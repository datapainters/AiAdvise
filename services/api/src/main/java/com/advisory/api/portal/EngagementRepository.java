package com.advisory.api.portal;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EngagementRepository extends JpaRepository<Engagement, Long> {

    List<Engagement> findByClientIdOrderByStartedOnDesc(Long clientId);

    /**
     * The authorization check. Used to confirm an engagement really belongs to
     * the caller's client before anything is read from or written to it.
     */
    boolean existsByIdAndClientId(Long id, Long clientId);
}
