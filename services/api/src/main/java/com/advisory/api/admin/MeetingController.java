package com.advisory.api.admin;

import com.advisory.api.auth.AppUserRepository;
import com.advisory.api.auth.CurrentUser;
import com.advisory.api.billing.BillingService;
import com.advisory.api.video.VideoService;
import com.advisory.api.mail.Notifications;
import com.advisory.api.portal.Appointment;
import com.advisory.api.portal.AppointmentRepository;
import com.advisory.api.portal.Client;
import com.advisory.api.portal.ClientRepository;
import com.advisory.api.portal.Company;
import com.advisory.api.portal.CompanyRepository;
import com.advisory.api.portal.Engagement;
import com.advisory.api.portal.EngagementRepository;
import com.advisory.api.portal.MeetingNote;
import com.advisory.api.portal.MeetingNoteRepository;
import com.advisory.api.portal.SchedulingService;
import com.advisory.api.portal.Topic;
import com.advisory.api.portal.TopicRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Appointments, the Meeting Manager, and the client detail view.
 *
 * <p>Everything under {@code /api/admin} is gated to ROLE_ADMIN in the filter
 * chain, so there are no per-method role checks here.
 */
@RestController
@RequestMapping("/api/admin")
public class MeetingController {

    private static final Logger log = LoggerFactory.getLogger(MeetingController.class);

    private final AppointmentRepository appointments;
    private final ClientRepository clients;
    private final EngagementRepository engagements;
    private final TopicRepository topics;
    private final MeetingNoteRepository notes;
    private final AppUserRepository users;
    private final SchedulingService scheduling;
    private final Notifications notifications;
    private final CompanyRepository companies;
    private final BillingService billing;
    private final VideoService video;
    private final com.advisory.api.media.MeetTokens meetTokens;
    private final String mailBaseUrl;
    private final AgendaService agenda;
    private final PeopleService people;

    public MeetingController(AppointmentRepository appointments, ClientRepository clients,
            EngagementRepository engagements, TopicRepository topics,
            MeetingNoteRepository notes, AppUserRepository users,
            SchedulingService scheduling, Notifications notifications,
            CompanyRepository companies, BillingService billing, VideoService video,
            com.advisory.api.media.MeetTokens meetTokens,
            AgendaService agenda, PeopleService people,
            @org.springframework.beans.factory.annotation.Value("${APP_BASE_URL:https://ai.datapainters.com}")
                    String mailBaseUrl) {
        this.meetTokens = meetTokens;
        this.agenda = agenda;
        this.people = people;
        this.mailBaseUrl = mailBaseUrl.replaceAll("/$", "");
        this.billing = billing;
        this.video = video;
        this.appointments = appointments;
        this.clients = clients;
        this.engagements = engagements;
        this.topics = topics;
        this.notes = notes;
        this.users = users;
        this.scheduling = scheduling;
        this.notifications = notifications;
        this.companies = companies;
    }

    /* -------------------------------------------------------- appointments */

    public record AppointmentRow(
            Long id, Long clientId, String clientName, Long engagementId,
            String engagementTitle, Instant startsAt, Instant endsAt, int durationMinutes,
            String status, int topicCount, int notedCount, boolean video, String title) {}

    private static Grid.Spec<AppointmentRow> appointmentSpec() {
        return new Grid.Spec<AppointmentRow>()
                .add("startsAt", "When", "datetime", AppointmentRow::startsAt)
                .add("title", "Meeting", "text", AppointmentRow::title)
                .add("clientName", "Client", "text", AppointmentRow::clientName)
                .add("engagementTitle", "Engagement", "text", AppointmentRow::engagementTitle)
                .add("durationMinutes", "Length (min)", "number",
                        AppointmentRow::durationMinutes)
                .add("status", "Status", "text", AppointmentRow::status)
                .add("topicCount", "Agenda items", "number", AppointmentRow::topicCount)
                .add("notedCount", "Noted", "number", AppointmentRow::notedCount);
    }

    @GetMapping("/appointments/columns")
    public List<Grid.Column> appointmentColumns() {
        return appointmentSpec().columns();
    }

    @GetMapping("/appointments")
    public Grid.Page<AppointmentRow> listAppointments(
            @RequestParam(name = "filter", required = false) List<String> filter,
            @RequestParam(defaultValue = "startsAt:desc") String sort,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size) {

        return Grid.apply(rows(appointments.findAllByOrderByStartsAtDesc()),
                appointmentSpec().accessors(), Grid.parse(filter), sort, page, size);
    }

