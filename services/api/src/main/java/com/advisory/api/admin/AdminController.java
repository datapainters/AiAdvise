package com.advisory.api.admin;

import com.advisory.api.auth.AppUser;
import com.advisory.api.auth.CurrentUser;
import com.advisory.api.auth.AppUserRepository;
import com.advisory.api.auth.LoginEvent;
import com.advisory.api.auth.InviteService;
import com.advisory.api.auth.LoginEventRepository;
import com.advisory.api.mail.Notifications;
import com.advisory.api.portal.Client;
import com.advisory.api.portal.Company;
import com.advisory.api.portal.CompanyRepository;
import com.advisory.api.portal.ClientRepository;
import com.advisory.api.portal.Engagement;
import com.advisory.api.portal.EngagementRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Firm-side administration: create clients, open engagements, and issue
 * client logins.
 *
 * <p>The whole path is restricted to ROLE_ADMIN in SecurityConfig, so there
 * are no per-method role checks here. A user with a pending forced password
 * change carries the PASSWORD_RESET role instead of their real one and
 * therefore cannot reach any of this until they have chosen a password.
 *
 * <p>There is no self-service registration anywhere in the system. Accounts
 * exist because the firm created them for a client it has engaged.
 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private static final Logger log = LoggerFactory.getLogger(AdminController.class);

    private final ClientRepository clients;
    private final EngagementRepository engagements;
    private final AppUserRepository users;
    private final LoginEventRepository loginEvents;
    private final Notifications notifications;
    private final InviteService invites;
    private final CompanyRepository companies;

    /** Where the invite link points. Same origin the SPA is served from. */
    private final String appBaseUrl;

    /**
     * Used only to pull DB-generated columns back after an insert. created_at
     * and started_on are filled by Postgres defaults and mapped
     * insertable=false, so the entity Hibernate hands back from save() has
     * nulls in them until the row is re-read. The create methods below are
     * transactional so the entity is still managed when refresh() runs.
     */
    @PersistenceContext
    private EntityManager em;

    public AdminController(ClientRepository clients, EngagementRepository engagements,
            AppUserRepository users, LoginEventRepository loginEvents,
            Notifications notifications, InviteService invites,
            CompanyRepository companies,
            @Value("${APP_BASE_URL:https://ai.datapainters.com}") String appBaseUrl) {
        this.clients = clients;
        this.engagements = engagements;
        this.users = users;
        this.loginEvents = loginEvents;
        this.notifications = notifications;
        this.invites = invites;
        this.companies = companies;
        this.appBaseUrl = appBaseUrl;
    }

    /* ------------------------------------------------------------ clients */

    public record CreateClient(
            @NotBlank String name,
            @NotBlank @Email String primaryEmail) {}

    public record ClientView(Long id, String name, String primaryEmail, Instant createdAt) {

        static ClientView of(Client c) {
            return new ClientView(c.getId(), c.getName(), c.getPrimaryEmail(), c.getCreatedAt());
        }
    }

    /** Whitelist of filterable and sortable columns, shared with the UI. */
    private static Grid.Spec<ClientView> clientSpec() {
        return new Grid.Spec<ClientView>()
                .add("name", "Client", "text", ClientView::name)
                .add("primaryEmail", "Primary email", "text", ClientView::primaryEmail)
                .add("createdAt", "Added", "date", ClientView::createdAt);
    }

    @GetMapping("/clients/columns")
    public List<Grid.Column> clientColumns() {
        return clientSpec().columns();
    }

    @GetMapping("/clients")
    public Grid.Page<ClientView> listClients(
            @RequestParam(name = "filter", required = false) List<String> filter,
            @RequestParam(defaultValue = "name:asc") String sort,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size) {

        List<ClientView> all =
                clients.findAllByOrderByNameAsc().stream().map(ClientView::of).toList();
        return Grid.apply(all, clientSpec().accessors(), Grid.parse(filter), sort, page, size);
    }

    public record UpdateClient(
            @NotBlank String name,
            @NotBlank @Email String primaryEmail) {}

    @PutMapping("/clients/{id}")
    @Transactional
    public ClientView updateClient(
            @PathVariable Long id, @Valid @RequestBody UpdateClient request) {

        Client client = clients.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        String email = request.primaryEmail().trim();
        // Guard the unique index explicitly so a collision reads as a
        // conflict rather than a constraint violation at flush.
        clients.findByPrimaryEmailIgnoringCase(email)
                .filter(other -> !other.getId().equals(id))
                .ifPresent(other -> {
                    throw new ResponseStatusException(HttpStatus.CONFLICT,
                            "Another client already uses that primary email");
                });

        client.setName(request.name().trim());
        client.setPrimaryEmail(email);
        log.info("Updated client {}", id);
        return ClientView.of(clients.save(client));
    }

    @PostMapping("/clients")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ClientView createClient(@Valid @RequestBody CreateClient request) {
        if (clients.existsByPrimaryEmailIgnoreCase(request.primaryEmail().trim())) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "A client already exists with that primary email");
        }

        Client client = new Client();
        client.setName(request.name().trim());
        client.setPrimaryEmail(request.primaryEmail());

        Client saved = clients.save(client);
        em.flush();
        em.refresh(saved);

        log.info("Created client {} ({})", saved.getId(), saved.getName());
        return ClientView.of(saved);
    }

    /* -------------------------------------------------------- engagements */

    public record CreateEngagement(
            @NotNull Long clientId,
            @NotBlank String title) {}

    public record EngagementView(
            Long id, Long clientId, String title, String status, LocalDate startedOn) {

        static EngagementView of(Engagement e) {
            return new EngagementView(e.getId(), e.getClientId(), e.getTitle(),
                    e.getStatus(), e.getStartedOn());
        }
    }

    private Grid.Spec<EngagementView> engagementSpec(Map<Long, String> clientNames) {
        return new Grid.Spec<EngagementView>()
                .add("title", "Engagement", "text", EngagementView::title)
                .add("clientName", "Client", "text",
                        e -> clientNames.getOrDefault(e.clientId(), ""))
                .add("status", "Status", "text", EngagementView::status)
                .add("startedOn", "Started", "date", EngagementView::startedOn);
    }

    @GetMapping("/engagements/columns")
    public List<Grid.Column> engagementColumns() {
        return engagementSpec(Map.of()).columns();
    }

    @GetMapping("/engagements")
    public Grid.Page<EngagementView> listEngagements(
            @RequestParam(name = "filter", required = false) List<String> filter,
            @RequestParam(defaultValue = "startedOn:desc") String sort,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size) {

        Map<Long, String> names = clients.findAll().stream()
                .collect(Collectors.toMap(Client::getId, Client::getName, (a, b) -> a));

        List<EngagementView> all = engagements.findAll().stream()
                .map(EngagementView::of).toList();

        return Grid.apply(all, engagementSpec(names).accessors(),
                Grid.parse(filter), sort, page, size);
    }

    public record UpdateEngagement(
            @NotBlank String title,
            @NotBlank String status) {}

    @PutMapping("/engagements/{id}")
    @Transactional
    public EngagementView updateEngagement(
            @PathVariable Long id, @Valid @RequestBody UpdateEngagement request) {

        if (!List.of("active", "paused", "closed").contains(request.status())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "status must be active, paused or closed");
        }

        Engagement engagement = engagements.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        engagement.setTitle(request.title().trim());
        engagement.setStatus(request.status());
        log.info("Updated engagement {}", id);
        return EngagementView.of(engagements.save(engagement));
    }

    @PostMapping("/engagements")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public EngagementView createEngagement(@Valid @RequestBody CreateEngagement request) {
        requireClient(request.clientId());

        Engagement engagement = new Engagement();
        engagement.setClientId(request.clientId());
        engagement.setTitle(request.title().trim());

        Engagement saved = engagements.save(engagement);
        em.flush();
        em.refresh(saved);

        log.info("Opened engagement {} for client {}", saved.getId(), request.clientId());
        return EngagementView.of(saved);
    }

    /* --------------------------------------------------------------- users */

    public record CreateUser(
            @NotNull Long clientId,
            @NotBlank String firstName,
            @NotBlank String lastName,
            @NotBlank @Email String email,
            /** Employer, stored as its own record. May differ from the client. */
            String companyName,
            String phone) {

        /** displayName is derived, not asked for -- two fields, not three. */
        String displayName() {
            return (firstName.trim() + " " + lastName.trim()).trim();
        }
    }

    public record UserView(Long id, Long clientId, String email, String displayName,
            String firstName, String lastName, String phone, String companyName,
            String role, boolean enabled, Instant lastLoginAt) {

        static UserView of(AppUser u) {
            return of(u, null);
        }

        static UserView of(AppUser u, String companyName) {
            return new UserView(u.getId(), u.getClientId(), u.getEmail(), u.getDisplayName(),
                    u.getFirstName(), u.getLastName(), u.getPhone(), companyName,
                    u.getRole(), u.isEnabled(), u.getLastLoginAt());
        }
    }

    /**
     * The invite link, returned once at creation.
     *
     * <p>The link is still shown to the admin rather than only emailed. Two
     * reasons: SES is in the sandbox, so a real client address is rejected
     * and the admin needs something to hand over; and even in production,
     * mail goes missing and a working fallback beats re-issuing.
     *
     * @param emailed whether the invite actually reached the mail provider
     */
    public record CreatedUser(UserView user, String inviteUrl, Instant inviteExpiresAt,
            boolean emailed) {}

    @GetMapping("/users")
    public List<UserView> listUsers() {
        Map<Long, String> names = companies.findAll().stream()
                .collect(Collectors.toMap(Company::getId, Company::getName, (a, b) -> a));
        return users.findAll().stream()
                .map(u -> UserView.of(u, u.getCompanyId() == null
                        ? null : names.get(u.getCompanyId())))
                .toList();
    }

    @PostMapping("/users")
    @ResponseStatus(HttpStatus.CREATED)
    public CreatedUser createUser(
            @AuthenticationPrincipal Jwt jwt, @Valid @RequestBody CreateUser request) {
        requireClient(request.clientId());

        String email = request.email().trim().toLowerCase();
        if (users.findByEmailIgnoringCase(email).isPresent()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "An account already exists for that email");
        }

        AppUser user = new AppUser();
        user.setEmail(email);
        user.setDisplayName(request.displayName());
        user.setFirstName(request.firstName());
        user.setLastName(request.lastName());
        user.setPhone(request.phone());
        user.setCompanyId(resolveCompany(request.companyName()));
        user.setRole(AppUser.ROLE_CLIENT);
        user.setClientId(request.clientId());
        // No password the firm knows ever exists for this account. The hash
        // is well-formed but matches nothing until the invite is redeemed.
        user.setPasswordHash(invites.unusablePassword());
        user.setMustChangePassword(true);
        user.setEnabled(true);

        AppUser saved = users.save(user);
        // Deliberately not logging the address or anything about the invite.
        log.info("Created client user {} for client {}", saved.getId(), request.clientId());

        return invite(jwt, saved, clients.findById(request.clientId())
                .map(Client::getName).orElse("your team"));
    }

    /** Issues an invite, emails it, and returns the link either way. */
    private CreatedUser invite(Jwt jwt, AppUser user, String clientName) {
        InviteService.Issued issued = invites.issue(user.getId(), CurrentUser.from(jwt).id());
        String url = appBaseUrl + "/invite/" + issued.token();

        boolean emailed = notifications.invitation(
                user.getEmail(), user.getDisplayName(), clientName, url,
                issued.expiresAt());

        return new CreatedUser(UserView.of(user), url, issued.expiresAt(), emailed);
    }

    /**
     * Re-invites someone, superseding any link they already hold.
     *
     * <p>Needed whenever a link expires, goes missing, or was sent while SES
     * could not reach the recipient.
     */
    @PostMapping("/users/{id}/invite")
    public CreatedUser reinvite(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id) {
        AppUser user = users.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        if (!user.isEnabled()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "That account is disabled");
        }

        String clientName = user.getClientId() == null
                ? "your team"
                : clients.findById(user.getClientId()).map(Client::getName).orElse("your team");

        return invite(jwt, user, clientName);
    }

    /* -------------------------------------------------------------- helpers */

    /* ------------------------------------------------- sign-in activity */

    /**
     * One recorded sign-in attempt. {@code emailTried} rather than a resolved
     * name because a failed attempt may match no account at all, which is
     * precisely the case worth seeing.
     */
    public record LoginEventView(Long id, Long userId, String emailTried, String outcome,
            String ipAddress, String userAgent, Instant at) {

        static LoginEventView of(LoginEvent e) {
            return new LoginEventView(e.getId(), e.getUserId(), e.getEmailTried(),
                    e.getOutcome(), e.getIpAddress(), e.getUserAgent(), e.getCreatedAt());
        }
    }

    /** Hard ceiling on a page of audit rows, whatever the caller asks for. */
    private static final int MAX_EVENTS = 500;

    @GetMapping("/login-events")
    public List<LoginEventView> listLoginEvents(
            @RequestParam(defaultValue = "100") int limit) {

        int capped = Math.min(Math.max(limit, 1), MAX_EVENTS);
        return loginEvents.findAllByOrderByCreatedAtDesc(PageRequest.of(0, capped))
                .stream().map(LoginEventView::of).toList();
    }

    /* -------------------------------------------------------------- errors */

    public record AdminError(String error) {}

    /**
     * The client table has a unique constraint on primary_email, and app_user
     * one on lower(email). Either can lose a race with a concurrent create
     * that the pre-check above passed, and both should read as a conflict
     * rather than a 500.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public AdminError handleDuplicate(DataIntegrityViolationException e) {
        log.info("Rejected admin create: constraint violation");
        return new AdminError("That name or email is already in use");
    }

    /**
     * Finds the company by name or creates it.
     *
     * <p>Matched case-insensitively against the same expression as the unique
     * index, so "Acme" typed twice with different capitalisation resolves to
     * one record rather than quietly becoming two.
     */
    private Long resolveCompany(String name) {
        if (name == null || name.isBlank()) {
            return null;
        }
        String trimmed = name.trim();
        return companies.findByNameIgnoringCase(trimmed)
                .map(Company::getId)
                .orElseGet(() -> {
                    Company created = new Company();
                    created.setName(trimmed);
                    Company saved = companies.save(created);
                    log.info("Created company {} ({})", saved.getId(), saved.getName());
                    return saved.getId();
                });
    }

    @GetMapping("/companies")
    public List<String> listCompanies() {
        return companies.findAllByOrderByNameAsc().stream().map(Company::getName).toList();
    }

    private void requireClient(Long clientId) {
        if (!clients.existsById(clientId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such client");
        }
    }
}
