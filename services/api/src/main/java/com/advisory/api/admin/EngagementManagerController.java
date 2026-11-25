package com.advisory.api.admin;

import com.advisory.api.admin.PeopleService.Candidate;
import com.advisory.api.admin.PeopleService.Person;
import com.advisory.api.auth.CurrentUser;
import com.advisory.api.auth.Staff;
import com.advisory.api.billing.BillingService;
import com.advisory.api.billing.BillingService.ChargeView;
import com.advisory.api.billing.BillingService.InvoiceView;
import com.advisory.api.media.MediaService;
import com.advisory.api.media.MediaStore;
import com.advisory.api.portal.Appointment;
import com.advisory.api.portal.AppointmentRepository;
import com.advisory.api.portal.Client;
import com.advisory.api.portal.ClientRepository;
import com.advisory.api.portal.Engagement;
import com.advisory.api.portal.EngagementRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * The Engagement Manager, and the people lists on engagements and meetings.
 *
 * <p>An engagement is the unit of work: it has a goal, and everything held
 * under it -- meetings, the notes taken in them, what was shown on screen,
 * the time recorded and what that time was billed at -- is collected here so
 * progress towards the goal can be read in one place.
 *
 * <p>Open to every staff role except for the money. The billing figures are
 * left out of the response for roles that do not handle billing, and raising
 * an invoice is fenced by path in SecurityConfig.
 */
@RestController
@RequestMapping("/api/admin")
public class EngagementManagerController {

    private final EngagementRepository engagements;
    private final AppointmentRepository appointments;
    private final ClientRepository clients;
    private final PeopleService people;
    private final BillingService billing;
    private final MediaStore store;
    private final JdbcClient jdbc;

    public EngagementManagerController(EngagementRepository engagements,
            AppointmentRepository appointments, ClientRepository clients,
            PeopleService people, BillingService billing, MediaStore store, JdbcClient jdbc) {
        this.engagements = engagements;
        this.appointments = appointments;
        this.clients = clients;
        this.people = people;
        this.billing = billing;
        this.store = store;
        this.jdbc = jdbc;
    }

    /* --------------------------------------------------------------- detail */

    public record Meeting(Long id, Instant startsAt, Instant endsAt, int durationMinutes,
            String status, boolean video, int topicCount, int notedCount,
            int recordedMinutes) {}

    /** One agenda line across the whole engagement, with its note if one was taken. */
    public record AgendaLine(Long topicId, String title, String detail, String desiredOutcome,
            int priority, String status, Long appointmentId, Instant meetingAt, String note,
            Instant noteUpdatedAt) {}

    public record SharedItem(Long id, Long appointmentId, Instant meetingAt, String title,
            String kind, String url, String sharedByRole, String sharedByName,
            Instant sharedAt) {}

    /**
     * What the engagement has cost the client so far. Charges are compiled
     * from meetings, so this only moves when a meeting is completed.
     */
    public record Billing(long chargedCents, long invoicedCents, long unbilledCents,
            int billedMinutes, List<ChargeView> charges) {}

    public record Detail(Long id, Long clientId, String clientName, String title, String goal,
            String status, LocalDate startedOn, int recordedMinutes, List<Meeting> meetings,
            List<AgendaLine> agenda, List<SharedItem> media, List<Person> team,
            Billing billing) {}

