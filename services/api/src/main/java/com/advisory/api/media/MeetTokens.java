package com.advisory.api.media;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Tokens scoped to one meeting: who is in the call (host, client or guest)
 * and until when. They authorise the in-call share endpoints, and a guest
 * token in a confirmation email lets someone with no portal login join.
 *
 * <p>Signed with a key derived from, but different to, the login JWT key,
 * so a meeting token can never be presented as a login and vice versa.
 */
@Component
public class MeetTokens {

    public record Claims(long appointmentId, String role, String name, Long userId,
            Instant expires) {

        public boolean isHost() {
            return "host".equals(role);
        }
    }

    private static final ObjectMapper JSON = new ObjectMapper();
    private final byte[] key;

    public MeetTokens(SecretKey jwtSigningKey) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(jwtSigningKey.getEncoded(), "HmacSHA256"));
            this.key = mac.doFinal("meet-session-v1".getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public String issue(long appointmentId, String role, String name, Long userId,
            Instant expires) {
        ObjectNode o = JSON.createObjectNode();
        o.put("apt", appointmentId);
        o.put("role", role);
        o.put("name", name);
        if (userId != null) {
            o.put("uid", userId);
        }
        o.put("exp", expires.getEpochSecond());
        String payload = b64(o.toString().getBytes(StandardCharsets.UTF_8));
        return payload + "." + b64(hmac(payload));
    }

    /** Verifies and returns the claims, or answers 401. */
    public Claims verify(String token, long appointmentId) {
        if (token == null || !token.contains(".")) {
            throw unauthorized();
        }
        String[] parts = token.split("\\.", 2);
        if (!MessageDigest.isEqual(b64(hmac(parts[0])).getBytes(StandardCharsets.UTF_8),
                parts[1].getBytes(StandardCharsets.UTF_8))) {
            throw unauthorized();
        }
        try {
            JsonNode o = JSON.readTree(Base64.getUrlDecoder().decode(parts[0]));
            Instant exp = Instant.ofEpochSecond(o.path("exp").asLong());
            if (Instant.now().isAfter(exp) || o.path("apt").asLong() != appointmentId) {
                throw unauthorized();
            }
            return new Claims(o.path("apt").asLong(), o.path("role").asText(),
                    o.path("name").asText(), o.has("uid") ? o.path("uid").asLong() : null, exp);
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw unauthorized();
        }
    }

    private byte[] hmac(String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String b64(byte[] b) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    private static ResponseStatusException unauthorized() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED,
                "This meeting link has expired or is not valid");
    }
}
