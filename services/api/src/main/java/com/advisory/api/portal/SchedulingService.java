package com.advisory.api.portal;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Booking and cancelling meetings.
 *
 * <p>This sits in a service rather than a controller because booking is the
 * one operation here that has to be atomic: it writes an appointment and then
 * moves a set of topics onto it, and a half-applied version of that leaves
 * topics marked scheduled against a meeting that does not exist.
 */
@Service
public class SchedulingService {

    private static final Logger log = LoggerFactory.getLogger(SchedulingService.class);

    /** Refuse bookings further out than this. */
    private static final int MAX_DAYS_AHEAD = 365;

    private final AppointmentRepository appointments;
    private final EngagementRepository engagements;
    private final TopicRepository topics;

    public SchedulingService(AppointmentRepository appointments,
            EngagementRepository engagements, TopicRepository topics) {
        this.appointments = appointments;
        this.engagements = engagements;
        this.topics = topics;
    }

    /**
     * Books a meeting and attaches the given topics as its agenda.
     *
     * @param clientId the caller's client, or for an admin the engagement's owner
     * @param userId who asked; recorded on the appointment
     * @param topicOwner the user every named topic must belong to, or null for
     *     an admin, who may put any of the client's topics on the agenda
     */
    @Transactional
    public Appointment book(Long clientId, Long userId, Long engagementId,
            Instant startsAt, int durationMinutes, List<Long> topicIds, Long topicOwner) {

        Engagement engagement = engagements.findById(engagementId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        // Access is checked against the engagement's owner, so an id guessed
        // from another client's range reads as a miss rather than a refusal.
        if (!engagement.getClientId().equals(clientId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }

        // Paused and closed engagements keep their history but take no new
        // meetings. The portal only offers active ones; this holds the rule
        // for any other caller, admins included -- reopen it first.
        if (!"active".equals(engagement.getStatus())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Engagement " + engagementId + " is " + engagement.getStatus()
                            + " and not open for new meetings");
        }

        Instant start = normaliseAndValidate(startsAt, durationMinutes);

        Appointment appointment = new Appointment();
        appointment.setClientId(clientId);
        appointment.setEngagementId(engagementId);
        appointment.setStartsAt(start);
        appointment.setDurationMinutes(durationMinutes);
        appointment.setRequestedBy(userId);
        appointment.setStatus(Appointment.REQUESTED);

        Appointment saved = appointments.save(appointment);

        attach(saved, engagementId, topicIds, topicOwner);

        log.info("Booked appointment {} for client {} on engagement {} ({} min, {} topics)",
                saved.getId(), clientId, engagementId, durationMinutes, topicIds.size());
        return saved;
    }

    /**
     * Moves topics onto a meeting.
     *
     * <p>Every topic is checked against the meeting's engagement, against its
     * owner, and against its current state. Attaching a topic that is already
     * on another meeting would silently move it off that agenda, so it is
     * rejected instead.
     *
     * <p>The ownership check is what stops a client user booking a meeting
     * with a colleague's topics on it. Without it, topics stay private to
     * read but not to use: naming someone else's id here would move that
     * topic onto an agenda the caller can then open.
     */
    private void attach(Appointment appointment, Long engagementId, List<Long> topicIds,
            Long topicOwner) {
        if (topicIds.isEmpty()) {
            return;
        }

        List<Topic> found = topics.findAllById(topicIds);
        if (found.size() != topicIds.size()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "One or more topics do not exist");
        }

        for (Topic topic : found) {
            if (!topic.getEngagementId().equals(engagementId)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Topic " + topic.getId() + " belongs to a different engagement");
            }
            if (topicOwner != null && !topicOwner.equals(topic.getCreatedByUserId())) {
                // Same wording as a nonexistent id, deliberately. Telling the
                // caller this one exists but is someone else's would leak the
                // fact that a colleague has a topic at that id.
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST, "One or more topics do not exist");
            }
            if (topic.getAppointmentId() != null) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Topic " + topic.getId() + " is already on another meeting");
            }
            if (Topic.DISCUSSED.equals(topic.getStatus())
                    || Topic.DROPPED.equals(topic.getStatus())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Topic " + topic.getId() + " is closed");
            }

