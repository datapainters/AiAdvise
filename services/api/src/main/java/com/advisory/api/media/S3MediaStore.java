package com.advisory.api.media;

import java.time.Duration;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

/** A private S3 bucket reached only through presigned URLs. */
public class S3MediaStore implements MediaStore {

    private final String bucket;
    private final S3Client s3 = S3Client.create();
    private final S3Presigner presigner = S3Presigner.create();

    public S3MediaStore(String bucket) {
        this.bucket = bucket;
    }

    @Override
    public Upload presignPut(String key, String contentType, Duration ttl) {
        PutObjectRequest put = PutObjectRequest.builder()
                .bucket(bucket).key(key).contentType(contentType).build();
        String url = presigner.presignPutObject(PutObjectPresignRequest.builder()
                .signatureDuration(ttl).putObjectRequest(put).build()).url().toString();
        return new Upload(url, contentType);
    }

    @Override
    public String presignGet(String key, Duration ttl) {
        GetObjectRequest get = GetObjectRequest.builder().bucket(bucket).key(key).build();
        return presigner.presignGetObject(GetObjectPresignRequest.builder()
                .signatureDuration(ttl).getObjectRequest(get).build()).url().toString();
    }

    @Override
    public long size(String key) {
        try {
            return s3.headObject(HeadObjectRequest.builder().bucket(bucket).key(key).build())
                    .contentLength();
        } catch (NoSuchKeyException e) {
            return -1;
        } catch (S3Exception e) {
            if (e.statusCode() == 404) {
                return -1;
            }
            throw e;
        }
    }

    @Override
    public void delete(String key) {
        s3.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
    }
}
