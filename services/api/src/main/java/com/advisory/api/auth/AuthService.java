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

    public String issueToken(AppUser user) {
        Instant now = Instant.now();

        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer("advisory-api")
                .issuedAt(now)
                .expiresAt(now.plus(TOKEN_LIFETIME))
                .subject(String.valueOf(user.getId()))
                .claim("email", user.getEmail())
                .claim("name", user.getDisplayName())
                .claim("role", user.getRole())
                // Null for admins, who are not scoped to a client.
                .claim("cid", user.getClientId())
                .build();

        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        return jwtEncoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
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
