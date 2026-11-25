package com.advisory.api.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class MeetTokensTest {

    private final MeetTokens tokens = new MeetTokens(new SecretKeySpec(
            "a-test-signing-key-that-is-at-least-32-bytes".getBytes(StandardCharsets.UTF_8),
            "HmacSHA256"));

    @Test
    void roundTripsTheClaims() {
        String t = tokens.issue(42, "guest", "Riley", null, Instant.now().plusSeconds(600));
        MeetTokens.Claims c = tokens.verify(t, 42);
        assertThat(c.role()).isEqualTo("guest");
        assertThat(c.name()).isEqualTo("Riley");
        assertThat(c.isHost()).isFalse();
    }

    @Test
    void isBoundToOneMeeting() {
        String t = tokens.issue(42, "client", "Dana", 7L, Instant.now().plusSeconds(600));
        assertThatThrownBy(() -> tokens.verify(t, 43)).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void rejectsExpiredAndTamperedTokens() {
        String expired = tokens.issue(1, "host", "A", 1L, Instant.now().minusSeconds(1));
        assertThatThrownBy(() -> tokens.verify(expired, 1)).isInstanceOf(ResponseStatusException.class);

        String t = tokens.issue(1, "guest", "A", null, Instant.now().plusSeconds(600));
        // Promote the guest to host by editing the payload: the signature no longer matches.
        String payload = new String(java.util.Base64.getUrlDecoder().decode(t.split("\\.")[0]),
                StandardCharsets.UTF_8).replace("\"guest\"", "\"host\"");
        String forged = java.util.Base64.getUrlEncoder().withoutPadding()
                .encodeToString(payload.getBytes(StandardCharsets.UTF_8)) + "." + t.split("\\.")[1];
        assertThatThrownBy(() -> tokens.verify(forged, 1)).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void aTokenFromADifferentKeyIsRejected() {
        MeetTokens other = new MeetTokens(new SecretKeySpec(
                "another-signing-key-that-is-at-least-32-bytes".getBytes(StandardCharsets.UTF_8),
                "HmacSHA256"));
        String t = other.issue(1, "host", "A", 1L, Instant.now().plusSeconds(600));
        assertThatThrownBy(() -> tokens.verify(t, 1)).isInstanceOf(ResponseStatusException.class);
    }
}
