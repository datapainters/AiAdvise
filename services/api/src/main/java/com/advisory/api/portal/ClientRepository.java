package com.advisory.api.portal;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ClientRepository extends JpaRepository<Client, Long> {

    List<Client> findAllByOrderByNameAsc();

    /**
     * primary_email is UNIQUE in the schema. Checking first turns the common
     * case into a clean 409 instead of relying on the constraint violation
     * being translated, which depends on whether it surfaces at flush or at
     * commit.
     */
    boolean existsByPrimaryEmailIgnoreCase(String primaryEmail);

    /**
     * Used when editing, where the collision to reject is any client other
     * than the one being saved -- so the row itself has to come back, not
     * just a boolean.
     */
    Optional<Client> findByPrimaryEmailIgnoringCase(String primaryEmail);
}
