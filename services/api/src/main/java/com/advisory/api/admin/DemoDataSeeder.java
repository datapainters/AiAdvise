package com.advisory.api.admin;

import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Fills the development site with enough records to page through.
 *
 * <p>Off unless {@code SEED_DEMO_DATA=true}, which only the development
 * environment sets. The script checks for its own rows first, so a restart
 * does nothing; to seed again, delete the clients whose email ends in
 * {@code @demo.datapainters.test} and everything under them.
 *
 * <p>A failure is logged and swallowed: test data is not worth keeping the
 * service down for.
 */
@Component
public class DemoDataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoDataSeeder.class);

    private final JdbcTemplate jdbc;
    private final boolean enabled;

    public DemoDataSeeder(JdbcTemplate jdbc, @Value("${SEED_DEMO_DATA:false}") boolean enabled) {
        this.jdbc = jdbc;
        this.enabled = enabled;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled) {
            return;
        }
        try {
            String script = new ClassPathResource("demo/seed.sql")
                    .getContentAsString(StandardCharsets.UTF_8);
            Integer before = jdbc.queryForObject("SELECT count(*) FROM client", Integer.class);
            jdbc.execute(script);
            Integer after = jdbc.queryForObject("SELECT count(*) FROM client", Integer.class);
            log.info("Demo data: {} clients before, {} after", before, after);
        } catch (Exception e) {
            log.warn("Demo data could not be loaded; the service continues without it", e);
        }
    }
}
