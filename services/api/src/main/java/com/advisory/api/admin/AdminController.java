package com.advisory.api.admin;

import com.advisory.api.auth.AppUser;
import com.advisory.api.auth.AppUserRepository;
import com.advisory.api.auth.LoginEvent;
import com.advisory.api.auth.LoginEventRepository;
import com.advisory.api.portal.Client;
import com.advisory.api.portal.ClientRepository;
import com.advisory.api.portal.Engagement;
import com.advisory.api.portal.EngagementRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
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

    private static final SecureRandom RANDOM = new SecureRandom();

    // Unambiguous alphabet: no O/0, l/1/I. These passwords get read aloud
    // or copied by hand, and a character nobody can transcribe is a
    // support call.
    private static final String ALPHABET =
            "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

    private final ClientRepository clients;
    private final EngagementRepository engagements;
    private final AppUserRepository users;
    private final LoginEventRepository loginEvents;
    private final PasswordEncoder passwordEncoder;

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
            PasswordEncoder passwordEncoder) {
        this.clients = clients;
        this.engagements = engagements;
        this.users = users;
        this.loginEvents = loginEvents;
        this.passwordEncoder = passwordEncoder;
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

    @GetMapping("/clients")
    public List<ClientView> listClients() {
        return clients.findAllByOrderByNameAsc().stream().map(ClientView::of).toList();
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

    @GetMapping("/engagements")
    public List<EngagementView> listEngagements() {
        return engagements.findAll().stream().map(EngagementView::of).toList();
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
            @NotBlank @Email String email,
            @NotBlank String displayName) {}

    public record UserView(Long id, Long clientId, String email, String displayName,
            String role, boolean enabled, Instant lastLoginAt) {

        static UserView of(AppUser u) {
            return new UserView(u.getId(), u.getClientId(), u.getEmail(), u.getDisplayName(),
                    u.getRole(), u.isEnabled(), u.getLastLoginAt());
        }
    }

    /**
     * The one-time password is returned exactly once, at creation. It is
     * stored only as a BCrypt hash, so it cannot be retrieved afterwards --
     * if it is lost, issue a new one rather than trying to recover it.
     */
    public record CreatedUser(UserView user, String oneTimePassword) {}

    @GetMapping("/users")
    public List<UserView> listUsers() {
        return users.findAll().stream().map(UserView::of).toList();
    }

    @PostMapping("/users")
    @ResponseStatus(HttpStatus.CREATED)
    public CreatedUser createUser(@Valid @RequestBody CreateUser request) {
        requireClient(request.clientId());

        String email = request.email().trim().toLowerCase();
        if (users.findByEmailIgnoringCase(email).isPresent()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "An account already exists for that email");
        }

        String oneTime = generatePassword();

        AppUser user = new AppUser();
        user.setEmail(email);
        user.setDisplayName(request.displayName().trim());
        user.setRole(AppUser.ROLE_CLIENT);
        user.setClientId(request.clientId());
        user.setPasswordHash(passwordEncoder.encode(oneTime));
        user.setMustChangePassword(true);
        user.setEnabled(true);

        AppUser saved = users.save(user);
        // Deliberately not logging the password or the full address.
        log.info("Created client user {} for client {}", saved.getId(), request.clientId());

        return new CreatedUser(UserView.of(saved), oneTime);
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

    private void requireClient(Long clientId) {
        if (!clients.existsById(clientId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such client");
        }
    }

    private static String generatePassword() {
        StringBuilder sb = new StringBuilder(16);
        for (int i = 0; i < 16; i++) {
            sb.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        }
        return sb.toString();
    }
}
