package com.advisory.api.video;

import com.advisory.api.portal.Appointment;
import com.advisory.api.portal.AppointmentRepository;
import com.advisory.api.video.DailyClient.Session;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Video rooms for meetings.
 *
 * <p>Rules: a meeting gets a private room when it is confirmed. The room
 * expires two hours after the meeting's scheduled end, and is kept in step
 * when the meeting moves. Cancelling deletes it. Clients join with a token
 * that works from 15 minutes before the start; the firm joins as owner at
 * any time.
 *
 * <p>Daily being down must never block confirming or cancelling a meeting,
 * so the lifecycle methods log and carry on. The admin console can create a
 * missing room later.
 */
@Service
public class VideoService {

    private static final Logger log = LoggerFactory.getLogger(VideoService.class);

    public static final int JOIN_EARLY_MINUTES = 15;
    public static final int GRACE_AFTER_END_MINUTES = 120;

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final char[] ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789".toCharArray();

    private final DailyClient daily;
    private final AppointmentRepository appointments;
    private final JdbcClient jdbc;

    private String roomPrefix = "dp";

    /** Keeps a development copy's rooms apart from production's in one Daily account. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    void setRoomPrefix(
            @org.springframework.beans.factory.annotation.Value("${VIDEO_ROOM_PREFIX:dp}") String p) {
        this.roomPrefix = p == null || p.isBlank() ? "dp" : p.trim();
    }

    public VideoService(DailyClient daily, AppointmentRepository appointments, JdbcClient jdbc) {
        this.daily = daily;
        this.appointments = appointments;
        this.jdbc = jdbc;
    }

    /**
     * Copies the room's finished calls from Daily into video_session, so the
     * engagement costs report keeps them after the room is deleted.
     * Idempotent: a session already copied is updated in place.
     *
     * @return the number of sessions recorded
     */
    public int syncUsage(Appointment a) {
        if (a.getVideoRoomName() == null || !daily.enabled()) {
            return 0;
        }
        int n = 0;
        for (Session s : daily.sessions(a.getVideoRoomName())) {
            if (s.ongoing()) {
                continue;
            }
            jdbc.sql("""
                    INSERT INTO video_session (id, appointment_id, room_name, started_at,
                        duration_seconds, participant_seconds, max_participants)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (id) DO UPDATE SET duration_seconds = EXCLUDED.duration_seconds,
                        participant_seconds = EXCLUDED.participant_seconds,
                        max_participants = EXCLUDED.max_participants, synced_at = now()
                    """)
                    .params(s.id(), a.getId(), a.getVideoRoomName(),
                            java.sql.Timestamp.from(s.startTime()), (int) s.durationSeconds(),
                            s.participantSeconds(), s.maxParticipants())
                    .update();
            n++;
        }
        return n;
    }

    public boolean enabled() {
        return daily.enabled();
    }

    public static Instant roomExpiry(Appointment a) {
        return a.getEndsAt().plus(GRACE_AFTER_END_MINUTES, ChronoUnit.MINUTES);
    }

    public static Instant opensAt(Appointment a) {
        return a.getStartsAt().minus(JOIN_EARLY_MINUTES, ChronoUnit.MINUTES);
    }

    /**
     * Creates the meeting's room, or brings an existing one's expiry up to
     * date. Returns whether the meeting has a room afterwards.
     */
    public boolean ensureRoom(Appointment a) {
        if (!daily.enabled()) {
            return false;
        }
        try {
            DailyClient.Room room = daily.upsertRoom(a.getVideoRoomName(), newName(a),
                    roomExpiry(a));
            boolean changed = !room.name().equals(a.getVideoRoomName());
            a.setVideoRoomName(room.name());
            a.setVideoRoomUrl(room.url());
            if (changed) {
                appointments.save(a);
                log.info("Video room {} created for appointment {}", room.name(), a.getId());
            }
            return true;
        } catch (RuntimeException e) {
            log.warn("Could not set up a video room for appointment {}: {}", a.getId(),
                    e.getMessage());
            return a.getVideoRoomName() != null;
        }
    }

    /** Deletes the meeting's room, if it has one. */
    public void removeRoom(Appointment a) {
        String name = a.getVideoRoomName();
        if (name == null) {
            return;
        }
        if (daily.enabled()) {
            // Keep the cost record of any calls before the history goes.
            try {
                syncUsage(a);
            } catch (RuntimeException e) {
                log.warn("Could not record video usage for appointment {}: {}", a.getId(),
                        e.getMessage());
            }
        }
        a.setVideoRoomName(null);
        a.setVideoRoomUrl(null);
        appointments.save(a);
        if (!daily.enabled()) {
            return;
        }
        try {
            daily.deleteRoom(name);
            log.info("Video room {} deleted with appointment {}", name, a.getId());
        } catch (RuntimeException e) {
            // It expires on its own; nothing is left reachable for long.
            log.warn("Could not delete video room {}: {}", name, e.getMessage());
        }
    }

    /**
     * A personal join link: the room URL with a meeting token.
     *
     * @param owner true for the firm, which may join at any time and admit people
     */
    public String joinUrl(Appointment a, String userName, boolean owner) {
        if (a.getVideoRoomName() == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "This meeting has no video room yet");
        }
        Instant exp = roomExpiry(a);
        if (Instant.now().isAfter(exp)) {
            throw new ResponseStatusException(HttpStatus.GONE, "This meeting's video room has closed");
        }
        try {
            String token = daily.token(a.getVideoRoomName(),
                    userName == null || userName.isBlank() ? "Guest" : userName, owner,
                    owner ? null : opensAt(a), exp);
            return a.getVideoRoomUrl() + "?t=" + token;
        } catch (RuntimeException e) {
            log.warn("Could not issue a meeting token for appointment {}: {}", a.getId(),
                    e.getMessage());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "The video service did not respond. Try again in a moment.");
        }
    }

    public record CallTime(int minutes, int sessions, int ignoredSessions) {}

    /**
     * Total length of the calls held in the meeting's room, in whole minutes
     * rounded up. Only finished sessions where at least two people were
     * present count: a host waiting alone is not billable time.
     */
    public CallTime callTime(Appointment a) {
        if (a.getVideoRoomName() == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "This meeting has no video room");
        }
        List<Session> sessions;
        try {
            sessions = daily.sessions(a.getVideoRoomName());
        } catch (RuntimeException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Could not read call history from the video service");
        }
        long seconds = 0;
        int counted = 0;
        int ignored = 0;
        for (Session s : sessions) {
            if (!s.ongoing() && s.maxParticipants() >= 2 && s.durationSeconds() > 0) {
                seconds += s.durationSeconds();
                counted++;
            } else {
                ignored++;
            }
        }
        return new CallTime((int) ((seconds + 59) / 60), counted, ignored);
    }

    private String newName(Appointment a) {
        StringBuilder sb = new StringBuilder(roomPrefix).append("-m").append(a.getId()).append('-');
        for (int i = 0; i < 8; i++) {
            sb.append(ALPHABET[RANDOM.nextInt(ALPHABET.length)]);
        }
        return sb.toString();
    }
}