    @GetMapping("/engagements/{id}")
    public Detail detail(@PathVariable Long id, Authentication auth) {
        Engagement e = engagement(id);
        String clientName = clients.findById(e.getClientId()).map(Client::getName)
                .orElse("(client removed)");

        List<Meeting> meetings = jdbc.sql("""
                SELECT a.id, a.starts_at, a.duration_minutes, a.status,
                       a.video_room_name IS NOT NULL AS video,
                       (SELECT count(*) FROM topic t WHERE t.appointment_id = a.id) AS topics,
                       (SELECT count(*) FROM meeting_note n WHERE n.appointment_id = a.id)
                           AS noted,
                       COALESCE((SELECT sum(COALESCE(te.minutes,
                               GREATEST(1, CEIL(EXTRACT(EPOCH FROM
                                   (COALESCE(te.ended_at, now()) - te.started_at)) / 60.0))))
                           FROM time_entry te WHERE te.appointment_id = a.id), 0)::int
                           AS recorded
                FROM appointment a
                WHERE a.engagement_id = ?
                ORDER BY a.starts_at DESC
                """).param(id).query((rs, i) -> {
                    Instant starts = rs.getTimestamp("starts_at").toInstant();
                    int minutes = rs.getInt("duration_minutes");
                    return new Meeting(rs.getLong("id"), starts,
                            starts.plusSeconds(minutes * 60L), minutes, rs.getString("status"),
                            rs.getBoolean("video"), rs.getInt("topics"), rs.getInt("noted"),
                            rs.getInt("recorded"));
                }).list();

        List<AgendaLine> agenda = jdbc.sql("""
                SELECT t.id, t.title, t.detail, t.desired_outcome, t.priority, t.status,
                       t.appointment_id, a.starts_at, n.body, n.updated_at
                FROM topic t
                LEFT JOIN appointment a ON a.id = t.appointment_id
                LEFT JOIN meeting_note n
                       ON n.topic_id = t.id AND n.appointment_id = t.appointment_id
                WHERE t.engagement_id = ?
                ORDER BY a.starts_at DESC NULLS FIRST, t.priority, t.created_at
                """).param(id).query((rs, i) -> new AgendaLine(rs.getLong("id"),
                rs.getString("title"), rs.getString("detail"), rs.getString("desired_outcome"),
                rs.getInt("priority"), rs.getString("status"),
                rs.getObject("appointment_id", Long.class), instant(rs.getTimestamp("starts_at")),
                rs.getString("body"), instant(rs.getTimestamp("updated_at")))).list();

        List<SharedItem> media = jdbc.sql(SHARE_SELECT + """
                 WHERE a.engagement_id = ? ORDER BY s.created_at DESC
                """).param(id).query(this::share).list();

        int recorded = meetings.stream().mapToInt(Meeting::recordedMinutes).sum();

        Billing money = null;
        if (Staff.seesMoney(auth)) {
            List<ChargeView> charges = billing.engagementCharges(id);
            long charged = charges.stream().mapToLong(ChargeView::amountCents).sum();
            long invoiced = charges.stream().filter(c -> c.invoiceId() != null)
                    .mapToLong(ChargeView::amountCents).sum();
            int billedMinutes = charges.stream()
                    .mapToInt(c -> c.minutes() == null ? 0 : c.minutes()).sum();
            money = new Billing(charged, invoiced, charged - invoiced, billedMinutes, charges);
        }

        return new Detail(e.getId(), e.getClientId(), clientName, e.getTitle(), e.getGoal(),
                e.getStatus(), e.getStartedOn(), recorded, meetings, agenda, media,
                people.team(id), money);
    }

