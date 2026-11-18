package com.advisory.api.portal;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.net.URI;
import java.time.Instant;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

/**
 * Topic management for the client portal.
 *
 * <p>NO AUTHENTICATION YET. This is scaffolding: every endpoint takes an
 * engagement id from the caller and trusts it, which means any client could
 * read any other client's topics. Before this handles a real engagement, put
 * authentication in front of it and derive the engagement from the
 * authenticated principal rather than the request. docs/next-steps.md has the
 * options.
 */
@RestController
@RequestMapping("/api/topics")
public class TopicController {

    private final TopicRepository topics;

    public TopicController(TopicRepository topics) {
        this.topics = topics;
    }

    public record TopicView(
            Long id,
            Long engagementId,
            String title,
            String detail,
            int priority,
            String status,
            Instant createdAt) {

        static TopicView of(Topic t) {
            return new TopicView(
                    t.getId(),
                    t.getEngagementId(),
                    t.getTitle(),
                    t.getDetail(),
                    t.getPriority(),
                    t.getStatus(),
                    t.getCreatedAt());
        }
    }

    public record CreateTopic(
            @NotNull Long engagementId,
            @NotBlank String title,
            String detail,
            @Min(1) @Max(5) Integer priority) {}

    public record UpdateStatus(@NotBlank String status) {}

    private static final List<String> VALID_STATUSES =
            List.of("proposed", "scheduled", "discussed", "dropped");

    @GetMapping
    public List<TopicView> list(
            @RequestParam Long engagementId, @RequestParam(required = false) String status) {

        List<Topic> found = (status == null)
                ? topics.findByEngagementIdOrderByPriorityAscCreatedAtAsc(engagementId)
                : topics.findByEngagementIdAndStatusOrderByPriorityAsc(engagementId, status);

        return found.stream().map(TopicView::of).toList();
    }

    @PostMapping
    public ResponseEntity<TopicView> create(@Valid @RequestBody CreateTopic request) {
        Topic topic = new Topic();
        topic.setEngagementId(request.engagementId());
        topic.setTitle(request.title());
        topic.setDetail(request.detail());
        if (request.priority() != null) {
            topic.setPriority(request.priority());
        }

        Topic saved = topics.save(topic);
        return ResponseEntity.created(URI.create("/api/topics/" + saved.getId()))
                .body(TopicView.of(saved));
    }

    @PatchMapping("/{id}/status")
    public TopicView updateStatus(
            @PathVariable Long id, @Valid @RequestBody UpdateStatus request) {

        if (!VALID_STATUSES.contains(request.status())) {
            // The database has the same CHECK constraint; rejecting here gives
            // a 400 with a useful message instead of a 500 from Postgres.
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "status must be one of " + VALID_STATUSES);
        }

        Topic topic = topics.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        topic.setStatus(request.status());
        return TopicView.of(topics.save(topic));
    }
}
