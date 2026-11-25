package com.advisory.api.portal;

import com.advisory.api.auth.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.net.URI;
import java.time.Instant;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Topics for an engagement.
 *
 * <p>Authorization rule, applied on every path in and out, in two layers:
 *
 * <ol>
 *   <li>the engagement must belong to the caller's client, and
 *   <li>the topic must have been created by the caller.
 * </ol>
 *
 * <p>The second layer is the one that matters here. A topic is private to
 * its author: two users of the same client, on the same engagement, do not
 * see each other's topics. The first layer alone used to be the whole rule,
 * which meant anyone invited under a client could read and close the
 * client's entire backlog.
 *
 * <p>The engagement id still arrives as a parameter because a client can
 * have several, but it is checked against the token rather than trusted.
 * Admins bypass both layers: the firm's engineers need the full agenda to
 * run a meeting.
 *
 * <p>A request for someone else's engagement or topic returns 404, not 403.
 * A 403 would confirm the row exists, which is itself a disclosure -- and
 * with ids being sequential, a 403 on a guessed id would let a client user
 * count another user's topics without reading them.
 */
@RestController
@RequestMapping("/api/topics")
public class TopicController {

    private final TopicRepository topics;
    private final EngagementRepository engagements;

    public TopicController(TopicRepository topics, EngagementRepository engagements) {
        this.topics = topics;
        this.engagements = engagements;
    }

    public record TopicView(
            Long id,
            Long engagementId,
            String title,
            String detail,
            String desiredOutcome,
            int priority,
            String status,
            Long appointmentId,
            Instant createdAt) {

        public static TopicView of(Topic t) {
            return new TopicView(
                    t.getId(),
                    t.getEngagementId(),
                    t.getTitle(),
                    t.getDetail(),
                    t.getDesiredOutcome(),
                    t.getPriority(),
                    t.getStatus(),
                    t.getAppointmentId(),
                    t.getCreatedAt());
        }
    }

    public record CreateTopic(
            @NotNull Long engagementId,
            @NotBlank String title,
            String detail,
            String desiredOutcome,
            @Min(1) @Max(5) Integer priority) {}

    public record UpdateStatus(@NotBlank String status) {}

    private static final List<String> VALID_STATUSES =
            List.of(Topic.PROPOSED, Topic.SCHEDULED, Topic.DISCUSSED, Topic.DROPPED);

    /** Throws 404 unless the caller may act on this engagement. */
    private void requireAccess(CurrentUser user, Long engagementId) {
        if (user.isAdmin()) {
            if (!engagements.existsById(engagementId)) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND);
            }
            return;
        }

        if (!engagements.existsByIdAndClientId(engagementId, user.requireClientId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
    }

    /**
     * Throws 404 unless the caller created this topic.
     *
     * <p>Separate from {@link #requireAccess} on purpose. Passing the client
     * check only proves the caller is in the right company; a topic written
     * by a colleague is still not theirs to read or close. An unowned legacy
     * row (null creator) belongs to nobody and so fails this for every
     * client user.
     */
    // Package-private rather than private so TopicOwnershipTest can exercise
    // the rule directly. It is the whole of the privacy guarantee; it should
    // not only be reachable through a controller and a database.
    static void requireOwnership(CurrentUser user, Topic topic) {
        if (user.isAdmin()) {
            return;
        }
        if (!user.id().equals(topic.getCreatedByUserId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
    }

    @GetMapping
    public List<TopicView> list(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam Long engagementId,
            @RequestParam(required = false) String status) {

        CurrentUser user = CurrentUser.from(jwt);
        requireAccess(user, engagementId);

        List<Topic> found;
        if (user.isAdmin()) {
            found = (status == null)
                    ? topics.findByEngagementIdOrderByPriorityAscCreatedAtAsc(engagementId)
                    : topics.findByEngagementIdAndStatusOrderByPriorityAsc(engagementId, status);
        } else {
            // Scoped to the caller, not to their client. The filter is in the
            // query rather than applied to the result, so another user's
            // topics are never loaded in the first place.
            found = (status == null)
                    ? topics.findByEngagementIdAndCreatedByUserIdOrderByPriorityAscCreatedAtAsc(
                            engagementId, user.id())
                    : topics.findByEngagementIdAndCreatedByUserIdAndStatusOrderByPriorityAsc(
                            engagementId, user.id(), status);
        }

        return found.stream().map(TopicView::of).toList();
    }

    @PostMapping
    public ResponseEntity<TopicView> create(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateTopic request) {

        CurrentUser user = CurrentUser.from(jwt);
        requireAccess(user, request.engagementId());

        Topic topic = new Topic();
        topic.setEngagementId(request.engagementId());
        // From the token, never the request body: a creator the caller could
        // nominate would be a way to plant a topic in someone else's backlog.
        topic.setCreatedByUserId(user.id());
        topic.setTitle(request.title());
        topic.setDetail(request.detail());
        topic.setDesiredOutcome(request.desiredOutcome());
        if (request.priority() != null) {
            topic.setPriority(request.priority());
        }

        Topic saved = topics.save(topic);
        return ResponseEntity.created(URI.create("/api/topics/" + saved.getId()))
                .body(TopicView.of(saved));
    }

    @PatchMapping("/{id}/status")
    public TopicView updateStatus(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable Long id,
            @Valid @RequestBody UpdateStatus request) {

        if (!VALID_STATUSES.contains(request.status())) {
            // The database has the same CHECK constraint; rejecting here gives
            // a 400 with a useful message instead of a 500 from Postgres.
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "status must be one of " + VALID_STATUSES);
        }

        Topic topic = topics.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        // Check access against the topic's own engagement, so an id guessed
        // from another client's range is rejected like any other miss.
        CurrentUser user = CurrentUser.from(jwt);
        requireAccess(user, topic.getEngagementId());
        requireOwnership(user, topic);

        topic.setStatus(request.status());
        return TopicView.of(topics.save(topic));
    }
}
