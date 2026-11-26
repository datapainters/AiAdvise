package com.advisory.api.admin;

import com.advisory.api.auth.CurrentUser;
import com.advisory.api.auth.Staff;
import com.advisory.api.billing.BillingService;
import com.advisory.api.messaging.ThreadService;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Everything the console's landing page shows, in one response.
 *
 * <p>The page is a summary of the whole system: what is waiting on the firm,
 * what is coming up, and how the work and the money stand. Asking each part
 * of the system for its own number would be a dozen requests on every
 * sign-in, so they are gathered here.
 *
 * <p>Open to every staff role. The money block is left out for roles that do
 * not handle billing, as it is everywhere else.
 */
@RestController
@RequestMapping("/api/admin/overview")
public class OverviewController {

    private final JdbcClient jdbc;
    private final ThreadService threads;
    private final BillingService billing;

    public OverviewController(JdbcClient jdbc, ThreadService threads, BillingService billing) {
        this.jdbc = jdbc;
        this.threads = threads;
        this.billing = billing;
    }

    /** A conversation where the client spoke last and nobody has answered. */
    public record Waiting(Long topicId, String title, String clientName,
            String engagementTitle, String lastAuthor, String lastSnippet, Instant since) {}

    /** An open engagement with a target date that has passed or is close. */
    public record Due(Long id, String title, String clientName, LocalDate dueOn,
            long daysLeft) {}

    public record Work(int clients, int activeEngagements, int inquiries, int openTopics,
            int meetingsToConfirm, int meetingsNext7Days, int meetingsToday,
            int minutesThisMonth, int replyMinutesThisMonth) {}

    public record People(int team, int teamInvitesPending, int clientUsers,
            int clientInvitesPending) {}

    public record Money(long receivableCents, long overdueCents, long unbilledCents,
            long billedThisMonthCents, long collectedThisMonthCents, long hourlyRateCents,
            int unchargedReplyMinutes) {}

    public record Overview(Work work, People people, int awaitingReply,
            List<Waiting> waiting, int pastDue, List<Due> due, int mediaItems, Money money) {}

    @GetMapping
    public Overview overview(@AuthenticationPrincipal Jwt jwt, Authentication auth) {
        Work work = jdbc.sql("""
                SELECT
                  (SELECT count(*) FROM client) AS clients,
                  (SELECT count(*) FROM engagement WHERE status = 'active') AS active,
                  (SELECT count(*) FROM engagement WHERE status = 'inquiry') AS inquiries,
                  (SELECT count(*) FROM topic t JOIN engagement e ON e.id = t.engagement_id
                    WHERE e.status <> 'closed' AND t.status IN ('proposed', 'scheduled'))
                      AS open_topics,
                  (SELECT count(*) FROM appointment
                    WHERE status = 'requested' AND starts_at > now()) AS to_confirm,
                  (SELECT count(*) FROM appointment
                    WHERE status = 'confirmed' AND starts_at > now()
                      AND starts_at < now() + interval '7 days') AS next7,
                  (SELECT count(*) FROM appointment
                    WHERE status IN ('requested', 'confirmed')
                      AND starts_at >= date_trunc('day', now())
                      AND starts_at < date_trunc('day', now()) + interval '1 day') AS today,
                  (SELECT COALESCE(sum(COALESCE(te.minutes,
                          GREATEST(1, CEIL(EXTRACT(EPOCH FROM
                              (COALESCE(te.ended_at, now()) - te.started_at)) / 60.0)))), 0)
                     FROM time_entry te
                    WHERE te.started_at >= date_trunc('month', now()))::int AS minutes,
                  (SELECT COALESCE(sum(minutes), 0) FROM topic_message
                    WHERE minutes IS NOT NULL
                      AND created_at >= date_trunc('month', now()))::int AS reply_minutes
                """).query((rs, i) -> new Work(rs.getInt("clients"), rs.getInt("active"),
                rs.getInt("inquiries"), rs.getInt("open_topics"), rs.getInt("to_confirm"),
                rs.getInt("next7"), rs.getInt("today"), rs.getInt("minutes"),
                rs.getInt("reply_minutes"))).single();

        People people = jdbc.sql("""
                SELECT
                  count(*) FILTER (WHERE role = 'ADMIN' AND enabled) AS team,
                  count(*) FILTER (WHERE role = 'ADMIN' AND enabled AND must_change_password
                                     AND last_login_at IS NULL) AS team_pending,
                  count(*) FILTER (WHERE role = 'CLIENT' AND enabled) AS clients,
                  count(*) FILTER (WHERE role = 'CLIENT' AND enabled AND must_change_password
                                     AND last_login_at IS NULL) AS client_pending
                FROM app_user
                """).query((rs, i) -> new People(rs.getInt("team"), rs.getInt("team_pending"),
                rs.getInt("clients"), rs.getInt("client_pending"))).single();

        // "Waiting" is the same test the inbox uses to flag a thread: the
        // conversation is open and the last word was not ours.
        List<ThreadService.Summary> unanswered = threads
                .list(threads.reader(CurrentUser.from(jwt).id()), null, null, false).stream()
                .filter(t -> t.open() && !"team".equals(t.lastSide()))
                .toList();
        List<Waiting> waiting = unanswered.stream().limit(6)
                .map(t -> new Waiting(t.topicId(), t.title(), t.clientName(),
                        t.engagementTitle(), t.lastAuthor(), t.lastSnippet(),
                        t.lastActivityAt()))
                .toList();

        List<Due> due = jdbc.sql("""
                SELECT e.id, e.title, c.name, e.due_on, (e.due_on - CURRENT_DATE) AS days_left
                FROM engagement e JOIN client c ON c.id = e.client_id
                WHERE e.status IN ('active', 'paused') AND e.due_on IS NOT NULL
                  AND e.due_on <= CURRENT_DATE + 14
                ORDER BY e.due_on
                LIMIT 8
                """).query((rs, i) -> new Due(rs.getLong("id"), rs.getString("title"),
                rs.getString("name"), rs.getObject("due_on", LocalDate.class),
                rs.getLong("days_left"))).list();
        int pastDue = jdbc.sql("""
                SELECT count(*) FROM engagement
                WHERE status IN ('active', 'paused') AND due_on < CURRENT_DATE
                """).query(Integer.class).single();

        int media = jdbc.sql(
                        "SELECT count(*) FROM media_item WHERE archived_at IS NULL AND status = 'ready'")
                .query(Integer.class).single();

        Money money = null;
        if (Staff.seesMoney(auth)) {
            BillingService.Snapshot s = billing.snapshot();
            int uncharged = jdbc.sql("""
                    SELECT COALESCE(sum(minutes), 0) FROM topic_message
                    WHERE minutes IS NOT NULL AND charge_id IS NULL
                    """).query(Integer.class).single();
            money = new Money(s.receivableCents(), s.overdueCents(), s.unbilledCents(),
                    s.billedThisMonthCents(), s.collectedThisMonthCents(), s.hourlyRateCents(),
                    uncharged);
        }

        return new Overview(work, people, unanswered.size(), waiting, pastDue, due, media, money);
    }
}
