package com.advisory.api.video;

import com.advisory.api.auth.AppUserRepository;
import com.advisory.api.auth.CurrentUser;
import com.advisory.api.billing.BillingService;
import com.advisory.api.billing.BillingService.TimeSheet;
import com.advisory.api.portal.Appointment;
import com.advisory.api.portal.AppointmentRepository;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Joining a meeting's video call, and the admin tools around it.
 *
 * <p>A join link is issued per person on request rather than stored: the
 * token in it names the person, and expires with the room.
 */
@RestController
public class VideoController {

    private final VideoService video;
    private final AppointmentRepository appointments;
    private final AppUserRepository users;
    private final BillingService billing;

    public VideoController(VideoService video, AppointmentRepository appointments,
            AppUserRepository users, BillingService billing) {
        this.video = video;
        this.appointments = appointments;
        this.users = users;
        this.billing = billing;
    }

    public record JoinLink(String url, Instant opensAt, Instant closesAt) {}

    public record VideoStatus(boolean enabled, boolean hasRoom, Instant opensAt,
            Instant closesAt) {}

    /** A client joining their own confirmed meeting. */
    @PostMapping("/api/appointments/{id}/join")
    public JoinLink join(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id) {
        CurrentUser user = CurrentUser.from(jwt);
        Appointment a = appointments.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!user.isAdmin() && !a.getClientId().equals(user.requireClientId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        if (!Appointment.CONFIRMED.equals(a.getStatus())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "The video call opens once we confirm the meeting");
        }
        if (Instant.now().isBefore(VideoService.opensAt(a))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "The video room opens " + VideoService.JOIN_EARLY_MINUTES
                            + " minutes before the meeting starts");
        }
        String name = users.findById(user.id()).map(u -> u.getDisplayName()).orElse(user.email());
        return new JoinLink(video.joinUrl(a, name, user.isAdmin()), VideoService.opensAt(a),
                VideoService.roomExpiry(a));
    }

    /** The firm joining as room owner, at any time before the room closes. */
    @PostMapping("/api/admin/appointments/{id}/join")
    public JoinLink adminJoin(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id) {
        CurrentUser user = CurrentUser.from(jwt);
        Appointment a = appointments.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        String name = users.findById(user.id()).map(u -> u.getDisplayName())
                .orElse("Data Painters");
        return new JoinLink(video.joinUrl(a, name + " (Data Painters)", true),
                VideoService.opensAt(a), VideoService.roomExpiry(a));
    }

    @GetMapping("/api/admin/appointments/{id}/video")
    public VideoStatus status(@PathVariable Long id) {
        Appointment a = appointments.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        return new VideoStatus(video.enabled(), a.hasVideo(), VideoService.opensAt(a),
                VideoService.roomExpiry(a));
    }

    /** Creates a missing room (or refreshes its expiry) for a live meeting. */
    @PostMapping("/api/admin/appointments/{id}/video")
    public VideoStatus createRoom(@PathVariable Long id) {
        Appointment a = appointments.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!video.enabled()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Video meetings are not configured: the Daily API key is missing");
        }
        if (Appointment.CANCELLED.equals(a.getStatus())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This meeting is cancelled");
        }
        if (!video.ensureRoom(a)) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "The video service did not create the room. Try again in a moment.");
        }
        return status(id);
    }

    /** Replaces the meeting's video time entry with the call's measured length. */
    @PostMapping("/api/admin/appointments/{id}/time/import-video")
    public TimeSheet importCallTime(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id) {
        Appointment a = appointments.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        VideoService.CallTime t = video.callTime(a);
        if (t.minutes() == 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "No finished call with two or more people was found in this meeting's room");
        }
        return billing.importVideoTime(id, t.minutes(), noteFor(t), CurrentUser.from(jwt).id());
    }

    static String noteFor(VideoService.CallTime t) {
        return "Video call: " + t.sessions() + (t.sessions() == 1 ? " session" : " sessions")
                + ", " + t.minutes() + " min";
    }
}
