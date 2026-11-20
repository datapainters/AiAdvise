package com.advisory.api.portal;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TopicRepository extends JpaRepository<Topic, Long> {

    /**
     * Every topic on an engagement, whoever wrote it. Admin views only --
     * a client user must go through the creator-scoped methods below, or
     * they see other users' topics.
     */
    List<Topic> findByEngagementIdOrderByPriorityAscCreatedAtAsc(Long engagementId);

    List<Topic> findByEngagementIdAndStatusOrderByPriorityAsc(Long engagementId, String status);

    /* ------------------------------------------------- creator-scoped reads */

    /**
     * One user's own topics on an engagement.
     *
     * <p>A null creator never matches, which is what keeps unowned legacy
     * rows out of the portal rather than showing them to an arbitrary user.
     */
    List<Topic> findByEngagementIdAndCreatedByUserIdOrderByPriorityAscCreatedAtAsc(
            Long engagementId, Long createdByUserId);

    List<Topic> findByEngagementIdAndCreatedByUserIdAndStatusOrderByPriorityAsc(
            Long engagementId, Long createdByUserId, String status);

    /** Agenda for one meeting, highest priority first. */
    List<Topic> findByAppointmentIdOrderByPriorityAscCreatedAtAsc(Long appointmentId);

    List<Topic> findAllByAppointmentIdIn(List<Long> appointmentIds);

    /** Backlog across every engagement a client has. */
    List<Topic> findByEngagementIdInAndStatusOrderByPriorityAscCreatedAtAsc(
            List<Long> engagementIds, String status);
}
