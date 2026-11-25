package com.advisory.api.messaging;

import com.advisory.api.auth.AppUser;
import com.advisory.api.auth.AppUserRepository;
import com.advisory.api.mail.MailSender;
import com.advisory.api.mail.Notifications;
import com.advisory.api.media.MediaService;
import com.advisory.api.media.MediaStore;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

/**
 * The written conversation on a topic.
 *
 * <p>A topic is the thing a client wants covered. Where an engagement is run
 * by message, or by both message and video, each topic carries a thread: the
 * client's people and Data Painters post back and forth on it.
 *
 * <p>Who may read a thread from the client side: the person who raised the
 * topic, anyone on the engagement's team, and the client account's owner and
 * managers. That widens V8, which made a topic visible only to its creator,
 * for the people explicitly put on the engagement -- a conversation nobody
 * else on the engagement could read would not be one. Someone at the client
 * who is not on the engagement still sees only the topics they raised.
 *
 * <p>Refusals are 404, as in V8: ids are sequential, and a 403 on a guessed
 * id would let someone count threads they cannot read.
 */
@Service
public class ThreadService {

    private static final Logger log = LoggerFactory.getLogger(ThreadService.class);

    private final JdbcClient jdbc;
    private final AppUserRepository users;
    private final MediaStore store;
    private final Notifications notifications;
    private final MailSender mail;

    public ThreadService(JdbcClient jdbc, AppUserRepository users, MediaStore store,
            Notifications notifications, MailSender mail) {
        this.jdbc = jdbc;
        this.users = users;
        this.store = store;
        this.notifications = notifications;
        this.mail = mail;
    }

    /* ---------------------------------------------------------------- views */

    /** One row of an inbox: a topic and where its conversation stands. */
    public record Summary(Long topicId, String title, String status, Long engagementId,
            String engagementTitle, Long clientId, String clientName, String raisedBy,
            int messageCount, Instant lastActivityAt, String lastAuthor, String lastSide,
            String lastSnippet, boolean open) {}

    public record Attachment(String title, String kind, String url) {}

    /** {@code minutes} is only ever filled for a Data Painters reader. */
    public record Message(Long id, String authorName, String side, String body,
            Instant createdAt, Integer minutes, boolean charged, List<Attachment> attachments) {}

    public record Thread(Long topicId, String title, String detail, String desiredOutcome,
            String status, Long engagementId, String engagementTitle, String communication,
            Long clientId, String clientName, String raisedBy, Instant raisedAt,
            boolean canPost, String closedReason, List<Message> messages) {}

    private static final String SUMMARY_SELECT = """
            SELECT t.id, t.title, t.status, t.created_at, t.created_by_user_id,
                   e.id AS engagement_id, e.title AS engagement_title, e.communication,
                   e.status AS engagement_status, c.id AS client_id, c.name AS client_name,
                   cu.display_name AS raised_by,
                   (SELECT count(*) FROM topic_message m WHERE m.topic_id = t.id) AS messages,
                   lm.created_at AS last_at, lm.display_name AS last_author,
                   lm.author_side AS last_side, lm.body AS last_body
            FROM topic t
            JOIN engagement e ON e.id = t.engagement_id
            JOIN client c ON c.id = e.client_id
            LEFT JOIN app_user cu ON cu.id = t.created_by_user_id
            LEFT JOIN LATERAL (
                SELECT m.created_at, m.author_side, m.body, u.display_name
                FROM topic_message m
                LEFT JOIN app_user u ON u.id = m.author_user_id
                WHERE m.topic_id = t.id
                ORDER BY m.created_at DESC, m.id DESC
                LIMIT 1) lm ON true
            WHERE (e.communication IN ('message', 'both')
                   OR EXISTS (SELECT 1 FROM topic_message m WHERE m.topic_id = t.id))
            """;

