package com.advisory.api.auth;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AppUserRepository extends JpaRepository<AppUser, Long> {

    /**
     * Lookup is on the lowercased address to match the unique index, so
     * "Wes@example.com" and "wes@example.com" resolve to the same account.
     */
    @Query("select u from AppUser u where lower(u.email) = lower(:email)")
    Optional<AppUser> findByEmailIgnoringCase(@Param("email") String email);

    /** The portal logins belonging to one client. */
    List<AppUser> findAllByClientIdOrderByDisplayNameAsc(Long clientId);
}
