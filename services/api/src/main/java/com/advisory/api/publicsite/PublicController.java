package com.advisory.api.publicsite;

import com.advisory.api.billing.OptionsService;
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

    public PublicController(OptionsService options, InquiryService inquiries) {
        this.options = options;
        this.inquiries = inquiries;
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
