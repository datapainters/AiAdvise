package com.advisory.api.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * A portal login.
 *
 * <p>A CLIENT user belongs to exactly one client and sees only that client's
 * engagements. An ADMIN is the firm, has no client, and is not scoped. The
 * database enforces that pairing with a check constraint, so an inconsistent
 * row cannot be written even by a bug here.
 */
@Entity
@Table(name = "app_user")
public class AppUser {

    public static final String ROLE_CLIENT = "CLIENT";
    public static final String ROLE_ADMIN = "ADMIN";

    /**
     * What a staff account works on. Only meaningful when role is ADMIN,
     * which now reads as "is staff"; see V13.
     */
    public static final String TEAM_ADMIN = "admin";
    public static final String TEAM_BILLING = "billing";
    public static final String TEAM_RELATIONS = "relations";
    public static final String TEAM_ENGINEER = "engineer";
    public static final java.util.List<String> TEAM_ROLES =
            java.util.List.of(TEAM_ADMIN, TEAM_BILLING, TEAM_RELATIONS, TEAM_ENGINEER);

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Null for ADMIN users. */
    @Column(name = "client_id")
    private Long clientId;

    @Column(nullable = false)
    private String email;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Column(name = "display_name", nullable = false)
    private String displayName;

    /**
     * Captured separately from displayName because forms need them apart.
     * displayName stays the authoritative label -- splitting a name on the
     * first space is wrong for plenty of people, so it is derived once and
     * then left alone.
     */
    @Column(name = "first_name")
    private String firstName;

    @Column(name = "last_name")
    private String lastName;

    @Column
    private String phone;

    /** The contact's employer, which is not necessarily the client. */
    @Column(name = "company_id")
    private Long companyId;

    @Column(nullable = false)
    private String role = ROLE_CLIENT;

    @Column(name = "team_role")
    private String teamRole;

    /** owner, manager or member of the client account; null for staff. */
    @Column(name = "client_role")
    private String clientRole;

    @Column(nullable = false)
    private boolean enabled = true;

    @Column(name = "must_change_password", nullable = false)
    private boolean mustChangePassword = false;

    @Column(name = "last_login_at")
    private Instant lastLoginAt;

    // Set here rather than left to the column default, so the entity
    // returned from save() -- and the create response built from it --
    // carries the timestamp instead of null.
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    public boolean isAdmin() {
        return ROLE_ADMIN.equals(role);
    }

    public static final String CLIENT_OWNER = "owner";
    public static final String CLIENT_MANAGER = "manager";
    public static final String CLIENT_MEMBER = "member";

    public String getClientRole() {
        return clientRole;
    }

    public void setClientRole(String clientRole) {
        this.clientRole = clientRole;
    }

    /** May open engagements and choose who is on them. */
    public boolean managesClient() {
        return CLIENT_OWNER.equals(clientRole) || CLIENT_MANAGER.equals(clientRole);
    }

    public String getTeamRole() {
        return teamRole;
    }

    public void setTeamRole(String teamRole) {
        this.teamRole = teamRole;
    }

    public Long getId() {
        return id;
    }

    public String getFirstName() {
        return firstName;
    }

    public void setFirstName(String firstName) {
        this.firstName = trimToNull(firstName);
    }

    public String getLastName() {
        return lastName;
    }

    public void setLastName(String lastName) {
        this.lastName = trimToNull(lastName);
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = trimToNull(phone);
    }

    public Long getCompanyId() {
        return companyId;
    }

    public void setCompanyId(Long companyId) {
        this.companyId = companyId;
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    public Long getClientId() {
        return clientId;
    }

    public void setClientId(Long clientId) {
        this.clientId = clientId;
    }

    public String getEmail() {
        return email;
    }

    /** Always stored lowercase; the unique index is on lower(email). */
    public void setEmail(String email) {
        this.email = email == null ? null : email.trim().toLowerCase();
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public String getRole() {
        return role;
    }

    public void setRole(String role) {
        this.role = role;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public boolean isMustChangePassword() {
        return mustChangePassword;
    }

    public void setMustChangePassword(boolean mustChangePassword) {
        this.mustChangePassword = mustChangePassword;
    }

    public Instant getLastLoginAt() {
        return lastLoginAt;
    }

    public void setLastLoginAt(Instant lastLoginAt) {
        this.lastLoginAt = lastLoginAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
