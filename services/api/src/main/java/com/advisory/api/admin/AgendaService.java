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

    public AgendaService(TopicRepository topics, MeetingNoteRepository notes) {
        this.topics = topics;
        this.notes = notes;
    }

    public List<AgendaItem> agenda(Long appointmentId) {
        Map<Long, MeetingNote> byTopic = notes.findAllByAppointmentId(appointmentId).stream()
                .collect(Collectors.toMap(MeetingNote::getTopicId, n -> n, (a, b) -> a));
        return topics.findByAppointmentIdOrderByPriorityAscCreatedAtAsc(appointmentId).stream()
                .map(t -> item(t, byTopic.get(t.getId())))
                .toList();
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

    private Topic onAgenda(Long appointmentId, Long topicId) {
        Topic topic = topics.findById(topicId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!appointmentId.equals(topic.getAppointmentId())) {
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