    /** What a client-side reader may see. Bound with :uid, :cid and :manages. */
    private static final String CLIENT_SCOPE = """
             AND e.client_id = :cid
             AND (:manages
                  OR t.created_by_user_id = :uid
                  OR EXISTS (SELECT 1 FROM engagement_member em
                             WHERE em.engagement_id = e.id AND em.user_id = :uid))
            """;

    private static Summary summary(ResultSet rs, int i) throws SQLException {
        Timestamp last = rs.getTimestamp("last_at");
        String body = rs.getString("last_body");
        boolean open = !"closed".equals(rs.getString("engagement_status"))
                && List.of("message", "both").contains(rs.getString("communication"));
        return new Summary(rs.getLong("id"), rs.getString("title"), rs.getString("status"),
                rs.getLong("engagement_id"), rs.getString("engagement_title"),
                rs.getLong("client_id"), rs.getString("client_name"),
                rs.getString("raised_by"), rs.getInt("messages"),
                (last == null ? rs.getTimestamp("created_at") : last).toInstant(),
                rs.getString("last_author"), rs.getString("last_side"),
                body == null ? null : body.length() > 160 ? body.substring(0, 160) + "…" : body,
                open);
    }

    /**
     * The threads a person can see, most recently active first.
     *
     * @param engagementId narrow to one engagement, or null
     * @param clientId     narrow to one client, or null; ignored for a client
     *                     reader, who is always held to their own
     */
    public List<Summary> list(AppUser reader, Long engagementId, Long clientId) {
        StringBuilder sql = new StringBuilder(SUMMARY_SELECT);
        Map<String, Object> p = new HashMap<>();
        if (!reader.isAdmin()) {
            sql.append(CLIENT_SCOPE);
            p.put("cid", reader.getClientId());
            p.put("uid", reader.getId());
            p.put("manages", reader.managesClient());
        } else if (clientId != null) {
            sql.append(" AND e.client_id = :cid");
            p.put("cid", clientId);
        }
        if (engagementId != null) {
            sql.append(" AND e.id = :eid");
            p.put("eid", engagementId);
        }
        sql.append(" ORDER BY COALESCE(lm.created_at, t.created_at) DESC, t.id DESC");
        return jdbc.sql(sql.toString()).params(p).query(ThreadService::summary).list();
    }

    private record TopicRow(Long id, String title, String detail, String desiredOutcome,
            String status, Long createdBy, Instant createdAt, Long engagementId,
            String engagementTitle, String communication, String engagementStatus,
            Long clientId, String clientName, String raisedBy) {}

