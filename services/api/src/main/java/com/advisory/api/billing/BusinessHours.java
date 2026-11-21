package com.advisory.api.billing;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.TextStyle;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Weekly opening hours in the business's own time zone, stored as the
 * {@code business_hours} system option:
 *
 * <pre>{"timezone":"America/Chicago","days":{"mon":{"open":"08:00","close":"18:00"},...,"sun":null}}</pre>
 *
 * A meeting is inside hours when it starts and ends within one day's window.
 */
public record BusinessHours(ZoneId zone, Map<DayOfWeek, Window> days) {

    public record Window(LocalTime open, LocalTime close) {}

    private static final ObjectMapper JSON = new ObjectMapper();

    static final String[] KEYS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"};

    public static final BusinessHours DEFAULT = parse(
            "{\"timezone\":\"America/Chicago\",\"days\":{"
                    + "\"mon\":{\"open\":\"08:00\",\"close\":\"18:00\"},"
                    + "\"tue\":{\"open\":\"08:00\",\"close\":\"18:00\"},"
                    + "\"wed\":{\"open\":\"08:00\",\"close\":\"18:00\"},"
                    + "\"thu\":{\"open\":\"08:00\",\"close\":\"18:00\"},"
                    + "\"fri\":{\"open\":\"08:00\",\"close\":\"18:00\"},"
                    + "\"sat\":null,\"sun\":null}}");

    /** Parses and validates; throws IllegalArgumentException with a readable message. */
    public static BusinessHours parse(String json) {
        JsonNode root;
        try {
            root = JSON.readTree(json);
        } catch (Exception e) {
            throw new IllegalArgumentException("Hours must be valid JSON");
        }
        if (root == null || !root.isObject()) {
            throw new IllegalArgumentException("Hours must be an object");
        }
        ZoneId zone;
        try {
            zone = ZoneId.of(root.path("timezone").asText());
        } catch (Exception e) {
            throw new IllegalArgumentException("Choose a valid time zone");
        }
        Map<DayOfWeek, Window> days = new LinkedHashMap<>();
        JsonNode d = root.path("days");
        boolean any = false;
        for (int i = 0; i < 7; i++) {
            JsonNode w = d.path(KEYS[i]);
            if (w.isMissingNode() || w.isNull()) {
                continue;
            }
            LocalTime open = time(w.path("open").asText(), KEYS[i]);
            LocalTime close = time(w.path("close").asText(), KEYS[i]);
            if (!close.isAfter(open)) {
                throw new IllegalArgumentException(
                        label(i) + ": closing time must be after opening time");
            }
            days.put(DayOfWeek.of(i + 1), new Window(open, close));
            any = true;
        }
        if (!any) {
            throw new IllegalArgumentException("Open at least one day a week");
        }
        return new BusinessHours(zone, days);
    }

    private static LocalTime time(String s, String day) {
        try {
            LocalTime t = LocalTime.parse(s);
            if (t.getMinute() % 30 != 0 || t.getSecond() != 0) {
                throw new IllegalArgumentException(label(indexOf(day))
                        + ": times must be on the hour or half hour");
            }
            return t;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException(label(indexOf(day)) + ": use times like 08:00");
        }
    }

    private static int indexOf(String key) {
        for (int i = 0; i < KEYS.length; i++) {
            if (KEYS[i].equals(key)) {
                return i;
            }
        }
        return 0;
    }

    private static String label(int i) {
        return DayOfWeek.of(i + 1).getDisplayName(TextStyle.FULL, Locale.US);
    }

    /** Canonical JSON for storage. */
    public String toJson() {
        ObjectNode root = JSON.createObjectNode();
        root.put("timezone", zone.getId());
        ObjectNode d = root.putObject("days");
        for (int i = 0; i < 7; i++) {
            Window w = days.get(DayOfWeek.of(i + 1));
            if (w == null) {
                d.putNull(KEYS[i]);
            } else {
                ObjectNode o = d.putObject(KEYS[i]);
                o.put("open", w.open().toString());
                o.put("close", w.close().toString());
            }
        }
        return root.toString();
    }

    /** True when [start, start + minutes) lies within one day's opening window. */
    public boolean contains(Instant start, int minutes) {
        ZonedDateTime s = start.atZone(zone);
        ZonedDateTime e = start.plusSeconds(minutes * 60L).atZone(zone);
        Window w = days.get(s.getDayOfWeek());
        // Closing times are at most 23:30, so a meeting inside hours always
        // ends on the calendar day it starts.
        if (w == null || !e.toLocalDate().equals(s.toLocalDate())) {
            return false;
        }
        return !s.toLocalTime().isBefore(w.open()) && !e.toLocalTime().isAfter(w.close());
    }

    /** "Mon–Fri 8 AM–6 PM (America/Chicago)": consecutive days with equal hours grouped. */
    public String describe() {
        StringBuilder sb = new StringBuilder();
        DayOfWeek start = null;
        DayOfWeek prev = null;
        Window window = null;
        for (int i = 1; i <= 8; i++) {
            DayOfWeek d = i <= 7 ? DayOfWeek.of(i) : null;
            Window w = d == null ? null : days.get(d);
            boolean continues = w != null && w.equals(window) && prev != null
                    && prev.getValue() == i - 1;
            if (!continues && window != null) {
                if (sb.length() > 0) {
                    sb.append(", ");
                }
                sb.append(start.getDisplayName(TextStyle.SHORT, Locale.US));
                if (prev != start) {
                    sb.append('–').append(prev.getDisplayName(TextStyle.SHORT, Locale.US));
                }
                sb.append(' ').append(fmt(window.open())).append('–').append(fmt(window.close()));
                window = null;
            }
            if (w != null && !continues) {
                start = d;
                window = w;
            }
            prev = w != null ? d : null;
        }
        return sb.append(" (").append(zone.getId()).append(')').toString();
    }

    private static String fmt(LocalTime t) {
        int h = t.getHour() % 12 == 0 ? 12 : t.getHour() % 12;
        return h + (t.getMinute() == 0 ? "" : ":" + String.format("%02d", t.getMinute()))
                + (t.getHour() < 12 ? " AM" : " PM");
    }
}
