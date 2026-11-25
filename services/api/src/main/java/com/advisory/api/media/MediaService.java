package com.advisory.api.media;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * The media library: templates, pre-recorded videos and images the firm can
 * put on screen in a meeting. Uploads go straight from the browser to
 * storage; an item becomes usable once the upload is confirmed.
 */
@Service
public class MediaService {

    static final Map<String, List<String>> TYPES = Map.of(
            "template", List.of("application/pdf", "image/png", "image/jpeg", "image/webp"),
            "video", List.of("video/mp4", "video/webm"),
            "image", List.of("image/png", "image/jpeg", "image/gif", "image/webp"));

    static final Map<String, Long> MAX_BYTES = Map.of(
            "template", 50L * 1024 * 1024,
            "video", 500L * 1024 * 1024,
            "image", 15L * 1024 * 1024);

    public static final Duration VIEW_TTL = Duration.ofHours(3);

    public record MediaItem(Long id, String kind, String title, String description,
            String contentType, Long sizeBytes, String status, Instant createdAt,
            String createdBy) {}

    public record Created(MediaItem item, String uploadUrl, String contentType) {}

    private final JdbcClient jdbc;
    private final MediaStore store;

    public MediaService(JdbcClient jdbc, MediaStore store) {
        this.jdbc = jdbc;
        this.store = store;
    }

    public List<MediaItem> list(boolean readyOnly) {
        return jdbc.sql("""
                SELECT m.*, u.display_name FROM media_item m
                LEFT JOIN app_user u ON u.id = m.created_by
                WHERE m.archived_at IS NULL %s
                ORDER BY m.kind, lower(m.title)
                """.formatted(readyOnly ? "AND m.status = 'ready'" : ""))
                .query((rs, i) -> new MediaItem(rs.getLong("id"), rs.getString("kind"),
                        rs.getString("title"), rs.getString("description"),
                        rs.getString("content_type"), rs.getObject("size_bytes", Long.class),
                        rs.getString("status"), rs.getTimestamp("created_at").toInstant(),
                        rs.getString("display_name")))
                .list();
    }

    public MediaItem get(Long id) {
        return list(false).stream().filter(m -> m.id().equals(id)).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    public Created create(String kind, String title, String description, String contentType,
            long size, Long userId) {
        if (!TYPES.containsKey(kind)) {
            throw bad("Kind must be template, video or image");
        }
        if (contentType == null || !TYPES.get(kind).contains(contentType)) {
            throw bad(article(kind) + kind + " must be one of: " + String.join(", ", TYPES.get(kind)));
        }
        if (size <= 0 || size > MAX_BYTES.get(kind)) {
            throw bad(article(kind) + kind + " can be up to " + MAX_BYTES.get(kind) / (1024 * 1024) + " MB");
        }
        if (title == null || title.isBlank() || title.length() > 200) {
            throw bad("Give it a title of up to 200 characters");
        }
        String key = "library/" + kind + "/" + UUID.randomUUID() + extension(contentType);
        Long id = jdbc.sql("""
                INSERT INTO media_item (kind, title, description, storage_key, content_type,
                                        size_bytes, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
                """).params(kind, title.trim(), blank(description), key, contentType, size, userId)
                .query(Long.class).single();
        MediaStore.Upload up = store.presignPut(key, contentType, Duration.ofMinutes(30));
        return new Created(get(id), up.url(), up.contentType());
    }

    /** Marks an item ready once its file is really in storage. */
    public MediaItem complete(Long id) {
        String key = storageKey(id);
        long size = store.size(key);
        if (size <= 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "The file has not finished uploading");
        }
        jdbc.sql("UPDATE media_item SET status = 'ready', size_bytes = ? WHERE id = ?")
                .params(size, id).update();
        return get(id);
    }

    public void archive(Long id) {
        storageKey(id); // 404 for an unknown or already archived item
        // Past meetings may still reference the file through meeting_share,
        // so it stays in storage; only the catalogue entry goes.
        jdbc.sql("UPDATE media_item SET archived_at = now() WHERE id = ?").param(id).update();
    }

    public String viewUrl(Long id) {
        return store.presignGet(storageKey(id), VIEW_TTL);
    }

    private String storageKey(Long id) {
        return jdbc.sql("SELECT storage_key FROM media_item WHERE id = ? AND archived_at IS NULL")
                .param(id).query(String.class).optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    public static String extension(String contentType) {
        return switch (contentType) {
            case "application/pdf" -> ".pdf";
            case "image/png" -> ".png";
            case "image/jpeg" -> ".jpg";
            case "image/gif" -> ".gif";
            case "image/webp" -> ".webp";
            case "video/mp4" -> ".mp4";
            case "video/webm" -> ".webm";
            default -> "";
        };
    }

    private static String article(String kind) {
        return "image".equals(kind) ? "An " : "A ";
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static ResponseStatusException bad(String m) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, m);
    }
}
