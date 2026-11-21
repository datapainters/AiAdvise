package com.advisory.api.billing;

import com.advisory.api.auth.CurrentUser;
import com.advisory.api.billing.CostService.CostDetail;
import com.advisory.api.billing.CostService.CostLine;
import com.advisory.api.billing.CostService.CostReport;
import com.advisory.api.portal.Appointment;
import com.advisory.api.portal.AppointmentRepository;
import com.advisory.api.video.VideoService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.time.LocalDate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** The engagement costs report and the costs entered against engagements. */
@RestController
@RequestMapping("/api/admin")
public class CostController {

    private static final Logger log = LoggerFactory.getLogger(CostController.class);

    private final CostService costs;
    private final VideoService video;
    private final AppointmentRepository appointments;

    public CostController(CostService costs, VideoService video,
            AppointmentRepository appointments) {
        this.costs = costs;
        this.video = video;
        this.appointments = appointments;
    }

    @GetMapping("/reports/engagement-costs")
    public CostReport report(@RequestParam(required = false) LocalDate from,
            @RequestParam(required = false) LocalDate to) {
        return costs.report(from, to);
    }

    @GetMapping("/engagements/{id}/costs")
    public CostDetail detail(@PathVariable Long id) {
        return costs.detail(id);
    }

    public record AddCost(LocalDate incurredOn, @NotNull String category, String description,
            @NotNull String amount) {}

    @PostMapping("/engagements/{id}/costs")
    @ResponseStatus(HttpStatus.CREATED)
    public CostLine add(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id,
            @Valid @RequestBody AddCost r) {
        return costs.addCost(id, r.incurredOn(), r.category(), r.description(),
                BillingController.cents(r.amount(), false), CurrentUser.from(jwt).id());
    }

    @PostMapping("/engagement-costs/{id}/void")
    public void voidCost(@PathVariable Long id) {
        costs.voidCost(id);
    }

    public record SyncResult(boolean enabled, int rooms, int sessions, int failed) {}

    /**
     * Pulls call history from Daily for every meeting room that has been
     * used, so the report reflects calls nobody imported by hand.
     */
    @PostMapping("/reports/engagement-costs/sync")
    public SyncResult sync() {
        if (!video.enabled()) {
            return new SyncResult(false, 0, 0, 0);
        }
        int rooms = 0;
        int sessions = 0;
        int failed = 0;
        Instant now = Instant.now();
        for (Appointment a : appointments.findAll()) {
            if (!a.hasVideo() || a.getStartsAt().isAfter(now)) {
                continue;
            }
            rooms++;
            try {
                sessions += video.syncUsage(a);
            } catch (RuntimeException e) {
                failed++;
                log.warn("Video usage sync failed for appointment {}: {}", a.getId(),
                        e.getMessage());
            }
        }
        return new SyncResult(true, rooms, sessions, failed);
    }
}
