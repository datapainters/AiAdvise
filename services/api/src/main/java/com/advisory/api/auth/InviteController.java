package com.advisory.api.auth;

import com.advisory.api.portal.ClientRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Accepting an invite.
 *
 * <p>These two routes are unauthenticated by necessity: the person using them
 * has no password yet, which is the entire point. The token in the path is
 * the credential, and it is 256 bits of CSPRNG output, used once, with an
 * expiry.
 *
 * <p>Both routes answer 404 for a token that is expired, already redeemed, or
 * never existed. Telling the three apart would let someone holding a stale
 * link learn whether it was ever real and who it belonged to.
 */
@RestController
@RequestMapping("/api/invites")
public class InviteController {

    private final InviteService invites;
    private final AuthService auth;
    private final ClientRepository clients;
    private final LoginAudit audit;

    public InviteController(InviteService invites, AuthService auth,
            ClientRepository clients, LoginAudit audit) {
        this.invites = invites;
        this.auth = auth;
        this.clients = clients;
        this.audit = audit;
    }

    /** Only what the page needs to greet someone. No ids, no role. */
    public record InviteView(String email, String displayName, String clientName) {}

    public record AcceptRequest(@NotBlank String password) {}

    public record AcceptResponse(String token, Instant expiresAt,
            AuthController.UserView user) {}

    @GetMapping("/{token}")
    public InviteView peek(@PathVariable String token) {
        AppUser user = invites.peek(token);
        if (user == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }

        return new InviteView(
                user.getEmail(),
                user.getDisplayName(),
                user.getClientId() == null
                        ? null
                        : clients.findById(user.getClientId())
                                .map(c -> c.getName())
                                .orElse(null));
    }

    /**
     * Sets the password and signs the user straight in.
     *
     * <p>Returning a session here rather than bouncing to the sign-in page is
     * deliberate: the user has just proved they hold the invite and chosen a
     * password, so asking them to type it again immediately adds a step and
     * an opportunity to mistype.
     */
    @PostMapping("/{token}/accept")
    public AcceptResponse accept(
            @PathVariable String token,
            @Valid @RequestBody AcceptRequest request,
            HttpServletRequest http) {

        AppUser user = invites.accept(token, request.password());
        if (user == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }

        audit.record(LoginEvent.INVITE_ACCEPTED, user.getEmail(), user.getId(), http);

        return new AcceptResponse(
                auth.issueToken(user),
                Instant.now().plus(AuthService.TOKEN_LIFETIME),
                AuthController.UserView.of(user));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public AuthController.AuthError handleBadPassword(IllegalArgumentException e) {
        return new AuthController.AuthError(e.getMessage());
    }
}
