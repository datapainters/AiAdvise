package com.advisory.api.admin;

import com.advisory.api.auth.AppUser;
import com.advisory.api.auth.AppUserRepository;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * The people attached to an engagement (its team) and to a meeting (its
 * participants), drawn from both sides of the table.
 *
 * <p>Two rules are enforced here rather than left to the caller. A person
 * from the client side must belong to the client the engagement is for, so
 * one client's contact can never be attached to another client's work. And
 * the role has to suit the side: a client contact is not an "engineer", and
 * a Data Painters engineer is not the "executive sponsor".
 */
@Service
public class PeopleService {

    public static final List<String> TEAM_ROLES =
            List.of("lead", "engineer", "account_manager", "billing");
    public static final List<String> CLIENT_ROLES =
            List.of("sponsor", "project_owner", "technical", "billing_contact", "stakeholder");

    public static final Map<String, String> ROLE_LABELS = Map.of(
            "lead", "Engagement lead",
            "engineer", "Engineer",
            "account_manager", "Account manager",
            "billing", "Billing",
            "sponsor", "Executive sponsor",
            "project_owner", "Project owner",
            "technical", "Technical contact",
            "billing_contact", "Billing contact",
            "stakeholder", "Stakeholder");

    private final JdbcClient jdbc;
    private final AppUserRepository users;

    public PeopleService(JdbcClient jdbc, AppUserRepository users) {
        this.jdbc = jdbc;
        this.users = users;
    }

    /** Someone who could be added: a staff account, or a login at this client. */
    public record Candidate(Long userId, String name, String email, String side,
            String teamRole) {}

    /**
     * A person on an engagement or in a meeting. {@code attending} and
     * {@code sendSummary} are always true for an engagement member; they only
     * vary per meeting.
     */
    public record Person(Long id, Long userId, String name, String email, String side,
            String role, boolean attending, boolean sendSummary, boolean enabled) {}

    private static Person person(ResultSet rs, int i) throws SQLException {
        return new Person(rs.getLong("id"), rs.getLong("user_id"),
                rs.getString("display_name"), rs.getString("email"),
                "ADMIN".equals(rs.getString("account_role")) ? "team" : "client",
                rs.getString("role"), rs.getBoolean("attending"),
                rs.getBoolean("send_summary"), rs.getBoolean("enabled"));
    }

    /* ------------------------------------------------------------ candidates */

    public List<Candidate> candidates(Long clientId) {
        Stream<AppUser> staff = users.findAll().stream()
                .filter(u -> u.isAdmin() && u.isEnabled());
        Stream<AppUser> theirs = users.findAllByClientIdOrderByDisplayNameAsc(clientId).stream()
                .filter(AppUser::isEnabled);
        return Stream.concat(staff, theirs)
                .sorted(Comparator.comparing((AppUser u) -> u.isAdmin() ? 0 : 1)
                        .thenComparing(AppUser::getDisplayName, String.CASE_INSENSITIVE_ORDER))
                .map(u -> new Candidate(u.getId(), u.getDisplayName(), u.getEmail(),
                        u.isAdmin() ? "team" : "client",
                        u.isAdmin() ? u.getTeamRole() : null))
                .toList();
    }

