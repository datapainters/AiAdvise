package com.advisory.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueRequest;

/**
 * Builds the production {@link DataSource} from the RDS credentials held in
 * Secrets Manager.
 *
 * <p>The point of doing it here rather than through ECS secret injection is
 * that the password never appears in the task definition, in the image, or in
 * {@code docker inspect} output. The task role grants
 * {@code secretsmanager:GetSecretValue} on exactly one secret ARN and nothing
 * else.
 *
 * <p>Credentials are read once at startup. If you later turn on automatic
 * rotation, this needs to become a refreshing credentials provider or the
 * service will start failing authentication a rotation period after deploy --
 * see docs/next-steps.md.
 */
@Configuration
@Profile("prod")
public class DataSourceConfig {

    private static final Logger log = LoggerFactory.getLogger(DataSourceConfig.class);

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Bean
    public DataSource dataSource() {
        String secretArn = System.getenv("DB_SECRET_ARN");
        if (secretArn == null || secretArn.isBlank()) {
            throw new IllegalStateException(
                    "DB_SECRET_ARN is not set. Terraform passes it as a container "
                            + "environment variable; check the api-service module.");
        }

        JsonNode secret = fetchSecret(secretArn);

        HikariDataSource ds = new HikariDataSource();
        ds.setJdbcUrl(secret.get("jdbc_url").asText());
        ds.setUsername(secret.get("username").asText());
        ds.setPassword(secret.get("password").asText());
        ds.setDriverClassName("org.postgresql.Driver");

        // A db.t4g.small has a connection ceiling in the low hundreds and
        // every Fargate task opens its own pool. Keep pools small so that
        // scaling out to 20 tasks does not exhaust the server.
        ds.setMaximumPoolSize(10);
        ds.setMinimumIdle(2);
        ds.setConnectionTimeout(10_000);
        ds.setValidationTimeout(5_000);
        ds.setMaxLifetime(600_000);
        ds.setPoolName("advisory-pool");

        log.info("Datasource configured from secret {}", redact(secretArn));
        return ds;
    }

    private JsonNode fetchSecret(String secretArn) {
        try (SecretsManagerClient client = SecretsManagerClient.create()) {
            String payload = client.getSecretValue(
                            GetSecretValueRequest.builder().secretId(secretArn).build())
                    .secretString();
            return objectMapper.readTree(payload);
        } catch (Exception e) {
            // Failing fast is correct: a task that cannot reach its database
            // should never pass its readiness probe and take traffic.
            throw new IllegalStateException(
                    "Could not read database credentials from " + redact(secretArn), e);
        }
    }

    private static String redact(String arn) {
        int slash = arn.lastIndexOf(':');
        return slash > 0 ? arn.substring(0, slash) + ":***" : "***";
    }
}
