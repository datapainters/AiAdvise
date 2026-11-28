package com.advisory.api.admin;

import com.advisory.api.admin.EngagementManagerController.AgendaLine;
import com.advisory.api.admin.EngagementManagerController.Detail;
import com.advisory.api.admin.EngagementManagerController.Meeting;
import com.advisory.api.admin.PeopleService.Person;
import com.advisory.api.auth.CurrentUser;
import com.advisory.api.messaging.ThreadService;
import com.lowagie.text.Chunk;
import com.lowagie.text.Document;
import com.lowagie.text.Element;
import com.lowagie.text.Font;
import com.lowagie.text.Image;
import com.lowagie.text.PageSize;
import com.lowagie.text.Paragraph;
import com.lowagie.text.Phrase;
import com.lowagie.text.Rectangle;
import com.lowagie.text.pdf.ColumnText;
import com.lowagie.text.pdf.PdfContentByte;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPTable;
import com.lowagie.text.pdf.PdfPageEventHelper;
import com.lowagie.text.pdf.PdfWriter;
import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Engagement Status Report: a PDF that says where an engagement stands,
 * written to be sent to the client.
 *
 * <p>Because it is for the client, it holds only what the client may already
 * see in their portal: the goal, the dates, who is involved, each topic and
 * its latest update, the meetings, and recent activity. It deliberately
 * leaves out everything internal -- billing figures, the time recorded on
 * replies, the team's own engagement notes and closure notes -- so it can be
 * forwarded without reading it for leaks first.
 *
 * <p>Built on the server rather than printed from the browser so that every
 * copy is the same document whatever machine produced it.
 */
@RestController
@RequestMapping("/api/admin/engagements/{id}/status-report")
public class StatusReportController {

    private static final Color INK = new Color(0x16, 0x18, 0x1d);
    private static final Color SOFT = new Color(0x59, 0x5f, 0x6b);
    private static final Color ACCENT = new Color(0x8a, 0x5a, 0x2b);
    private static final Color RULE = new Color(0xe3, 0xe5, 0xea);
    private static final Color WASH = new Color(0xf5, 0xf5, 0xf3);

    private static final Font BRAND = new Font(Font.HELVETICA, 9, Font.BOLD, ACCENT);
    private static final Font TITLE = new Font(Font.HELVETICA, 20, Font.BOLD, INK);
    private static final Font SUBTITLE = new Font(Font.HELVETICA, 10, Font.NORMAL, SOFT);
    private static final Font H2 = new Font(Font.HELVETICA, 12, Font.BOLD, INK);
    private static final Font BODY = new Font(Font.HELVETICA, 10, Font.NORMAL, INK);
    private static final Font BOLD = new Font(Font.HELVETICA, 10, Font.BOLD, INK);
    private static final Font SMALL = new Font(Font.HELVETICA, 8.5f, Font.NORMAL, SOFT);
    private static final Font LABEL = new Font(Font.HELVETICA, 8.5f, Font.BOLD, SOFT);
    private static final Font FIGURE = new Font(Font.HELVETICA, 16, Font.BOLD, INK);

