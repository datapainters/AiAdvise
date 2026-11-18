package com.advisory.api.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueRequest;

/**
 * Creates the first admin account so there is a way in to a fresh database.
 *
 * <p>Runs only when the user table is completely empty, so it cannot change
 * or resurrect an account later. Credentials come from the environment and
 * are never written to the image:
 *
 * <pre>
 *   BOOTSTRAP_ADMIN_EMAIL=you@example.com
 *   BOOTSTRAP_ADMIN_PASSWORD=...
 * </pre>
 *
 * <p>Set them once, start the service, sign in, then remove them. There is no
 * self-service registration, by design: accounts here belong to clients the
 * firm has actually engaged.
 */
@Component
public class AdminBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);

    private final AppUserRepository users;
    private final PasswordEncoder passwordEncoder;

    public AdminBootstrap(AppUserRepository users, PasswordEncoder passwordEncoder) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (users.count() > 0) {
            return;
        }

        String email;
        String password;

        String secretArn = System.getenv("BOOTSTRAP_ADMIN_SECRET_ARN");
        if (secretArn != null && !secretArn.isBlank()) {
            // Deployed: Terraform generated the credentials into Secrets
            // Manager, so they never appear in the task definition.
            try (SecretsManagerClient client = SecretsManagerClient.create()) {
                String payload = client.getSecretValue(
                                GetSecretValueRequest.builder().secretId(secretArn).build())
                        .secretString();
                JsonNode json = new ObjectMapper().readTree(payload);
                email = json.get("email").asText();
                password = json.get("password").asText();
            } catch (Exception e) {
                log.error("Could not read the bootstrap admin secret; no admin created.", e);
                return;
            }
        } else {
            // Local development.
            email = System.getenv("BOOTSTRAP_ADMIN_EMAIL");
            password = System.getenv("BOOTSTRAP_ADMIN_PASSWORD");
        }

        if (email == null || email.isBlank() || password == null || password.isBlank()) {
            log.warn("No users exist and no bootstrap admin is configured, so nobody "
                    + "can sign in. Set bootstrap_admin_email in Terraform, or "
                    + "BOOTSTRAP_ADMIN_EMAIL/PASSWORD locally, and restart.");
            return;
        }

        if (password.length() < 12) {
            // Refuse rather than quietly create a weak administrator.
            log.error("BOOTSTRAP_ADMIN_PASSWORD is shorter than 12 characters; "
                    + "refusing to create the admin account.");
            return;
        }

        AppUser admin = new AppUser();
        admin.setEmail(email);
        admin.setDisplayName("Administrator");
        admin.setRole(AppUser.ROLE_ADMIN);
        admin.setClientId(null);
        admin.setPasswordHash(passwordEncoder.encode(password));
        admin.setEnabled(true);

        users.save(admin);
        log.info("Created the initial admin account. Remove the bootstrap "
                + "environment variables now that it exists.");
    }
}
