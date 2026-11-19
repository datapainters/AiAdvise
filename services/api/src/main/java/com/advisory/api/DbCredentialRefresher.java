package com.advisory.api;

import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.util.concurrent.atomic.AtomicReference;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Keeps the pool's password in step with the RDS-managed secret.
 *
 * <p>RDS rotates the master password on a schedule -- seven days by default.
 * Without this, the service would keep presenting the password it read at
 * startup and begin failing authentication one rotation period after deploy:
 * a failure that looks exactly like a database outage and is not one. The
 * pool's existing connections would carry on working, because Postgres does
 * not invalidate live sessions when a role's password changes, so the first
 * symptom would be intermittent and would arrive whenever the pool next
 * needed to grow.
 *
 * <p><strong>Probe before apply.</strong> The obvious implementation -- read
 * the secret, call setPassword, evict connections -- has a bad failure mode.
 * If the secret is read midway through a rotation, or has been written with a
 * password RDS has not applied yet, evicting would throw away working
 * connections and replace them with ones that cannot authenticate. So a new
 * password is opened as a real connection first, and only applied if that
 * succeeds. A failed probe leaves the pool exactly as it was and tries again
 * on the next tick.
 *
 * <p>This is also why {@code softEvictConnections} is safe to call here: by
 * that point the credential is known to work.
 */
@Component
@Profile("prod")
public class DbCredentialRefresher implements HealthIndicator {

    private static final Logger log = LoggerFactory.getLogger(DbCredentialRefresher.class);

    private final HikariDataSource pool;

    /**
     * The driver DataSource underneath the pool, used only to open a probe
     * connection with a candidate credential. Taken from the pool rather than
     * injected, because publishing it as a bean would give the context two
     * DataSource candidates and break JPA auto-configuration.
     */
    private final DataSource probeTarget;

    private final String secretArn;

    /** The password currently applied to the pool, to spot an actual change. */
    private final AtomicReference<String> applied = new AtomicReference<>();

    private final AtomicReference<String> lastOutcome =
            new AtomicReference<>("no refresh attempted yet");
    private volatile long consecutiveFailures = 0;

    public DbCredentialRefresher(DataSource dataSource) {
        this.pool = (HikariDataSource) dataSource;
        this.probeTarget = pool.getDataSource();
        this.secretArn = System.getenv("DB_SECRET_ARN");
        this.applied.set(pool.getPassword());

        if (this.probeTarget == null) {
            throw new IllegalStateException(
                    "The pool was not built around a driver DataSource. Runtime password "
                            + "changes do not apply to URL-based pools, so rotation would "
                            + "silently stop working -- see DataSourceConfig.");
        }
    }

    /**
     * Runs a minute after startup and every minute after that.
     *
     * <p>A minute is the exposure window: if RDS changes the password at the
     * worst possible moment, new physical connections can fail for up to that
     * long. Existing ones are unaffected. Polling harder would shrink the
     * window and spend more Secrets Manager calls to do it; a minute against
     * a seven-day rotation is a reasonable trade.
     */
    @Scheduled(initialDelayString = "${app.db.credential-refresh-ms:60000}",
            fixedDelayString = "${app.db.credential-refresh-ms:60000}")
    public void refresh() {
        try {
            DbCredentials creds = DbCredentials.fetch(secretArn);

            if (creds.password().equals(applied.get())
                    && creds.username().equals(pool.getUsername())) {
                consecutiveFailures = 0;
                lastOutcome.set("credential unchanged");
                return;
            }

            log.info("Database credential in {} has changed; verifying before applying",
                    DbCredentials.redact(secretArn));

            if (!probe(creds)) {
                // Expected during a rotation: the secret can hold the new
                // password slightly before or after RDS applies it. Not an
                // error unless it keeps happening.
                consecutiveFailures++;
                lastOutcome.set("new credential did not authenticate; kept the current one");
                log.warn("New credential did not authenticate (attempt {}). Keeping the "
                        + "current one and retrying on the next tick.", consecutiveFailures);
                return;
            }

            pool.getHikariConfigMXBean().setUsername(creds.username());
            pool.getHikariConfigMXBean().setPassword(creds.password());
            applied.set(creds.password());

            // Retire connections holding the old credential. Idle ones close
            // now; in-use ones close on return. Nothing is interrupted.
            //
            // Null until the pool has started, which it has by now -- Flyway
            // connects during startup, long before the first refresh -- but
            // the pool is created lazily, so this is not guaranteed by
            // construction.
            var poolBean = pool.getHikariPoolMXBean();
            if (poolBean != null) {
                poolBean.softEvictConnections();
            }

            consecutiveFailures = 0;
            lastOutcome.set("credential rotated successfully");
            log.info("Applied rotated database credential for user {} and evicted the "
                    + "connections holding the previous one", creds.username());

        } catch (RuntimeException e) {
            consecutiveFailures++;
            lastOutcome.set("refresh failed: " + e.getClass().getSimpleName());
            log.error("Database credential refresh failed (attempt {})", consecutiveFailures, e);
        }
    }

    /** Opens one real connection with the candidate credential, then closes it. */
    private boolean probe(DbCredentials creds) {
        try (Connection c = probeTarget.getConnection(creds.username(), creds.password())) {
            return c.isValid(5);
        } catch (Exception e) {
            log.debug("Credential probe failed", e);
            return false;
        }
    }

    /**
     * Surfaces the refresher in {@code /actuator/health} so a quietly stuck
     * rotation is visible before the pool needs a new connection and fails.
     *
     * <p>Reported as a detail rather than DOWN: while the current credential
     * still works the service is healthy, and taking a task out of service
     * over a failed secret read would turn a recoverable condition into an
     * outage.
     */
    @Override
    public Health health() {
        return Health.up()
                .withDetail("secret", DbCredentials.redact(secretArn))
                .withDetail("lastOutcome", lastOutcome.get())
                .withDetail("consecutiveFailures", consecutiveFailures)
                .build();
    }
}
