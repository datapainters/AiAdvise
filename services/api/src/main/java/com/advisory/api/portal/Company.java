package com.advisory.api.portal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * The employer printed on a contact's card.
 *
 * <p>Not the same thing as a {@link Client}. A client is an organisation the
 * firm has engaged; a company is who a person works for. They usually
 * coincide, and diverge exactly when it matters -- a consultant at a partner
 * firm who needs access to a client's portal belongs to both.
 */
@Entity
@Table(name = "company")
public class Company {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name == null ? null : name.trim();
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
