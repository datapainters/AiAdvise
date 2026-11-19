package com.advisory.api.portal;

import java.util.List;
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
}
