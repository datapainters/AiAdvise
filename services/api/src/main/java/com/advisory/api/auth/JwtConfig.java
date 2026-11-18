package com.advisory.api.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.nio.charset.StandardCharsets;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueRequest;

/**
 * Supplies the HS256 key used to sign and verify access tokens.
 *
 * <p>In deployed environments the key comes from Secrets Manager, named by
 * {@code JWT_SECRET_ARN}, which Terraform generates and grants the task role
 * read access to. Locally it falls back to a development value, which is
 * fine precisely because a local token is worthless anywhere else.
 */
@Configuration
public class JwtConfig {

    private static final Logger log = LoggerFactory.getLogger(JwtConfig.class);

    @Bean
    public SecretKey jwtSigningKey(
            @Value("${app.jwt.secret:}") String configuredSecret) {

        String arn = System.getenv("JWT_SECRET_ARN");
        String secret;

        if (arn != null && !arn.isBlank()) {
            secret = fetchFromSecretsManager(arn);
            log.info("JWT signing key loaded from Secrets Manager");
        } else if (!configuredSecret.isBlank()) {
            secret = configuredSecret;
            log.warn("JWT signing key came from configuration, not Secrets Manager. "
                    + "Expected locally; a deployed environment should set JWT_SECRET_ARN.");
        } else {
            throw new IllegalStateException(
                    "No JWT signing key. Set JWT_SECRET_ARN, or app.jwt.secret for local runs.");
        }

        byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
        if (bytes.length < 32) {
            // HS256 needs at least 256 bits; a shorter key is rejected at
            // startup rather than producing weak tokens in production.
            throw new IllegalStateException(
                    "JWT signing key is too short: HS256 requires at least 32 bytes.");
        }

        return new SecretKeySpec(bytes, "HmacSHA256");
    }

    private String fetchFromSecretsManager(String arn) {
        try (SecretsManagerClient client = SecretsManagerClient.create()) {
            String payload = client.getSecretValue(
                            GetSecretValueRequest.builder().secretId(arn).build())
                    .secretString();
            return new ObjectMapper().readTree(payload).get("key").asText();
        } catch (Exception e) {
            throw new IllegalStateException("Could not read the JWT signing key", e);
        }
    }

    @Bean
    public JwtEncoder jwtEncoder(SecretKey key) {
        return new NimbusJwtEncoder(new ImmutableSecret<>(key));
    }

    @Bean
    public JwtDecoder jwtDecoder(SecretKey key) {
        return NimbusJwtDecoder.withSecretKey(key)
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
    }
}