            topic.setAppointmentId(appointment.getId());
            topic.setStatus(Topic.SCHEDULED);
            topic.setUpdatedAt(Instant.now());
        }

        topics.saveAll(found);
    }

    /**
     * Cancels a meeting and returns its agenda to the backlog.
     *
     * <p>The topics are deliberately not deleted. A cancelled meeting is a
     * scheduling event; the work the client described is still wanted.
     */
    @Transactional
    public Appointment cancel(Long appointmentId) {
        Appointment appointment = appointments.findById(appointmentId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        appointment.setStatus(Appointment.CANCELLED);

        List<Topic> agenda = topics.findByAppointmentIdOrderByPriorityAscCreatedAtAsc(
                appointmentId);
        for (Topic topic : agenda) {
            topic.setAppointmentId(null);
            // Only topics still awaiting discussion go back to the backlog.
            // One already marked discussed stays discussed: the conversation
            // happened, whatever later became of the meeting record.
            if (Topic.SCHEDULED.equals(topic.getStatus())) {
                topic.setStatus(Topic.PROPOSED);
            }
            topic.setUpdatedAt(Instant.now());
        }
        topics.saveAll(agenda);

        log.info("Cancelled appointment {}, returned {} topics to the backlog",
                appointmentId, agenda.size());
        return appointments.save(appointment);
    }

    /**
     * Normalises a requested slot and rejects anything invalid.
     *
     * <p>Public because rescheduling from the admin tools has to apply
     * exactly these rules -- the database constraints enforcing 30-minute
     * blocks and aligned starts do not care which endpoint wrote the row,
     * and a second copy of the logic would drift.
     *
     * <p>Normalising before validating matters: a caller sending
     * 10:00:00.500Z would otherwise pass a check that truncates and then
     * violate the constraint that requires a whole second, turning a bad
     * request into a 500.
     */
    public Instant normaliseAndValidate(Instant startsAt, int durationMinutes) {
        return normaliseAndValidate(startsAt, durationMinutes, false);
    }

    /**
     * @param allowPast true when editing an existing meeting. A client
     *     booking cannot land in the past -- that is always a mistake -- but
     *     an admin correcting the record of a call that already happened, or
     *     marking one complete, legitimately needs a past start. The block
     *     and length rules still apply either way.
     */
    public Instant normaliseAndValidate(
            Instant startsAt, int durationMinutes, boolean allowPast) {

        Instant start = startsAt.truncatedTo(ChronoUnit.MINUTES);
        validateSlot(start, durationMinutes, allowPast);
        return start;
    }

    /**
     * Rejects anything the portal should not have offered.
     *
     * <p>The database enforces the block alignment and length too. Checking
     * here as well turns a 500 from a constraint violation into a 400 that
     * says which rule was broken.
     */
    private void validateSlot(Instant startsAt, int durationMinutes, boolean allowPast) {
        if (durationMinutes <= 0
                || durationMinutes % Appointment.BLOCK_MINUTES != 0
                || durationMinutes > Appointment.MAX_MINUTES) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Meeting length must be whole " + Appointment.BLOCK_MINUTES
                            + "-minute blocks, up to " + Appointment.MAX_MINUTES + " minutes");
        }

        // Epoch zero is midnight UTC, so an instant divisible by 1800
        // seconds is exactly :00 or :30 UTC with no stray seconds -- the same
        // rule the appointment_aligned_to_block constraint enforces.
        if (startsAt.getEpochSecond() % (Appointment.BLOCK_MINUTES * 60) != 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Meetings start on the hour or the half hour");
        }

        if (!allowPast && startsAt.isBefore(Instant.now())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "That start time is in the past");
        }

        if (startsAt.isAfter(Instant.now().plus(MAX_DAYS_AHEAD, ChronoUnit.DAYS))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "That start time is more than a year away");
        }
    }
}