    /** Loads a topic if this reader may see it; 404 otherwise. */
    private TopicRow visible(AppUser reader, Long topicId) {
        StringBuilder sql = new StringBuilder("""
                SELECT t.id, t.title, t.detail, t.desired_outcome, t.status,
                       t.created_by_user_id, t.created_at, e.id AS engagement_id,
                       e.title AS engagement_title, e.communication,
                       e.status AS engagement_status, c.id AS client_id,
                       c.name AS client_name, cu.display_name AS raised_by
                FROM topic t
                JOIN engagement e ON e.id = t.engagement_id
                JOIN client c ON c.id = e.client_id
                LEFT JOIN app_user cu ON cu.id = t.created_by_user_id
                WHERE t.id = :tid
                """);
        Map<String, Object> p = new HashMap<>();
        p.put("tid", topicId);
        if (!reader.isAdmin()) {
            sql.append(CLIENT_SCOPE);
            p.put("cid", reader.getClientId());
            p.put("uid", reader.getId());
            p.put("manages", reader.managesClient());
        }
        return jdbc.sql(sql.toString()).params(p).query((rs, i) -> new TopicRow(
                rs.getLong("id"), rs.getString("title"), rs.getString("detail"),
                rs.getString("desired_outcome"), rs.getString("status"),
                rs.getObject("created_by_user_id", Long.class),
                rs.getTimestamp("created_at").toInstant(), rs.getLong("engagement_id"),
                rs.getString("engagement_title"), rs.getString("communication"),
                rs.getString("engagement_status"), rs.getLong("client_id"),
                rs.getString("client_name"), rs.getString("raised_by"))).optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    /** Why nobody can post here, or null if they can. */
    private static String closedReason(TopicRow t) {
        if ("closed".equals(t.engagementStatus())) {
            return "This engagement is closed.";
        }
        if (!List.of("message", "both").contains(t.communication())) {
            return "This engagement is run by video meetings, so its topics do not take messages.";
        }
        return null;
    }

    public Thread thread(AppUser reader, Long topicId) {
        TopicRow t = visible(reader, topicId);

        Map<Long, List<Attachment>> attachments = new HashMap<>();
        jdbc.sql("""
                SELECT a.message_id, a.title, a.content_type, a.storage_key
                FROM topic_message_attachment a
                JOIN topic_message m ON m.id = a.message_id
                WHERE m.topic_id = ? ORDER BY a.id
                """).param(topicId).query(rs -> {
                    String type = rs.getString("content_type");
                    attachments.computeIfAbsent(rs.getLong("message_id"), k -> new ArrayList<>())
                            .add(new Attachment(rs.getString("title"),
                                    type.startsWith("video/") ? "video"
                                            : type.equals("application/pdf") ? "pdf" : "image",
                                    store.presignGet(rs.getString("storage_key"),
                                            MediaService.VIEW_TTL)));
                });

        boolean staff = reader.isAdmin();
        List<Message> messages = jdbc.sql("""
                SELECT m.id, m.author_side, m.body, m.created_at, m.minutes, m.charge_id,
                       u.display_name
                FROM topic_message m
                LEFT JOIN app_user u ON u.id = m.author_user_id
                WHERE m.topic_id = ? ORDER BY m.created_at, m.id
                """).param(topicId).query((rs, i) -> new Message(rs.getLong("id"),
                rs.getString("display_name") == null
                        ? ("team".equals(rs.getString("author_side"))
                                ? "Data Painters" : "Former team member")
                        : rs.getString("display_name"),
                rs.getString("author_side"), rs.getString("body"),
                rs.getTimestamp("created_at").toInstant(),
                // How long a reply took is the firm's business until it is a
                // line on an invoice.
                staff ? rs.getObject("minutes", Integer.class) : null,
                staff && rs.getObject("charge_id") != null,
                attachments.getOrDefault(rs.getLong("id"), List.of()))).list();

        String reason = closedReason(t);
        return new Thread(t.id(), t.title(), t.detail(), t.desiredOutcome(), t.status(),
                t.engagementId(), t.engagementTitle(), t.communication(), t.clientId(),
                t.clientName(), t.raisedBy(), t.createdAt(), reason == null, reason, messages);
    }

    /* ----------------------------------------------------------------- post */

    /**
     * Adds a post to a topic's thread and tells everyone else on it.
     *
     * @param minutes      time the reply took; honoured for Data Painters only
     * @param mediaItemIds library items to attach; honoured for Data Painters only
     */
    @Transactional
    public Thread post(AppUser author, Long topicId, String text, Integer minutes,
            List<Long> mediaItemIds) {
        TopicRow t = visible(author, topicId);
        String reason = closedReason(t);
        if (reason != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, reason);
        }
        String body = text == null ? "" : text.trim();
        if (body.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Write a message first");
        }
        if (body.length() > 20000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "That message is too long. Keep it under 20,000 characters.");
        }

        boolean staff = author.isAdmin();
        Integer spent = staff ? minutes : null;
        if (spent != null && (spent < 1 || spent > 1440)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Time spent must be between 1 and 1,440 minutes");
        }

        Long messageId = jdbc.sql("""
                INSERT INTO topic_message (topic_id, author_user_id, author_side, body, minutes)
                VALUES (?, ?, ?, ?, ?) RETURNING id
                """).params(topicId, author.getId(), staff ? "team" : "client", body, spent)
                .query(Long.class).single();