    /** Checks the person may be attached to this client's work in this role. */
    private void validate(Long userId, String role, Long clientId) {
        AppUser user = users.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "No such user"));
        if (user.isAdmin()) {
            if (!TEAM_ROLES.contains(role)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Choose a Data Painters role for a team member");
            }
        } else {
            if (!clientId.equals(user.getClientId())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "That person belongs to a different client");
            }
            if (!CLIENT_ROLES.contains(role)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Choose a client role for a client contact");
            }
        }
    }

    /* ------------------------------------------------------- engagement team */

    private static final String MEMBER_SELECT = """
            SELECT m.id, m.user_id, m.role, true AS attending, true AS send_summary,
                   u.display_name, u.email, u.role AS account_role, u.enabled
            FROM engagement_member m
            JOIN app_user u ON u.id = m.user_id
            """;

    public List<Person> team(Long engagementId) {
        return jdbc.sql(MEMBER_SELECT + """
                 WHERE m.engagement_id = ?
                 ORDER BY (u.role = 'ADMIN') DESC, lower(u.display_name)
                """).param(engagementId).query(PeopleService::person).list();
    }

    @Transactional
    public List<Person> addMember(Long engagementId, Long clientId, Long userId, String role) {
        validate(userId, role, clientId);
        try {
            jdbc.sql("INSERT INTO engagement_member (engagement_id, user_id, role) VALUES (?, ?, ?)")
                    .params(engagementId, userId, role).update();
        } catch (DuplicateKeyException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "That person is already on this engagement");
        }
        return team(engagementId);
    }

    @Transactional
    public List<Person> updateMember(Long engagementId, Long clientId, Long memberId,
            String role) {
        Long userId = jdbc.sql(
                        "SELECT user_id FROM engagement_member WHERE id = ? AND engagement_id = ?")
                .params(memberId, engagementId).query(Long.class).optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        validate(userId, role, clientId);
        jdbc.sql("UPDATE engagement_member SET role = ? WHERE id = ?")
                .params(role, memberId).update();
        return team(engagementId);
    }

    @Transactional
    public List<Person> removeMember(Long engagementId, Long memberId) {
        jdbc.sql("DELETE FROM engagement_member WHERE id = ? AND engagement_id = ?")
                .params(memberId, engagementId).update();
        return team(engagementId);
    }

    /* -------------------------------------------------- meeting participants */

    private static final String PARTICIPANT_SELECT = """
            SELECT p.id, p.user_id, p.role, p.attending, p.send_summary,
                   u.display_name, u.email, u.role AS account_role, u.enabled
            FROM appointment_participant p
            JOIN app_user u ON u.id = p.user_id
            """;

    public List<Person> participants(Long appointmentId) {
        return jdbc.sql(PARTICIPANT_SELECT + """
                 WHERE p.appointment_id = ?
                 ORDER BY (u.role = 'ADMIN') DESC, lower(u.display_name)
                """).param(appointmentId).query(PeopleService::person).list();
    }

    @Transactional
    public List<Person> addParticipant(Long appointmentId, Long clientId, Long userId,
            String role, boolean attending, boolean sendSummary) {
        validate(userId, role, clientId);
        try {
            jdbc.sql("""
                    INSERT INTO appointment_participant
                        (appointment_id, user_id, role, attending, send_summary)
                    VALUES (?, ?, ?, ?, ?)
                    """).params(appointmentId, userId, role, attending, sendSummary).update();
        } catch (DuplicateKeyException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "That person is already on this meeting");
        }
        return participants(appointmentId);
    }

    @Transactional
    public List<Person> updateParticipant(Long appointmentId, Long clientId, Long participantId,
            String role, boolean attending, boolean sendSummary) {
        Long userId = jdbc.sql("""
                        SELECT user_id FROM appointment_participant
                        WHERE id = ? AND appointment_id = ?
                        """)
                .params(participantId, appointmentId).query(Long.class).optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        validate(userId, role, clientId);
        jdbc.sql("""
                UPDATE appointment_participant
                SET role = ?, attending = ?, send_summary = ? WHERE id = ?
                """).params(role, attending, sendSummary, participantId).update();
        return participants(appointmentId);
    }

    @Transactional
    public List<Person> removeParticipant(Long appointmentId, Long participantId) {
        jdbc.sql("DELETE FROM appointment_participant WHERE id = ? AND appointment_id = ?")
                .params(participantId, appointmentId).update();
        return participants(appointmentId);
    }

    /**
     * Copies the engagement's team onto the meeting, leaving anyone already
     * there as they are. The usual way to fill a meeting's list.
     */
    @Transactional
    public List<Person> addEngagementTeam(Long appointmentId, Long engagementId) {
        jdbc.sql("""
                INSERT INTO appointment_participant (appointment_id, user_id, role)
                SELECT ?, m.user_id, m.role
                FROM engagement_member m
                JOIN app_user u ON u.id = m.user_id AND u.enabled
                WHERE m.engagement_id = ?
                ON CONFLICT (appointment_id, user_id) DO NOTHING
                """).params(appointmentId, engagementId).update();
        return participants(appointmentId);
    }

    /* --------------------------------------------------------------- summary */

    /** Addresses of the enabled participants who asked for the write-up. */
    public List<String> summaryRecipients(Long appointmentId) {
        return jdbc.sql("""
                SELECT u.email FROM appointment_participant p
                JOIN app_user u ON u.id = p.user_id
                WHERE p.appointment_id = ? AND p.send_summary AND u.enabled
                ORDER BY u.email
                """).param(appointmentId).query(String.class).list();
    }

    /** True the first time only, so a reopened meeting does not mail twice. */
    @Transactional
    public boolean claimSummary(Long appointmentId) {
        return jdbc.sql("""
                UPDATE appointment SET summary_sent_at = now()
                WHERE id = ? AND summary_sent_at IS NULL
                """).param(appointmentId).update() == 1;
    }
}
