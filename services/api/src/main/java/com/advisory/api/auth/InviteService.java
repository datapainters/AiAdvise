package com.advisory.api.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Issues and redeems single-use invite links.
 *
 * <p>This replaces emailing a one-time password. The email carries a token,
 * not a credential: it expires, it works once, and it cannot be replayed from
 * a mailbox a year later. The user chooses their own password at the end of
 * it, so no password the firm knows ever exists for that account.
 */
@Service
public class InviteService {

    private static final Logger log = LoggerFactory.getLogger(InviteService.class);

    /**
     * How long a link stays good. Long enough to survive a weekend and an
     * out-of-office, short enough that a forwarded mailbox is not a standing
     * key to the account.
     */
    public static final Duration LIFETIME = Duration.ofDays(7);

    /** 256 bits from a CSPRNG. Not guessable, so no rate limit is needed. */
    private static final int TOKEN_BYTES = 32;

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Base64.Encoder URL64 = Base64.getUrlEncoder().withoutPadding();

    private final InviteTokenRepository invites;
    private final AppUserRepository users;
    private final PasswordEncoder passwordEncoder;

    public InviteService(InviteTokenRepository invites, AppUserRepository users,
            PasswordEncoder passwordEncoder) {
        this.invites = invites;
        this.users = users;
        this.passwordEncoder = passwordEncoder;
    }

    /** The raw token, returned exactly once. Only its hash is stored. */
    public record Issued(String token, Instant expiresAt) {

        @Override
        public String toString() {
            return "Issued[token=***, expiresAt=" + expiresAt + "]";
        }
    }

    /**
     * Issues an invite, superseding any the user already has outstanding.
     *
     * <p>Superseding matters: without it, re-inviting someone leaves the
     * earlier link live, so a mail forwarded or a laptop left open still
     * carries a working key. Only the newest link should work.
     */
    @Transactional
    public Issued issue(Long userId, Long issuedBy) {
        List<InviteToken> outstanding = invites.findAllByUserIdAndUsedAtIsNull(userId);
        if (!outstanding.isEmpty()) {
            invites.deleteAll(outstanding);
            log.info("Superseded {} outstanding invite(s) for user {}",
                    outstanding.size(), userId);
        }

        byte[] raw = new byte[TOKEN_BYTES];
        RANDOM.nextBytes(raw);
        String token = URL64.encodeToString(raw);

        InviteToken invite = new InviteToken();
        invite.setUserId(userId);
        invite.setTokenHash(hash(token));
        invite.setExpiresAt(Instant.now().plus(LIFETIME));
        invite.setCreatedBy(issuedBy);
        invites.save(invite);

        log.info("Issued invite for user {}, expires {}", userId, invite.getExpiresAt());
        return new Issued(token, invite.getExpiresAt());
    }

    /**
     * Gives a user an unusable password.
     *
     * <p>password_hash is NOT NULL, and an account awaiting its invite must
     * not be reachable by any password at all. A BCrypt of a random UUID is
     * a well-formed hash that nothing can match, rather than a sentinel some
     * future comparison might treat as empty.
     */
    public String unusablePassword() {
        // One UUID, not two. Two joined by a colon is 73 bytes and BCrypt
        // rejects anything past 72, which turned every invite into a 500.
        // A single UUID is 36 bytes and 122 bits of entropy -- nothing has
        // to match it, ever, so more would buy nothing.
        return passwordEncoder.encode(UUID.randomUUID().toString());
    }

    /** Who an invite is for, without redeeming it. */
    @Transactional(readOnly = true)
    public AppUser peek(String token) {
        InviteToken invite = invites.findByTokenHash(hash(token)).orElse(null);

        // Expired, already used and never existed are all reported the same
        // way by the caller. Distinguishing them would tell someone holding
        // a stale link whether it was ever real.
        if (invite == null || !invite.isRedeemable(Instant.now())) {
            return null;
        }

        return users.findById(invite.getUserId())
                .filter(AppUser::isEnabled)
                .orElse(null);
    }

    /**
     * Redeems an invite and sets the user's password.
     *
     * <p>Marking the token used and saving the password happen in one
     * transaction, so a failure cannot leave a consumed token with no
     * password set -- which would lock the account out permanently.
     *
     * @return the user, now able to sign in, or null if the token is no good
     */
    @Transactional
    public AppUser accept(String token, String newPassword) {
        InviteToken invite = invites.findByTokenHash(hash(token)).orElse(null);
        if (invite == null || !invite.isRedeemable(Instant.now())) {
            return null;
        }

        AppUser user = users.findById(invite.getUserId())
                .filter(AppUser::isEnabled)
                .orElse(null);
        if (user == null) {
            return null;
        }

        AuthService.validatePassword(newPassword);

        user.setPasswordHash(passwordEncoder.encode(newPassword));
        // They chose it themselves, so there is nothing left to force.
        user.setMustChangePassword(false);
        // Redeeming an invite hands back a session -- the caller issues a
        // token and the browser lands in the portal signed in -- so this is
        // a sign-in and has to be recorded as one. Without it the admin's
        // user list said "never" for someone who was looking at the portal
        // at that moment, which is the opposite of what that column is for.
        user.setLastLoginAt(Instant.now());
        users.save(user);

        invite.setUsedAt(Instant.now());
        invites.save(invite);

        log.info("Invite redeemed by user {}", user.getId());
        return user;
    }

    /**
     * SHA-256, hex encoded.
     *
     * <p>Deliberately not BCrypt. The token is already 256 bits of CSPRNG
     * output so there is no dictionary to resist, and a per-row salt would
     * make lookup-by-token impossible without scanning the table.
     */
    private static String hash(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16));
                hex.append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is required of every JVM; this cannot happen.
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
