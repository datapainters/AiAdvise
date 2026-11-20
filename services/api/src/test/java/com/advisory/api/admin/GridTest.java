package com.advisory.api.admin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Nested;
import org.springframework.web.server.ResponseStatusException;

/**
 * Sorting, filtering and paging for the admin grids.
 *
 * <p>These exist because the grids were only ever checked by eye, against
 * five rows of seed data, which is exactly the sample size at which a
 * case-sensitive sort and an off-by-one page both look fine.
 */
class GridTest {

    record Row(String name, Instant added, Integer size) {}

    private static final Map<String, Function<Row, Object>> ACCESSORS = Map.of(
            "name", Row::name,
            "added", Row::added,
            "size", Row::size);

    private static Row row(String name) {
        return new Row(name, Instant.parse("2026-01-01T00:00:00Z"), 1);
    }

    private static List<String> names(Grid.Page<Row> page) {
        return page.rows().stream().map(Row::name).toList();
    }

    private static Grid.Page<Row> sorted(List<Row> rows, String sort) {
        return Grid.apply(rows, ACCESSORS, List.of(), sort, 0, 50);
    }

    @Nested
    @DisplayName("sorting")
    class Sorting {

        /**
         * The regression this file was written for. String is Comparable, so
         * the generic Comparable branch used to claim every text column and
         * sort it with String.compareTo -- ASCII order, where every capital
         * letter precedes every lowercase one.
         */
        @Test
        @DisplayName("text sorts case-insensitively, not in ASCII order")
        void textIgnoresCase() {
            List<Row> rows = List.of(
                    row("Zenith Manufacturing"),
                    row("client 1"),
                    row("Acme Logistics"),
                    row("northwind traders"));

            assertEquals(
                    List.of("Acme Logistics", "client 1", "northwind traders",
                            "Zenith Manufacturing"),
                    names(sorted(rows, "name:asc")));
        }

        @Test
        @DisplayName("descending is the exact reverse")
        void descendingReverses() {
            List<Row> rows = List.of(
                    row("Zenith Manufacturing"),
                    row("client 1"),
                    row("Acme Logistics"),
                    row("northwind traders"));

            List<String> asc = names(sorted(rows, "name:asc"));
            List<String> desc = names(sorted(rows, "name:desc"));

            assertEquals(asc.reversed(), desc);
        }

        @Test
        @DisplayName("case-variant names keep a deterministic order")
        void caseVariantsAreStable() {
            // "ACME" and "acme" tie case-insensitively. Returning them in a
            // different order on each request would make a grid flicker
            // between pages for no visible reason.
            List<Row> rows = List.of(row("acme"), row("ACME"), row("AcMe"));

            List<String> first = names(sorted(rows, "name:asc"));
            List<String> second = names(sorted(List.of(row("ACME"), row("AcMe"), row("acme")),
                    "name:asc"));

            assertEquals(first, second);
        }

        @Test
        @DisplayName("numbers sort numerically, not as text")
        void numbersAreNotText() {
            List<Row> rows = List.of(
                    new Row("a", Instant.EPOCH, 90),
                    new Row("b", Instant.EPOCH, 120),
                    new Row("c", Instant.EPOCH, 9));

            assertEquals(List.of("c", "a", "b"), names(sorted(rows, "size:asc")));
        }

        @Test
        @DisplayName("nulls sort last in both directions")
        void nullsLastBothWays() {
            List<Row> rows = List.of(
                    new Row("a", Instant.EPOCH, 2),
                    new Row("b", Instant.EPOCH, null),
                    new Row("c", Instant.EPOCH, 1));

            assertEquals("b", names(sorted(rows, "size:asc")).get(2));
            // Reversing a nullsLast comparator would normally float nulls to
            // the top; an absent value is not the largest value.
            assertEquals("b", names(sorted(rows, "size:desc")).get(2));
        }

        @Test
        @DisplayName("an unknown sort field is a 400, not a silent no-op")
        void unknownSortField() {
            assertThrows(ResponseStatusException.class,
                    () -> sorted(List.of(row("a")), "passwordHash:asc"));
        }
    }

    @Nested
    @DisplayName("filtering")
    class Filtering {

        private Grid.Page<Row> filter(List<Row> rows, String field, String op, String value) {
            return Grid.apply(rows, ACCESSORS,
                    List.of(new Grid.Filter(field, op, value)), null, 0, 50);
        }

