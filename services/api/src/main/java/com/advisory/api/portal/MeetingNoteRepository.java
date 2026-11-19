package com.advisory.api.portal;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MeetingNoteRepository extends JpaRepository<MeetingNote, Long> {

    List<MeetingNote> findAllByAppointmentId(Long appointmentId);

    Optional<MeetingNote> findByAppointmentIdAndTopicId(Long appointmentId, Long topicId);

    List<MeetingNote> findAllByAppointmentIdInOrderByUpdatedAtDesc(List<Long> appointmentIds);
}
