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

    /** The need this engagement exists to meet; its meetings work towards it. */
    @Column
    private String goal;

    // UTC, matching the database default this replaces on RDS.
    @Column(name = "started_on", nullable = false)
    private LocalDate startedOn = LocalDate.now(java.time.ZoneOffset.UTC);

    /** message, video or both: how the client wants this engagement run. */
    @Column(nullable = false)
    private String communication = "video";

    @Column(name = "created_by_user_id")
    private Long createdByUserId;

    @Column(name = "closed_on")
    private LocalDate closedOn;

    @Column(name = "closure_notes")
    private String closureNotes;

    @Column(name = "closed_by")
    private Long closedBy;

    /** When the engagement is meant to reach its goal; null if open-ended. */
    @Column(name = "due_on")
    private LocalDate dueOn;

    // Set here rather than left to the column default, so the entity
    // returned from save() -- and the create response built from it --
    // carries the timestamp instead of null.
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

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

    public String getGoal() {
        return goal;
    }

    public void setGoal(String goal) {
        this.goal = goal == null || goal.isBlank() ? null : goal.trim();
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

    public void setStartedOn(LocalDate startedOn) {
        this.startedOn = startedOn;
    }

    public String getCommunication() {
        return communication;
    }

    public void setCommunication(String communication) {
        this.communication = communication;
    }

    /** Whether topics on this engagement carry a written thread. */
    public boolean allowsMessages() {
        return "message".equals(communication) || "both".equals(communication);
    }

    /** Whether meetings can be booked on this engagement. */
    public boolean allowsVideo() {
        return "video".equals(communication) || "both".equals(communication);
    }

    public Long getCreatedByUserId() {
        return createdByUserId;
    }

    public void setCreatedByUserId(Long createdByUserId) {
        this.createdByUserId = createdByUserId;
    }

    public LocalDate getClosedOn() {
        return closedOn;
    }

    public void setClosedOn(LocalDate closedOn) {
        this.closedOn = closedOn;
    }

    public String getClosureNotes() {
        return closureNotes;
    }

    public void setClosureNotes(String closureNotes) {
        this.closureNotes = closureNotes;
    }

    public Long getClosedBy() {
        return closedBy;
    }

    public void setClosedBy(Long closedBy) {
        this.closedBy = closedBy;
    }

    public LocalDate getDueOn() {
        return dueOn;
    }

    public void setDueOn(LocalDate dueOn) {
        this.dueOn = dueOn;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
