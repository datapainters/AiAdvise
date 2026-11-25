package com.advisory.api;

import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;
import org.postgresql.ds.PGSimpleDataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

/**
 * Builds the production {@link DataSource} from the RDS-managed master user
 * credentials in Secrets Manager.
 *
 * <p>The password never appears in the task definition, in the image, or in
 * {@code docker inspect} output. The task role grants
 * {@code secretsmanager:GetSecretValue} on exactly one secret ARN.
 *
 * <p><strong>Why this pool is built around a PGSimpleDataSource rather than a
 * JDBC URL.</strong> RDS rotates the master password every seven days, so the
 * pool has to be able to pick up a new password without a restart. HikariCP
 * supports that through {@code HikariConfigMXBean.setPassword}, but its
 * contract is narrow: the change applies to new connections only, and it
 * <em>only works for DataSource-based pools, not for Driver-class or JDBC
 * URL-based ones</em>. This pool used to be configured with
 * {@code setJdbcUrl}, which is exactly the case where a runtime password
 * change is silently ignored -- it would have looked correct, logged
 * cheerfully, and then failed a week later when the old password stopped
 * working. Hence the explicit PGSimpleDataSource.
 *
 * <p>{@link DbCredentialRefresher} does the actual rotation follow-up.
 */
@Configuration
@Profile("prod")
public class DataSourceConfig {

    private static final Logger log = LoggerFactory.getLogger(DataSourceConfig.class);

    /**
     * Deliberately not a bean. PGSimpleDataSource implements
     * {@link DataSource}, so publishing it would leave the context with two
     * DataSource candidates and JPA auto-configuration would refuse to pick
     * one. {@link DbCredentialRefresher} reaches it through
     * {@code HikariDataSource.getDataSource()} instead, which hands back this
     * very instance.
     */
    private static PGSimpleDataSource driverDataSource() {
        PGSimpleDataSource pg = new PGSimpleDataSource();
        pg.setServerNames(new String[] {required("DB_HOST")});
        pg.setPortNumbers(new int[] {Integer.parseInt(requiredOr("DB_PORT", "5432"))});
        pg.setDatabaseName(required("DB_NAME"));

        // RDS always offers TLS. `require` encrypts without verifying the
        // server certificate; the Postgres driver's default (`prefer`) would
        // silently fall back to plaintext if the handshake failed. Moving to
        // verify-full means shipping the RDS CA bundle in the image -- worth
        // doing, not worth bundling into the rotation change.
        pg.setSslMode("require");

        pg.setApplicationName("advisory-api");
        return pg;
    }

    @Bean
    public DataSource dataSource() {
        String secretArn = required("DB_SECRET_ARN");
        DbCredentials creds = DbCredentials.fetch(secretArn);

        HikariDataSource ds = new HikariDataSource();
        ds.setDataSource(driverDataSource());
        ds.setUsername(creds.username());
        ds.setPassword(creds.password());

        // A db.t4g.small has a connection ceiling in the low hundreds and
        // every Fargate task opens its own pool. Keep pools small so that
        // scaling out to 20 tasks does not exhaust the server.
        ds.setMaximumPoolSize(10);
        ds.setMinimumIdle(2);
        ds.setConnectionTimeout(10_000);
        ds.setValidationTimeout(5_000);

        // Also the rotation backstop. Even if the refresher never fired, no
        // physical connection outlives this, so the pool fully turns over
        // well inside a seven-day rotation period.
        ds.setMaxLifetime(600_000);

        ds.setPoolName("advisory-pool");

        log.info("Datasource configured from secret {} as user {}",
                DbCredentials.redact(secretArn), creds.username());
        return ds;
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(
                    name + " is not set. Terraform passes it as a container environment "
                            + "variable; check the api-service module and envs/prod/main.tf.");
        }
        return value;
    }

    private static String requiredOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
