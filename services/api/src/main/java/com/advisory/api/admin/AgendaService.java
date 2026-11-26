package com.advisory.api.admin;

import com.advisory.api.admin.MeetingController.AgendaItem;
import com.advisory.api.portal.MeetingNote;
import com.advisory.api.portal.MeetingNoteRepository;
import com.advisory.api.portal.Topic;
import com.advisory.api.portal.TopicRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * A meeting's agenda and the notes taken against it.
 *
 * <p>Lives in a service because two front doors reach it: the Meeting
 * Manager in the console, authenticated by a sign-in, and the notes panel in
 * the video room, authenticated by the room's host token. Both must apply the
 * same rules -- chiefly that a topic can only be noted or moved from the
 * meeting whose agenda it is on.
 */
@Service
public class AgendaService {

    private final TopicRepository topics;
    private final MeetingNoteRepository notes;
    private final org.springframework.jdbc.core.simple.JdbcClient jdbc;

    public AgendaService(TopicRepository topics, MeetingNoteRepository notes,
            org.springframework.jdbc.core.simple.JdbcClient jdbc) {
        this.topics = topics;
        this.notes = notes;
        this.jdbc = jdbc;
    }

    /** Topics brought back to this meeting from an earlier one (V16). */
    private List<Long> carriedTopicIds(Long appointmentId) {
        return jdbc.sql("SELECT topic_id FROM meeting_topic WHERE appointment_id = ?")
                .param(appointmentId).query(Long.class).list();
    }

    /**
     * The agenda: the topics booked onto this meeting, then any brought back
     * to it from earlier meetings.
     */
    public List<AgendaItem> agenda(Long appointmentId) {
        Map<Long, MeetingNote> byTopic = notes.findAllByAppointmentId(appointmentId).stream()
                .collect(Collectors.toMap(MeetingNote::getTopicId, n -> n, (a, b) -> a));
        List<Topic> all = new java.util.ArrayList<>(
                topics.findByAppointmentIdOrderByPriorityAscCreatedAtAsc(appointmentId));
        all.addAll(topics.findAllById(carriedTopicIds(appointmentId)));
        return all.stream().map(t -> item(t, byTopic.get(t.getId()))).toList();
    }

    /**
     * Brings a topic that already exists on the engagement onto this
     * meeting's agenda, so it can be taken further and noted again. Its
     * earlier notes stay with the meetings they were taken in.
     */
    @Transactional
    public AgendaItem carryOver(Long appointmentId, Long engagementId, Long topicId) {
        Topic topic = topics.findById(topicId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!engagementId.equals(topic.getEngagementId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "That topic belongs to a different engagement");
        }
        if (appointmentId.equals(topic.getAppointmentId())
                || carriedTopicIds(appointmentId).contains(topicId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "That topic is already on this meeting's agenda");
        }
        jdbc.sql("INSERT INTO meeting_topic (appointment_id, topic_id) VALUES (?, ?)")
                .params(appointmentId, topicId).update();
        // Back on an agenda, so no longer finished.
        if (Topic.DISCUSSED.equals(topic.getStatus()) || Topic.PROPOSED.equals(topic.getStatus())) {
            topic.setStatus(Topic.SCHEDULED);
            topic.setUpdatedAt(Instant.now());
            topics.save(topic);
        }
        return item(topic,
                notes.findByAppointmentIdAndTopicId(appointmentId, topicId).orElse(null));
    }

    /** Saves the note for one agenda item; an empty body removes it. */
    @Transactional
    public AgendaItem saveNote(Long appointmentId, Long topicId, String text, Long authorId) {
        Topic topic = onAgenda(appointmentId, topicId);
        String body = text == null ? "" : text.trim();
        MeetingNote existing =
                notes.findByAppointmentIdAndTopicId(appointmentId, topicId).orElse(null);

        if (body.isEmpty()) {
            if (existing != null) {
                notes.delete(existing);
            }
            return item(topic, null);
        }

        MeetingNote note = existing == null ? new MeetingNote() : existing;
        note.setAppointmentId(appointmentId);
        note.setTopicId(topicId);
        note.setBody(body);
        note.setAuthorUserId(authorId);
        note.setUpdatedAt(Instant.now());
        return item(topic, notes.save(note));
    }

    @Transactional
    public AgendaItem setStatus(Long appointmentId, Long topicId, String status) {
        if (!List.of(Topic.SCHEDULED, Topic.DISCUSSED, Topic.DROPPED).contains(status)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "status must be scheduled, discussed or dropped");
        }
        Topic topic = onAgenda(appointmentId, topicId);
        topic.setStatus(status);
        topic.setUpdatedAt(Instant.now());
        topics.save(topic);
        return item(topic,
                notes.findByAppointmentIdAndTopicId(appointmentId, topicId).orElse(null));
    }

    /**
     * Puts a new item straight onto a meeting's agenda. Clients build an
     * agenda by choosing topics when they book; a meeting the firm creates
     * has none, and without an item there is nowhere to take a note.
     */
    @Transactional
    public AgendaItem addItem(Long appointmentId, Long engagementId, String title,
            String desiredOutcome, Long userId) {
        Topic topic = new Topic();
        topic.setEngagementId(engagementId);
        topic.setAppointmentId(appointmentId);
        topic.setTitle(title.trim());
        topic.setDesiredOutcome(
                desiredOutcome == null || desiredOutcome.isBlank() ? null : desiredOutcome.trim());
        topic.setStatus(Topic.SCHEDULED);
        topic.setCreatedByUserId(userId);
        return item(topics.save(topic), null);
    }

    private Topic onAgenda(Long appointmentId, Long topicId) {
        Topic topic = topics.findById(topicId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!appointmentId.equals(topic.getAppointmentId())
                && !carriedTopicIds(appointmentId).contains(topicId)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "That topic is not on this meeting's agenda");
        }
        return topic;
    }

    private static AgendaItem item(Topic t, MeetingNote n) {
        return new AgendaItem(t.getId(), t.getTitle(), t.getDetail(), t.getDesiredOutcome(),
                t.getPriority(), t.getStatus(),
                n == null ? null : n.getBody(), n == null ? null : n.getUpdatedAt());
    }
}
