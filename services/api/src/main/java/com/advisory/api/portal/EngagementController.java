package com.advisory.api.portal;

import com.advisory.api.auth.CurrentUser;
import java.time.LocalDate;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The caller's engagements.
 *
 * <p>The portal calls this first to find out what it may show. There is no
 * parameter: the list is derived entirely from the token, so there is nothing
 * for a caller to tamper with.
 */
@RestController
@RequestMapping("/api/engagements")
public class EngagementController {

    private final EngagementRepository engagements;

    public EngagementController(EngagementRepository engagements) {
        this.engagements = engagements;
    }

    public record EngagementView(
            Long id, String title, String status, LocalDate startedOn) {

        static EngagementView of(Engagement e) {
            return new EngagementView(e.getId(), e.getTitle(), e.getStatus(), e.getStartedOn());
        }
    }

    @GetMapping
    public List<EngagementView> mine(@AuthenticationPrincipal Jwt jwt) {
        CurrentUser user = CurrentUser.from(jwt);

        // An admin is not scoped to one client, so they see everything. Once
        // there is an admin console this should paginate.
        List<Engagement> found = user.isAdmin()
                ? engagements.findAll()
                : engagements.findByClientIdOrderByStartedOnDesc(user.requireClientId());

        return found.stream().map(EngagementView::of).toList();
    }
}
