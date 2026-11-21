package com.advisory.api.portal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** An organisation the firm works with. Owns engagements and users. */
@Entity
@Table(name = "client")
public class Client {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @Column(name = "primary_email", nullable = false)
    private String primaryEmail;

    // Set here rather than left to the column default, so the entity
    // returned from save() -- and the create response built from it --
    // carries the timestamp instead of null.
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getPrimaryEmail() {
        return primaryEmail;
    }

    public void setPrimaryEmail(String primaryEmail) {
        this.primaryEmail = primaryEmail == null ? null : primaryEmail.trim().toLowerCase();
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
