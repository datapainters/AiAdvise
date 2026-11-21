package com.advisory.api.billing;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * What each engagement costs the firm, against what it billed.
 *
 * <p>Two kinds of cost: video, computed from Daily usage copied into
 * {@code video_session} at the current per-participant-minute rate, and
 * costs entered by hand in {@code engagement_cost}. Revenue is the live
 * charges on the engagement. Margin is revenue less both.
 */
@Service
public class CostService {

    private static final List<String> CATEGORIES =
            List.of("software", "subcontractor", "travel", "video", "other");

    private final JdbcClient jdbc;
    private final OptionsService options;
    private final ZoneId zone;

    public CostService(JdbcClient jdbc, OptionsService options,
            @Value("${MAIL_DISPLAY_TIMEZONE:America/Chicago}") String zone) {
        this.jdbc = jdbc;
        this.options = options;
        this.zone = ZoneId.of(zone);
    }

    public record CostRow(Long engagementId, String engagementTitle, String engagementStatus,
            Long clientId, String clientName, int meetings, int billedMinutes,
            long billedCents, int videoSessions, long participantMinutes,
            long videoCostCents, long otherCostCents, long totalCostCents, long marginCents,
            Double marginPercent) {}

    public record CostReport(LocalDate from, LocalDate to, String videoRatePerMinute,
            List<CostRow> rows, CostRow totals) {}

    /** Video cost in cents for participant-seconds at the configured rate. */
    long videoCents(long participantSeconds) {
        return BigDecimal.valueOf(participantSeconds)
                .multiply(options.videoCostRate())
                .multiply(BigDecimal.valueOf(100))
                .divide(BigDecimal.valueOf(60), 0, RoundingMode.HALF_UP)
                .longValue();
    }

    public CostReport report(LocalDate from, LocalDate to) {
        LocalDate f = from == null ? LocalDate.now(zone).withDayOfYear(1) : from;
        LocalDate t = to == null ? LocalDate.now(zone).withMonth(12).withDayOfMonth(31) : to;
        if (t.isBefore(f)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "The end date is before the start date");
        }
        Instant fi = f.atStartOfDay(zone).toInstant();
        Instant ti = t.plusDays(1).atStartOfDay(zone).toInstant();

        List<CostRow> rows = new ArrayList<>(jdbc.sql("""
                SELECT e.id, e.title, e.status, c.id AS client_id, c.name AS client_name,
                  (SELECT count(*) FROM appointment a WHERE a.engagement_id = e.id
                     AND a.status = 'completed' AND a.starts_at >= :fi AND a.starts_at < :ti) AS meetings,
                  (SELECT COALESCE(SUM(ch.minutes), 0) FROM charge ch WHERE ch.engagement_id = e.id
                     AND ch.voided_at IS NULL AND ch.service_date BETWEEN :f AND :t) AS billed_minutes,
                  (SELECT COALESCE(SUM(ch.amount_cents), 0) FROM charge ch WHERE ch.engagement_id = e.id
                     AND ch.voided_at IS NULL AND ch.service_date BETWEEN :f AND :t) AS billed,
                  (SELECT count(*) FROM video_session v JOIN appointment a ON a.id = v.appointment_id
                     WHERE a.engagement_id = e.id AND v.started_at >= :fi AND v.started_at < :ti) AS sessions,
                  (SELECT COALESCE(SUM(v.participant_seconds), 0) FROM video_session v
                     JOIN appointment a ON a.id = v.appointment_id
                     WHERE a.engagement_id = e.id AND v.started_at >= :fi AND v.started_at < :ti) AS p_seconds,
                  (SELECT COALESCE(SUM(k.amount_cents), 0) FROM engagement_cost k
                     WHERE k.engagement_id = e.id AND k.voided_at IS NULL
                       AND k.incurred_on BETWEEN :f AND :t) AS other_costs
                FROM engagement e JOIN client c ON c.id = e.client_id
                ORDER BY c.name, e.title
                """)
                .param("f", f).param("t", t)
                .param("fi", java.sql.Timestamp.from(fi)).param("ti", java.sql.Timestamp.from(ti))
                .query((rs, i) -> {
                    long pSeconds = rs.getLong("p_seconds");
                    long video = videoCents(pSeconds);
                    long other = rs.getLong("other_costs");
                    long billed = rs.getLong("billed");
                    long cost = video + other;
                    return new CostRow(rs.getLong("id"), rs.getString("title"),
                            rs.getString("status"), rs.getLong("client_id"),
                            rs.getString("client_name"), rs.getInt("meetings"),
                            rs.getInt("billed_minutes"), billed, rs.getInt("sessions"),
                            (pSeconds + 59) / 60, video, other, cost, billed - cost,
                            billed > 0 ? Math.round((billed - cost) * 1000.0 / billed) / 10.0 : null);
                })
                .list());

