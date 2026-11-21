package com.advisory.api.billing;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * System-wide settings, one row per option in {@code system_option}.
 *
 * <p>Rows are seeded by migration; the console can change values but not add
 * or remove options, because code reads them by key. Every value is validated
 * against its declared type on the way in, so a reader can parse without
 * defending against garbage.
 */
@Service
public class OptionsService {

    private static final Logger log = LoggerFactory.getLogger(OptionsService.class);

    public static final String HOURLY_RATE = "hourly_rate";
    public static final String PAYMENT_TERMS_DAYS = "payment_terms_days";
    public static final String INVOICE_PREFIX = "invoice_prefix";
    public static final String INVOICE_NOTES = "invoice_notes";
    public static final String INQUIRY_EMAIL = "inquiry_email";

    private static final Pattern MONEY = Pattern.compile("^\\d{1,7}(\\.\\d{1,2})?$");
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    public record Option(String key, String value, String type, String label,
            String description, Instant updatedAt, String updatedBy) {}

    private final JdbcClient jdbc;

    public OptionsService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<Option> all() {
        return jdbc.sql("""
                SELECT o.key, o.value, o.value_type, o.label, o.description, o.updated_at,
                       u.display_name AS updated_by
                FROM system_option o
                LEFT JOIN app_user u ON u.id = o.updated_by
                ORDER BY o.sort_order, o.key
                """)
                .query((rs, i) -> new Option(rs.getString("key"), rs.getString("value"),
                        rs.getString("value_type"), rs.getString("label"),
                        rs.getString("description"),
                        rs.getTimestamp("updated_at").toInstant(),
                        rs.getString("updated_by")))
                .list();
    }

    public Optional<String> get(String key) {
        return jdbc.sql("SELECT value FROM system_option WHERE key = ?")
                .param(key).query(String.class).optional();
    }

    public Option update(String key, String rawValue, Long userId) {
        String type = jdbc.sql("SELECT value_type FROM system_option WHERE key = ?")
                .param(key).query(String.class).optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "No such option"));

        String value = normalise(type, rawValue == null ? "" : rawValue.trim());

        jdbc.sql("""
                UPDATE system_option SET value = ?, updated_at = now(), updated_by = ?
                WHERE key = ?
                """).params(value, userId, key).update();
        log.info("System option {} changed by user {}", key, userId);

        return all().stream().filter(o -> o.key().equals(key)).findFirst().orElseThrow();
    }

    private static String normalise(String type, String v) {
        switch (type) {
            case "money" -> {
                String s = v.replace("$", "").replace(",", "");
                if (!MONEY.matcher(s).matches()) {
                    throw bad("Enter an amount like 250 or 250.00");
                }
                return new BigDecimal(s).setScale(2, RoundingMode.UNNECESSARY).toPlainString();
            }
            case "integer" -> {
                try {
                    int n = Integer.parseInt(v);
                    if (n < 0 || n > 365) {
                        throw bad("Enter a whole number from 0 to 365");
                    }
                    return Integer.toString(n);
                } catch (NumberFormatException e) {
                    throw bad("Enter a whole number");
                }
            }
            case "email" -> {
                if (!v.isEmpty() && !EMAIL.matcher(v).matches()) {
                    throw bad("Enter a valid email address, or leave it blank");
                }
                return v;
            }
            case "text" -> {
                if (v.length() > 40) {
                    throw bad("Keep this under 40 characters");
                }
                return v;
            }
            default -> {
                if (v.length() > 2000) {
                    throw bad("Keep this under 2,000 characters");
                }
                return v;
            }
        }
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    /* ------------------------------------------------------- typed readers */

    /** The hourly rate in cents. Zero when unset. */
    public long hourlyRateCents() {
        return get(HOURLY_RATE)
                .map(v -> new BigDecimal(v).movePointRight(2).longValueExact())
                .orElse(0L);
    }

    public int paymentTermsDays() {
        return get(PAYMENT_TERMS_DAYS).map(Integer::parseInt).orElse(30);
    }

    public String invoicePrefix() {
        return get(INVOICE_PREFIX).orElse("INV-");
    }

    public String invoiceNotes() {
        return get(INVOICE_NOTES).orElse("");
    }

    public String inquiryEmail() {
        return get(INQUIRY_EMAIL).orElse("");
    }
}
