package com.advisory.api.media;

import java.time.Duration;

/**
 * Where media bytes live. The API never streams file contents itself in
 * production: it hands out short-lived URLs and the browser talks to
 * storage directly.
 */
public interface MediaStore {

    /** A URL the browser can PUT the file to, with the headers it must send. */
    record Upload(String url, String contentType) {}

    Upload presignPut(String key, String contentType, Duration ttl);

    String presignGet(String key, Duration ttl);

    /** Size in bytes, or -1 if the object does not exist. */
    long size(String key);

    void delete(String key);
}
