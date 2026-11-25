package com.advisory.api.billing;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Time tracking, charges, invoices, payments and the reports built on them.
 *
 * <p>Plain SQL rather than JPA entities: almost everything here is an
 * aggregate (balances, aging buckets, totals by month), which reads far more
 * clearly as a query than as a graph of entities summed in Java.
 *
 * <p>The billing rule lives in {@link #compile}: a completed meeting's
 * recorded time, rounded up to whole 30-minute blocks, at half the hourly
 * rate per block. The rate is copied onto the charge, so changing the
 * system option later never rewrites what was already billed.
 */
@Service
public class BillingService {

    private static final Logger log = LoggerFactory.getLogger(BillingService.class);

    public static final int BLOCK_MINUTES = 30;

    private static final List<String> METHODS =
            List.of("ach", "wire", "check", "card", "cash", "other");

    private final JdbcClient jdbc;
    private final OptionsService options;
    private final ZoneId zone;

    public BillingService(JdbcClient jdbc, OptionsService options,
            @Value("${MAIL_DISPLAY_TIMEZONE:America/Chicago}") String zone) {
        this.jdbc = jdbc;
        this.options = options;
        this.zone = ZoneId.of(zone);
    }

    public LocalDate today() {
        return LocalDate.now(zone);
    }

    /* =============================================================== money */

    /** Half the hourly rate per block, rounded half-up to the cent. */
    public static long amountFor(long rateCents, int blocks) {
        return BigDecimal.valueOf(rateCents)
                .multiply(BigDecimal.valueOf(blocks))
                .multiply(BigDecimal.valueOf(BLOCK_MINUTES))
                .divide(BigDecimal.valueOf(60), 0, RoundingMode.HALF_UP)
                .longValueExact();
    }

    public static int blocksFor(int minutes) {
        return minutes <= 0 ? 0 : (minutes + BLOCK_MINUTES - 1) / BLOCK_MINUTES;
    }

    /* ======================================================== time entries */

    public record TimeEntry(Long id, Instant startedAt, Instant endedAt, int minutes,
            boolean running, boolean manual, String note, String userName, String source) {}

    public record TimeSheet(Long appointmentId, List<TimeEntry> entries, int totalMinutes,
            int blocks, long rateCents, long estimatedCents, boolean billable,
            boolean locked, String appointmentStatus, ChargeView charge) {}

    private static final String ENTRY_SELECT = """
            SELECT t.id, t.started_at, t.ended_at, t.minutes AS manual_minutes, t.note, t.source,
                   COALESCE(t.minutes,
                            GREATEST(1, CEIL(EXTRACT(EPOCH FROM
                                (COALESCE(t.ended_at, now()) - t.started_at)) / 60.0)))::int
                       AS minutes,
                   (t.ended_at IS NULL AND t.minutes IS NULL) AS running,
                   u.display_name AS user_name
            FROM time_entry t
            LEFT JOIN app_user u ON u.id = t.user_id
            """;

    private static TimeEntry entry(ResultSet rs, int i) throws SQLException {
        return new TimeEntry(rs.getLong("id"),
                rs.getTimestamp("started_at").toInstant(),
                rs.getTimestamp("ended_at") == null ? null
                        : rs.getTimestamp("ended_at").toInstant(),
                rs.getInt("minutes"),
                rs.getBoolean("running"),
                rs.getObject("manual_minutes") != null,
                rs.getString("note"),
                rs.getString("user_name"),
                rs.getString("source"));
    }

    public TimeSheet timeSheet(Long appointmentId) {
        Map<String, Object> appt = appointment(appointmentId);
        List<TimeEntry> entries = jdbc.sql(ENTRY_SELECT
                        + " WHERE t.appointment_id = ? ORDER BY t.started_at, t.id")
                .param(appointmentId).query(BillingService::entry).list();

        int total = entries.stream().mapToInt(TimeEntry::minutes).sum();
        int blocks = blocksFor(total);
        boolean billable = (Boolean) appt.get("billable");
        long rate = billable ? options.hourlyRateCents() : 0;
        ChargeView charge = liveChargeFor(appointmentId);

        return new TimeSheet(appointmentId, entries, total, blocks, rate,
                amountFor(rate, blocks), billable,
                charge != null && charge.invoiceId() != null,
                (String) appt.get("status"), charge);
    }

    @Transactional
    public TimeSheet startTimer(Long appointmentId, Long userId) {
        Map<String, Object> appt = appointment(appointmentId);
        if ("cancelled".equals(appt.get("status"))) {
            throw conflict("This meeting is cancelled");
        }
        requireUnlocked(appointmentId);
        try {
            jdbc.sql("""
                    INSERT INTO time_entry (appointment_id, started_at, user_id, source)
                    VALUES (?, now(), ?, 'timer')
                    """).params(appointmentId, userId).update();
        } catch (DuplicateKeyException e) {
            throw conflict("A timer is already running for this meeting");
        }
        return timeSheet(appointmentId);
    }

    @Transactional
    public TimeSheet stopTimer(Long appointmentId) {
        appointment(appointmentId);
        stopRunning(appointmentId);
        return timeSheet(appointmentId);
    }

    private void stopRunning(Long appointmentId) {
        jdbc.sql("""
                UPDATE time_entry SET ended_at = now()
                WHERE appointment_id = ? AND ended_at IS NULL AND minutes IS NULL
                """).param(appointmentId).update();
    }

    @Transactional
    public TimeSheet addTime(Long appointmentId, int minutes, String note, Long userId) {
        Map<String, Object> appt = appointment(appointmentId);
        if (minutes < 1 || minutes > 1440) {
            throw bad("Minutes must be between 1 and 1,440");
        }
        requireUnlocked(appointmentId);
        jdbc.sql("""
                INSERT INTO time_entry (appointment_id, started_at, ended_at, minutes, note, user_id,
                                        source)
                VALUES (?, ?, ?, ?, ?, ?, 'manual')
                """)
                .params(appointmentId, appt.get("starts_at"), appt.get("starts_at"), minutes,
                        blank(note), userId)
                .update();
        return timeSheet(appointmentId);
    }

    /**
     * Records the video call's measured length as the meeting's video time
     * entry, replacing any earlier import, so importing twice never counts
     * the call twice. Zero minutes removes the entry.
     */
    @Transactional
    public TimeSheet importVideoTime(Long appointmentId, int minutes, String note, Long userId) {
        Map<String, Object> appt = appointment(appointmentId);
        requireUnlocked(appointmentId);
        jdbc.sql("DELETE FROM time_entry WHERE appointment_id = ? AND source = 'video'")
                .param(appointmentId).update();
        if (minutes > 0) {
            jdbc.sql("""
                    INSERT INTO time_entry (appointment_id, started_at, ended_at, minutes, note,
                                            user_id, source)
                    VALUES (?, ?, ?, ?, ?, ?, 'video')
                    """)
                    .params(appointmentId, appt.get("starts_at"), appt.get("starts_at"),
                            Math.min(minutes, 1440), note, userId)
                    .update();
        }
        return timeSheet(appointmentId);
    }

    /** Whether any time has been recorded against the meeting, by any means. */
    public boolean hasTime(Long appointmentId) {
        return jdbc.sql("SELECT count(*) FROM time_entry WHERE appointment_id = ?")
                .param(appointmentId).query(Long.class).single() > 0;
    }

    @Transactional
    public TimeSheet deleteTime(Long entryId) {
        Long appointmentId = jdbc.sql("SELECT appointment_id FROM time_entry WHERE id = ?")
                .param(entryId).query(Long.class).optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        requireUnlocked(appointmentId);
        jdbc.sql("DELETE FROM time_entry WHERE id = ?").param(entryId).update();
        return timeSheet(appointmentId);
    }

    private void requireUnlocked(Long appointmentId) {
        ChargeView c = liveChargeFor(appointmentId);
        if (c != null && c.invoiceId() != null) {
            throw conflict("This meeting's time is on invoice " + c.invoiceNumber()
                    + ". Void the invoice to change it.");
        }
    }

    /* ============================================================= compile */

    /**
     * Turns a completed meeting's time into its charge.
     *
     * <p>Called on every transition into completed. Running timers stop
     * first. An existing charge is recalculated in place unless it is already
     * on an invoice, in which case it is left alone -- an issued invoice must
     * not change under the client. No recorded time, no charge.
     *
     * @return the live charge afterwards, or null when there is none
     */
    @Transactional
    public ChargeView compile(Long appointmentId, Long userId) {
        stopRunning(appointmentId);

        Map<String, Object> appt = jdbc.sql("""
                SELECT a.id, a.client_id, a.engagement_id, a.starts_at, a.billable,
                       e.title AS engagement_title
                FROM appointment a JOIN engagement e ON e.id = a.engagement_id
                WHERE a.id = ?
                """).param(appointmentId).query().singleRow();

        int minutes = timeSheet(appointmentId).totalMinutes();
        ChargeView existing = liveChargeFor(appointmentId);

        if (existing != null && existing.invoiceId() != null) {
            log.info("Appointment {} completed again; charge {} is invoiced and stays as is",
                    appointmentId, existing.id());
            return existing;
        }

        if (minutes == 0) {
            if (existing != null) {
                voidCharge(existing.id(), "No time recorded when the meeting was completed");
            }
            return null;
        }

        boolean billable = (Boolean) appt.get("billable");
        long rate = billable ? options.hourlyRateCents() : 0;
        int blocks = blocksFor(minutes);
        long amount = amountFor(rate, blocks);
        String title = (String) appt.get("engagement_title");
        String description = (billable ? "Consulting: " + title : title)
                + " (" + blocks + " × 30 min" + (billable ? ")" : ", no charge)");
        LocalDate serviceDate = ((java.sql.Timestamp) appt.get("starts_at")).toInstant()
                .atZone(zone).toLocalDate();

        if (existing != null) {
            jdbc.sql("""
                    UPDATE charge SET description = ?, service_date = ?, minutes = ?,
                           blocks = ?, rate_cents = ?, amount_cents = ?
                    WHERE id = ?
                    """)
                    .params(description, serviceDate, minutes, blocks, rate, amount,
                            existing.id())
                    .update();
        } else {
            jdbc.sql("""
                    INSERT INTO charge (client_id, engagement_id, appointment_id, kind,
                        description, service_date, minutes, blocks, rate_cents, amount_cents,
                        created_by)
                    VALUES (?, ?, ?, 'meeting', ?, ?, ?, ?, ?, ?, ?)
                    """)
                    .params(appt.get("client_id"), appt.get("engagement_id"), appointmentId,
                            description, serviceDate, minutes, blocks, rate, amount, userId)
                    .update();
        }
        log.info("Compiled appointment {}: {} min -> {} blocks, {} cents",
                appointmentId, minutes, blocks, amount);
        return liveChargeFor(appointmentId);
    }

    /* ============================================================= charges */

    public record ChargeView(Long id, Long clientId, String clientName, Long engagementId,
            Long appointmentId, String kind, String description, LocalDate serviceDate,
            Integer minutes, Integer blocks, Long rateCents, long amountCents,
            Long invoiceId, String invoiceNumber, Instant voidedAt, String voidReason) {}

    private static final String CHARGE_SELECT = """
            SELECT c.*, cl.name AS client_name, i.number AS invoice_number
            FROM charge c
            JOIN client cl ON cl.id = c.client_id
            LEFT JOIN invoice i ON i.id = c.invoice_id
            """;

    private static ChargeView charge(ResultSet rs, int i) throws SQLException {
        return new ChargeView(rs.getLong("id"), rs.getLong("client_id"),
                rs.getString("client_name"),
                rs.getObject("engagement_id", Long.class),
                rs.getObject("appointment_id", Long.class),
                rs.getString("kind"), rs.getString("description"),
                rs.getObject("service_date", LocalDate.class),
                rs.getObject("minutes", Integer.class),
                rs.getObject("blocks", Integer.class),
                rs.getObject("rate_cents", Long.class),
                rs.getLong("amount_cents"),
                rs.getObject("invoice_id", Long.class),
                rs.getString("invoice_number"),
                rs.getTimestamp("voided_at") == null ? null
                        : rs.getTimestamp("voided_at").toInstant(),
                rs.getString("void_reason"));
    }

    public ChargeView liveChargeFor(Long appointmentId) {
        return jdbc.sql(CHARGE_SELECT
                        + " WHERE c.appointment_id = ? AND c.voided_at IS NULL")
                .param(appointmentId).query(BillingService::charge).optional().orElse(null);
    }

    @Transactional
    public ChargeView addAdjustment(Long clientId, String description, long amountCents,
            LocalDate serviceDate, Long userId) {
        requireClient(clientId);
        if (description == null || description.isBlank()) {
            throw bad("Describe the adjustment");
        }
        if (amountCents == 0) {
            throw bad("Enter a non-zero amount; use a negative amount for a credit");
        }
        Long id = jdbc.sql("""
                INSERT INTO charge (client_id, kind, description, service_date, amount_cents,
                                    created_by)
                VALUES (?, 'adjustment', ?, ?, ?, ?) RETURNING id
                """)
                .params(clientId, description.trim(),
                        serviceDate == null ? today() : serviceDate, amountCents, userId)
                .query(Long.class).single();
        return jdbc.sql(CHARGE_SELECT + " WHERE c.id = ?").param(id)
                .query(BillingService::charge).single();
    }

    @Transactional
    public void voidCharge(Long chargeId, String reason) {
        ChargeView c = jdbc.sql(CHARGE_SELECT + " WHERE c.id = ?").param(chargeId)
                .query(BillingService::charge).optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (c.voidedAt() != null) {
            return;
        }
        if (c.invoiceId() != null) {
            throw conflict("This charge is on invoice " + c.invoiceNumber()
                    + ". Void the invoice first, or add a credit adjustment.");
        }
        jdbc.sql("UPDATE charge SET voided_at = now(), void_reason = ? WHERE id = ?")
                .params(blank(reason), chargeId).update();
    }

    /* ============================================================ invoices */

    public record InvoiceView(Long id, String number, Long clientId, String clientName,
            LocalDate issuedOn, LocalDate dueOn, long totalCents, long paidCents,
            long balanceCents, String status, int daysOverdue, String notes,
            Instant voidedAt, String voidReason) {}

    private static final String INVOICE_SELECT = """
            SELECT i.*, cl.name AS client_name,
                   COALESCE((SELECT SUM(p.amount_cents) FROM payment p
                             WHERE p.invoice_id = i.id AND p.voided_at IS NULL), 0) AS paid
            FROM invoice i JOIN client cl ON cl.id = i.client_id
            """;

    private InvoiceView invoice(ResultSet rs, int i) throws SQLException {
        long total = rs.getLong("total_cents");
        long paid = rs.getLong("paid");
        long balance = total - paid;
        LocalDate due = rs.getObject("due_on", LocalDate.class);
        boolean voided = rs.getTimestamp("voided_at") != null;
        int overdue = (int) Math.max(0, ChronoUnit.DAYS.between(due, today()));
        String status = voided ? "void"
                : balance <= 0 ? "paid"
                : overdue > 0 ? "overdue"
                : paid > 0 ? "partial" : "open";
        return new InvoiceView(rs.getLong("id"), rs.getString("number"),
                rs.getLong("client_id"), rs.getString("client_name"),
                rs.getObject("issued_on", LocalDate.class), due, total, paid,
                voided ? 0 : balance, status, voided || balance <= 0 ? 0 : overdue,
                rs.getString("notes"),
                voided ? rs.getTimestamp("voided_at").toInstant() : null,
                rs.getString("void_reason"));
    }

    public List<InvoiceView> invoices(Long clientId) {
        return clientId == null
                ? jdbc.sql(INVOICE_SELECT + " ORDER BY i.issued_on DESC, i.id DESC")
                        .query(this::invoice).list()
                : jdbc.sql(INVOICE_SELECT
                                + " WHERE i.client_id = ? ORDER BY i.issued_on DESC, i.id DESC")
                        .param(clientId).query(this::invoice).list();
    }

    public InvoiceView invoiceById(Long id) {
        return jdbc.sql(INVOICE_SELECT + " WHERE i.id = ?").param(id)
                .query(this::invoice).optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    @Transactional
    public InvoiceView createInvoice(Long clientId, List<Long> chargeIds, LocalDate issuedOn,
            String notes, Long userId) {
        requireClient(clientId);
        List<ChargeView> pending = jdbc.sql(CHARGE_SELECT + """
                 WHERE c.client_id = ? AND c.voided_at IS NULL AND c.invoice_id IS NULL
                 ORDER BY c.service_date, c.id
                """).param(clientId).query(BillingService::charge).list();
        if (chargeIds != null && !chargeIds.isEmpty()) {
            pending = pending.stream().filter(c -> chargeIds.contains(c.id())).toList();
        }
        if (pending.isEmpty()) {
            throw bad("There are no unbilled charges to invoice");
        }
        long total = pending.stream().mapToLong(ChargeView::amountCents).sum();
        if (total <= 0) {
            throw bad("These charges total zero or less; nothing to invoice");
        }

        LocalDate issued = issuedOn == null ? today() : issuedOn;
        LocalDate due = issued.plusDays(options.paymentTermsDays());
        long seq = jdbc.sql("SELECT nextval('invoice_number_seq')").query(Long.class).single();
        String number = options.invoicePrefix() + String.format("%04d", seq);

        Long id = jdbc.sql("""
                INSERT INTO invoice (number, client_id, issued_on, due_on, total_cents, notes,
                                     created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
                """)
                .params(number, clientId, issued, due, total, blank(notes), userId)
                .query(Long.class).single();

        jdbc.sql("UPDATE charge SET invoice_id = :inv WHERE id IN (:ids)")
                .param("inv", id)
                .param("ids", pending.stream().map(ChargeView::id).toList())
                .update();

        log.info("Invoice {} issued to client {} for {} cents", number, clientId, total);
        return invoiceById(id);
    }

    @Transactional
    public InvoiceView voidInvoice(Long id, String reason) {
        InvoiceView inv = invoiceById(id);
        if (inv.voidedAt() != null) {
            return inv;
        }
        if (inv.paidCents() > 0) {
            throw conflict("Payments are applied to this invoice. Void them first.");
        }
        jdbc.sql("UPDATE invoice SET voided_at = now(), void_reason = ? WHERE id = ?")
                .params(blank(reason), id).update();
        // The charges go back to unbilled, ready for a corrected invoice.
        jdbc.sql("UPDATE charge SET invoice_id = NULL WHERE invoice_id = ?").param(id).update();
        return invoiceById(id);
    }

    public record InvoiceDetail(InvoiceView invoice, ClientInfo client,
            List<ChargeView> lines, List<PaymentView> payments, String footer) {}

    public record ClientInfo(Long id, String name, String primaryEmail, String contactName,
            String phone) {}

    public InvoiceDetail invoiceDetail(Long id) {
        InvoiceView inv = invoiceById(id);
        List<ChargeView> lines = jdbc.sql(CHARGE_SELECT
                        + " WHERE c.invoice_id = ? ORDER BY c.service_date, c.id")
                .param(id).query(BillingService::charge).list();
        // A void invoice released its charges; show what it was issued with
        // is not possible after release, so the lines list is honest-empty.
        List<PaymentView> pays = jdbc.sql(PAYMENT_SELECT
                        + " WHERE p.invoice_id = ? ORDER BY p.received_on, p.id")
                .param(id).query(BillingService::payment).list();
        return new InvoiceDetail(inv, clientInfo(inv.clientId()), lines, pays,
                options.invoiceNotes());
    }

    /* ============================================================ payments */

    public record PaymentView(Long id, Long clientId, String clientName, Long invoiceId,
            String invoiceNumber, LocalDate receivedOn, long amountCents, String method,
            String reference, String note, Instant voidedAt, String voidReason) {}

    private static final String PAYMENT_SELECT = """
            SELECT p.*, cl.name AS client_name, i.number AS invoice_number
            FROM payment p
            JOIN client cl ON cl.id = p.client_id
            LEFT JOIN invoice i ON i.id = p.invoice_id
            """;

    private static PaymentView payment(ResultSet rs, int i) throws SQLException {
        return new PaymentView(rs.getLong("id"), rs.getLong("client_id"),
                rs.getString("client_name"),
                rs.getObject("invoice_id", Long.class), rs.getString("invoice_number"),
                rs.getObject("received_on", LocalDate.class), rs.getLong("amount_cents"),
                rs.getString("method"), rs.getString("reference"), rs.getString("note"),
                rs.getTimestamp("voided_at") == null ? null
                        : rs.getTimestamp("voided_at").toInstant(),
                rs.getString("void_reason"));
    }

    public List<PaymentView> payments(Long clientId) {
        return clientId == null
                ? jdbc.sql(PAYMENT_SELECT + " ORDER BY p.received_on DESC, p.id DESC")
                        .query(BillingService::payment).list()
                : jdbc.sql(PAYMENT_SELECT
                                + " WHERE p.client_id = ? ORDER BY p.received_on DESC, p.id DESC")
                        .param(clientId).query(BillingService::payment).list();
    }

    @Transactional
    public PaymentView recordPayment(Long clientId, Long invoiceId, LocalDate receivedOn,
            long amountCents, String method, String reference, String note, Long userId) {
        requireClient(clientId);
        if (amountCents <= 0) {
            throw bad("Payment amount must be greater than zero");
        }
        if (method == null || !METHODS.contains(method)) {
            throw bad("Method must be one of " + String.join(", ", METHODS));
        }
        if (receivedOn != null && receivedOn.isAfter(today().plusDays(1))) {
            throw bad("The received date cannot be in the future");
        }
        if (invoiceId != null) {
            InvoiceView inv = invoiceById(invoiceId);
            if (!inv.clientId().equals(clientId)) {
                throw bad("That invoice belongs to a different client");
            }
            if (inv.voidedAt() != null) {
                throw bad("That invoice is void");
            }
            if (amountCents > inv.balanceCents()) {
                throw bad("That is more than the invoice's balance of "
                        + dollars(inv.balanceCents())
                        + ". Record the remainder on account instead.");
            }
        }
        Long id = jdbc.sql("""
                INSERT INTO payment (client_id, invoice_id, received_on, amount_cents, method,
                                     reference, note, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
                """)
                .params(clientId, invoiceId, receivedOn == null ? today() : receivedOn,
                        amountCents, method, blank(reference), blank(note), userId)
                .query(Long.class).single();
        log.info("Payment {} recorded for client {}: {} cents", id, clientId, amountCents);
        return jdbc.sql(PAYMENT_SELECT + " WHERE p.id = ?").param(id)
                .query(BillingService::payment).single();
    }

    @Transactional
    public void voidPayment(Long id, String reason) {
        int n = jdbc.sql("""
                UPDATE payment SET voided_at = now(), void_reason = ?
                WHERE id = ? AND voided_at IS NULL
                """).params(blank(reason), id).update();
        if (n == 0 && jdbc.sql("SELECT count(*) FROM payment WHERE id = ?").param(id)
                .query(Long.class).single() == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
    }

    /* ============================================================= account */

    public record AccountSummary(long chargedCents, long paidCents, long balanceCents,
            long unbilledCents, long invoicedOutstandingCents, long creditCents,
            long overdueCents, LocalDate lastPaymentOn) {}

    public record Account(ClientInfo client, AccountSummary summary, List<ChargeView> charges,
            List<InvoiceView> invoices, List<PaymentView> payments, long hourlyRateCents) {}

    public Account account(Long clientId) {
        ClientInfo client = clientInfo(clientId);
        List<ChargeView> charges = jdbc.sql(CHARGE_SELECT
                        + " WHERE c.client_id = ? ORDER BY c.service_date DESC, c.id DESC")
                .param(clientId).query(BillingService::charge).list();
        List<InvoiceView> invs = invoices(clientId);
        List<PaymentView> pays = payments(clientId);
        return new Account(client, summarise(charges, invs, pays), charges, invs, pays,
                options.hourlyRateCents());
    }

    private static AccountSummary summarise(List<ChargeView> charges, List<InvoiceView> invs,
            List<PaymentView> pays) {
        long charged = charges.stream().filter(c -> c.voidedAt() == null)
                .mapToLong(ChargeView::amountCents).sum();
        long unbilled = charges.stream()
                .filter(c -> c.voidedAt() == null && c.invoiceId() == null)
                .mapToLong(ChargeView::amountCents).sum();
        List<PaymentView> live = pays.stream().filter(p -> p.voidedAt() == null).toList();
        long paid = live.stream().mapToLong(PaymentView::amountCents).sum();
        long credit = live.stream().filter(p -> p.invoiceId() == null)
                .mapToLong(PaymentView::amountCents).sum();
        long outstanding = invs.stream().filter(i -> i.voidedAt() == null)
                .mapToLong(InvoiceView::balanceCents).sum();
        long overdue = invs.stream().filter(i -> "overdue".equals(i.status()))
                .mapToLong(InvoiceView::balanceCents).sum();
        LocalDate last = live.stream().map(PaymentView::receivedOn)
                .max(Comparator.naturalOrder()).orElse(null);
        return new AccountSummary(charged, paid, charged - paid, unbilled, outstanding, credit,
                overdue, last);
    }

    /** One line of a client statement, oldest first, with a running balance. */
    public record LedgerLine(LocalDate date, String type, String reference,
            String description, long debitCents, long creditCents, long balanceCents) {}

    public record Statement(ClientInfo client, LocalDate asOf, AccountSummary summary,
            List<LedgerLine> lines, List<InvoiceView> openInvoices, String footer) {}

    public Statement statement(Long clientId) {
        Account acc = account(clientId);
        record Raw(LocalDate date, int order, String type, String ref, String desc,
                long debit, long credit) {}
        List<Raw> raw = new ArrayList<>();
        for (ChargeView c : acc.charges()) {
            if (c.voidedAt() != null) continue;
            raw.add(new Raw(c.serviceDate(), 0, c.amountCents() >= 0 ? "Charge" : "Credit",
                    c.invoiceNumber() == null ? "Unbilled" : c.invoiceNumber(),
                    c.description(), Math.max(0, c.amountCents()),
                    Math.max(0, -c.amountCents())));
        }
        for (PaymentView p : acc.payments()) {
            if (p.voidedAt() != null) continue;
            raw.add(new Raw(p.receivedOn(), 1, "Payment",
                    p.invoiceNumber() == null ? "On account" : p.invoiceNumber(),
                    "Payment received (" + p.method().toUpperCase()
                            + (p.reference() == null ? "" : " " + p.reference()) + ")",
                    0, p.amountCents()));
        }
        raw.sort(Comparator.comparing(Raw::date).thenComparing(Raw::order));
        long running = 0;
        List<LedgerLine> lines = new ArrayList<>();
        for (Raw r : raw) {
            running += r.debit() - r.credit();
            lines.add(new LedgerLine(r.date(), r.type(), r.ref(), r.desc(), r.debit(),
                    r.credit(), running));
        }
        List<InvoiceView> open = acc.invoices().stream()
                .filter(i -> i.voidedAt() == null && i.balanceCents() > 0).toList();
        return new Statement(acc.client(), today(), acc.summary(), lines, open,
                options.invoiceNotes());
    }

    /* ============================================================= reports */

    public record AgingRow(Long clientId, String clientName, long unbilledCents,
            long currentCents, long days1to30Cents, long days31to60Cents,
            long days61to90Cents, long days90PlusCents, long creditCents, long balanceCents,
            LocalDate lastPaymentOn) {}

    public record AgingReport(LocalDate asOf, List<AgingRow> rows, AgingRow totals) {}

    /**
     * Accounts receivable aging, as of today. Invoiced balances fall into
     * buckets by days past their due date; unbilled charges and unapplied
     * payments are shown beside them so the balance column reconciles to
     * charges minus payments.
     */
    public AgingReport aging() {
        LocalDate asOf = today();
        Map<Long, long[]> acc = new LinkedHashMap<>();
        Map<Long, String> names = new LinkedHashMap<>();
        Map<Long, LocalDate> lastPaid = new LinkedHashMap<>();

        jdbc.sql("SELECT id, name FROM client ORDER BY name").query((rs, i) -> {
            names.put(rs.getLong("id"), rs.getString("name"));
            return null;
        }).list();

        // [unbilled, current, 1-30, 31-60, 61-90, 90+, credit]
        java.util.function.Function<Long, long[]> row = id -> acc.computeIfAbsent(id,
                k -> new long[7]);

        jdbc.sql("""
                SELECT client_id, SUM(amount_cents) AS s FROM charge
                WHERE voided_at IS NULL AND invoice_id IS NULL GROUP BY client_id
                """).query((rs, i) -> {
            row.apply(rs.getLong("client_id"))[0] += rs.getLong("s");
            return null;
        }).list();

        for (InvoiceView inv : invoices(null)) {
            if (inv.voidedAt() != null || inv.balanceCents() == 0) continue;
            long[] r = row.apply(inv.clientId());
            long days = ChronoUnit.DAYS.between(inv.dueOn(), asOf);
            int bucket = days <= 0 ? 1 : days <= 30 ? 2 : days <= 60 ? 3 : days <= 90 ? 4 : 5;
            r[bucket] += inv.balanceCents();
        }

        for (PaymentView p : payments(null)) {
            if (p.voidedAt() != null) continue;
            lastPaid.merge(p.clientId(), p.receivedOn(),
                    (a, b) -> a.isAfter(b) ? a : b);
            if (p.invoiceId() == null) {
                row.apply(p.clientId())[6] += p.amountCents();
            }
        }

        List<AgingRow> rows = new ArrayList<>();
        long[] t = new long[7];
        for (Map.Entry<Long, long[]> e : acc.entrySet()) {
            long[] r = e.getValue();
            long balance = r[0] + r[1] + r[2] + r[3] + r[4] + r[5] - r[6];
            if (balance == 0 && r[6] == 0 && r[0] == 0) continue;
            for (int i = 0; i < 7; i++) t[i] += r[i];
            rows.add(new AgingRow(e.getKey(), names.getOrDefault(e.getKey(), "?"), r[0], r[1],
                    r[2], r[3], r[4], r[5], r[6], balance, lastPaid.get(e.getKey())));
        }
        rows.sort(Comparator.comparingLong(AgingRow::balanceCents).reversed());
        AgingRow totals = new AgingRow(null, "Total", t[0], t[1], t[2], t[3], t[4], t[5], t[6],
                t[0] + t[1] + t[2] + t[3] + t[4] + t[5] - t[6], null);
        return new AgingReport(asOf, rows, totals);
    }

    public record RevenueMonth(String month, int minutes, int blocks, long billedCents,
            long collectedCents, int meetings) {}

    public record RevenueClient(Long clientId, String clientName, int minutes, int blocks,
            long billedCents, long collectedCents, int meetings) {}

    public record RevenueReport(LocalDate from, LocalDate to, List<RevenueMonth> months,
            List<RevenueClient> clients, RevenueMonth totals) {}

    /** Billed time and amounts by service month, against cash collected by month. */
    public RevenueReport revenue(LocalDate from, LocalDate to) {
        LocalDate f = from == null ? today().withDayOfYear(1) : from;
        LocalDate t = to == null ? today().withDayOfMonth(today().lengthOfMonth()) : to;
        if (t.isBefore(f)) {
            throw bad("The end date is before the start date");
        }

        Map<String, long[]> months = new java.util.TreeMap<>();
        // [minutes, blocks, billed, collected, meetings]
        jdbc.sql("""
                SELECT to_char(service_date, 'YYYY-MM') AS m,
                       COALESCE(SUM(minutes), 0) AS mins, COALESCE(SUM(blocks), 0) AS blocks,
                       SUM(amount_cents) AS billed,
                       COUNT(*) FILTER (WHERE kind = 'meeting') AS meetings
                FROM charge WHERE voided_at IS NULL AND service_date BETWEEN ? AND ?
                GROUP BY 1
                """).params(f, t).query((rs, i) -> {
            long[] r = months.computeIfAbsent(rs.getString("m"), k -> new long[5]);
            r[0] += rs.getLong("mins");
            r[1] += rs.getLong("blocks");
            r[2] += rs.getLong("billed");
            r[4] += rs.getLong("meetings");
            return null;
        }).list();
        jdbc.sql("""
                SELECT to_char(received_on, 'YYYY-MM') AS m, SUM(amount_cents) AS s
                FROM payment WHERE voided_at IS NULL AND received_on BETWEEN ? AND ?
                GROUP BY 1
                """).params(f, t).query((rs, i) -> {
            months.computeIfAbsent(rs.getString("m"), k -> new long[5])[3] += rs.getLong("s");
            return null;
        }).list();

        List<RevenueMonth> monthRows = months.entrySet().stream()
                .map(e -> new RevenueMonth(e.getKey(), (int) e.getValue()[0],
                        (int) e.getValue()[1], e.getValue()[2], e.getValue()[3],
                        (int) e.getValue()[4]))
                .toList();

        Map<Long, Object[]> byClient = new LinkedHashMap<>();
        jdbc.sql("""
                SELECT cl.id, cl.name,
                       COALESCE((SELECT SUM(minutes) FROM charge c WHERE c.client_id = cl.id
                                 AND c.voided_at IS NULL AND c.service_date BETWEEN :f AND :t), 0) AS mins,
                       COALESCE((SELECT SUM(blocks) FROM charge c WHERE c.client_id = cl.id
                                 AND c.voided_at IS NULL AND c.service_date BETWEEN :f AND :t), 0) AS blocks,
                       COALESCE((SELECT SUM(amount_cents) FROM charge c WHERE c.client_id = cl.id
                                 AND c.voided_at IS NULL AND c.service_date BETWEEN :f AND :t), 0) AS billed,
                       COALESCE((SELECT COUNT(*) FROM charge c WHERE c.client_id = cl.id
                                 AND c.kind = 'meeting'
                                 AND c.voided_at IS NULL AND c.service_date BETWEEN :f AND :t), 0) AS meetings,
                       COALESCE((SELECT SUM(amount_cents) FROM payment p WHERE p.client_id = cl.id
                                 AND p.voided_at IS NULL AND p.received_on BETWEEN :f AND :t), 0) AS collected
                FROM client cl ORDER BY cl.name
                """).param("f", f).param("t", t).query((rs, i) -> {
            byClient.put(rs.getLong("id"), new Object[] {rs.getString("name"),
                    rs.getLong("mins"), rs.getLong("blocks"), rs.getLong("billed"),
                    rs.getLong("collected"), rs.getLong("meetings")});
            return null;
        }).list();

        List<RevenueClient> clientRows = byClient.entrySet().stream()
                .filter(e -> (long) e.getValue()[3] != 0 || (long) e.getValue()[4] != 0
                        || (long) e.getValue()[1] != 0)
                .map(e -> new RevenueClient(e.getKey(), (String) e.getValue()[0],
                        (int) (long) e.getValue()[1], (int) (long) e.getValue()[2],
                        (long) e.getValue()[3], (long) e.getValue()[4],
                        (int) (long) e.getValue()[5]))
                .sorted(Comparator.comparingLong(RevenueClient::billedCents).reversed())
                .toList();

        RevenueMonth totals = new RevenueMonth("Total",
                monthRows.stream().mapToInt(RevenueMonth::minutes).sum(),
                monthRows.stream().mapToInt(RevenueMonth::blocks).sum(),
                monthRows.stream().mapToLong(RevenueMonth::billedCents).sum(),
                monthRows.stream().mapToLong(RevenueMonth::collectedCents).sum(),
                monthRows.stream().mapToInt(RevenueMonth::meetings).sum());
        return new RevenueReport(f, t, monthRows, clientRows, totals);
    }

    public record AttentionMeeting(Long appointmentId, Long clientId, String clientName,
            String engagementTitle, Instant startsAt, String status, int recordedMinutes,
            String issue) {}

    public record UnbilledReport(List<ChargeView> charges, long totalCents,
            List<AttentionMeeting> attention) {}

    /**
     * What has not reached an invoice yet, and meetings whose billing needs a
     * look: completed with no time recorded, or past and never completed
     * while time sits on them.
     */
    public UnbilledReport unbilled() {
        List<ChargeView> charges = jdbc.sql(CHARGE_SELECT + """
                 WHERE c.voided_at IS NULL AND c.invoice_id IS NULL
                 ORDER BY cl.name, c.service_date, c.id
                """).query(BillingService::charge).list();
        long total = charges.stream().mapToLong(ChargeView::amountCents).sum();

        List<AttentionMeeting> attention = jdbc.sql("""
                SELECT a.id, a.client_id, cl.name, e.title, a.starts_at, a.status,
                       COALESCE((SELECT SUM(COALESCE(t.minutes, GREATEST(1, CEIL(EXTRACT(EPOCH FROM
                            (COALESCE(t.ended_at, now()) - t.started_at)) / 60.0))))::int
                         FROM time_entry t WHERE t.appointment_id = a.id), 0) AS mins,
                       EXISTS (SELECT 1 FROM charge c WHERE c.appointment_id = a.id
                               AND c.voided_at IS NULL) AS charged
                FROM appointment a
                JOIN client cl ON cl.id = a.client_id
                JOIN engagement e ON e.id = a.engagement_id
                WHERE a.status <> 'cancelled' AND a.starts_at < now()
                ORDER BY a.starts_at DESC
                """).query((rs, i) -> {
            String status = rs.getString("status");
            int mins = rs.getInt("mins");
            boolean charged = rs.getBoolean("charged");
            String issue = null;
            if ("completed".equals(status) && mins == 0) {
                issue = "Completed with no time recorded";
            } else if (!"completed".equals(status) && mins > 0) {
                issue = "Time recorded but meeting not marked complete";
            } else if (!"completed".equals(status)) {
                issue = "Meeting time has passed; not marked complete";
            } else if (!charged) {
                issue = "Completed with time but no charge";
            }
            return issue == null ? null : new AttentionMeeting(rs.getLong("id"),
                    rs.getLong("client_id"), rs.getString("name"), rs.getString("title"),
                    rs.getTimestamp("starts_at").toInstant(), status, mins, issue);
        }).list().stream().filter(java.util.Objects::nonNull).toList();

        return new UnbilledReport(charges, total, attention);
    }

    /** Headline numbers for the admin overview. */
    public record Snapshot(long receivableCents, long overdueCents, long unbilledCents,
            long collectedThisMonthCents, long billedThisMonthCents, int openInquiries,
            long hourlyRateCents) {}

    public Snapshot snapshot() {
        AgingReport ar = aging();
        AgingRow t = ar.totals();
        LocalDate monthStart = today().withDayOfMonth(1);
        long collected = jdbc.sql("""
                SELECT COALESCE(SUM(amount_cents), 0) FROM payment
                WHERE voided_at IS NULL AND received_on >= ?
                """).param(monthStart).query(Long.class).single();
        long billed = jdbc.sql("""
                SELECT COALESCE(SUM(amount_cents), 0) FROM charge
                WHERE voided_at IS NULL AND service_date >= ?
                """).param(monthStart).query(Long.class).single();
        int inquiries = jdbc.sql("SELECT count(*) FROM engagement WHERE status = 'inquiry'")
                .query(Integer.class).single();
        return new Snapshot(t.balanceCents(),
                t.days1to30Cents() + t.days31to60Cents() + t.days61to90Cents()
                        + t.days90PlusCents(),
                t.unbilledCents(), collected, billed, inquiries, options.hourlyRateCents());
    }

    /* ======================================================= meeting report */

    public record SummaryTopic(String title, String detail, String desiredOutcome,
            int priority, String status, String note) {}

    public record MeetingSummary(Long appointmentId, ClientInfo client,
            String engagementTitle, String engagementStatus, Instant startsAt,
            Instant endsAt, int scheduledMinutes, String status, boolean billable,
            List<SummaryTopic> agenda, List<TimeEntry> time, int recordedMinutes,
            int blocks, ChargeView charge, long rateCents, long estimatedCents,
            Instant generatedAt) {}

    public MeetingSummary meetingSummary(Long appointmentId) {
        Map<String, Object> a = jdbc.sql("""
                SELECT a.*, e.title AS engagement_title, e.status AS engagement_status
                FROM appointment a JOIN engagement e ON e.id = a.engagement_id
                WHERE a.id = ?
                """).param(appointmentId).query().listOfRows().stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        List<SummaryTopic> agenda = jdbc.sql("""
                SELECT t.title, t.detail, t.desired_outcome, t.priority, t.status, n.body
                FROM topic t
                LEFT JOIN meeting_note n ON n.topic_id = t.id AND n.appointment_id = t.appointment_id
                WHERE t.appointment_id = ?
                ORDER BY t.priority, t.created_at
                """).param(appointmentId).query((rs, i) -> new SummaryTopic(
                rs.getString("title"), rs.getString("detail"), rs.getString("desired_outcome"),
                rs.getInt("priority"), rs.getString("status"), rs.getString("body"))).list();

        TimeSheet ts = timeSheet(appointmentId);
        Instant starts = ((java.sql.Timestamp) a.get("starts_at")).toInstant();
        int minutes = (Integer) a.get("duration_minutes");
        return new MeetingSummary(appointmentId, clientInfo((Long) a.get("client_id")),
                (String) a.get("engagement_title"), (String) a.get("engagement_status"),
                starts, starts.plusSeconds(minutes * 60L), minutes, (String) a.get("status"),
                (Boolean) a.get("billable"), agenda, ts.entries(), ts.totalMinutes(),
                ts.blocks(), ts.charge(), ts.rateCents(), ts.estimatedCents(), Instant.now());
    }

    /* ============================================================= helpers */

    private Map<String, Object> appointment(Long id) {
        return jdbc.sql("SELECT id, status, billable, starts_at FROM appointment WHERE id = ?")
                .param(id).query().listOfRows().stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "No such meeting"));
    }

    private void requireClient(Long clientId) {
        if (clientId == null || jdbc.sql("SELECT count(*) FROM client WHERE id = ?")
                .param(clientId).query(Long.class).single() == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such client");
        }
    }

    public ClientInfo clientInfo(Long clientId) {
        return jdbc.sql("""
                SELECT id, name, primary_email, contact_name, phone FROM client WHERE id = ?
                """).param(clientId).query((rs, i) -> new ClientInfo(rs.getLong("id"),
                rs.getString("name"), rs.getString("primary_email"),
                rs.getString("contact_name"), rs.getString("phone"))).optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "No such client"));
    }

    static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    static String dollars(long cents) {
        return "$" + BigDecimal.valueOf(cents).movePointLeft(2).setScale(2).toPlainString();
    }

    private static ResponseStatusException bad(String m) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, m);
    }

    private static ResponseStatusException conflict(String m) {
        return new ResponseStatusException(HttpStatus.CONFLICT, m);
    }
}
