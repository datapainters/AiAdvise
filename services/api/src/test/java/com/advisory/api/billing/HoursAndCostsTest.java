package com.advisory.api.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class HoursAndCostsTest {

    private static final BusinessHours HOURS = BusinessHours.DEFAULT; // Mon–Fri 8–18 Chicago

    @Test
    void meetingMustStartAndEndInsideOneDaysWindow() {
        // 2026-11-23 is a Monday; Chicago is UTC-6 in November.
        assertThat(HOURS.contains(Instant.parse("2026-11-23T14:00:00Z"), 60)).isTrue();  // 8:00–9:00
        assertThat(HOURS.contains(Instant.parse("2026-11-23T13:30:00Z"), 30)).isFalse(); // 7:30
        assertThat(HOURS.contains(Instant.parse("2026-11-23T23:30:00Z"), 30)).isTrue();  // 17:30–18:00
        assertThat(HOURS.contains(Instant.parse("2026-11-23T23:30:00Z"), 60)).isFalse(); // runs past close
        assertThat(HOURS.contains(Instant.parse("2026-11-28T16:00:00Z"), 30)).isFalse(); // Saturday
    }

    @Test
    void describeGroupsConsecutiveDays() {
        assertThat(HOURS.describe()).isEqualTo("Mon–Fri 8 AM–6 PM (America/Chicago)");
        BusinessHours split = BusinessHours.parse("{\"timezone\":\"UTC\",\"days\":{"
                + "\"mon\":{\"open\":\"09:00\",\"close\":\"17:00\"},"
                + "\"tue\":{\"open\":\"09:00\",\"close\":\"17:00\"},"
                + "\"thu\":{\"open\":\"09:30\",\"close\":\"12:00\"}}}");
        assertThat(split.describe()).isEqualTo("Mon–Tue 9 AM–5 PM, Thu 9:30 AM–12 PM (UTC)");
    }

    @Test
    void rejectsBadHours() {
        assertThatThrownBy(() -> BusinessHours.parse("{\"timezone\":\"UTC\",\"days\":{}}"))
                .hasMessageContaining("at least one day");
        assertThatThrownBy(() -> BusinessHours.parse(
                "{\"timezone\":\"UTC\",\"days\":{\"mon\":{\"open\":\"08:15\",\"close\":\"18:00\"}}}"))
                .hasMessageContaining("hour or half hour");
        assertThatThrownBy(() -> BusinessHours.parse(
                "{\"timezone\":\"Nope/Zone\",\"days\":{\"mon\":{\"open\":\"08:00\",\"close\":\"18:00\"}}}"))
                .hasMessageContaining("time zone");
    }

    @Test
    void roundTripsToCanonicalJson() {
        assertThat(BusinessHours.parse(HOURS.toJson()).toJson()).isEqualTo(HOURS.toJson());
    }

    @Test
    void videoCostIsParticipantMinutesTimesRate() {
        OptionsService opts = new OptionsService(null) {
            @Override
            public BigDecimal videoCostRate() {
                return new BigDecimal("0.004");
            }
        };
        CostService costs = new CostService(null, opts, "America/Chicago");
        // Two people for 30 minutes = 60 participant-minutes = $0.24.
        assertThat(costs.videoCents(2 * 30 * 60)).isEqualTo(24);
        assertThat(costs.videoCents(0)).isZero();
    }
}
