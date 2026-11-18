package com.advisory.api.portal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;

/**
 * A workstream the firm is running for a client.
 *
 * <p>This is the unit authorization hangs off: a user belongs to a client, a
 * client owns engagements, and an engagement owns topics.
 */
@Entity
@Table(name = "engagement")
public class Engagement {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "client_id", nullable = false)
    private Long clientId;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private String status = "active";

    @Column(name = "started_on", nullable = false, insertable = false, updatable = false)
    private LocalDate startedOn;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    public Long getId() {
        return id;
    }

    public Long getClientId() {
        return clientId;
    }

    public void setClientId(Long clientId) {
        this.clientId = clientId;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public LocalDate getStartedOn() {
        return startedOn;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
