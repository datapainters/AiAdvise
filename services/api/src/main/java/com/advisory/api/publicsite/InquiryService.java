package com.advisory.api.publicsite;

import com.advisory.api.billing.OptionsService;
import com.advisory.api.mail.Notifications;
import com.advisory.api.portal.Appointment;
import com.advisory.api.portal.AppointmentRepository;
import com.advisory.api.portal.Client;
import com.advisory.api.portal.ClientRepository;
import com.advisory.api.portal.Engagement;
import com.advisory.api.portal.EngagementRepository;
import com.advisory.api.portal.SchedulingService;
import com.advisory.api.portal.Topic;
import com.advisory.api.portal.TopicRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
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
 * Free consultation requests from the public website.
 *
 * <p>One request creates, in one transaction: the client (or reuses the one
 * already on file for that email), an engagement in {@code inquiry} status,
 * a 30-minute non-billable appointment, and its agenda. The firm is emailed
 * after commit, and so is the person who asked.
 */
@Service
public class InquiryService {

    private static final Logger log = LoggerFactory.getLogger(InquiryService.class);

    public static final int CONSULTATION_MINUTES = 30;

    static final Map<String, String> SEGMENTS = Map.of(
            "corporate", "Corporate AI Development",
            "data", "AI Data Development",
            "dev", "Development Team AI Enablement");

    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    public record TopicInput(String title, String detail) {}

    public record ConsultationRequest(String name, String email, String company,
            String phone, String role, String segment, Instant startsAt,
            List<TopicInput> topics, String message, String website) {}

    public record Confirmation(String reference, Instant startsAt, Instant endsAt,
            int durationMinutes) {}

    public record Busy(Instant startsAt, Instant endsAt) {}

    private final ClientRepository clients;
    private final EngagementRepository engagements;
    private final AppointmentRepository appointments;
    private final TopicRepository topics;
    private final SchedulingService scheduling;
    private final Notifications notifications;
    private final OptionsService options;
    private final JdbcClient jdbc;

    public InquiryService(ClientRepository clients, EngagementRepository engagements,
            AppointmentRepository appointments, TopicRepository topics,
            SchedulingService scheduling, Notifications notifications, OptionsService options,
            JdbcClient jdbc) {
        this.clients = clients;
        this.engagements = engagements;
        this.appointments = appointments;
        this.topics = topics;
        this.scheduling = scheduling;
        this.notifications = notifications;
        this.options = options;
        this.jdbc = jdbc;
    }

    /** Busy intervals in a window, for the booking page. Reveals nothing else. */
    public List<Busy> busy(Instant from, Instant to) {
        if (from == null || to == null || !to.isAfter(from)
                || ChronoUnit.DAYS.between(from, to) > 62) {
            throw bad("Ask for a window of up to 62 days");
        }
        return jdbc.sql("""
                SELECT starts_at, starts_at + duration_minutes * interval '1 minute' AS ends_at
                FROM appointment
                WHERE status IN ('requested', 'confirmed')
                  AND starts_at < :to
                  AND starts_at + duration_minutes * interval '1 minute' > :from
                ORDER BY starts_at
                """)
                .param("from", java.sql.Timestamp.from(from))
                .param("to", java.sql.Timestamp.from(to))
                .query((rs, i) -> new Busy(rs.getTimestamp("starts_at").toInstant(),
                        rs.getTimestamp("ends_at").toInstant()))
                .list();
    }

