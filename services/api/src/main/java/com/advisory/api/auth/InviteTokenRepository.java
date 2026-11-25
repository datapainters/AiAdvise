package com.advisory.api.auth;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InviteTokenRepository extends JpaRepository<InviteToken, Long> {

    Optional<InviteToken> findByTokenHash(String tokenHash);

    /** Outstanding invites for a user, which a new invite supersedes. */
    List<InviteToken> findAllByUserIdAndUsedAtIsNull(Long userId);
}
