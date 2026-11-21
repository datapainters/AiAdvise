package com.advisory.api.portal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * A subject a client wants covered in an upcoming session.
 *
 * <p>Mapped against the {@code topic} table created by V1__init.sql. Hibernate
 * runs with {@code ddl-auto: validate}, so a mismatch between this class and
 * the migration fails at startup rather than quietly diverging.
 */
@Entity
@Table(name = "topic")
public class Topic {

    /** In the backlog, not yet attached to a meeting. */
    public static final String PROPOSED = "proposed";

    /** Attached to an appointment as an agenda item. */
    public static final String SCHEDULED = "scheduled";

    public static final String DISCUSSED = "discussed";
    public static final String DROPPED = "dropped";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "engagement_id", nullable = false)
    private Long engagementId;

    /**
     * The user who created this topic. A topic is private to its creator:
     * other users of the same client cannot see it, even though they share
     * the engagement.
     *
     * <p>Nullable only because V8 backfilled rows that predate the column and
     * could not be attributed to anyone. The application always sets it on
     * create, so a null here means an unowned legacy row, visible to admins
     * only. It also goes null if the creator's account is deleted, which
     * preserves the topic and any meeting notes attached to it.
     */
    @Column(name = "created_by_user_id")
    private Long createdByUserId;

    @Column(nullable = false)
    private String title;

    @Column(columnDefinition = "text")
    private String detail;

    /** What the client wants to be true once this has been discussed. */
    @Column(name = "desired_outcome")
    private String desiredOutcome;

    /**
     * The meeting this topic is an agenda item for. Null while it sits in
     * the backlog, and null again if that meeting is cancelled -- cancelling
     * returns topics to the backlog rather than destroying what the client
     * typed.
     */
    @Column(name = "appointment_id")
    private Long appointmentId;

    @Column(nullable = false)
    private int priority = 3;

    @Column(nullable = false)
    private String status = PROPOSED;

    // Set here rather than left to the column default, so the entity
    // returned from save() -- and the create response built from it --
    // carries the timestamp instead of null.
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    @PreUpdate
    void touch() {
        this.updatedAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public Long getEngagementId() {
        return engagementId;
    }

    public void setEngagementId(Long engagementId) {
        this.engagementId = engagementId;
    }

    public Long getCreatedByUserId() {
        return createdByUserId;
    }

    public void setCreatedByUserId(Long createdByUserId) {
        this.createdByUserId = createdByUserId;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getDetail() {
        return detail;
    }

    public void setDetail(String detail) {
        this.detail = detail;
    }

    public String getDesiredOutcome() {
        return desiredOutcome;
    }

    public void setDesiredOutcome(String desiredOutcome) {
        this.desiredOutcome = desiredOutcome;
    }

    public Long getAppointmentId() {
        return appointmentId;
    }

    public void setAppointmentId(Long appointmentId) {
        this.appointmentId = appointmentId;
    }

    public int getPriority() {
        return priority;
    }

    public void setPriority(int priority) {
        this.priority = priority;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
