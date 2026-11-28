package com.advisory.api.media;

import com.advisory.api.auth.AppUserRepository;
import com.advisory.api.auth.CurrentUser;
import com.advisory.api.media.MediaService.MediaItem;
import com.advisory.api.portal.Appointment;
import com.advisory.api.portal.AppointmentRepository;
import com.advisory.api.portal.ClientRepository;
import com.advisory.api.portal.EngagementRepository;
import com.advisory.api.video.VideoService;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * The meeting room page: joining, and what can be put on the shared stage.
 *
 * <p>Open to unauthenticated callers in the filter chain because a guest
 * from a confirmation email has no login. Every call is authorised here
 * instead: opening a session needs either a login (client or admin) or a
 * guest key; everything after that needs the meeting token the session
 * returned, in {@code X-Meet-Token}.
 */
@RestController
@RequestMapping("/api/meet/{id}")
public class MeetController {

    private static final List<String> SCREENSHOT_TYPES =
            List.of("image/png", "image/jpeg", "image/webp", "image/gif");
    private static final long SCREENSHOT_MAX = 15L * 1024 * 1024;

    private final AppointmentRepository appointments;
    private final ClientRepository clients;
    private final EngagementRepository engagements;
    private final AppUserRepository users;
    private final VideoService video;
    private final MeetTokens tokens;
    private final MediaService media;
    private final MediaStore store;
    private final JdbcClient jdbc;
    private final com.advisory.api.admin.AgendaService agenda;
    private final com.advisory.api.billing.BillingService billing;

    public MeetController(AppointmentRepository appointments, ClientRepository clients,
            EngagementRepository engagements, AppUserRepository users, VideoService video,
            MeetTokens tokens, MediaService media, MediaStore store, JdbcClient jdbc,
            com.advisory.api.admin.AgendaService agenda,
            com.advisory.api.billing.BillingService billing) {
        this.agenda = agenda;
        this.billing = billing;
        this.appointments = appointments;
        this.clients = clients;
        this.engagements = engagements;
        this.users = users;
        this.video = video;
        this.tokens = tokens;
        this.media = media;
        this.store = store;
        this.jdbc = jdbc;
    }

    public record SessionRequest(String guestKey) {}

    public record MeetingInfo(Long id, String clientName, String engagementTitle,
            Instant startsAt, Instant endsAt, String status) {}

    public record Session(String dailyUrl, String meetToken, String role, String name,
            MeetingInfo meeting) {}

