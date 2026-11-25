package com.advisory.api.admin;

import com.advisory.api.admin.AdminController.CreatedUser;
import com.advisory.api.admin.AdminController.UserView;
import com.advisory.api.auth.AppUser;
import com.advisory.api.auth.AppUserRepository;
import com.advisory.api.auth.CurrentUser;
import com.advisory.api.auth.InviteService;
import com.advisory.api.mail.Notifications;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * The firm's own people: who has a console account and what it lets them do.
 *
 * <p>Restricted to administrators in SecurityConfig. Team members are invited
 * the same way clients are -- a single-use link, never a password the inviter
 * knows -- so an administrator cannot sign in as a colleague.
 *
 * <p>Two rules keep the console from locking itself: nobody changes their own
 * role or disables their own account, and the last enabled administrator
 * cannot be demoted or disabled by anyone.
 */
@RestController
@RequestMapping("/api/admin/team")
public class TeamController {

    private static final Logger log = LoggerFactory.getLogger(TeamController.class);

    /** What each team role is called wherever a person reads it. */
    public static final Map<String, String> ROLE_LABELS = Map.of(
            AppUser.TEAM_ADMIN, "Administrator",
            AppUser.TEAM_BILLING, "Billing",
            AppUser.TEAM_RELATIONS, "Client relations",
            AppUser.TEAM_ENGINEER, "Engineer");

    private final AppUserRepository users;
    private final InviteService invites;
    private final Notifications notifications;
    private final String appBaseUrl;

    public TeamController(AppUserRepository users, InviteService invites,
            Notifications notifications,
            @Value("${APP_BASE_URL:https://ai.datapainters.com}") String appBaseUrl) {
        this.users = users;
        this.invites = invites;
        this.notifications = notifications;
        this.appBaseUrl = appBaseUrl;
    }

    public record TeamMember(Long id, String email, String displayName, String firstName,
            String lastName, String phone, String teamRole, boolean enabled,
            boolean invitePending, Instant lastLoginAt, Instant createdAt) {

        static TeamMember of(AppUser u) {
            return new TeamMember(u.getId(), u.getEmail(), u.getDisplayName(),
                    u.getFirstName(), u.getLastName(), u.getPhone(),
                    u.getTeamRole() == null ? AppUser.TEAM_ADMIN : u.getTeamRole(),
                    u.isEnabled(), u.isMustChangePassword() && u.getLastLoginAt() == null,
                    u.getLastLoginAt(), u.getCreatedAt());
        }
    }

    public record InviteMember(
            @NotBlank String firstName,
            @NotBlank String lastName,
            @NotBlank @Email String email,
            String phone,
            @NotBlank String teamRole) {}

    public record UpdateMember(
            @NotBlank String firstName,
            @NotBlank String lastName,
            String phone,
            @NotBlank String teamRole,
            boolean enabled) {}

    @GetMapping
    public List<TeamMember> list() {
        return users.findAll().stream()
                .filter(AppUser::isAdmin)
                .sorted(Comparator.comparing(AppUser::getDisplayName,
                        String.CASE_INSENSITIVE_ORDER))
                .map(TeamMember::of)
                .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public CreatedUser invite(@AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody InviteMember request) {
        requireRole(request.teamRole());
        String email = request.email().trim().toLowerCase();
        if (users.findByEmailIgnoringCase(email).isPresent()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "An account already exists for that email");
        }

        AppUser user = new AppUser();
        user.setEmail(email);
        user.setFirstName(request.firstName());
        user.setLastName(request.lastName());
        user.setDisplayName((request.firstName().trim() + " " + request.lastName().trim()).trim());
        user.setPhone(request.phone());
        user.setRole(AppUser.ROLE_ADMIN);
        user.setTeamRole(request.teamRole());
        user.setClientId(null);
        user.setPasswordHash(invites.unusablePassword());
        user.setMustChangePassword(true);
        user.setEnabled(true);
        AppUser saved = users.save(user);

        log.info("Invited team member {} as {}", saved.getId(), saved.getTeamRole());
        return invite(invites, notifications, appBaseUrl, saved, CurrentUser.from(jwt).id());
    }

    @PutMapping("/{id}")
    @Transactional
    public TeamMember update(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id,
            @Valid @RequestBody UpdateMember request) {
        requireRole(request.teamRole());
        AppUser user = users.findById(id)
                .filter(AppUser::isAdmin)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        String currentRole = user.getTeamRole() == null ? AppUser.TEAM_ADMIN : user.getTeamRole();
        boolean roleChanges = !currentRole.equals(request.teamRole());
        boolean disabling = user.isEnabled() && !request.enabled();

        if (id.equals(CurrentUser.from(jwt).id()) && (roleChanges || disabling)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "You cannot change your own role or disable your own account. "
                            + "Ask another administrator.");
        }

        boolean wasActiveAdmin = user.isEnabled() && AppUser.TEAM_ADMIN.equals(currentRole);
        boolean staysActiveAdmin = request.enabled()
                && AppUser.TEAM_ADMIN.equals(request.teamRole());
        if (wasActiveAdmin && !staysActiveAdmin && activeAdmins() <= 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "This is the only administrator. Make someone else an administrator first.");
        }

        user.setFirstName(request.firstName());
        user.setLastName(request.lastName());
        user.setDisplayName((request.firstName().trim() + " " + request.lastName().trim()).trim());
        user.setPhone(request.phone());
        user.setTeamRole(request.teamRole());
        user.setEnabled(request.enabled());
        log.info("Updated team member {}: role {}, enabled {}", id, request.teamRole(),
                request.enabled());
        return TeamMember.of(users.save(user));
    }

    private long activeAdmins() {
        return users.findAll().stream()
                .filter(u -> u.isAdmin() && u.isEnabled()
                        && (u.getTeamRole() == null
                                || AppUser.TEAM_ADMIN.equals(u.getTeamRole())))
                .count();
    }

    private static void requireRole(String teamRole) {
        if (!AppUser.TEAM_ROLES.contains(teamRole)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Role must be one of " + AppUser.TEAM_ROLES);
        }
    }

    /** Issues an invite link for a team member, emails it, and returns it either way. */
    static CreatedUser invite(InviteService invites, Notifications notifications,
            String appBaseUrl, AppUser user, Long issuedBy) {
        InviteService.Issued issued = invites.issue(user.getId(), issuedBy);
        String url = appBaseUrl + "/invite/" + issued.token();
        boolean emailed = notifications.teamInvitation(user.getEmail(), user.getDisplayName(),
                ROLE_LABELS.getOrDefault(user.getTeamRole(), "a team member"), url,
                issued.expiresAt());
        return new CreatedUser(UserView.of(user), url, issued.expiresAt(), emailed);
    }
}
