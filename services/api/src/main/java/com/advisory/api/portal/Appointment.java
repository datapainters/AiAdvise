package com.advisory.api.portal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** A scheduled meeting between a client and the firm, against one engagement. */
@Entity
@Table(name = "appointment")
public class Appointment {

    /** Scheduling granularity, in minutes. The portal offers whole blocks only. */
    public static final int BLOCK_MINUTES = 30;

    /** Longest bookable meeting. Anything past this is a mistake, not a meeting. */
    public static final int MAX_MINUTES = 480;

    public static final String REQUESTED = "requested";
    public static final String CONFIRMED = "confirmed";
    public static final String COMPLETED = "completed";
    public static final String CANCELLED = "cancelled";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "client_id", nullable = false)
    private Long clientId;

    @Column(name = "engagement_id", nullable = false)
    private Long engagementId;

    @Column(name = "starts_at", nullable = false)
    private Instant startsAt;

    @Column(name = "duration_minutes", nullable = false)
    private int durationMinutes;

    @Column(nullable = false)
    private String status = REQUESTED;

    @Column(name = "requested_by")
    private Long requestedBy;

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

    public Long getEngagementId() {
        return engagementId;
    }

    public void setEngagementId(Long engagementId) {
        this.engagementId = engagementId;
    }

    public Instant getStartsAt() {
        return startsAt;
    }

    public void setStartsAt(Instant startsAt) {
        this.startsAt = startsAt;
    }

    public int getDurationMinutes() {
        return durationMinutes;
    }

    public void setDurationMinutes(int durationMinutes) {
        this.durationMinutes = durationMinutes;
    }

    /** Derived, not stored: the end is always start plus duration. */
    public Instant getEndsAt() {
        return startsAt == null ? null : startsAt.plusSeconds(durationMinutes * 60L);
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Long getRequestedBy() {
        return requestedBy;
    }

    public void setRequestedBy(Long requestedBy) {
        this.requestedBy = requestedBy;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
