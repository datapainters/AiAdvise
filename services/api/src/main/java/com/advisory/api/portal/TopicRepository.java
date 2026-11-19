package com.advisory.api.portal;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TopicRepository extends JpaRepository<Topic, Long> {

    List<Topic> findByEngagementIdOrderByPriorityAscCreatedAtAsc(Long engagementId);

    List<Topic> findByEngagementIdAndStatusOrderByPriorityAsc(Long engagementId, String status);

    /** Agenda for one meeting, highest priority first. */
    List<Topic> findByAppointmentIdOrderByPriorityAscCreatedAtAsc(Long appointmentId);

    List<Topic> findAllByAppointmentIdIn(List<Long> appointmentIds);

    /** Backlog across every engagement a client has. */
    List<Topic> findByEngagementIdInAndStatusOrderByPriorityAscCreatedAtAsc(
            List<Long> engagementIds, String status);
}