        List<String> attached = new ArrayList<>();
        if (staff && mediaItemIds != null) {
            for (Long itemId : mediaItemIds.stream().distinct().limit(10).toList()) {
                String[] item = jdbc.sql("""
                        SELECT storage_key, content_type, title FROM media_item
                        WHERE id = ? AND archived_at IS NULL AND status = 'ready'
                        """).param(itemId).query((rs, i) -> new String[] {
                            rs.getString("storage_key"), rs.getString("content_type"),
                            rs.getString("title")}).optional()
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
                                "One of the attachments is no longer in the media library"));
                jdbc.sql("""
                        INSERT INTO topic_message_attachment
                            (message_id, media_item_id, storage_key, content_type, title)
                        VALUES (?, ?, ?, ?, ?)
                        """).params(messageId, itemId, item[0], item[1], item[2]).update();
                attached.add(item[2]);
            }
        }

        log.info("Message {} posted on topic {} by user {}", messageId, topicId, author.getId());
        afterCommit(() -> notifyPost(t, author, body, attached));
        return thread(author, topicId);
    }

    /**
     * Tells the engagement's Data Painters people that a client has raised a
     * topic on a message engagement. The topic is the opening post of its
     * thread, so it is announced like one.
     */
    public void topicRaised(AppUser author, Long topicId) {
        TopicRow t = visible(author, topicId);
        if (closedReason(t) != null) {
            return;
        }
        String opening = t.detail() == null || t.detail().isBlank()
                ? "(No background given.)" : t.detail();
        afterCommit(() -> notifyPost(t, author, opening, List.of()));
    }

    /* -------------------------------------------------------- notifications */

    /**
     * Mails everyone on the thread except the author: the engagement's team
     * from both sides, the person who raised the topic, and anyone who has
     * already posted. If that leaves nobody from Data Painters -- an
     * engagement with no team yet -- the firm's inbox gets it, so a client's
     * message is never posted into a void.
     */
    private void notifyPost(TopicRow t, AppUser author, String body, List<String> attached) {
        try {
            Map<String, Boolean> recipients = new LinkedHashMap<>(); // email -> is staff
            jdbc.sql("""
                    SELECT DISTINCT u.email, (u.role = 'ADMIN') AS staff
                    FROM app_user u
                    WHERE u.enabled AND u.id <> :author AND (
                        u.id IN (SELECT user_id FROM engagement_member WHERE engagement_id = :eid)
                        OR u.id = :creator
                        OR u.id IN (SELECT author_user_id FROM topic_message WHERE topic_id = :tid))
                    """)
                    .param("author", author.getId())
                    .param("eid", t.engagementId())
                    .param("creator", t.createdBy() == null ? -1L : t.createdBy())
                    .param("tid", t.id())
                    .query(rs -> {
                        recipients.put(rs.getString("email"), rs.getBoolean("staff"));
                    });

            if (!author.isAdmin() && !recipients.containsValue(Boolean.TRUE)) {
                String inbox = mail.adminRecipient();
                if (inbox != null && !inbox.isBlank()) {
                    recipients.put(inbox, true);
                }
            }

            String authorName = author.isAdmin()
                    ? author.getDisplayName() + " (Data Painters)" : author.getDisplayName();
            for (Map.Entry<String, Boolean> r : recipients.entrySet()) {
                String url = mail.baseUrl() + (r.getValue()
                        ? "/admin?view=messages&topic=" : "/portal?view=messages&topic=")
                        + t.id();
                notifications.threadUpdate(r.getKey(), authorName, t.clientName(),
                        t.engagementTitle(), t.title(), body, attached, url);
            }
            log.info("Told {} people about a post on topic {}", recipients.size(), t.id());
        } catch (RuntimeException e) {
            // The post is saved; a mail problem must not undo it.
            log.warn("Could not send notifications for topic {}: {}", t.id(), e.getMessage());
        }
    }

    private static void afterCommit(Runnable work) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(
                    new TransactionSynchronization() {
                        @Override
                        public void afterCommit() {
                            work.run();
                        }
                    });
        } else {
            work.run();
        }
    }

    public AppUser reader(Long userId) {
        return users.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
    }
}
