package com.advisory.api.publicsite;

import com.advisory.api.auth.AppUserRepository;
import com.advisory.api.auth.InviteService;
import com.advisory.api.billing.OptionsService;
import com.advisory.api.mail.Notifications;
import com.advisory.api.publicsite.InquiryService.Busy;
import com.advisory.api.publicsite.InquiryService.Confirmation;
import com.advisory.api.publicsite.InquiryService.ConsultationRequest;
import jakarta.servlet.http.HttpServletRequest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Unauthenticated endpoints the marketing site calls. Each returns only what
 * the page needs: the published rate, busy intervals without whose they are,
 * and a booking endpoint that is rate limited per address.
 */
@RestController
@RequestMapping("/api/public")
public class PublicController {

    /** Bookings per address per hour. Generous for a person, useless for a bot. */
    private static final int MAX_PER_HOUR = 5;

    private final OptionsService options;
    private final InquiryService inquiries;
    private final Map<String, Deque<Instant>> attempts = new ConcurrentHashMap<>();
    private final AppUserRepository users;
    private final InviteService invites;
    private final Notifications notifications;
    private final String appBaseUrl;

    private static final Logger log = LoggerFactory.getLogger(PublicController.class);

    public PublicController(OptionsService options, InquiryService inquiries,
            AppUserRepository users, InviteService invites, Notifications notifications,
            @Value("${APP_BASE_URL:https://ai.datapainters.com}") String appBaseUrl) {
        this.options = options;
        this.inquiries = inquiries;
        this.users = users;
        this.invites = invites;
        this.notifications = notifications;
        this.appBaseUrl = appBaseUrl;
    }

    public record Info(String hourlyRate, String currency, int blockMinutes,
            int consultationMinutes, JsonNode businessHours) {}

    @GetMapping("/info")
    public Info info() {
        String rate = BigDecimal.valueOf(options.hourlyRateCents()).movePointLeft(2)
                .setScale(2).toPlainString();
        JsonNode hours;
        try {
            hours = new ObjectMapper().readTree(options.businessHours().toJson());
        } catch (Exception e) {
            hours = null;
        }
        return new Info(rate, "USD", 30, InquiryService.CONSULTATION_MINUTES, hours);
    }

    public record Availability(List<Busy> taken) {}

    @GetMapping("/availability")
    public Availability availability(@RequestParam Instant from, @RequestParam Instant to) {
        return new Availability(inquiries.busy(from, to));
    }

    @PostMapping("/consultations")
    @ResponseStatus(HttpStatus.CREATED)
    public Confirmation book(@RequestBody ConsultationRequest request,
            HttpServletRequest http) {
        throttle(clientAddress(http));
        return inquiries.book(request);
    }

    public record ResetRequest(String email) {}

    /**
     * Emails a password reset link, if the address belongs to an account.
     *
     * <p>The answer is the same either way, so this cannot be used to find
     * out who has an account. Nothing about the account changes until the
     * link is followed: the current password keeps working, so asking on
     * someone else's behalf cannot lock them out.
     */
    @PostMapping("/password-reset")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void passwordReset(@RequestBody ResetRequest request, HttpServletRequest http) {
        throttle(clientAddress(http));
        String email = request.email() == null ? "" : request.email().trim();
        if (email.isEmpty() || email.length() > 320) {
            return;
        }
        users.findByEmailIgnoringCase(email)
                .filter(u -> u.isEnabled())
                .ifPresent(u -> {
                    try {
                        InviteService.Issued issued = invites.issue(u.getId(), null);
                        notifications.passwordReset(u.getEmail(), u.getDisplayName(),
                                appBaseUrl + "/invite/" + issued.token(), issued.expiresAt());
                        log.info("Password reset link issued for user {}", u.getId());
                    } catch (RuntimeException e) {
                        // Swallowed on purpose: an error here would tell the
                        // caller the address exists.
                        log.warn("Could not issue a password reset for user {}", u.getId(), e);
                    }
                });
    }

    /**
     * Sliding one-hour window per address, in memory. Per task rather than
     * shared, which is fine at this scale: the point is to stop a script, and
     * a script that finds two tasks still gets ten an hour.
     */
    private void throttle(String address) {
        Instant cutoff = Instant.now().minusSeconds(3600);
        Deque<Instant> q = attempts.computeIfAbsent(address, k -> new ArrayDeque<>());
        synchronized (q) {
            while (!q.isEmpty() && q.peekFirst().isBefore(cutoff)) {
                q.pollFirst();
            }
            if (q.size() >= MAX_PER_HOUR) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "Too many requests from your network. Try again later or email us.");
            }
            q.addLast(Instant.now());
        }
        if (attempts.size() > 10_000) {
            attempts.clear();
        }
    }

    /**
     * The load balancer appends the address it saw to X-Forwarded-For, so the
     * last entry is the one a caller cannot forge; earlier entries are
     * whatever the caller sent.
     */
    private static String clientAddress(HttpServletRequest http) {
        String xff = http.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            String[] hops = xff.split(",");
            return hops[hops.length - 1].trim();
        }
        return http.getRemoteAddr();
    }
}
