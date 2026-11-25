package com.advisory.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueRequest;

/**
 * A username and password read from the RDS-managed master user secret.
 *
 * <p>That secret contains credentials and nothing else -- no host, no port,
 * no database name, no connection string. Those arrive as plain environment
 * variables. The split is the point: when RDS rotates the password, the only
 * thing that changes is the thing that is supposed to change.
 */
public record DbCredentials(String username, String password) {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * Reads the current value of the secret.
     *
     * <p>A short-lived client per call rather than a shared one. This runs
     * once a minute at most, so the cost is irrelevant, and it keeps the
     * refresher from holding an SDK client open for the life of the process
     * just to make one call a minute.
     *
     * @throws IllegalStateException if the secret cannot be read or does not
     *     look like an RDS-managed credential pair. Callers decide whether
     *     that is fatal: it is at startup, and it is not during a refresh.
     */
    public static DbCredentials fetch(String secretArn) {
        try (SecretsManagerClient client = SecretsManagerClient.create()) {
            String payload = client.getSecretValue(
                            GetSecretValueRequest.builder().secretId(secretArn).build())
                    .secretString();

            JsonNode json = MAPPER.readTree(payload);
            JsonNode username = json.get("username");
            JsonNode password = json.get("password");

            if (username == null || password == null) {
                throw new IllegalStateException(
                        "Secret " + redact(secretArn) + " has no username/password pair. "
                                + "Expected the RDS-managed master user secret.");
            }

            return new DbCredentials(username.asText(), password.asText());
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException(
                    "Could not read database credentials from " + redact(secretArn), e);
        }
    }

    /** Enough of an ARN to identify it in a log line, without the suffix. */
    public static String redact(String arn) {
        int colon = arn.lastIndexOf(':');
        return colon > 0 ? arn.substring(0, colon) + ":***" : "***";
    }

    /** Never let a password reach a log line or a stack trace. */
    @Override
    public String toString() {
        return "DbCredentials[username=" + username + ", password=***]";
    }
}
