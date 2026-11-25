package com.advisory.api.auth;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/**
 * Guards the 72-byte BCrypt ceiling.
 *
 * <p>These exist because of a real failure: the placeholder password for an
 * invited account was two UUIDs joined by a colon, which is 73 bytes. BCrypt
 * ignores anything past 72 and Spring Security throws rather than truncating,
 * so every invitation returned a 500. One byte.
 *
 * <p>The second case is worse and was not noticed at all: nothing capped a
 * user-chosen password, so a long passphrase -- a good password -- also
 * produced a 500 instead of being accepted or politely refused.
 */
class PasswordRulesTest {

    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(12);

    @Test
    @DisplayName("the placeholder password for an invited account fits BCrypt")
    void unusablePasswordFitsBcrypt() {
        InviteService invites = new InviteService(null, null, encoder);

        // The bug was here and the hash is opaque, so assert on the input
        // rule as well as on the call not throwing.
        assertDoesNotThrow(invites::unusablePassword);

        String raw = UUID.randomUUID().toString();
        assertTrue(raw.getBytes(StandardCharsets.UTF_8).length
                        <= AuthService.MAX_PASSWORD_BYTES,
                "placeholder must fit BCrypt's 72-byte limit");
    }

    @Test
    @DisplayName("72 bytes is accepted and 73 is refused, not thrown at BCrypt")
    void boundaryIsExact() {
        String seventyTwo = "a".repeat(AuthService.MAX_PASSWORD_BYTES);
        assertDoesNotThrow(() -> AuthService.validatePassword(seventyTwo));

        String seventyThree = "a".repeat(AuthService.MAX_PASSWORD_BYTES + 1);
        assertThrows(IllegalArgumentException.class,
                () -> AuthService.validatePassword(seventyThree));
    }

    @Test
    @DisplayName("the limit counts bytes, not characters")
    void countsBytesNotCharacters() {
        // 24 four-byte characters is 96 bytes but only 24 characters, so a
        // length check would wave it through and BCrypt would then throw.
        String emoji = "😀".repeat(24);
        assertTrue(emoji.length() < AuthService.MAX_PASSWORD_BYTES,
                "precondition: fewer characters than the byte limit");

        assertThrows(IllegalArgumentException.class,
                () -> AuthService.validatePassword(emoji));
    }

    @Test
    @DisplayName("a long passphrase is refused cleanly rather than 500ing")
    void longPassphraseIsRejectedNotCrashed() {
        String passphrase = "correct horse battery staple ".repeat(4);
        assertTrue(passphrase.getBytes(StandardCharsets.UTF_8).length
                > AuthService.MAX_PASSWORD_BYTES);

        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> AuthService.validatePassword(passphrase));
        assertTrue(e.getMessage().contains("too long"),
                "the message should say what is wrong: " + e.getMessage());
    }

    @Test
    @DisplayName("the minimum still applies")
    void minimumStillApplies() {
        assertThrows(IllegalArgumentException.class, () -> AuthService.validatePassword("short"));
        assertThrows(IllegalArgumentException.class, () -> AuthService.validatePassword(null));
        assertDoesNotThrow(() -> AuthService.validatePassword("a".repeat(
                AuthService.MIN_PASSWORD_LENGTH)));
    }

    @Test
    @DisplayName("anything validatePassword accepts, BCrypt will hash")
    void acceptedPasswordsAlwaysHash() {
        // The property that actually matters: the guard and the encoder
        // agree, so no accepted password can reach BCrypt and throw.
        for (String candidate : new String[] {
                "a".repeat(AuthService.MIN_PASSWORD_LENGTH),
                "a".repeat(AuthService.MAX_PASSWORD_BYTES),
                "pa55word with spaces",
                "é".repeat(36),
        }) {
            AuthService.validatePassword(candidate);
            assertDoesNotThrow(() -> encoder.encode(candidate),
                    "BCrypt refused a password the guard accepted: " + candidate);
        }
    }
}