    @PostMapping("/session")
    public Session session(@PathVariable Long id, @AuthenticationPrincipal Jwt jwt,
            @RequestBody(required = false) SessionRequest body) {
        Appointment a = appointments.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        String role;
        String name;
        Long userId = null;
        if (jwt != null) {
            CurrentUser user = CurrentUser.from(jwt);
            userId = user.id();
            String display = users.findById(user.id()).map(u -> u.getDisplayName())
                    .orElse(user.email());
            if (user.isAdmin()) {
                role = "host";
                name = display + " (DataPainters)";
            } else {
                if (!a.getClientId().equals(user.requireClientId())) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND);
                }
                role = "client";
                name = display;
            }
        } else if (body != null && body.guestKey() != null) {
            MeetTokens.Claims g = tokens.verify(body.guestKey(), id);
            if (!"guest".equals(g.role())) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,
                        "This meeting link is not valid");
            }
            role = "guest";
            name = g.name();
        } else {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,
                    "Sign in, or use the link from your confirmation email");
        }

        if (!"host".equals(role)) {
            if (!Appointment.CONFIRMED.equals(a.getStatus())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "The video call opens once we confirm the meeting");
            }
            if (Instant.now().isBefore(VideoService.opensAt(a))) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "The video room opens " + VideoService.JOIN_EARLY_MINUTES
                                + " minutes before the meeting starts");
            }
        }

        String dailyUrl = video.joinUrl(a, name, "host".equals(role));
        String token = tokens.issue(id, role, name, userId, VideoService.roomExpiry(a));
        return new Session(dailyUrl, token, role, name, info(a));
    }

    private MeetingInfo info(Appointment a) {
        String client = clients.findById(a.getClientId()).map(c -> c.getName()).orElse("");
        String engagement = engagements.findById(a.getEngagementId()).map(e -> e.getTitle())
                .orElse("");
        return new MeetingInfo(a.getId(), client, engagement, a.getStartsAt(), a.getEndsAt(),
                a.getStatus());
    }

    /* ------------------------------------------------- host: agenda & timer */

    /*
     * The host runs the meeting from inside the call window, so the agenda,
     * the notes and the clock are reachable with the room's host token --
     * the same credential that already lets them share from the library.
     * Clients and guests hold tokens too, and every method here refuses them.
     */

    public record NoteRequest(String body) {}

    public record StatusRequest(String status) {}

    /** The meeting clock as the call window shows it. No rates or amounts. */
    public record Timer(boolean running, Instant runningSince, int totalMinutes,
            boolean locked) {}

    @GetMapping("/agenda")
    public List<com.advisory.api.admin.MeetingController.AgendaItem> agenda(
            @PathVariable Long id,
            @RequestHeader(name = "X-Meet-Token", required = false) String token) {
        requireHost(tokens.verify(token, id));
        return agenda.agenda(id);
    }

    @org.springframework.web.bind.annotation.PutMapping("/agenda/{topicId}/note")
    public com.advisory.api.admin.MeetingController.AgendaItem saveNote(@PathVariable Long id,
            @PathVariable Long topicId,
            @RequestHeader(name = "X-Meet-Token", required = false) String token,
            @RequestBody NoteRequest r) {
        MeetTokens.Claims c = tokens.verify(token, id);
        requireHost(c);
        return agenda.saveNote(id, topicId, r.body(), c.userId());
    }

    @org.springframework.web.bind.annotation.PutMapping("/agenda/{topicId}/status")
    public com.advisory.api.admin.MeetingController.AgendaItem setStatus(@PathVariable Long id,
            @PathVariable Long topicId,
            @RequestHeader(name = "X-Meet-Token", required = false) String token,
            @RequestBody StatusRequest r) {
        requireHost(tokens.verify(token, id));
        return agenda.setStatus(id, topicId, r.status());
    }

    @GetMapping("/timer")
    public Timer timer(@PathVariable Long id,
            @RequestHeader(name = "X-Meet-Token", required = false) String token) {
        requireHost(tokens.verify(token, id));
        return timerOf(billing.timeSheet(id));
    }

    /**
     * Starts the clock. Called by the call window when the host joins, so it
     * is safe to call when a timer is already running: a second host joining,
     * or the same host rejoining, changes nothing.
     */
    @PostMapping("/timer/start")
    public Timer startTimer(@PathVariable Long id,
            @RequestHeader(name = "X-Meet-Token", required = false) String token) {
        MeetTokens.Claims c = tokens.verify(token, id);
        requireHost(c);
        com.advisory.api.billing.BillingService.TimeSheet sheet = billing.timeSheet(id);
        boolean running = sheet.entries().stream().anyMatch(e -> e.running());
        if (running || sheet.locked()) {
            return timerOf(sheet);
        }
        return timerOf(billing.startTimer(id, c.userId()));
    }

    /** Stops the clock. Called when the host leaves; harmless if nothing is running. */
    @PostMapping("/timer/stop")
    public Timer stopTimer(@PathVariable Long id,
            @RequestHeader(name = "X-Meet-Token", required = false) String token) {
        requireHost(tokens.verify(token, id));
        return timerOf(billing.stopTimer(id));
    }

    private static Timer timerOf(com.advisory.api.billing.BillingService.TimeSheet sheet) {
        Instant since = sheet.entries().stream()
                .filter(e -> e.running())
                .map(e -> e.startedAt())
                .findFirst().orElse(null);
        return new Timer(since != null, since, sheet.totalMinutes(), sheet.locked());
    }

    /* -------------------------------------------------------------- library */

    @GetMapping("/library")
    public List<MediaItem> library(@PathVariable Long id,
            @RequestHeader(name = "X-Meet-Token", required = false) String token) {
        requireHost(tokens.verify(token, id));
        return media.list(true);
    }

    /* -------------------------------------------------------------- uploads */

    public record UploadRequest(String fileName, String contentType, long sizeBytes) {}

    public record UploadSlot(String uploadUrl, String contentType, String uploadKey) {}

    /** Anyone in the call may put an image of their own on the stage. */
    @PostMapping("/uploads")
    public UploadSlot upload(@PathVariable Long id,
            @RequestHeader(name = "X-Meet-Token", required = false) String token,
            @RequestBody UploadRequest r) {
        tokens.verify(token, id);
        if (r.contentType() == null || !SCREENSHOT_TYPES.contains(r.contentType())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Share a PNG, JPEG, WebP or GIF image");
        }
        if (r.sizeBytes() <= 0 || r.sizeBytes() > SCREENSHOT_MAX) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Images can be up to 15 MB");
        }
        String key = "meetings/" + id + "/" + UUID.randomUUID()
                + MediaService.extension(r.contentType());
        MediaStore.Upload up = store.presignPut(key, r.contentType(), Duration.ofMinutes(10));
        return new UploadSlot(up.url(), up.contentType(), key);
    }

    /* --------------------------------------------------------------- shares */

    public record ShareRequest(Long mediaItemId, String uploadKey, String title) {}

    public record Share(Long id, String title, String contentType, String kind, String url,
            String sharedByRole, String sharedByName, Instant createdAt) {}

    /**
     * Puts something on the stage: a library item (hosts only) or an image
     * this person just uploaded. Returns a viewing URL every participant can
     * open; the page broadcasts it to the call.
     */
    @PostMapping("/shares")
    public Share share(@PathVariable Long id,
            @RequestHeader(name = "X-Meet-Token", required = false) String token,
            @RequestBody ShareRequest r) {
        MeetTokens.Claims c = tokens.verify(token, id);
        String key;
        String type;
        String title;
        Long itemId = null;
        if (r.mediaItemId() != null) {
            requireHost(c);
            MediaItem item = media.get(r.mediaItemId());
            if (!"ready".equals(item.status())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "That item is still uploading");
            }
            key = jdbc.sql("SELECT storage_key FROM media_item WHERE id = ?")
                    .param(item.id()).query(String.class).single();
            type = item.contentType();
            title = item.title();
            itemId = item.id();
        } else if (r.uploadKey() != null) {
            if (!r.uploadKey().startsWith("meetings/" + id + "/") || r.uploadKey().contains("..")) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown upload");
            }
            if (store.size(r.uploadKey()) <= 0) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "The image has not finished uploading");
            }
            key = r.uploadKey();
            type = typeFor(key);
            title = r.title() == null || r.title().isBlank() ? "Screenshot"
                    : r.title().trim().substring(0, Math.min(120, r.title().trim().length()));
        } else {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Nothing to share");
        }
        Long shareId = jdbc.sql("""
                INSERT INTO meeting_share (appointment_id, media_item_id, storage_key,
                    content_type, title, shared_by_role, shared_by_name)
                VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
                """).params(id, itemId, key, type, title, c.role(), c.name())
                .query(Long.class).single();
        return shares(id, token).stream().filter(s -> s.id().equals(shareId)).findFirst()
                .orElseThrow();
    }

    /** Everything shared in this meeting so far, with fresh viewing URLs. */
    @GetMapping("/shares")
    public List<Share> shares(@PathVariable Long id,
            @RequestHeader(name = "X-Meet-Token", required = false) String token) {
        tokens.verify(token, id);
        return jdbc.sql("""
                SELECT * FROM meeting_share WHERE appointment_id = ? ORDER BY created_at
                """).param(id).query((rs, i) -> new Share(rs.getLong("id"),
                rs.getString("title"), rs.getString("content_type"),
                kindOf(rs.getString("content_type")),
                store.presignGet(rs.getString("storage_key"), MediaService.VIEW_TTL),
                rs.getString("shared_by_role"), rs.getString("shared_by_name"),
                rs.getTimestamp("created_at").toInstant())).list();
    }

    static String kindOf(String contentType) {
        if (contentType.startsWith("video/")) {
            return "video";
        }
        if (contentType.equals("application/pdf")) {
            return "pdf";
        }
        return "image";
    }

    private static String typeFor(String key) {
        if (key.endsWith(".png")) return "image/png";
        if (key.endsWith(".jpg")) return "image/jpeg";
        if (key.endsWith(".webp")) return "image/webp";
        if (key.endsWith(".gif")) return "image/gif";
        return "application/octet-stream";
    }

    private static void requireHost(MeetTokens.Claims c) {
        if (!c.isHost()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Only the host can do that");
        }
    }
}
