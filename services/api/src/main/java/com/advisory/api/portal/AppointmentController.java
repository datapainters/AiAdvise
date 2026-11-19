package com.advisory.api.portal;

import com.advisory.api.auth.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * The client side of scheduling: book open topics into a meeting, and see
 * what is already booked.
 *
 * <p>Admins reach the same data through {@code /api/admin/appointments},
 * which adds the cross-client views and the Meeting Manager.
 */
@RestController
@RequestMapping("/api/appointments")
public class AppointmentController {

    private final AppointmentRepository appointments;
    private final EngagementRepository engagements;
    private final TopicRepository topics;
    private final SchedulingService scheduling;

    public AppointmentController(AppointmentRepository appointments,
            EngagementRepository engagements, TopicRepository topics,
            SchedulingService scheduling) {
        this.appointments = appointments;
        this.engagements = engagements;
        this.topics = topics;
        this.scheduling = scheduling;
    }

    public record AppointmentView(
            Long id,
            Long clientId,
            Long engagementId,
            String engagementTitle,
            Instant startsAt,
            Instant endsAt,
            int durationMinutes,
            String status,
            int topicCount) {}

    public record BookRequest(
            @NotNull Long engagementId,
            @NotNull Instant startsAt,
            @NotNull Integer durationMinutes,
            List<Long> topicIds) {}

    @GetMapping
    public List<AppointmentView> list(@AuthenticationPrincipal Jwt jwt) {
        CurrentUser user = CurrentUser.from(jwt);
        List<Appointment> found = user.isAdmin()
                ? appointments.findAllByOrderByStartsAtDesc()
                : appointments.findAllByClientIdOrderByStartsAtDesc(user.requireClientId());
        return decorate(found);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public AppointmentView book(
            @AuthenticationPrincipal Jwt jwt, @Valid @RequestBody BookRequest request) {

        CurrentUser user = CurrentUser.from(jwt);

        // An admin booking on a client's behalf is scoped to the engagement's
        // owner; a client is scoped to themselves.
        Long clientId = user.isAdmin()
                ? engagements.findById(request.engagementId())
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND))
                        .getClientId()
                : user.requireClientId();

        Appointment saved = scheduling.book(
                clientId,
                user.id(),
                request.engagementId(),
                request.startsAt(),
                request.durationMinutes(),
                request.topicIds() == null ? List.of() : request.topicIds());

        return decorate(List.of(saved)).get(0);
    }

    @PostMapping("/{id}/cancel")
    public AppointmentView cancel(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id) {
        CurrentUser user = CurrentUser.from(jwt);

        Appointment appointment = appointments.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        if (!user.isAdmin() && !appointment.getClientId().equals(user.requireClientId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }

        return decorate(List.of(scheduling.cancel(id))).get(0);
    }

    /**
     * Adds the engagement title and agenda size.
     *
     * <p>Batched rather than per row: a list of twenty appointments would
     * otherwise be forty-one queries, and this is the screen a client opens
     * first.
     */
    private List<AppointmentView> decorate(List<Appointment> found) {
        if (found.isEmpty()) {
            return List.of();
        }

        List<Long> ids = found.stream().map(Appointment::getId).toList();
        Map<Long, Long> counts = topics.findAllByAppointmentIdIn(ids).stream()
                .collect(Collectors.groupingBy(Topic::getAppointmentId, Collectors.counting()));

        Map<Long, String> titles = engagements
                .findAllById(found.stream().map(Appointment::getEngagementId).distinct().toList())
                .stream()
                .collect(Collectors.toMap(Engagement::getId, Engagement::getTitle,
                        (a, b) -> a));

        Function<Appointment, AppointmentView> toView = a -> new AppointmentView(
                a.getId(),
                a.getClientId(),
                a.getEngagementId(),
                titles.getOrDefault(a.getEngagementId(), "(engagement removed)"),
                a.getStartsAt(),
                a.getEndsAt(),
                a.getDurationMinutes(),
                a.getStatus(),
                counts.getOrDefault(a.getId(), 0L).intValue());

        return found.stream().map(toView).toList();
    }
}