    private static final DateTimeFormatter DAY =
            DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US);

    private static final Map<String, String> TOPIC_STATUS = Map.of(
            "proposed", "Open", "scheduled", "On a meeting",
            "discussed", "Discussed", "dropped", "Dropped");

    private static final Map<String, String> COMMUNICATION = Map.of(
            "message", "Messages", "video", "Video meetings", "both", "Messages and video meetings");

    private final EngagementManagerController engagements;
    private final ThreadService threads;
    private final JdbcClient jdbc;
    private final ZoneId zone;

    public StatusReportController(EngagementManagerController engagements, ThreadService threads,
            JdbcClient jdbc, @Value("${MAIL_DISPLAY_TIMEZONE:America/Chicago}") String zone) {
        this.engagements = engagements;
        this.threads = threads;
        this.jdbc = jdbc;
        this.zone = ZoneId.of(zone);
    }

    private record Activity(Instant at, String kind, String who, String what) {}

    /** The most recent notes taken on a topic in a meeting that has happened. */
    private record LastNote(String body, Instant meetingAt) {}

    @GetMapping
    public ResponseEntity<byte[]> report(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id) {
        // No Authentication passed: the detail then carries no billing block,
        // which is exactly what this document must not contain.
        Detail d = engagements.detail(id, null);
        Map<Long, ThreadService.Summary> latest = threads
                .list(threads.reader(CurrentUser.from(jwt).id()), id, null, true).stream()
                .collect(Collectors.toMap(ThreadService.Summary::topicId, s -> s, (a, b) -> a));

        List<Activity> activity = jdbc.sql("""
                SELECT at, kind, who, what FROM (
                    SELECT m.created_at AS at, 'Message' AS kind,
                           COALESCE(u.display_name, 'DataPainters') AS who, t.title AS what
                    FROM topic_message m
                    JOIN topic t ON t.id = m.topic_id
                    LEFT JOIN app_user u ON u.id = m.author_user_id
                    WHERE t.engagement_id = :id
                    UNION ALL
                    SELECT a.starts_at, 'Meeting notes', COALESCE(u.display_name, 'DataPainters'),
                           t.title
                    FROM meeting_note n
                    JOIN appointment a ON a.id = n.appointment_id
                    JOIN topic t ON t.id = n.topic_id
                    LEFT JOIN app_user u ON u.id = n.author_user_id
                    WHERE a.engagement_id = :id
                    UNION ALL
                    SELECT a.starts_at, 'Meeting held', '', COALESCE(a.title, 'Meeting')
                    FROM appointment a
                    WHERE a.engagement_id = :id AND a.status = 'completed'
                    UNION ALL
                    SELECT t.created_at, 'Topic raised', COALESCE(u.display_name, ''), t.title
                    FROM topic t
                    LEFT JOIN app_user u ON u.id = t.created_by_user_id
                    WHERE t.engagement_id = :id
                ) x
                WHERE at <= now()
                ORDER BY at DESC
                LIMIT 15
                """).param("id", id).query((rs, i) -> new Activity(
                rs.getTimestamp("at").toInstant(), rs.getString("kind"), rs.getString("who"),
                rs.getString("what"))).list();

        // A topic can be noted in several meetings; the report wants the
        // newest of those, wherever the topic was first booked.
        Map<Long, LastNote> notes = new java.util.HashMap<>();
        jdbc.sql("""
                SELECT DISTINCT ON (n.topic_id) n.topic_id, n.body, a.starts_at
                FROM meeting_note n
                JOIN appointment a ON a.id = n.appointment_id
                WHERE a.engagement_id = ? AND a.starts_at <= now()
                ORDER BY n.topic_id, a.starts_at DESC
                """).param(id).query(rs -> {
                    notes.put(rs.getLong("topic_id"), new LastNote(rs.getString("body"),
                            rs.getTimestamp("starts_at").toInstant()));
                });

        byte[] pdf = render(d, latest, notes, activity);
        String file = "Status report - " + d.title().replaceAll("[^A-Za-z0-9 _.-]", "").trim()
                + " - " + LocalDate.now(zone) + ".pdf";
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(file).build().toString())
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(pdf);
    }

    /* ---------------------------------------------------------------- render */

    private byte[] render(Detail d, Map<Long, ThreadService.Summary> latest,
            Map<Long, LastNote> notes, List<Activity> activity) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Document doc = new Document(PageSize.LETTER, 54, 54, 54, 60);
        PdfWriter writer = PdfWriter.getInstance(doc, out);
        writer.setPageEvent(new Footer(d.title()));
        doc.addTitle("Engagement status report: " + d.title());
        doc.addAuthor("DataPainters");
        doc.open();

        LocalDate today = LocalDate.now(zone);

        Image logo = logo();
        if (logo != null) {
            logo.scaleToFit(170, 34);
            logo.setSpacingAfter(10);
            doc.add(logo);
        } else {
            doc.add(new Paragraph("DATA PAINTERS", BRAND));
        }
        Paragraph kind = new Paragraph("Engagement status report", SUBTITLE);
        kind.setSpacingAfter(4);
        doc.add(kind);
        Paragraph title = new Paragraph(clean(d.title()), TITLE);
        title.setSpacingAfter(2);
        doc.add(title);
        Paragraph prepared = new Paragraph(
                clean(d.clientName()) + "  |  Prepared " + DAY.format(today), SUBTITLE);
        prepared.setSpacingAfter(14);
        doc.add(prepared);

        /* --- status ------------------------------------------------------ */

        PdfPTable facts = new PdfPTable(new float[] {1, 1, 1, 1});
        facts.setWidthPercentage(100);
        facts.addCell(fact("Status", capitalise(d.status())));
        facts.addCell(fact("Run by", COMMUNICATION.getOrDefault(d.communication(),
                d.communication())));
        facts.addCell(fact("Started", DAY.format(d.startedOn())));
        facts.addCell(fact("Target date", d.dueOn() == null ? "Open-ended"
                : DAY.format(d.dueOn()) + dueNote(d, today)));
        doc.add(facts);

        if (d.goal() != null && !d.goal().isBlank()) {
            PdfPTable goal = new PdfPTable(1);
            goal.setWidthPercentage(100);
            goal.setSpacingBefore(8);
            PdfPCell c = new PdfPCell();
            c.setBorder(Rectangle.LEFT);
            c.setBorderColorLeft(ACCENT);
            c.setBorderWidthLeft(2.5f);
            c.setBackgroundColor(WASH);
            c.setPadding(10);
            c.addElement(new Paragraph("GOAL", LABEL));
            c.addElement(new Paragraph(clean(d.goal()), BODY));
            goal.addCell(c);
            doc.add(goal);
        }

        long openTopics = d.agenda().stream()
                .filter(a -> "proposed".equals(a.status()) || "scheduled".equals(a.status()))
                .count();
        long doneTopics = d.agenda().stream().filter(a -> "discussed".equals(a.status())).count();
        long held = d.meetings().stream().filter(m -> "completed".equals(m.status())).count();
        List<Meeting> upcoming = d.meetings().stream()
                .filter(m -> m.startsAt().isAfter(Instant.now())
                        && List.of("requested", "confirmed").contains(m.status()))
                .sorted((a, b) -> a.startsAt().compareTo(b.startsAt()))
                .toList();

        PdfPTable figures = new PdfPTable(4);
        figures.setWidthPercentage(100);
        figures.setSpacingBefore(12);
        figures.addCell(figure(String.valueOf(openTopics), "Topics open"));
        figures.addCell(figure(String.valueOf(doneTopics), "Topics discussed"));
        figures.addCell(figure(String.valueOf(held), "Meetings held"));
        figures.addCell(figure(String.valueOf(upcoming.size()), "Meetings coming up"));
        doc.add(figures);

        /* --- topics ------------------------------------------------------ */

        doc.add(heading("Topics"));
        List<AgendaLine> topics = d.agenda().stream()
                .collect(Collectors.toMap(AgendaLine::topicId, a -> a, (a, b) -> a,
                        java.util.LinkedHashMap::new))
                .values().stream()
                .sorted((a, b) -> Integer.compare(rank(a.status()), rank(b.status())))
                .toList();
        if (topics.isEmpty()) {
            doc.add(new Paragraph("No topics have been raised yet.", SUBTITLE));
        } else {
            PdfPTable t = new PdfPTable(new float[] {3.2f, 1.3f, 4.5f});
            t.setWidthPercentage(100);
            t.setHeaderRows(1);
            t.addCell(head("Topic"));
            t.addCell(head("Status"));
            t.addCell(head("Latest update"));
            for (AgendaLine a : topics) {
                ThreadService.Summary s = latest.get(a.topicId());
                PdfPCell name = block();
                name.addElement(new Paragraph(clean(a.title()), BOLD));
                if (a.desiredOutcome() != null && !a.desiredOutcome().isBlank()) {
                    name.addElement(new Paragraph(
                            "Wanted: " + clean(a.desiredOutcome()), SMALL));
                }
                t.addCell(name);
                t.addCell(cell(new Phrase(TOPIC_STATUS.getOrDefault(a.status(), a.status()),
                        BODY)));
                t.addCell(update(notes.get(a.topicId()), s));
            }
            doc.add(t);
        }

        /* --- meetings ---------------------------------------------------- */

        doc.add(heading("Meetings"));
        if (d.meetings().isEmpty()) {
            doc.add(new Paragraph("No meetings have been booked.", SUBTITLE));
        } else {
            PdfPTable m = new PdfPTable(new float[] {2.6f, 4.6f, 1.8f});
            m.setWidthPercentage(100);
            m.setHeaderRows(1);
            m.addCell(head("When"));
            m.addCell(head("Meeting"));
            m.addCell(head("Status"));
            d.meetings().stream()
                    .filter(x -> !"cancelled".equals(x.status()))
                    .sorted((a, b) -> b.startsAt().compareTo(a.startsAt()))
                    .limit(12)
                    .forEach(x -> {
                        m.addCell(cell(new Phrase(when(x.startsAt()), BODY)));
                        m.addCell(cell(new Phrase(
                                clean(x.title() == null ? "Meeting" : x.title()), BODY)));
                        m.addCell(cell(new Phrase(capitalise(x.status()), BODY)));
                    });
            doc.add(m);
        }

        /* --- team -------------------------------------------------------- */

        doc.add(heading("Team"));
        PdfPTable team = new PdfPTable(2);
        team.setWidthPercentage(100);
        team.addCell(people("DataPainters", d.team().stream()
                .filter(p -> "team".equals(p.side())).toList()));
        team.addCell(people(clean(d.clientName()), d.team().stream()
                .filter(p -> "client".equals(p.side())).toList()));
        doc.add(team);

        /* --- activity ---------------------------------------------------- */

        doc.add(heading("Recent activity"));
        if (activity.isEmpty()) {
            doc.add(new Paragraph("No activity yet.", SUBTITLE));
        } else {
            PdfPTable a = new PdfPTable(new float[] {1.7f, 1.8f, 5.5f});
            a.setWidthPercentage(100);
            for (Activity x : activity) {
                a.addCell(plain(new Phrase(DAY.format(x.at().atZone(zone)), SMALL)));
                a.addCell(plain(new Phrase(x.kind(), BOLD)));
                Phrase what = new Phrase(clean(x.what()), BODY);
                if (x.who() != null && !x.who().isBlank()) {
                    what.add(new Chunk("  " + clean(x.who()), SMALL));
                }
                a.addCell(plain(what));
            }
            doc.add(a);
        }

        doc.close();
        return out.toByteArray();
    }

    /* --------------------------------------------------------------- pieces */

    private static int rank(String status) {
        return switch (status) {
            case "scheduled" -> 0;
            case "proposed" -> 1;
            case "discussed" -> 2;
            default -> 3;
        };
    }

    private String dueNote(Detail d, LocalDate today) {
        if ("closed".equals(d.status())) {
            return "";
        }
        long days = ChronoUnit.DAYS.between(today, d.dueOn());
        if (days < 0) {
            return " (" + -days + (days == -1 ? " day" : " days") + " past)";
        }
        return days == 0 ? " (today)" : " (" + days + (days == 1 ? " day" : " days") + " left)";
    }

    private String when(Instant at) {
        return DateTimeFormatter.ofPattern("MMM d, yyyy, h:mm a", Locale.US)
                .format(at.atZone(zone));
    }

    private PdfPCell update(LastNote note, ThreadService.Summary s) {
        PdfPCell c = block();
        // The most recent thing said about the topic, whichever came later:
        // a post in its thread or the notes from a meeting.
        boolean posted = s != null && s.lastSnippet() != null;
        boolean noteIsNewer = note != null
                && (!posted || note.meetingAt().isAfter(s.lastActivityAt()));
        if (noteIsNewer) {
            c.addElement(new Paragraph(clean(shorten(note.body())), BODY));
            c.addElement(new Paragraph(
                    "Meeting notes, " + DAY.format(note.meetingAt().atZone(zone)), SMALL));
        } else if (posted) {
            c.addElement(new Paragraph(clean(s.lastSnippet()), BODY));
            c.addElement(new Paragraph(clean(s.lastAuthor() == null ? "" : s.lastAuthor() + ", ")
                    + DAY.format(s.lastActivityAt().atZone(zone)), SMALL));
        } else {
            c.addElement(new Paragraph("No updates yet.", SMALL));
        }
        return c;
    }

    private static String shorten(String s) {
        return s.length() > 220 ? s.substring(0, 220) + "..." : s;
    }

    /** The logo from the classpath, or null so the report still renders without it. */
    private static Image logo() {
        try (var in = StatusReportController.class.getResourceAsStream("/brand/logo.png")) {
            return in == null ? null : Image.getInstance(in.readAllBytes());
        } catch (Exception e) {
            return null;
        }
    }

    private static Paragraph heading(String text) {
        Paragraph p = new Paragraph(text, H2);
        p.setSpacingBefore(18);
        p.setSpacingAfter(6);
        return p;
    }

    private static PdfPCell fact(String label, String value) {
        PdfPCell c = new PdfPCell();
        c.setBorder(Rectangle.BOX);
        c.setBorderColor(RULE);
        c.setPadding(8);
        c.addElement(new Paragraph(label.toUpperCase(Locale.ROOT), LABEL));
        c.addElement(new Paragraph(clean(value), BOLD));
        return c;
    }

    private static PdfPCell figure(String value, String label) {
        PdfPCell c = new PdfPCell();
        c.setBorder(Rectangle.BOX);
        c.setBorderColor(RULE);
        c.setBackgroundColor(WASH);
        c.setPadding(9);
        c.addElement(new Paragraph(value, FIGURE));
        c.addElement(new Paragraph(label, SMALL));
        return c;
    }

    private static PdfPCell head(String text) {
        PdfPCell c = new PdfPCell(new Phrase(text.toUpperCase(Locale.ROOT), LABEL));
        c.setBorder(Rectangle.BOTTOM);
        c.setBorderColor(INK);
        c.setBorderWidthBottom(1f);
        c.setPadding(5);
        c.setPaddingBottom(6);
        return c;
    }

    private static PdfPCell cell(Phrase content) {
        PdfPCell c = new PdfPCell(content);
        c.setBorder(Rectangle.BOTTOM);
        c.setBorderColor(RULE);
        c.setPadding(5);
        c.setPaddingBottom(7);
        c.setVerticalAlignment(Element.ALIGN_TOP);
        return c;
    }

    /** A table cell built from several paragraphs rather than one phrase. */
    private static PdfPCell block() {
        PdfPCell c = new PdfPCell();
        c.setBorder(Rectangle.BOTTOM);
        c.setBorderColor(RULE);
        c.setPadding(5);
        c.setPaddingTop(2);
        c.setPaddingBottom(7);
        return c;
    }

    private static PdfPCell plain(Phrase content) {
        PdfPCell c = new PdfPCell(content);
        c.setBorder(Rectangle.NO_BORDER);
        c.setPadding(3);
        return c;
    }

    private static PdfPCell people(String title, List<Person> members) {
        PdfPCell c = new PdfPCell();
        c.setBorder(Rectangle.NO_BORDER);
        c.setPadding(0);
        c.setPaddingRight(12);
        c.addElement(new Paragraph(title.toUpperCase(Locale.ROOT), LABEL));
        if (members.isEmpty()) {
            c.addElement(new Paragraph("Nobody assigned yet.", SMALL));
        }
        for (Person p : members) {
            Paragraph line = new Paragraph();
            line.add(new Chunk(clean(p.name()), BOLD));
            line.add(new Chunk("  " + PeopleService.ROLE_LABELS.getOrDefault(p.role(), p.role()),
                    SMALL));
            line.setSpacingBefore(2);
            c.addElement(line);
        }
        return c;
    }

    private static String capitalise(String s) {
        return s == null || s.isEmpty() ? "" : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    /**
     * The built-in PDF fonts cover Windows-1252 only. Anything outside it
     * would be dropped silently, leaving a gap in someone's name; replacing
     * the common typographic characters keeps the text readable.
     */
    static String clean(String s) {
        if (s == null) {
            return "";
        }
        StringBuilder out = new StringBuilder(s.length());
        for (char ch : s.replace('→', '>').replace("…", "...").toCharArray()) {
            boolean ok = ch == '\n' || (ch >= 0x20 && ch <= 0x7e) || (ch >= 0xa0 && ch <= 0xff)
                    || "‘’“”–—•€".indexOf(ch) >= 0;
            out.append(ok ? ch : '?');
        }
        return out.toString();
    }

    /** Page number and the engagement's name at the foot of every page. */
    private static final class Footer extends PdfPageEventHelper {
        private final String title;

        Footer(String title) {
            this.title = clean(title);
        }

        @Override
        public void onEndPage(PdfWriter writer, Document document) {
            PdfContentByte cb = writer.getDirectContent();
            float y = document.bottom() - 26;
            cb.setColorStroke(RULE);
            cb.setLineWidth(0.5f);
            cb.moveTo(document.left(), y + 12);
            cb.lineTo(document.right(), y + 12);
            cb.stroke();
            ColumnText.showTextAligned(cb, Element.ALIGN_LEFT,
                    new Phrase("DataPainters  |  " + title, SMALL), document.left(), y, 0);
            ColumnText.showTextAligned(cb, Element.ALIGN_RIGHT,
                    new Phrase("Page " + writer.getPageNumber(), SMALL), document.right(), y, 0);
        }
    }
}
