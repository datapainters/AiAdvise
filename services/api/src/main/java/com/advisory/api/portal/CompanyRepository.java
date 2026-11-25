package com.advisory.api.portal;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CompanyRepository extends JpaRepository<Company, Long> {

    /** Matches the lower(name) unique index, so find-or-create is consistent. */
    @Query("select c from Company c where lower(c.name) = lower(:name)")
    Optional<Company> findByNameIgnoringCase(@Param("name") String name);

    List<Company> findAllByOrderByNameAsc();
}
