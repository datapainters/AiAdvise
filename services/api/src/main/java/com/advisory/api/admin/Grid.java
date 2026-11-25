package com.advisory.api.admin;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Filtering, sorting and paging for the admin lists.
 *
 * <p><strong>This works on already-decorated rows, in memory, on purpose.</strong>
 * Each admin list is built as a DTO carrying joined values -- an appointment
 * row already knows its client's name and its engagement's title -- in a
 * fixed number of queries. Filtering those objects means a joined column
 * behaves exactly like a plain one, with no Criteria API, no entity
 * associations added purely to enable a filter, and no string concatenated
 * into SQL anywhere.
 *
 * <p>The cost is that every row is loaded before being narrowed. At this
 * platform's size -- clients in the tens, appointments in the low thousands
 * at worst -- that is nothing. Past roughly ten thousand rows in one list it
 * becomes the wrong shape and the predicates want pushing into SQL. The field
 * whitelist below is what that rewrite would key off.
 *
 * <p>Fields are addressed by name through an explicit whitelist, so a client
 * cannot ask to filter on something that was never meant to be exposed, and
 * an unknown field is a 400 rather than a silently empty result.
 */
public final class Grid {

    private Grid() {
    }

    /** Hard ceiling on a page, whatever the caller asks for. */
    private static final int MAX_SIZE = 200;

    public record Filter(String field, String op, String value) {}

    public record Page<T>(List<T> rows, int page, int size, long total, int totalPages) {}

    /**
     * Column metadata the front end uses to build its dropdowns, so the
     * operators offered always match what the server will accept.
     */
    public record Column(String field, String label, String type) {}

