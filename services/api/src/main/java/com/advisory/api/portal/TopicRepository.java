package com.advisory.api.portal;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TopicRepository extends JpaRepository<Topic, Long> {

    List<Topic> findByEngagementIdOrderByPriorityAscCreatedAtAsc(Long engagementId);

    List<Topic> findByEngagementIdAndStatusOrderByPriorityAsc(Long engagementId, String status);
}