        @Test
        @DisplayName("contains ignores case in both directions")
        void containsIgnoresCase() {
            List<Row> rows = List.of(row("Globex Corporation"), row("client 1"));

            assertEquals(1, filter(rows, "name", "contains", "o").total());
            assertEquals(1, filter(rows, "name", "contains", "O").total());
            assertEquals(1, filter(rows, "name", "contains", "GLOBEX").total());
        }

        @Test
        @DisplayName("several filters intersect")
        void filtersAreAnded() {
            List<Row> rows = List.of(
                    row("Globex Corporation"), row("northwind traders"), row("client 1"));

            Grid.Page<Row> page = Grid.apply(rows, ACCESSORS, List.of(
                    new Grid.Filter("name", "contains", "o"),
                    new Grid.Filter("name", "startsWith", "g")), null, 0, 50);

            assertEquals(List.of("Globex Corporation"), names(page));
        }

        /**
         * Dates are compared as instants against UTC midnight of the date the
         * user typed. Worth pinning down: the grids render the same column in
         * the browser's zone, so a row can legitimately display as the
         * previous day and still be excluded by "less than" on that day.
         */
        @Test
        @DisplayName("date comparison is against UTC midnight")
        void dateComparesInUtc() {
            Row lateOn18thLocal = new Row("local-18th",
                    Instant.parse("2026-11-19T02:00:00Z"), 1);
            Row squarelyOn17th = new Row("17th",
                    Instant.parse("2026-11-17T12:00:00Z"), 1);
            List<Row> rows = List.of(lateOn18thLocal, squarelyOn17th);

            assertEquals(List.of("local-18th"),
                    names(filter(rows, "added", "gt", "2026-11-19")));
            assertEquals(List.of("17th"),
                    names(filter(rows, "added", "lt", "2026-11-19")));
        }

        @Test
        @DisplayName("an unparseable date falls back to text rather than 500ing")
        void junkDateDoesNotThrow() {
            List<Row> rows = List.of(row("a"));
            // Someone mid-keystroke has typed "2026-1". The request must not
            // blow up; an empty result is the acceptable outcome.
            assertTrue(filter(rows, "added", "gt", "2026-1").total() >= 0);
        }

        @Test
        @DisplayName("an unknown filter field is a 400, not an empty grid")
        void unknownFilterField() {
            assertThrows(ResponseStatusException.class,
                    () -> filter(List.of(row("a")), "passwordHash", "contains", "x"));
        }
    }

    @Nested
    @DisplayName("paging")
    class Paging {

        private List<Row> many(int n) {
            return java.util.stream.IntStream.range(0, n)
                    .mapToObj(i -> row(String.format("row%02d", i)))
                    .toList();
        }

        @Test
        @DisplayName("pages do not overlap and cover every row")
        void pagesTileTheList() {
            List<Row> rows = many(25);

            List<String> seen = new java.util.ArrayList<>();
            for (int p = 0; p < 3; p++) {
                seen.addAll(names(Grid.apply(rows, ACCESSORS, List.of(), "name:asc", p, 10)));
            }

            assertEquals(25, seen.size());
            assertEquals(25, new java.util.HashSet<>(seen).size(), "pages overlap");
        }

        @Test
        @DisplayName("totals describe the whole result, not the page")
        void totalsAreForTheWholeResult() {
            Grid.Page<Row> page = Grid.apply(many(25), ACCESSORS, List.of(), "name:asc", 0, 10);

            assertEquals(10, page.rows().size());
            assertEquals(25, page.total());
            assertEquals(3, page.totalPages());
        }

        @Test
        @DisplayName("a page past the end clamps to the last page instead of 404ing")
        void pastTheEndClamps() {
            // Deleting the last row of the last page should land you on a
            // page that exists.
            Grid.Page<Row> page = Grid.apply(many(25), ACCESSORS, List.of(), "name:asc", 99, 10);

            assertEquals(2, page.page());
            assertEquals(5, page.rows().size());
        }

        @Test
        @DisplayName("an empty result still reports one page")
        void emptyIsOnePage() {
            Grid.Page<Row> page = Grid.apply(List.of(), ACCESSORS, List.of(), "name:asc", 0, 10);

            assertEquals(0, page.total());
            assertEquals(1, page.totalPages());
            assertTrue(page.rows().isEmpty());
        }

        @Test
        @DisplayName("page size is capped however much the caller asks for")
        void sizeIsCapped() {
            Grid.Page<Row> page = Grid.apply(many(25), ACCESSORS, List.of(), "name:asc", 0, 100000);

            assertTrue(page.size() <= 200, "page size was " + page.size());
        }
    }
}