    /**
     * Every meeting starting in a window, for the calendar. Unpaged: a
     * calendar needs the whole month, and the window is capped at 100 days.
     */
    @GetMapping("/calendar")
    public List<AppointmentRow> calendar(@RequestParam Instant from, @RequestParam Instant to) {
        if (!to.isAfter(from) || java.time.Duration.between(from, to).toDays() > 100) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Ask for a window of up to 100 days");
        }
        return rows(appointments.findAllByStartsAtBetweenOrderByStartsAtAsc(from, to));
    }

    public record UpdateAppointment(
            @NotNull Instant startsAt,
            @NotNull Integer durationMinutes,
            @NotNull String status,
            String title) {}

    public record CreateAppointment(
            @NotNull Long engagementId,
            @jakarta.validation.constraints.NotBlank String title,
            @NotNull Instant startsAt,
            @NotNull Integer durationMinutes,
            /** requested or confirmed; confirmed is the default for a meeting the firm sets up. */
            String status,
            Boolean billable) {}

    /**
     * A meeting the firm sets up itself, on any engagement that is not
     * closed. Unlike a client booking it may be in the past (to record a
     * meeting that already happened) and outside the published hours.
     *
     * <p>Created as confirmed unless asked otherwise, which is announced to
     * the client the same way as confirming a request is.
     */
    @org.springframework.web.bind.annotation.PostMapping("/appointments")
    @org.springframework.web.bind.annotation.ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public AppointmentRow createAppointment(@AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateAppointment request) {
        Engagement engagement = engagements.findById(request.engagementId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "No such engagement"));
        if ("closed".equals(engagement.getStatus())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "That engagement is closed. Reopen it to add a meeting.");
        }
        String status = request.status() == null ? Appointment.CONFIRMED : request.status();
        if (!List.of(Appointment.REQUESTED, Appointment.CONFIRMED).contains(status)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "A new meeting is either requested or confirmed");
        }
        Instant start = scheduling.normaliseAndValidate(
                request.startsAt(), request.durationMinutes(), true);

        Appointment appointment = new Appointment();
        appointment.setClientId(engagement.getClientId());
        appointment.setEngagementId(engagement.getId());
        appointment.setTitle(request.title());
        appointment.setStartsAt(start);
        appointment.setDurationMinutes(request.durationMinutes());
        appointment.setStatus(status);
        appointment.setBillable(request.billable() == null || request.billable());
        appointment.setRequestedBy(CurrentUser.from(jwt).id());
        appointments.saveAndFlush(appointment);
        log.info("Created appointment {} on engagement {}", appointment.getId(),
                engagement.getId());

        if (Appointment.CONFIRMED.equals(status)) {
            video.ensureRoom(appointment);
            // Telling a client about a meeting that has already happened
            // would only confuse them.
            if (appointment.getEndsAt().isAfter(Instant.now())) {
                announceConfirmed(appointment);
            }
        }
        return rows(List.of(appointment)).get(0);
    }

    public record AddAgendaItem(
            @jakarta.validation.constraints.NotBlank String title, String desiredOutcome) {}

    @org.springframework.web.bind.annotation.PostMapping("/appointments/{id}/topics")
    public AgendaItem addAgendaItem(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id,
            @Valid @RequestBody AddAgendaItem request) {
        Appointment appointment = appointments.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (Appointment.CANCELLED.equals(appointment.getStatus())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This meeting is cancelled");
        }
        return agenda.addItem(id, appointment.getEngagementId(), request.title(),
                request.desiredOutcome(), CurrentUser.from(jwt).id());
    }

    /**
     * Reschedules or re-lengthens a meeting.
     *
     * <p>Start time and length go through the same validation booking does,
     * because the database constraints that enforce 30-minute blocks and
     * aligned starts do not care which endpoint wrote the row.
     */
    @PutMapping("/appointments/{id}")
    @Transactional
    public AppointmentRow updateAppointment(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable Long id, @Valid @RequestBody UpdateAppointment request) {

        Appointment appointment = appointments.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        if (!List.of(Appointment.REQUESTED, Appointment.CONFIRMED, Appointment.COMPLETED,
                Appointment.CANCELLED).contains(request.status())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown status");
        }

        // allowPast: an admin correcting the record of a call that already
        // happened needs a past start; a client booking never does.
        Instant start = scheduling.normaliseAndValidate(
                request.startsAt(), request.durationMinutes(), true);

        String previous = appointment.getStatus();
        appointment.setStartsAt(start);
        appointment.setDurationMinutes(request.durationMinutes());
        appointment.setStatus(request.status());
        if (request.title() != null) {
            appointment.setTitle(request.title());
        }

        log.info("Updated appointment {}", id);
        appointments.saveAndFlush(appointment);
        if (Appointment.CANCELLED.equals(request.status())) {
            video.removeRoom(appointment);
        } else if (Appointment.CONFIRMED.equals(request.status()) || appointment.hasVideo()) {
            // Creates the room on confirmation, and keeps an existing room's
            // expiry in step with a moved or lengthened meeting.
            video.ensureRoom(appointment);
        }
        if (Appointment.COMPLETED.equals(request.status())) {
            // Recompiles on every save while completed, so a corrected start
            // date reaches the charge too. An invoiced charge is left alone.
            importCallTimeIfEmpty(appointment, CurrentUser.from(jwt).id());
            billing.compile(id, CurrentUser.from(jwt).id());
            sendSummary(appointment);
        }
        if (Appointment.CONFIRMED.equals(request.status())
                && !Appointment.CONFIRMED.equals(previous)) {
            announceConfirmed(appointment);
        }
        return rows(List.of(appointment)).get(0);
    }

    /* ----------------------------------------------------- meeting manager */

    /** One agenda item, with whatever the engineer has written against it. */
    public record AgendaItem(
            Long topicId, String title, String detail, String desiredOutcome,
            int priority, String status, String note, Instant noteUpdatedAt) {}

    public record MeetingDetail(
            AppointmentRow appointment, List<AgendaItem> agenda) {}

    public record SaveNote(String body) {}

    public record UpdateStatus(@NotNull String status) {}

    @GetMapping("/appointments/{id}")
    public MeetingDetail meeting(@PathVariable Long id) {
        Appointment appointment = appointments.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        return new MeetingDetail(rows(List.of(appointment)).get(0), agenda.agenda(id));
    }

    @PutMapping("/appointments/{id}/topics/{topicId}/note")
    public AgendaItem saveNote(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable Long id,
            @PathVariable Long topicId,
            @Valid @RequestBody SaveNote request) {
        return agenda.saveNote(id, topicId, request.body(), CurrentUser.from(jwt).id());
    }

    @PutMapping("/appointments/{id}/topics/{topicId}/status")
    public AgendaItem setTopicStatus(
            @PathVariable Long id, @PathVariable Long topicId,
            @Valid @RequestBody UpdateStatus request) {
        return agenda.setStatus(id, topicId, request.status());
    }


    @PutMapping("/appointments/{id}/status")
    @Transactional
    public AppointmentRow setAppointmentStatus(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable Long id, @Valid @RequestBody UpdateStatus request) {

        if (Appointment.CANCELLED.equals(request.status())) {
            // Cancelling has to return the agenda to the backlog, which is
            // the scheduling service's job, not a field assignment.
            Appointment cancelled = scheduling.cancel(id);
            video.removeRoom(cancelled);
            return rows(List.of(cancelled)).get(0);
        }

        if (!List.of(Appointment.REQUESTED, Appointment.CONFIRMED, Appointment.COMPLETED)
                .contains(request.status())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "status must be requested, confirmed, completed or cancelled");
        }

        Appointment appointment = appointments.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        String previous = appointment.getStatus();
        appointment.setStatus(request.status());
        log.info("Appointment {} marked {}", id, request.status());
        appointments.saveAndFlush(appointment);

        // Completing a meeting turns its recorded time into a charge, in
        // 30-minute blocks at the current hourly rate. With nothing recorded,
        // the video call's measured length is used.
        if (Appointment.COMPLETED.equals(request.status())
                && !Appointment.COMPLETED.equals(previous)) {
            importCallTimeIfEmpty(appointment, CurrentUser.from(jwt).id());
            billing.compile(id, CurrentUser.from(jwt).id());
            sendSummary(appointment);
        }

        // Only on the transition into confirmed. Re-saving an already
        // confirmed meeting must not mail the client again.
        if (Appointment.CONFIRMED.equals(request.status())
                && !Appointment.CONFIRMED.equals(previous)) {
            video.ensureRoom(appointment);
            announceConfirmed(appointment);
        }

        return rows(List.of(appointment)).get(0);
    }

    /* ---------------------------------------------------------- client view */

    public record ClientUser(Long id, String email, String displayName, String firstName,
            String lastName, String phone, String companyName, String role,
            boolean enabled, boolean mustChangePassword, Instant lastLoginAt) {}

    public record ClientEngagement(Long id, String title, String status,
            java.time.LocalDate startedOn, int openTopics) {}

    public record ClientNote(Long appointmentId, Instant meetingAt, String topicTitle,
            String body, Instant updatedAt) {}

    public record ClientDetail(
            Long id, String name, String primaryEmail, Instant createdAt,
            List<ClientEngagement> engagements,
            List<AppointmentRow> appointments,
            List<ClientUser> users,
            List<ClientNote> notes) {}

    /**
     * Everything the admin client popup shows, in one request.
     *
     * <p>One round trip rather than five, because the popup opens on a click
     * and a spinner per tab would be worse than a slightly larger payload.
     */
    @GetMapping("/clients/{id}")
    public ClientDetail clientDetail(@PathVariable Long id) {
        Client client = clients.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        List<Engagement> clientEngagements = engagements.findByClientIdOrderByStartedOnDesc(id);
        List<Long> engagementIds = clientEngagements.stream().map(Engagement::getId).toList();

        Map<Long, Long> openByEngagement = engagementIds.isEmpty()
                ? Map.of()
                : topics.findByEngagementIdInAndStatusOrderByPriorityAscCreatedAtAsc(
                                engagementIds, Topic.PROPOSED).stream()
                        .collect(Collectors.groupingBy(Topic::getEngagementId,
                                Collectors.counting()));

        List<Appointment> clientAppointments =
                appointments.findAllByClientIdOrderByStartsAtDesc(id);

        return new ClientDetail(
                client.getId(),
                client.getName(),
                client.getPrimaryEmail(),
                client.getCreatedAt(),
                clientEngagements.stream()
                        .map(e -> new ClientEngagement(e.getId(), e.getTitle(), e.getStatus(),
                                e.getStartedOn(),
                                openByEngagement.getOrDefault(e.getId(), 0L).intValue()))
                        .toList(),
                rows(clientAppointments),
                users.findAllByClientIdOrderByDisplayNameAsc(id).stream()
                        .map(u -> new ClientUser(u.getId(), u.getEmail(), u.getDisplayName(),
                                u.getFirstName(), u.getLastName(), u.getPhone(),
                                u.getCompanyId() == null ? null
                                        : companies.findById(u.getCompanyId())
                                                .map(Company::getName).orElse(null),
                                u.getRole(), u.isEnabled(), u.isMustChangePassword(),
                                u.getLastLoginAt()))
                        .toList(),
                notesFor(clientAppointments));
    }

    /** Every meeting note for this client, most recently edited first. */
    private List<ClientNote> notesFor(List<Appointment> clientAppointments) {
        if (clientAppointments.isEmpty()) {
            return List.of();
        }

        List<Long> ids = clientAppointments.stream().map(Appointment::getId).toList();
        Map<Long, Instant> startsAt = clientAppointments.stream()
                .collect(Collectors.toMap(Appointment::getId, Appointment::getStartsAt));
        Map<Long, String> titles = topics.findAllByAppointmentIdIn(ids).stream()
                .collect(Collectors.toMap(Topic::getId, Topic::getTitle, (a, b) -> a));

        return notes.findAllByAppointmentIdInOrderByUpdatedAtDesc(ids).stream()
                .map(n -> new ClientNote(
                        n.getAppointmentId(),
                        startsAt.get(n.getAppointmentId()),
                        titles.getOrDefault(n.getTopicId(), "(topic removed)"),
                        n.getBody(),
                        n.getUpdatedAt()))
                .toList();
    }

    /* ---------------------------------------------------------------- video */

    /**
     * Tells the client a meeting is confirmed. People with portal logins are
     * pointed at the portal, where they join with their own token. A client
     * with no logins -- a website inquiry -- gets a direct join link at the
     * primary email instead, since there is nowhere for them to sign in.
     */
    private void announceConfirmed(Appointment appointment) {
        AppointmentRow row = rows(List.of(appointment)).get(0);
        boolean hasLogins = users.findAllByClientIdOrderByDisplayNameAsc(appointment.getClientId())
                .stream().anyMatch(u -> u.isEnabled());
        if (hasLogins) {
            notifications.meetingConfirmed(appointment.getClientId(), row.engagementTitle(),
                    appointment.getStartsAt(), appointment.getDurationMinutes(),
                    row.topicCount(), appointment.hasVideo());
            return;
        }
        Client client = clients.findById(appointment.getClientId()).orElse(null);
        if (client == null) {
            return;
        }
        String guest = client.getContactName() != null ? client.getContactName() : client.getName();
        String joinUrl = null;
        if (appointment.hasVideo()) {
            // Our meeting page, not Daily's: it carries the sharing toolbar.
            // The key authorises this one meeting until its room closes.
            joinUrl = mailBaseUrl + "/meet/" + appointment.getId() + "?k="
                    + meetTokens.issue(appointment.getId(), "guest", guest, null,
                            VideoService.roomExpiry(appointment));
        }
        notifications.meetingConfirmedGuest(client.getPrimaryEmail(), guest, row.engagementTitle(),
                appointment.getStartsAt(), appointment.getDurationMinutes(), row.topicCount(),
                joinUrl);
    }

    /**
     * Mails the write-up to the participants who asked for it, once.
     *
     * <p>Never allowed to fail the completion it follows: the meeting is
     * done and its time compiled whether or not the mail goes out, and the
     * summary can always be printed and sent by hand.
     */
    private void sendSummary(Appointment appointment) {
        try {
            List<String> recipients = people.summaryRecipients(appointment.getId());
            if (recipients.isEmpty() || !people.claimSummary(appointment.getId())) {
                return;
            }
            AppointmentRow row = rows(List.of(appointment)).get(0);
            notifications.meetingSummary(recipients, row.clientName(), row.engagementTitle(),
                    appointment.getStartsAt(),
                    billing.timeSheet(appointment.getId()).totalMinutes(),
                    agenda.agenda(appointment.getId()).stream()
                            .map(i -> new Notifications.SummaryLine(
                                    i.title(), i.status(), i.note()))
                            .toList());
            log.info("Sent the summary of appointment {} to {} participant(s)",
                    appointment.getId(), recipients.size());
        } catch (RuntimeException e) {
            log.warn("Could not send the summary of appointment {}: {}",
                    appointment.getId(), e.getMessage());
        }
    }

    private void importCallTimeIfEmpty(Appointment appointment, Long userId) {
        if (!appointment.hasVideo() || !video.enabled()) {
            return;
        }
        try {
            video.syncUsage(appointment);
        } catch (RuntimeException e) {
            log.warn("Could not record video usage for appointment {}: {}", appointment.getId(),
                    e.getMessage());
        }
        if (billing.hasTime(appointment.getId())) {
            return;
        }
        try {
            VideoService.CallTime t = video.callTime(appointment);
            if (t.minutes() > 0) {
                billing.importVideoTime(appointment.getId(), t.minutes(),
                        "Video call: " + t.sessions() + (t.sessions() == 1 ? " session" : " sessions")
                                + ", " + t.minutes() + " min (imported on completion)",
                        userId);
            }
        } catch (RuntimeException e) {
            // Completion must not fail because Daily is unreachable; the time
            // can be imported from the Meeting Manager afterwards.
            log.warn("Could not import call time for appointment {}: {}", appointment.getId(),
                    e.getMessage());
        }
    }

    /* -------------------------------------------------------------- helpers */

    /**
     * Decorates appointments with client name, engagement title and agenda
     * counts, in a fixed number of queries regardless of list length.
     */
    private List<AppointmentRow> rows(List<Appointment> found) {
        if (found.isEmpty()) {
            return List.of();
        }

        List<Long> ids = found.stream().map(Appointment::getId).toList();

        List<Topic> agenda = topics.findAllByAppointmentIdIn(ids);
        Map<Long, Long> topicCounts = agenda.stream()
                .collect(Collectors.groupingBy(Topic::getAppointmentId, Collectors.counting()));
        Map<Long, Long> noteCounts = notes.findAllByAppointmentIdInOrderByUpdatedAtDesc(ids)
                .stream()
                .collect(Collectors.groupingBy(MeetingNote::getAppointmentId,
                        Collectors.counting()));

        Map<Long, String> clientNames = clients
                .findAllById(found.stream().map(Appointment::getClientId).distinct().toList())
                .stream().collect(Collectors.toMap(Client::getId, Client::getName, (a, b) -> a));

        Map<Long, String> engagementTitles = engagements
                .findAllById(found.stream().map(Appointment::getEngagementId).distinct()
                        .toList())
                .stream().collect(Collectors.toMap(Engagement::getId, Engagement::getTitle,
                        (a, b) -> a));

        return found.stream()
                .map(a -> new AppointmentRow(
                        a.getId(),
                        a.getClientId(),
                        clientNames.getOrDefault(a.getClientId(), "(client removed)"),
                        a.getEngagementId(),
                        engagementTitles.getOrDefault(a.getEngagementId(),
                                "(engagement removed)"),
                        a.getStartsAt(),
                        a.getEndsAt(),
                        a.getDurationMinutes(),
                        a.getStatus(),
                        topicCounts.getOrDefault(a.getId(), 0L).intValue(),
                        noteCounts.getOrDefault(a.getId(), 0L).intValue(),
                        a.hasVideo(),
                        a.getTitle()))
                .toList();
    }
}
