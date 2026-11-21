package com.advisory.api.media;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Serves {@link LocalMediaStore}'s signed URLs. Answers 404 to everything
 * when media is in S3, so it is inert in deployed environments.
 */
@RestController
@RequestMapping("/api/media-local")
public class LocalMediaController {

    private static final long MAX_BYTES = 200L * 1024 * 1024;

    private final MediaStore store;

    public LocalMediaController(MediaStore store) {
        this.store = store;
    }

    private LocalMediaStore local() {
        if (store instanceof LocalMediaStore l) {
            return l;
        }
        throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    private static String key(HttpServletRequest req) {
        return req.getRequestURI().substring("/api/media-local/".length());
    }

    @PutMapping("/**")
    public ResponseEntity<Void> put(HttpServletRequest req, @RequestParam long exp,
            @RequestParam String sig) throws IOException {
        LocalMediaStore l = local();
        String key = key(req);
        if (!l.verify("PUT", key, exp, sig)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        Path p = l.path(key);
        Files.createDirectories(p.getParent());
        byte[] body = req.getInputStream().readNBytes((int) MAX_BYTES + 1);
        if (body.length > MAX_BYTES) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE);
        }
        Files.write(p, body);
        String type = req.getContentType();
        if (type != null) {
            Files.writeString(Path.of(p + ".type"), type);
        }
        return ResponseEntity.ok().build();
    }

    @GetMapping("/**")
    public ResponseEntity<FileSystemResource> get(HttpServletRequest req, @RequestParam long exp,
            @RequestParam String sig) throws IOException {
        LocalMediaStore l = local();
        String key = key(req);
        if (!l.verify("GET", key, exp, sig)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        Path p = l.path(key);
        if (!Files.exists(p)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        Path typeFile = Path.of(p + ".type");
        MediaType type = Files.exists(typeFile)
                ? MediaType.parseMediaType(Files.readString(typeFile))
                : MediaType.APPLICATION_OCTET_STREAM;
        return ResponseEntity.ok().contentType(type).body(new FileSystemResource(p));
    }
}