    @Transactional
    public Confirmation book(ConsultationRequest r) {
        // Honeypot: a field people never see. A bot that fills it gets a
        // convincing success and nothing is stored or sent.
        if (r.website() != null && !r.website().isBlank()) {
            log.info("Consultation request dropped by honeypot");
            Instant s = r.startsAt() == null ? Instant.now() : r.startsAt();
            return new Confirmation("C-000000", s, s.plus(CONSULTATION_MINUTES,
                    ChronoUnit.MINUTES), CONSULTATION_MINUTES);
        }

        String name = required(r.name(), "Your name", 120);
        String email = required(r.email(), "Email", 200).toLowerCase();
        if (!EMAIL.matcher(email).matches()) {
            throw bad("Enter a valid email address");
        }
        String company = required(r.company(), "Company", 200);
        String phone = optional(r.phone(), "Phone", 40);
        String role = optional(r.role(), "Role", 120);
        String message = optional(r.message(), "Message", 2000);
        String segment = SEGMENTS.get(r.segment() == null ? "" : r.segment());
        if (segment == null) {
            throw bad("Choose an area of interest");
        }
        if (r.topics() == null || r.topics().isEmpty()) {
            throw bad("Add at least one topic you would like to discuss");
        }
        if (r.topics().size() > 5) {
            throw bad("Up to five topics, please");
        }
        if (r.startsAt() == null) {
            throw bad("Choose a time");
        }

        Instant start = scheduling.normaliseAndValidate(r.startsAt(), CONSULTATION_MINUTES,
                false);
        if (start.isBefore(Instant.now().plus(2, ChronoUnit.HOURS))) {
            throw bad("Choose a time at least two hours from now");
        }
        if (start.isAfter(Instant.now().plus(62, ChronoUnit.DAYS))) {
            throw bad("Choose a time within the next two months");
        }
        if (!options.businessHours().contains(start, CONSULTATION_MINUTES)) {
            throw bad("Choose a time within our hours: " + options.businessHours().describe());
        }
        Instant end = start.plus(CONSULTATION_MINUTES, ChronoUnit.MINUTES);
        if (!busy(start, end).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "That time was just booked. Pick another slot.");
        }

        Client client = clients.findByPrimaryEmailIgnoringCase(email).orElseGet(() -> {
            Client c = new Client();
            c.setName(company);
            c.setPrimaryEmail(email);
            c.setContactName(name);
            c.setPhone(phone);
            c.setSource("website");
            return clients.save(c);
        });

        Engagement engagement = new Engagement();
        engagement.setClientId(client.getId());
        engagement.setTitle("Free consultation: " + segment);
        engagement.setStatus("inquiry");
        engagement = engagements.save(engagement);

        Appointment appointment = new Appointment();
        appointment.setClientId(client.getId());
        appointment.setEngagementId(engagement.getId());
        appointment.setStartsAt(start);
        appointment.setDurationMinutes(CONSULTATION_MINUTES);
        appointment.setStatus(Appointment.REQUESTED);
        appointment.setBillable(false);
        appointment = appointments.save(appointment);

        int priority = 1;
        for (TopicInput t : r.topics()) {
            String title = required(t.title(), "Each topic", 200);
            Topic topic = new Topic();
            topic.setEngagementId(engagement.getId());
            topic.setTitle(title);
            topic.setDetail(optional(t.detail(), "Topic detail", 2000));
            topic.setPriority(Math.min(priority++, 5));
            topic.setStatus(Topic.SCHEDULED);
            topic.setAppointmentId(appointment.getId());
            topics.save(topic);
        }
        if (message != null) {
            Topic topic = new Topic();
            topic.setEngagementId(engagement.getId());
            topic.setTitle("Additional context from the request");
            topic.setDetail(message);
            topic.setPriority(5);
            topic.setStatus(Topic.SCHEDULED);
            topic.setAppointmentId(appointment.getId());
            topics.save(topic);
        }

        String reference = "C-%06d".formatted(appointment.getId());
        log.info("Consultation {} requested for client {} ({})", reference, client.getId(),
                segment);

        List<String> topicTitles = r.topics().stream().map(t -> t.title().trim()).toList();
        Long clientId = client.getId();
        String clientName = client.getName();
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                notifications.consultationRequested(options.inquiryEmail(), reference,
                        clientId, clientName, name, email, phone, role, segment, start,
                        topicTitles, message);
                notifications.consultationReceived(email, name, reference, segment, start,
                        topicTitles);
            }
        });

        return new Confirmation(reference, start, end, CONSULTATION_MINUTES);
    }

    private static String required(String v, String label, int max) {
        if (v == null || v.isBlank()) {
            throw bad(label + " is required");
        }
        String t = v.trim();
        if (t.length() > max) {
            throw bad(label + " must be " + max + " characters or fewer");
        }
        return t;
    }

    private static String optional(String v, String label, int max) {
        if (v == null || v.isBlank()) {
            return null;
        }
        String t = v.trim();
        if (t.length() > max) {
            throw bad(label + " must be " + max + " characters or fewer");
        }
        return t;
    }

    private static ResponseStatusException bad(String m) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, m);
    }
}
