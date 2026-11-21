package com.advisory.api.media;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Local development storage: files on disk, served by
 * {@link LocalMediaController} behind URLs signed the way S3's are, so the
 * browser code is identical in both setups. Never used when MEDIA_BUCKET is
 * set.
 */
public class LocalMediaStore implements MediaStore {

    private final Path root;
    private final String baseUrl;
    private final byte[] key;

    public LocalMediaStore(Path root, String baseUrl, byte[] signingKey) {
        this.root = root;
        this.baseUrl = baseUrl.replaceAll("/$", "");
        this.key = signingKey;
    }

    Path path(String storageKey) {
        Path p = root.resolve(storageKey).normalize();
        if (!p.startsWith(root)) {
            throw new IllegalArgumentException("Bad key");
        }
        return p;
    }

    String sign(String method, String storageKey, long exp) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            byte[] sig = mac.doFinal((method + "\n" + storageKey + "\n" + exp)
                    .getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(sig);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    boolean verify(String method, String storageKey, long exp, String sig) {
        return Instant.now().getEpochSecond() <= exp
                && java.security.MessageDigest.isEqual(
                        sign(method, storageKey, exp).getBytes(StandardCharsets.UTF_8),
                        sig.getBytes(StandardCharsets.UTF_8));
    }

    private String url(String method, String storageKey, Duration ttl) {
        long exp = Instant.now().plus(ttl).getEpochSecond();
        return baseUrl + "/api/media-local/" + storageKey + "?exp=" + exp + "&sig="
                + sign(method, storageKey, exp);
    }

    @Override
    public Upload presignPut(String storageKey, String contentType, Duration ttl) {
        return new Upload(url("PUT", storageKey, ttl), contentType);
    }

    @Override
    public String presignGet(String storageKey, Duration ttl) {
        return url("GET", storageKey, ttl);
    }

    @Override
    public long size(String storageKey) {
        try {
            Path p = path(storageKey);
            return Files.exists(p) ? Files.size(p) : -1;
        } catch (IOException e) {
            return -1;
        }
    }

    @Override
    public void delete(String storageKey) {
        try {
            Files.deleteIfExists(path(storageKey));
        } catch (IOException e) {
            // Best effort in development.
        }
    }
}
