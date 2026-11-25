package com.advisory.api.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;
    private final AppUserRepository users;
    private final LoginAudit audit;

    public AuthController(AuthService auth, AppUserRepository users, LoginAudit audit) {
        this.auth = auth;
        this.users = users;
        this.audit = audit;
    }

    public record LoginRequest(
            @NotBlank @Email String email,
            @NotBlank String password) {}

    public record LoginResponse(String token, Instant expiresAt, UserView user) {}

    public record UserView(Long id, String email, String name, String role, Long clientId,
            boolean mustChangePassword, String teamRole, String clientRole) {

        public static UserView of(AppUser u) {
            return new UserView(u.getId(), u.getEmail(), u.getDisplayName(),
                    u.getRole(), u.getClientId(), u.isMustChangePassword(),
                    u.isAdmin() && u.getTeamRole() == null
                            ? AppUser.TEAM_ADMIN : u.getTeamRole(),
                    u.isAdmin() ? null
                            : u.getClientRole() == null ? AppUser.CLIENT_MEMBER
                                    : u.getClientRole());
        }
    }

    public record ChangePasswordRequest(
            @NotBlank String currentPassword,
            @NotBlank String newPassword) {}

    @PostMapping("/login")
    public LoginResponse login(
            @Valid @RequestBody LoginRequest request, HttpServletRequest http) {

        AppUser user;
        try {
            user = auth.authenticate(request.email(), request.password());
        } catch (AuthService.AuthenticationFailed e) {
            // Recorded before rethrowing. A failed attempt is the half of the
            // audit log that matters, and it is also the half that would be
            // lost if this were left to the exception handler.
            audit.record(LoginEvent.FAILURE, request.email(), null, http);
            throw e;
        }

        audit.record(LoginEvent.SUCCESS, request.email(), user.getId(), http);

        return new LoginResponse(
                auth.issueToken(user),
                Instant.now().plus(AuthService.TOKEN_LIFETIME),
                UserView.of(user));
    }

    /**
     * Who the bearer token says you are. The SPA calls this on load to decide
     * whether a stored token is still good, rather than waiting for the first
     * real request to fail.
     */
    @GetMapping("/me")
    public UserView me(@AuthenticationPrincipal Jwt jwt) {
        // Read the user rather than echoing the token. A token is valid for
        // 12 hours, so claims go stale: an account disabled or a password
        // changed after issue would otherwise go unnoticed until expiry.
        CurrentUser caller = CurrentUser.from(jwt);

        AppUser user = users.findById(caller.id())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));

        if (!user.isEnabled()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Account disabled");
        }

        return UserView.of(user);
    }

    /**
     * Returns a replacement token on success. The caller's old one may carry
     * only {@code PASSWORD_RESET}, and tokens cannot be revoked, so the new
     * one is the only way out of the forced-reset state without logging in
     * again.
     */
    @PostMapping("/password")
    public LoginResponse changePassword(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody ChangePasswordRequest request,
            HttpServletRequest http) {

        AppUser user = auth.changePassword(
                CurrentUser.from(jwt).id(), request.currentPassword(), request.newPassword());

        audit.record(LoginEvent.PASSWORD_CHANGE, user.getEmail(), user.getId(), http);

        return new LoginResponse(
                auth.issueToken(user),
                Instant.now().plus(AuthService.TOKEN_LIFETIME),
                UserView.of(user));
    }

    /** Password rule violations are the caller's to fix, so say what is wrong. */
    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public AuthError handleInvalidPassword(IllegalArgumentException e) {
        return new AuthError(e.getMessage());
    }

    public record AuthError(String error) {}

    /**
     * Every credential failure returns the same 401 with the same body. Which
     * half was wrong is not the caller's business.
     */
    @ExceptionHandler(AuthService.AuthenticationFailed.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    public AuthError handleAuthenticationFailed(AuthService.AuthenticationFailed e) {
        return new AuthError("Invalid email or password");
    }
}
