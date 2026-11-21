package com.advisory.api.video;

import static org.assertj.core.api.Assertions.assertThat;

import com.advisory.api.portal.Appointment;
import com.advisory.api.video.DailyClient.Session;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Which calls count as billable time. */
class CallTimeTest {

    private static VideoService withSessions(List<Session> sessions) {
        DailyClient daily = new DailyClient("test-key") {
            @Override
            public List<Session> sessions(String roomName) {
                return sessions;
            }
        };
        return new VideoService(daily, null, null);
    }

    private static Appointment meeting() {
        Appointment a = new Appointment();
        a.setVideoRoomName("dp-m1-test");
        a.setStartsAt(Instant.parse("2026-12-01T15:00:00Z"));
        a.setDurationMinutes(60);
        return a;
    }

    private static Session s(long seconds, boolean ongoing, int people) {
        return new Session("x", Instant.parse("2026-12-01T15:00:00Z"), seconds, ongoing, people,
                seconds * people);
    }

    @Test
    void sumsFinishedCallsWithTwoOrMorePeopleRoundingUpToTheMinute() {
        VideoService.CallTime t = withSessions(List.of(
                s(1_801, false, 2),   // 30 min 1 s
                s(600, false, 3)))    // 10 min
                .callTime(meeting());
        assertThat(t.minutes()).isEqualTo(41);
        assertThat(t.sessions()).isEqualTo(2);
        assertThat(t.ignoredSessions()).isZero();
    }

    @Test
    void ignoresAHostWaitingAloneAndCallsStillInProgress() {
        VideoService.CallTime t = withSessions(List.of(
                s(900, false, 1),     // host alone
                s(0, true, 2),        // ongoing
                s(1_200, false, 2)))  // the real call
                .callTime(meeting());
        assertThat(t.minutes()).isEqualTo(20);
        assertThat(t.sessions()).isEqualTo(1);
        assertThat(t.ignoredSessions()).isEqualTo(2);
    }

    @Test
    void noCallsIsZero() {
        assertThat(withSessions(List.of()).callTime(meeting()).minutes()).isZero();
    }
}
