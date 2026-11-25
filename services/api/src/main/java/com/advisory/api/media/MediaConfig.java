package com.advisory.api.media;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import javax.crypto.SecretKey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class MediaConfig {

    private static final Logger log = LoggerFactory.getLogger(MediaConfig.class);

    /** S3 when MEDIA_BUCKET is set (every deployed environment); disk otherwise. */
    @Bean
    public MediaStore mediaStore(@Value("${MEDIA_BUCKET:}") String bucket,
            @Value("${LOCAL_MEDIA_DIR:${java.io.tmpdir}/advisory-media}") String dir,
            @Value("${LOCAL_MEDIA_BASE_URL:http://localhost:8080}") String baseUrl,
            SecretKey jwtSigningKey) {
        if (!bucket.isBlank()) {
            log.info("Media stored in S3 bucket {}", bucket);
            return new S3MediaStore(bucket);
        }
        log.warn("MEDIA_BUCKET not set: media stored on local disk at {} (development only)", dir);
        byte[] k = ("local-media:" + new String(jwtSigningKey.getEncoded(), StandardCharsets.UTF_8))
                .getBytes(StandardCharsets.UTF_8);
        return new LocalMediaStore(Path.of(dir).toAbsolutePath().normalize(), baseUrl, k);
    }
}