        // Engagements with no activity in the range add nothing but noise.
        rows.removeIf(r -> r.meetings() == 0 && r.billedCents() == 0 && r.videoSessions() == 0
                && r.otherCostCents() == 0);
        rows.sort(Comparator.comparingLong(CostRow::totalCostCents).reversed()
                .thenComparing(CostRow::clientName));

        long billed = rows.stream().mapToLong(CostRow::billedCents).sum();
        long video = rows.stream().mapToLong(CostRow::videoCostCents).sum();
        long other = rows.stream().mapToLong(CostRow::otherCostCents).sum();
        CostRow totals = new CostRow(null, "Total", null, null, null,
                rows.stream().mapToInt(CostRow::meetings).sum(),
                rows.stream().mapToInt(CostRow::billedMinutes).sum(), billed,
                rows.stream().mapToInt(CostRow::videoSessions).sum(),
                rows.stream().mapToLong(CostRow::participantMinutes).sum(), video, other,
                video + other, billed - video - other,
                billed > 0 ? Math.round((billed - video - other) * 1000.0 / billed) / 10.0 : null);

        return new CostReport(f, t, options.videoCostRate().toPlainString(), rows, totals);
    }

    /* ------------------------------------------------------------- detail */

    public record VideoLine(String sessionId, Long appointmentId, Instant startedAt,
            int durationSeconds, int maxParticipants, long participantMinutes, long costCents) {}

    public record CostLine(Long id, LocalDate incurredOn, String category, String description,
            long amountCents, Instant voidedAt, String createdBy) {}

    public record CostDetail(Long engagementId, String engagementTitle, String clientName,
            List<VideoLine> video, List<CostLine> costs, String videoRatePerMinute) {}

    public CostDetail detail(Long engagementId) {
        var head = jdbc.sql("""
                SELECT e.title, c.name FROM engagement e JOIN client c ON c.id = e.client_id
                WHERE e.id = ?
                """).param(engagementId).query((rs, i) -> new String[] {rs.getString(1),
                rs.getString(2)}).optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        List<VideoLine> video = jdbc.sql("""
                SELECT v.* FROM video_session v JOIN appointment a ON a.id = v.appointment_id
                WHERE a.engagement_id = ? ORDER BY v.started_at DESC
                """).param(engagementId).query((rs, i) -> {
            long ps = rs.getLong("participant_seconds");
            return new VideoLine(rs.getString("id"), rs.getLong("appointment_id"),
                    rs.getTimestamp("started_at").toInstant(), rs.getInt("duration_seconds"),
                    rs.getInt("max_participants"), (ps + 59) / 60, videoCents(ps));
        }).list();

        List<CostLine> costs = jdbc.sql("""
                SELECT k.*, u.display_name FROM engagement_cost k
                LEFT JOIN app_user u ON u.id = k.created_by
                WHERE k.engagement_id = ? ORDER BY k.incurred_on DESC, k.id DESC
                """).param(engagementId).query((rs, i) -> new CostLine(rs.getLong("id"),
                rs.getObject("incurred_on", LocalDate.class), rs.getString("category"),
                rs.getString("description"), rs.getLong("amount_cents"),
                rs.getTimestamp("voided_at") == null ? null
                        : rs.getTimestamp("voided_at").toInstant(),
                rs.getString("display_name"))).list();

        return new CostDetail(engagementId, head[0], head[1], video, costs,
                options.videoCostRate().toPlainString());
    }

    @Transactional
    public CostLine addCost(Long engagementId, LocalDate incurredOn, String category,
            String description, long amountCents, Long userId) {
        if (!CATEGORIES.contains(category)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Category must be one of " + String.join(", ", CATEGORIES));
        }
        if (description == null || description.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Describe the cost");
        }
        if (amountCents <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Cost must be greater than zero");
        }
        if (jdbc.sql("SELECT count(*) FROM engagement WHERE id = ?").param(engagementId)
                .query(Long.class).single() == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such engagement");
        }
        Long id = jdbc.sql("""
                INSERT INTO engagement_cost (engagement_id, incurred_on, category, description,
                                             amount_cents, created_by)
                VALUES (?, ?, ?, ?, ?, ?) RETURNING id
                """)
                .params(engagementId, incurredOn == null ? LocalDate.now(zone) : incurredOn,
                        category, description.trim(), amountCents, userId)
                .query(Long.class).single();
        return detail(engagementId).costs().stream().filter(c -> c.id().equals(id))
                .findFirst().orElseThrow();
    }

    @Transactional
    public void voidCost(Long id) {
        if (jdbc.sql("UPDATE engagement_cost SET voided_at = now() WHERE id = ? AND voided_at IS NULL")
                .param(id).update() == 0
                && jdbc.sql("SELECT count(*) FROM engagement_cost WHERE id = ?").param(id)
                        .query(Long.class).single() == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
    }
}
