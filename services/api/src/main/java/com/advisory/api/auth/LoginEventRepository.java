package com.advisory.api.auth;

import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LoginEventRepository extends JpaRepository<LoginEvent, Long> {

    /**
     * Most recent first, capped by the caller. The table only grows, so an
     * unbounded read would eventually be a problem; there is no endpoint that
     * returns all of it.
     */
    List<LoginEvent> findAllByOrderByCreatedAtDesc(Pageable pageable);
}
