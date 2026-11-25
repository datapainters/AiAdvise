package com.advisory.api.portal;

import com.advisory.api.admin.PeopleService;
import com.advisory.api.admin.PeopleService.Person;
import com.advisory.api.auth.AppUser;
import com.advisory.api.auth.AppUserRepository;
import com.advisory.api.auth.CurrentUser;
import com.advisory.api.mail.Notifications;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * A client's own engagements: listing them, opening a new one, and choosing
 * which of their people are on each.
 *
 * <p>Everyone at a client can see the client's engagements. Opening one, and
 * changing who is on one, is for the account's owner and managers -- and for
 * the person who opened that engagement, who can always staff it.
 *
 * <p>A client only ever adds or removes their own people here. The Data
 * Painters side of an engagement's team is set from the console.
 */
@RestController
@RequestMapping("/api/engagements")
public class EngagementController {

    private static final Logger log = LoggerFactory.getLogger(EngagementController.class);

    private final EngagementRepository engagements;
    private final ClientRepository clients;
    private final AppUserRepository users;
    private final PeopleService people;
    private final Notifications notifications;

    public EngagementController(EngagementRepository engagements, ClientRepository clients,
            AppUserRepository users, PeopleService people, Notifications notifications) {
        this.engagements = engagements;
        this.clients = clients;
        this.users = users;
        this.people = people;
        this.notifications = notifications;
    }

    public record EngagementView(
            Long id, String title, String status, LocalDate startedOn, String goal,
            LocalDate dueOn, String communication, boolean canManageTeam) {

        static EngagementView of(Engagement e, AppUser reader) {
            return new EngagementView(e.getId(), e.getTitle(), e.getStatus(), e.getStartedOn(),
                    e.getGoal(), e.getDueOn(), e.getCommunication(), mayStaff(reader, e));
        }
    }

    public record OpenEngagement(@NotBlank String title, String goal,
            @NotBlank String communication) {}

    public record AddMember(@NotNull Long userId, @NotBlank String role) {}

    private static boolean mayStaff(AppUser reader, Engagement e) {
        return reader.isAdmin() || reader.managesClient()
                || reader.getId().equals(e.getCreatedByUserId());
    }

    @GetMapping
    public List<EngagementView> mine(@AuthenticationPrincipal Jwt jwt) {
        AppUser reader = reader(jwt);
        List<Engagement> found = reader.isAdmin()
                ? engagements.findAll()
                : engagements.findByClientIdOrderByStartedOnDesc(reader.getClientId());
        return found.stream().map(e -> EngagementView.of(e, reader)).toList();
    }

    /**
     * Opens an engagement from the portal. It starts active, so topics and
     * meetings can go on it at once, and the firm is told it exists.
     */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public EngagementView open(@AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody OpenEngagement request) {
        AppUser reader = reader(jwt);
        if (reader.isAdmin()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Open engagements for a client from the admin console");
        }
        if (!reader.managesClient()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Only your account's owner or a manager can open an engagement");
        }
        if (!List.of("message", "video", "both").contains(request.communication())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Choose messages, video meetings, or both");
        }
        String title = request.title().trim();
        if (title.length() > 200) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Keep the title under 200 characters");
        }

        Engagement e = new Engagement();
        e.setClientId(reader.getClientId());
        e.setTitle(title);
        e.setGoal(request.goal());
        e.setCommunication(request.communication());
        e.setCreatedByUserId(reader.getId());
        Engagement saved = engagements.save(e);

        // Whoever opens an engagement is on it.
        people.addMember(saved.getId(), reader.getClientId(), reader.getId(), "project_owner");

        log.info("Client {} opened engagement {} ({})", reader.getClientId(), saved.getId(),
                saved.getCommunication());
        String clientName = clients.findById(reader.getClientId()).map(Client::getName)
                .orElse("A client");
        notifications.engagementOpened(clientName, reader.getDisplayName(), title,
                saved.getCommunication(), saved.getGoal());
        return EngagementView.of(saved, reader);
    }

    /* ----------------------------------------------------------------- team */

    @GetMapping("/{id}/team")
    public List<Person> team(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id) {
        engagement(reader(jwt), id);
        return people.team(id);
    }

    @PostMapping("/{id}/team")
    public List<Person> addMember(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id,
            @Valid @RequestBody AddMember request) {
        AppUser reader = reader(jwt);
        Engagement e = staffable(reader, id);
        // From the client's own people only: never a Data Painters account,
        // and PeopleService refuses anyone from a different client.
        AppUser target = users.findById(request.userId())
                .filter(u -> !u.isAdmin() && u.isEnabled())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Choose someone from your own team"));
        return people.addMember(id, e.getClientId(), target.getId(), request.role());
    }

    @DeleteMapping("/{id}/team/{memberId}")
    public List<Person> removeMember(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id,
            @PathVariable Long memberId) {
        staffable(reader(jwt), id);
        boolean theirs = people.team(id).stream()
                .anyMatch(p -> p.id().equals(memberId) && "client".equals(p.side()));
        if (!theirs) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return people.removeMember(id, memberId);
    }

    /* -------------------------------------------------------------- helpers */

    private AppUser reader(Jwt jwt) {
        return users.findById(CurrentUser.from(jwt).id())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
    }

    /** The engagement, if it belongs to the reader's client. 404 otherwise. */
    private Engagement engagement(AppUser reader, Long id) {
        Engagement e = engagements.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!reader.isAdmin() && !e.getClientId().equals(reader.getClientId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return e;
    }

    private Engagement staffable(AppUser reader, Long id) {
        Engagement e = engagement(reader, id);
        if (!mayStaff(reader, e)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Only your account's owner, a manager, or the person who opened this "
                            + "engagement can change who is on it");
        }
        if ("closed".equals(e.getStatus())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This engagement is closed");
        }
        return e;
    }
}
