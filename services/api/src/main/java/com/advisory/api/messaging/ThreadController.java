package com.advisory.api.messaging;

import com.advisory.api.auth.CurrentUser;
import com.advisory.api.messaging.ThreadService.Summary;
import com.advisory.api.messaging.ThreadService.Thread;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Topic threads, for both sides of the table.
 *
 * <p>One set of endpoints rather than a client copy and an admin copy: the
 * conversation is the same object whoever reads it, and {@link ThreadService}
 * decides per caller what they may see and which fields they may set.
 */
@RestController
@RequestMapping("/api/threads")
public class ThreadController {

    private final ThreadService threads;

    public ThreadController(ThreadService threads) {
        this.threads = threads;
    }

    /** notifyTeam: false posts without emailing the topic's team. Staff only; absent means true. */
    public record PostMessage(String body, Integer minutes, List<Long> mediaItemIds,
            List<ThreadService.Upload> uploads, Boolean notifyTeam) {}

    public record UploadRequest(String fileName, String contentType, long sizeBytes) {}

    @PostMapping("/{topicId}/uploads")
    public ThreadService.UploadSlot startUpload(@AuthenticationPrincipal Jwt jwt,
            @PathVariable Long topicId, @RequestBody UploadRequest r) {
        return threads.startUpload(threads.reader(CurrentUser.from(jwt).id()), topicId,
                r.contentType(), r.sizeBytes());
    }

    @GetMapping
    public List<Summary> list(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) Long engagementId,
            @RequestParam(required = false) Long clientId,
            @RequestParam(defaultValue = "false") boolean all) {
        return threads.list(threads.reader(CurrentUser.from(jwt).id()), engagementId, clientId,
                all);
    }

    @GetMapping("/{topicId}")
    public Thread thread(@AuthenticationPrincipal Jwt jwt, @PathVariable Long topicId) {
        return threads.thread(threads.reader(CurrentUser.from(jwt).id()), topicId);
    }

    @PostMapping("/{topicId}/messages")
    public Thread post(@AuthenticationPrincipal Jwt jwt, @PathVariable Long topicId,
            @RequestBody PostMessage r) {
        return threads.post(threads.reader(CurrentUser.from(jwt).id()), topicId, r.body(),
                r.minutes(), r.mediaItemIds(), r.uploads(), !Boolean.FALSE.equals(r.notifyTeam()));
    }
}