    /** Invoices everything this engagement has that is not yet on an invoice. */
    @PostMapping("/engagements/{id}/invoice")
    @ResponseStatus(HttpStatus.CREATED)
    public InvoiceView invoice(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id) {
        Engagement e = engagement(id);
        List<Long> unbilled = billing.engagementCharges(id).stream()
                .filter(c -> c.invoiceId() == null).map(ChargeView::id).toList();
        if (unbilled.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "This engagement has no unbilled charges. Charges appear when a meeting "
                            + "is marked complete.");
        }
        return billing.createInvoice(e.getClientId(), unbilled, null,
                "Engagement: " + e.getTitle(), CurrentUser.from(jwt).id());
    }

    /* ----------------------------------------------------------------- team */

    public record AddPerson(@NotNull Long userId, @NotBlank String role, Boolean attending,
            Boolean sendSummary) {}

    public record UpdatePerson(@NotBlank String role, Boolean attending, Boolean sendSummary) {}

    @GetMapping("/engagements/{id}/people")
    public List<Candidate> engagementCandidates(@PathVariable Long id) {
        return people.candidates(engagement(id).getClientId());
    }

    @PostMapping("/engagements/{id}/team")
    public List<Person> addMember(@PathVariable Long id, @Valid @RequestBody AddPerson r) {
        return people.addMember(id, engagement(id).getClientId(), r.userId(), r.role());
    }

    @PutMapping("/engagements/{id}/team/{memberId}")
    public List<Person> updateMember(@PathVariable Long id, @PathVariable Long memberId,
            @Valid @RequestBody UpdatePerson r) {
        return people.updateMember(id, engagement(id).getClientId(), memberId, r.role());
    }

    @DeleteMapping("/engagements/{id}/team/{memberId}")
    public List<Person> removeMember(@PathVariable Long id, @PathVariable Long memberId) {
        engagement(id);
        return people.removeMember(id, memberId);
    }

    /* --------------------------------------------------------- participants */

    @GetMapping("/appointments/{id}/participants")
    public List<Person> participants(@PathVariable Long id) {
        appointment(id);
        return people.participants(id);
    }

    @GetMapping("/appointments/{id}/people")
    public List<Candidate> meetingCandidates(@PathVariable Long id) {
        return people.candidates(appointment(id).getClientId());
    }

    @PostMapping("/appointments/{id}/participants")
    public List<Person> addParticipant(@PathVariable Long id, @Valid @RequestBody AddPerson r) {
        return people.addParticipant(id, appointment(id).getClientId(), r.userId(), r.role(),
                r.attending() == null || r.attending(),
                r.sendSummary() == null || r.sendSummary());
    }

    @PostMapping("/appointments/{id}/participants/from-engagement")
    public List<Person> addEngagementTeam(@PathVariable Long id) {
        return people.addEngagementTeam(id, appointment(id).getEngagementId());
    }

    @PutMapping("/appointments/{id}/participants/{participantId}")
    public List<Person> updateParticipant(@PathVariable Long id,
            @PathVariable Long participantId, @Valid @RequestBody UpdatePerson r) {
        return people.updateParticipant(id, appointment(id).getClientId(), participantId,
                r.role(), r.attending() == null || r.attending(),
                r.sendSummary() == null || r.sendSummary());
    }

    @DeleteMapping("/appointments/{id}/participants/{participantId}")
    public List<Person> removeParticipant(@PathVariable Long id,
            @PathVariable Long participantId) {
        appointment(id);
        return people.removeParticipant(id, participantId);
    }

    /** Everything put on screen during one meeting, for the Meeting Manager. */
    @GetMapping("/appointments/{id}/shares")
    public List<SharedItem> shares(@PathVariable Long id) {
        appointment(id);
        return jdbc.sql(SHARE_SELECT + " WHERE s.appointment_id = ? ORDER BY s.created_at")
                .param(id).query(this::share).list();
    }

    /* -------------------------------------------------------------- helpers */

    private static final String SHARE_SELECT = """
            SELECT s.id, s.appointment_id, a.starts_at, s.title, s.content_type, s.storage_key,
                   s.shared_by_role, s.shared_by_name, s.created_at
            FROM meeting_share s
            JOIN appointment a ON a.id = s.appointment_id
            """;

    private SharedItem share(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        String type = rs.getString("content_type");
        return new SharedItem(rs.getLong("id"), rs.getLong("appointment_id"),
                rs.getTimestamp("starts_at").toInstant(), rs.getString("title"),
                type.startsWith("video/") ? "video"
                        : type.equals("application/pdf") ? "pdf" : "image",
                store.presignGet(rs.getString("storage_key"), MediaService.VIEW_TTL),
                rs.getString("shared_by_role"), rs.getString("shared_by_name"),
                rs.getTimestamp("created_at").toInstant());
    }

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    private Engagement engagement(Long id) {
        return engagements.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    private Appointment appointment(Long id) {
        return appointments.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }
}
