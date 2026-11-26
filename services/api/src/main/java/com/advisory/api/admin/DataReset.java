package com.advisory.api.admin;

import java.nio.charset.StandardCharsets;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Empties an environment's data once, on request.
 *
 * <p>Off unless {@code DATA_RESET_TOKEN} is set for the environment. Each
 * token runs at most once per database: it is written to
 * {@code maintenance_run} in the same transaction as the deletes, so a
 * restart, a second task or a redeploy with the same token does nothing. To
 * reset again, someone has to change the token on purpose.
 *
 * <p>Everything goes except the staff account named by
 * {@code DATA_RESET_KEEP_EMAIL}. If that account does not exist, is not
 * staff or is disabled, nothing is deleted: a reset that locks everyone out
 * is worse than one that does not happen.
 *
 * <p>Files in the media bucket and rooms at the video provider are not
 * touched; only database rows.
 */
@Component
public class DataReset implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DataReset.class);

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final String token;
    private final String keepEmail;

    public DataReset(JdbcTemplate jdbc, TransactionTemplate tx,
            @Value("${DATA_RESET_TOKEN:}") String token,
            @Value("${DATA_RESET_KEEP_EMAIL:}") String keepEmail) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.token = token.trim();
        this.keepEmail = keepEmail.trim();
    }

    @Override
    public void run(ApplicationArguments args) {
        if (token.isEmpty()) {
            return;
        }
        try {
            tx.executeWithoutResult(status -> reset());
        } catch (Exception e) {
            // Rolled back as a whole. The service still starts: an operator
            // can read this and decide, with the data intact.
            log.error("Data reset '{}' failed and was rolled back; nothing was deleted", token, e);
        }
    }

    private void reset() {
        // Claim the token first. Two tasks starting together both try this
        // insert; the loser waits on the row, then sees it and stops.
        int claimed = jdbc.update(
                "INSERT INTO maintenance_run (token) VALUES (?) ON CONFLICT DO NOTHING", token);
        if (claimed == 0) {
            return;
        }

        List<Long> keep = jdbc.queryForList("""
                SELECT id FROM app_user
                WHERE lower(email) = lower(?) AND role = 'ADMIN' AND enabled
                """, Long.class, keepEmail);
        if (keep.size() != 1) {
            throw new IllegalStateException(
                    "The account to keep was not found as an enabled staff account; reset abandoned");
        }

        Integer clients = jdbc.queryForObject("SELECT count(*) FROM client", Integer.class);
        Integer users = jdbc.queryForObject("SELECT count(*) FROM app_user", Integer.class);

        String script;
        try {
            script = new ClassPathResource("maintenance/reset.sql")
                    .getContentAsString(StandardCharsets.UTF_8);
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
        // The id is a number read from the database a moment ago, not input.
        jdbc.execute(script.replace(":keep", String.valueOf(keep.get(0))));

        String detail = "Removed %d clients and %d of %d accounts; kept account %d"
                .formatted(clients, users - 1, users, keep.get(0));
        jdbc.update("UPDATE maintenance_run SET detail = ? WHERE token = ?", detail, token);
        log.warn("Data reset '{}' complete. {}", token, detail);
    }
}
