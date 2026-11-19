package com.advisory.api.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** One sign-in attempt. Append-only; nothing in the application updates a row. */
@Entity
@Table(name = "login_event")
public class LoginEvent {

    public static final String SUCCESS = "success";
    public static final String FAILURE = "failure";
    public static final String PASSWORD_CHANGE = "password_change";

    /** A first password set by redeeming an invite link. */
    public static final String INVITE_ACCEPTED = "invite_accepted";

    /** Longest value either column will hold; anything longer is truncated. */
    private static final int MAX_TEXT = 512;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Null when the attempt matched no account. */
    @Column(name = "user_id")
    private Long userId;

    @Column(name = "email_tried", nullable = false)
    private String emailTried;

    @Column(nullable = false)
    private String outcome;

    @Column(name = "ip_address")
    private String ipAddress;

    @Column(name = "user_agent")
    private String userAgent;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    public Long getId() {
        return id;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public String getEmailTried() {
        return emailTried;
    }

    /**
     * Truncated and lowercased. The value comes straight from an
     * unauthenticated request body, so it is bounded here rather than trusting
     * the column type.
     */
    public void setEmailTried(String emailTried) {
        this.emailTried = emailTried == null
                ? "(none)"
                : truncate(emailTried.trim().toLowerCase());
    }

    public String getOutcome() {
        return outcome;
    }

    public void setOutcome(String outcome) {
        this.outcome = outcome;
    }

    public String getIpAddress() {
        return ipAddress;
    }

    public void setIpAddress(String ipAddress) {
        this.ipAddress = truncate(ipAddress);
    }

    public String getUserAgent() {
        return userAgent;
    }

    public void setUserAgent(String userAgent) {
        this.userAgent = truncate(userAgent);
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    private static String truncate(String value) {
        if (value == null) {
            return null;
        }
        return value.length() <= MAX_TEXT ? value : value.substring(0, MAX_TEXT);
    }
}
