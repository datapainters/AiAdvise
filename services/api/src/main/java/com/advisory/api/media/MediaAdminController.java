package com.advisory.api.media;

import com.advisory.api.auth.CurrentUser;
import com.advisory.api.media.MediaService.Created;
import com.advisory.api.media.MediaService.MediaItem;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Managing the media library. ROLE_ADMIN via the filter chain. */
@RestController
@RequestMapping("/api/admin/media")
public class MediaAdminController {

    private final MediaService media;

    public MediaAdminController(MediaService media) {
        this.media = media;
    }

    public record CreateMedia(String kind, String title, String description, String contentType,
            long sizeBytes) {}

    public record ViewUrl(String url) {}

    @GetMapping
    public List<MediaItem> list() {
        return media.list(false);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Created create(@AuthenticationPrincipal Jwt jwt, @RequestBody CreateMedia r) {
        return media.create(r.kind(), r.title(), r.description(), r.contentType(), r.sizeBytes(),
                CurrentUser.from(jwt).id());
    }

    @PostMapping("/{id}/complete")
    public MediaItem complete(@PathVariable Long id) {
        return media.complete(id);
    }

    @GetMapping("/{id}/url")
    public ViewUrl url(@PathVariable Long id) {
        return new ViewUrl(media.viewUrl(id));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void archive(@PathVariable Long id) {
        media.archive(id);
    }
}