    /**
     * Parses {@code field:op:value} as sent repeatedly in the query string.
     *
     * <p>Split into at most three parts so a value may itself contain a
     * colon -- timestamps do.
     */
    public static List<Filter> parse(List<String> raw) {
        if (raw == null) {
            return List.of();
        }
        return raw.stream()
                .filter(s -> s != null && !s.isBlank())
                .map(s -> {
                    String[] parts = s.split(":", 3);
                    if (parts.length < 2) {
                        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                                "Filter must be field:op:value, got '" + s + "'");
                    }
                    return new Filter(parts[0], parts[1], parts.length == 3 ? parts[2] : "");
                })
                .toList();
    }

    /**
     * Applies filters, then sorting, then paging, in that order.
     *
     * @param accessors field name to value extractor. The key set is the
     *     whitelist: anything not in it is rejected.
     * @param sort {@code field:asc} or {@code field:desc}; blank leaves the
     *     caller's order alone.
     */
    public static <T> Page<T> apply(
            List<T> rows,
            Map<String, Function<T, Object>> accessors,
            List<Filter> filters,
            String sort,
            int page,
            int size) {

        List<T> working = rows;

        for (Filter filter : filters) {
            Function<T, Object> accessor = accessors.get(filter.field());
            if (accessor == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Cannot filter on '" + filter.field() + "'");
            }
            working = working.stream()
                    .filter(row -> matches(accessor.apply(row), filter.op(), filter.value()))
                    .toList();
        }

        if (sort != null && !sort.isBlank()) {
            String[] parts = sort.split(":", 2);
            Function<T, Object> accessor = accessors.get(parts[0]);
            if (accessor == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Cannot sort on '" + parts[0] + "'");
            }
            boolean descending = parts.length > 1 && "desc".equalsIgnoreCase(parts[1]);

            // Nulls last in both directions: an empty cell is not "smallest",
            // it is absent, and burying it at the top of a descending sort
            // hides the rows someone is actually looking for.
            //
            // The direction is applied to the value comparison, NOT to the
            // finished comparator. Reversing a nullsLast comparator also
            // reverses its null handling and silently turns it into
            // nulls-first, which is the one thing this is here to prevent.
            Comparator<Object> values = descending
                    ? (x, y) -> compareValues(y, x)
                    : Grid::compareValues;
            Comparator<T> comparator =
                    Comparator.comparing(accessor::apply, Comparator.nullsLast(values));
            working = working.stream().sorted(comparator).toList();
        }

        int safeSize = Math.min(Math.max(size, 1), MAX_SIZE);
        long total = working.size();
        int totalPages = (int) Math.max(1, Math.ceil((double) total / safeSize));
        // Clamp rather than 404: deleting the last row of the last page
        // should land you on a page that exists, not an error.
        int safePage = Math.min(Math.max(page, 0), totalPages - 1);

        int from = Math.min(safePage * safeSize, working.size());
        int to = Math.min(from + safeSize, working.size());

        return new Page<>(working.subList(from, to), safePage, safeSize, total, totalPages);
    }

    /** Comparison across the handful of types these rows actually hold. */
    @SuppressWarnings({"unchecked", "rawtypes"})
    private static int compareValues(Object a, Object b) {
        if (a instanceof Number na && b instanceof Number nb) {
            return Double.compare(na.doubleValue(), nb.doubleValue());
        }
        // Text compares case-insensitively, and this check has to come before
        // the Comparable one below: String is itself Comparable, so the
        // general branch used to swallow every string column and sort it by
        // String.compareTo. That is ASCII order, which puts every capitalised
        // name above every lowercase one -- "Zenith" before "client" -- and
        // made the client list look broken next to the filters, which have
        // always matched case-insensitively.
        if (a instanceof CharSequence && b instanceof CharSequence) {
            int byText = String.valueOf(a).compareToIgnoreCase(String.valueOf(b));
            // Fall back to the case-sensitive order only to break an exact
            // tie, so "ACME" and "acme" keep a stable relative order instead
            // of swapping places between requests.
            return byText != 0 ? byText : String.valueOf(a).compareTo(String.valueOf(b));
        }
        if (a instanceof Comparable ca && a.getClass().isInstance(b)) {
            return ca.compareTo(b);
        }
        // Mixed or unorderable types fall back to their text, which at least
        // groups like with like instead of throwing.
        return String.valueOf(a).compareToIgnoreCase(String.valueOf(b));
    }

    private static boolean matches(Object value, String op, String target) {
        // A null cell matches nothing except an explicit emptiness test. A
        // "contains x" filter should not surprise anyone by returning rows
        // where the column is blank.
        if (value == null) {
            return "isEmpty".equals(op);
        }
        if ("isEmpty".equals(op)) {
            return String.valueOf(value).isBlank();
        }

        // Numeric and temporal columns compare as themselves rather than as
        // text, so "duration greater than 90" does not put 120 before 90
        // the way a string comparison would.
        Integer ordering = compareTyped(value, target);

        return switch (op) {
            case "contains" -> text(value).contains(target.toLowerCase());
            case "notContains" -> !text(value).contains(target.toLowerCase());
            case "startsWith" -> text(value).startsWith(target.toLowerCase());
            case "endsWith" -> text(value).endsWith(target.toLowerCase());
            case "eq" -> ordering != null ? ordering == 0 : text(value).equals(target.toLowerCase());
            case "ne" -> ordering != null ? ordering != 0 : !text(value).equals(target.toLowerCase());
            case "gt" -> ordering != null ? ordering > 0 : text(value).compareTo(target.toLowerCase()) > 0;
            case "gte" -> ordering != null ? ordering >= 0 : text(value).compareTo(target.toLowerCase()) >= 0;
            case "lt" -> ordering != null ? ordering < 0 : text(value).compareTo(target.toLowerCase()) < 0;
            case "lte" -> ordering != null ? ordering <= 0 : text(value).compareTo(target.toLowerCase()) <= 0;
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Unknown operator '" + op + "'");
        };
    }

    private static String text(Object value) {
        return String.valueOf(value).toLowerCase();
    }

    /**
     * Compares a typed cell against the text the user typed.
     *
     * @return the comparison, or null when the pair is not meaningfully
     *     typed and the caller should fall back to text
     */
    private static Integer compareTyped(Object value, String target) {
        try {
            if (value instanceof Number n) {
                return Double.compare(n.doubleValue(), Double.parseDouble(target.trim()));
            }
            if (value instanceof Instant instant) {
                // Accept a plain date as well as a full timestamp: nobody
                // types an ISO instant into a filter box.
                String t = target.trim();
                Instant other = t.length() <= 10
                        ? LocalDate.parse(t).atStartOfDay(java.time.ZoneOffset.UTC).toInstant()
                        : Instant.parse(t);
                return instant.compareTo(other);
            }
            if (value instanceof LocalDate date) {
                return date.compareTo(LocalDate.parse(target.trim()));
            }
            if (value instanceof Boolean b) {
                return Boolean.compare(b, Boolean.parseBoolean(target.trim()));
            }
        } catch (RuntimeException e) {
            // The user typed something that is not a number or a date for a
            // column that is. Fall through to text so the filter still does
            // something sensible instead of 500ing mid-keystroke.
            return null;
        }
        return null;
    }

    /** Builder that keeps a column's label, type and accessor in one place. */
    public static final class Spec<T> {

        private final Map<String, Function<T, Object>> accessors = new LinkedHashMap<>();
        private final List<Column> columns = new java.util.ArrayList<>();

        public Spec<T> add(String field, String label, String type, Function<T, Object> get) {
            accessors.put(field, get);
            columns.add(new Column(field, label, type));
            return this;
        }

        public Map<String, Function<T, Object>> accessors() {
            return accessors;
        }

        public List<Column> columns() {
            return List.copyOf(columns);
        }
    }
}
