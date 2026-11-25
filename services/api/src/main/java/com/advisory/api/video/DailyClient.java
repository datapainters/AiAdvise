package com.advisory.api.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.ProxySelector;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueRequest;

/**
 * A thin client for the Daily REST API (https://docs.daily.co/reference/rest-api).
 *
 * <p>The API key comes from Secrets Manager ({@code DAILY_API_KEY_SECRET_ARN})
 * when deployed, or {@code DAILY_API_KEY} locally. Without one, video is
 * simply off: {@link #enabled()} is false and nothing calls out. The key is
 * read lazily and retried, so a secret populated after the service started
 * is picked up without a redeploy.
 */
@Component
public class DailyClient {

    private static final Logger log = LoggerFactory.getLogger(DailyClient.class);
    private static final String BASE = "https://api.daily.co/v1";
    private static final Duration RETRY_KEY_AFTER = Duration.ofMinutes(5);

    public record Room(String name, String url) {}

    /** One call in a room. Duration is in seconds; ongoing calls have none yet. */
    public record Session(String id, Instant startTime, long durationSeconds, boolean ongoing,
            int maxParticipants, long participantSeconds) {}

    public static class DailyException extends RuntimeException {
        final int status;

        DailyException(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    private final ObjectMapper json = new ObjectMapper();
    // The default selector honours https.proxyHost, which matters in
    // environments that route egress through a proxy.
    private final HttpClient http = HttpClient.newBuilder()
            .proxy(ProxySelector.getDefault())
            .connectTimeout(Duration.ofSeconds(5))
            .build();

    private final String configuredKey;
    private volatile String key;
    private volatile Instant lastKeyAttempt = Instant.EPOCH;

    public DailyClient(@Value("${DAILY_API_KEY:}") String configuredKey) {
        this.configuredKey = configuredKey;
    }

    /** True when an API key is available. */
    public boolean enabled() {
        return apiKey() != null;
    }

    private String apiKey() {
        if (key != null) {
            return key;
        }
        if (!configuredKey.isBlank()) {
            key = configuredKey.trim();
            return key;
        }
        String arn = System.getenv("DAILY_API_KEY_SECRET_ARN");
        if (arn == null || arn.isBlank()
                || Instant.now().isBefore(lastKeyAttempt.plus(RETRY_KEY_AFTER))) {
            return null;
        }
        synchronized (this) {
            lastKeyAttempt = Instant.now();
            try (SecretsManagerClient sm = SecretsManagerClient.create()) {
                String raw = sm.getSecretValue(GetSecretValueRequest.builder().secretId(arn)
                        .build()).secretString();
                String value = raw == null ? "" : raw.trim();
                // Accept {"key": "..."} or the bare key.
                if (value.startsWith("{")) {
                    JsonNode node = json.readTree(value).get("key");
                    value = node == null ? "" : node.asText().trim();
                }
                if (value.isEmpty() || value.equals("REPLACE_ME")) {
                    log.warn("The Daily API key secret is empty; video meetings are off");
                    return null;
                }
                key = value;
                log.info("Daily API key loaded from Secrets Manager; video meetings are on");
                return key;
            } catch (Exception e) {
                log.warn("Could not read the Daily API key ({}); video meetings are off",
                        e.getClass().getSimpleName());
                return null;
            }
        }
    }

    /* --------------------------------------------------------------- rooms */

    /**
     * Creates a private room, or updates the expiry of an existing one.
     *
     * @param existingName the room already on the meeting, or null
     * @param newName the name to use when a room has to be created
     */
    public Room upsertRoom(String existingName, String newName, Instant expires) {
        ObjectNode props = json.createObjectNode();
        props.put("exp", expires.getEpochSecond());
        props.put("eject_at_room_exp", true);
        props.put("enable_prejoin_ui", true);
        props.put("enable_chat", true);
        props.put("enable_screenshare", true);

        if (existingName != null) {
            try {
                ObjectNode body = json.createObjectNode();
                body.put("privacy", "private");
                body.set("properties", props);
                JsonNode r = call("POST", "/rooms/" + enc(existingName), body);
                return new Room(r.path("name").asText(), r.path("url").asText());
            } catch (DailyException e) {
                if (e.status != 404) {
                    throw e;
                }
                // Deleted on Daily's side; fall through and make a new one.
            }
        }
        ObjectNode body = json.createObjectNode();
        body.put("name", newName);
        body.put("privacy", "private");
        body.set("properties", props);
        JsonNode r = call("POST", "/rooms", body);
        return new Room(r.path("name").asText(), r.path("url").asText());
    }

    public void deleteRoom(String name) {
        try {
            call("DELETE", "/rooms/" + enc(name), null);
        } catch (DailyException e) {
            if (e.status != 404) {
                throw e;
            }
        }
    }

    /* -------------------------------------------------------------- tokens */

    /**
     * A meeting token for one person.
     *
     * @param notBefore earliest join time, or null for no limit
     */
    public String token(String roomName, String userName, boolean owner, Instant notBefore,
            Instant expires) {
        ObjectNode props = json.createObjectNode();
        props.put("room_name", roomName);
        props.put("user_name", userName);
        props.put("is_owner", owner);
        props.put("exp", expires.getEpochSecond());
        if (notBefore != null) {
            props.put("nbf", notBefore.getEpochSecond());
        }
        ObjectNode body = json.createObjectNode();
        body.set("properties", props);
        return call("POST", "/meeting-tokens", body).path("token").asText();
    }

    /* ------------------------------------------------------------ sessions */

    public List<Session> sessions(String roomName) {
        JsonNode r = call("GET", "/meetings?room=" + enc(roomName) + "&limit=100", null);
        List<Session> out = new ArrayList<>();
        for (JsonNode m : r.path("data")) {
            // Daily bills per participant-minute: the sum of every
            // participant's time in the call, not the call's length.
            long participantSeconds = 0;
            for (JsonNode p : m.path("participants")) {
                participantSeconds += p.path("duration").asLong(0);
            }
            out.add(new Session(m.path("id").asText(),
                    Instant.ofEpochSecond(m.path("start_time").asLong()),
                    m.path("duration").asLong(0),
                    m.path("ongoing").asBoolean(false),
                    m.path("max_participants").asInt(0),
                    participantSeconds));
        }
        return out;
    }

    /* ------------------------------------------------------------- plumbing */

    private JsonNode call(String method, String path, JsonNode body) {
        String k = apiKey();
        if (k == null) {
            throw new DailyException(503, "Video meetings are not configured");
        }
        try {
            HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(BASE + path))
                    .timeout(Duration.ofSeconds(10))
                    .header("Authorization", "Bearer " + k)
                    .header("Content-Type", "application/json");
            b = switch (method) {
                case "GET" -> b.GET();
                case "DELETE" -> b.DELETE();
                default -> b.method(method, HttpRequest.BodyPublishers.ofString(
                        body == null ? "{}" : json.writeValueAsString(body)));
            };
            HttpResponse<String> res = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() >= 300) {
                // Daily's error bodies name the problem without echoing secrets.
                String info = res.body() == null ? "" : res.body();
                log.warn("Daily {} {} -> {} {}", method, path.replaceAll("\\?.*", ""),
                        res.statusCode(), info.length() > 200 ? info.substring(0, 200) : info);
                throw new DailyException(res.statusCode(), "Daily request failed ("
                        + res.statusCode() + ")");
            }
            return res.body() == null || res.body().isBlank()
                    ? json.createObjectNode() : json.readTree(res.body());
        } catch (IOException e) {
            throw new DailyException(502, "Could not reach Daily: " + e.getClass().getSimpleName());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new DailyException(502, "Interrupted calling Daily");
        }
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }
}
