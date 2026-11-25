package com.advisory.api.portal;

import com.advisory.api.auth.AppUser;
import com.advisory.api.auth.AppUserRepository;
import com.advisory.api.auth.CurrentUser;
import com.advisory.api.auth.InviteService;
import com.advisory.api.mail.Notifications;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import java.time.Instant;
import java.util.List;
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
 * A client's own people: who has a login on the client's account.
 *
 * <p>Everyone at the client can see the list, because they need it to know
 * who can be put on an engagement. Only the owner -- the first person who
 * signed up for the client -- can add someone, change a role or switch an
 * account off. There is exactly one owner and the role cannot be handed out
 * here, so a client can never end up with nobody able to manage its people.
 *
 * <p>New people are invited the way the firm invites them: a single-use link
 * to set their own password, which the owner never sees.
 */
@RestController
@RequestMapping("/api/team")
public class ClientTeamController {

    private static final Logger log = LoggerFactory.getLogger(ClientTeamController.class);

    private static final List<String> GRANTABLE =
            List.of(AppUser.CLIENT_MANAGER, AppUser.CLIENT_MEMBER);

    private final AppUserRepository users;
    private final ClientRepository clients;
    private final InviteService invites;
    private final Notifications notifications;
    private final String appBaseUrl;

    public ClientTeamController(AppUserRepository users, ClientRepository clients,
            InviteService invites, Notifications notifications,
            @Value("${APP_BASE_URL:https://ai.datapainters.com}") String appBaseUrl) {
        this.users = users;
        this.clients = clients;
        this.invites = invites;
        this.notifications = notifications;
        this.appBaseUrl = appBaseUrl;
    }

    public record Member(Long id, String displayName, String firstName, String lastName,
            String email, String phone, String clientRole, boolean enabled,
            boolean invitePending, Instant lastLoginAt) {

        static Member of(AppUser u) {
            return new Member(u.getId(), u.getDisplayName(), u.getFirstName(), u.getLastName(),
                    u.getEmail(), u.getPhone(),
                    u.getClientRole() == null ? AppUser.CLIENT_MEMBER : u.getClientRole(),
                    u.isEnabled(), u.isMustChangePassword() && u.getLastLoginAt() == null,
                    u.getLastLoginAt());
        }
    }

    public record Team(boolean canManage, List<Member> members) {}

    public record AddMember(@NotBlank String firstName, @NotBlank String lastName,
            @NotBlank @Email String email, String phone, @NotBlank String clientRole) {}

    public record UpdateMember(@NotBlank String clientRole, boolean enabled) {}

    @GetMapping
    public Team team(@AuthenticationPrincipal Jwt jwt) {
        AppUser reader = clientUser(jwt);
        return new Team(isOwner(reader),
                users.findAllByClientIdOrderByDisplayNameAsc(reader.getClientId()).stream()
                        .map(Member::of).toList());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Member add(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody AddMember request) {
        AppUser owner = owner(jwt);
        requireGrantable(request.clientRole());
        String email = request.email().trim().toLowerCase();
        if (users.findByEmailIgnoringCase(email).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Someone already has an account with that email address");
        }

        AppUser user = new AppUser();
        user.setEmail(email);
        user.setFirstName(request.firstName());
        user.setLastName(request.lastName());
        user.setDisplayName((request.firstName().trim() + " " + request.lastName().trim()).trim());
        user.setPhone(request.phone());
        user.setRole(AppUser.ROLE_CLIENT);
        user.setClientRole(request.clientRole());
        user.setClientId(owner.getClientId());
        user.setPasswordHash(invites.unusablePassword());
        user.setMustChangePassword(true);
        user.setEnabled(true);
        AppUser saved = users.save(user);

        InviteService.Issued issued = invites.issue(saved.getId(), owner.getId());
        String clientName = clients.findById(owner.getClientId()).map(Client::getName)
                .orElse("your team");
        notifications.invitation(saved.getEmail(), saved.getDisplayName(), clientName,
                appBaseUrl + "/invite/" + issued.token(), issued.expiresAt());

        log.info("Client {} owner added team member {} as {}", owner.getClientId(),
                saved.getId(), saved.getClientRole());
        return Member.of(saved);
    }

    @PutMapping("/{id}")
    @Transactional
    public Member update(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id,
            @Valid @RequestBody UpdateMember request) {
        AppUser owner = owner(jwt);
        if (id.equals(owner.getId())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "You are the account owner; your own role and access cannot be changed here");
        }
        requireGrantable(request.clientRole());
        // Same client or it does not exist, as far as this caller can tell.
        AppUser user = users.findById(id)
                .filter(u -> !u.isAdmin() && owner.getClientId().equals(u.getClientId()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        user.setClientRole(request.clientRole());
        user.setEnabled(request.enabled());
        log.info("Client {} owner updated team member {}: {}, enabled {}", owner.getClientId(),
                id, request.clientRole(), request.enabled());
        return Member.of(users.save(user));
    }

    /** Sends a fresh single-use link, replacing any they already hold. */
    @PostMapping("/{id}/invite")
    public Member reinvite(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id) {
        AppUser owner = owner(jwt);
        AppUser user = users.findById(id)
                .filter(u -> !u.isAdmin() && owner.getClientId().equals(u.getClientId())
                        && u.isEnabled() && !u.getId().equals(owner.getId()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        InviteService.Issued issued = invites.issue(user.getId(), owner.getId());
        String clientName = clients.findById(owner.getClientId()).map(Client::getName)
                .orElse("your team");
        notifications.invitation(user.getEmail(), user.getDisplayName(), clientName,
                appBaseUrl + "/invite/" + issued.token(), issued.expiresAt());
        return Member.of(user);
    }

    private static void requireGrantable(String role) {
        if (!GRANTABLE.contains(role)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Role must be manager or member");
        }
    }

    private AppUser clientUser(Jwt jwt) {
        AppUser reader = users.findById(CurrentUser.from(jwt).id())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
        if (reader.isAdmin() || reader.getClientId() == null) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "This is for client accounts");
        }
        return reader;
    }

    private boolean isOwner(AppUser reader) {
        return clients.findById(reader.getClientId())
                .map(c -> reader.getId().equals(c.getOwnerUserId())).orElse(false);
    }

    private AppUser owner(Jwt jwt) {
        AppUser reader = clientUser(jwt);
        if (!isOwner(reader)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Only your account's owner can manage team members");
        }
        return reader;
    }
}
