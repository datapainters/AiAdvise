package com.advisory.api.auth;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    public static final Duration TOKEN_LIFETIME = Duration.ofHours(12);

    private final AppUserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final JwtEncoder jwtEncoder;

    /**
     * A real BCrypt hash of a random value, compared against when the address
     * is unknown so that a failed login costs the same time either way.
     * Without it, response timing tells an attacker which addresses have
     * accounts. Generated at startup rather than hard-coded, so it is a
     * genuine hash at this encoder's cost factor.
     */
    private final String dummyHash;

    public AuthService(AppUserRepository users, PasswordEncoder passwordEncoder,
            JwtEncoder jwtEncoder) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.jwtEncoder = jwtEncoder;
        this.dummyHash = passwordEncoder.encode(UUID.randomUUID().toString());
    }

    /** Thrown for every login failure, with no detail about which part failed. */
    public static class AuthenticationFailed extends RuntimeException {
        public AuthenticationFailed() {
            super("Invalid email or password");
        }
    }

    /** Minimum length for a password a human chooses. */
    public static final int MIN_PASSWORD_LENGTH = 12;

    /**
     * Changes a password after verifying the current one, and clears any
     * pending forced reset.
     *
     * <p>The current password is re-checked even though the caller already
     * holds a valid token: a token can be lifted from a browser left open,
     * and changing a password is exactly the action that would lock the real
     * owner out.
     *
     * @return the saved user, so the caller can issue a replacement token. The
     *     caller's existing token may carry {@link #ROLE_PASSWORD_RESET},
     *     which is useless for anything but this call, and tokens are not
     *     revocable, so a fresh one has to come back in the response.
     */
    @Transactional
    public AppUser changePassword(Long userId, String currentPassword, String newPassword) {
        AppUser user = users.findById(userId).orElseThrow(AuthenticationFailed::new);

        if (!passwordEncoder.matches(currentPassword, user.getPasswordHash())) {
            log.info("Rejected password change for user {}: current password wrong", userId);
            throw new AuthenticationFailed();
        }

        if (newPassword == null || newPassword.length() < MIN_PASSWORD_LENGTH) {
            throw new IllegalArgumentException(
                    "New password must be at least " + MIN_PASSWORD_LENGTH + " characters");
        }

        if (passwordEncoder.matches(newPassword, user.getPasswordHash())) {
            throw new IllegalArgumentException("New password must differ from the current one");
        }

        user.setPasswordHash(passwordEncoder.encode(newPassword));
        user.setMustChangePassword(false);
        AppUser saved = users.save(user);

        log.info("Password changed for user {}", userId);
        return saved;
    }

    @Transactional
    public AppUser authenticate(String email, String password) {
        Optional<AppUser> found = users.findByEmailIgnoringCase(email);

        // Always run the hash comparison, even when there is no such user.
        String hash = found.map(AppUser::getPasswordHash).orElse(dummyHash);
        boolean matches = passwordEncoder.matches(password, hash);

        if (found.isEmpty() || !matches || !found.get().isEnabled()) {
            log.info("Failed login for {}", redact(email));
            throw new AuthenticationFailed();
        }

        AppUser user = found.get();
        user.setLastLoginAt(Instant.now());
        return users.save(user);
    }

    /**
     * The role carried by a token whose owner still has to choose a password.
     *
     * <p>It is not a role in the database -- no row ever holds it. Issuing it
     * in place of the real role is what makes the forced reset an actual
     * boundary rather than a redirect the front end can be talked out of: the
     * token authenticates, so {@code /api/auth/me} and
     * {@code /api/auth/password} work, but it carries no CLIENT or ADMIN
     * authority, so every other endpoint rejects it in the filter chain. A
     * one-time password therefore cannot read a single client record until it
     * has been replaced.
     */
    public static final String ROLE_PASSWORD_RESET = "PASSWORD_RESET";

    public String issueToken(AppUser user) {
        Instant now = Instant.now();

        String role = user.isMustChangePassword() ? ROLE_PASSWORD_RESET : user.getRole();

        JwtClaimsSet.Builder claims = JwtClaimsSet.builder()
                .issuer("advisory-api")
                .issuedAt(now)
                .expiresAt(now.plus(TOKEN_LIFETIME))
                .subject(String.valueOf(user.getId()))
                .claim("email", user.getEmail())
                .claim("name", user.getDisplayName())
                .claim("role", role);

        // Admins are not scoped to a client, so they have no cid. The claim
        // has to be OMITTED rather than set to null: JwtClaimsSet.Builder
        // asserts non-null and throws IllegalArgumentException, which
        // surfaces as a 500 on an otherwise successful login. CurrentUser
        // already treats an absent cid as "no client".
        if (user.getClientId() != null) {
            claims.claim("cid", user.getClientId());
        }

        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        return jwtEncoder.encode(JwtEncoderParameters.from(header, claims.build())).getTokenValue();
    }

    /** Keeps the local part out of logs while staying useful for support. */
    private static String redact(String email) {
        if (email == null) {
            return "(none)";
        }
        int at = email.indexOf('@');
        return at <= 0 ? "***" : "***" + email.substring(at);
    }
}
