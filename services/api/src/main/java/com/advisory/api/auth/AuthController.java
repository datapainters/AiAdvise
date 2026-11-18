package com.advisory.api.auth;

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

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;

    public AuthController(AuthService auth) {
        this.auth = auth;
    }

    public record LoginRequest(
            @NotBlank @Email String email,
            @NotBlank String password) {}

    public record LoginResponse(String token, Instant expiresAt, UserView user) {}

    public record UserView(Long id, String email, String name, String role, Long clientId) {

        static UserView of(AppUser u) {
            return new UserView(u.getId(), u.getEmail(), u.getDisplayName(),
                    u.getRole(), u.getClientId());
        }
    }

    @PostMapping("/login")
    public LoginResponse login(@Valid @RequestBody LoginRequest request) {
        AppUser user = auth.authenticate(request.email(), request.password());
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
        Long clientId = jwt.getClaim("cid") == null
                ? null
                : ((Number) jwt.getClaim("cid")).longValue();

        return new UserView(
                Long.valueOf(jwt.getSubject()),
                jwt.getClaimAsString("email"),
                jwt.getClaimAsString("name"),
                jwt.getClaimAsString("role"),
                clientId);
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
