package com.advisory.api.auth;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Writes sign-in attempts to {@code login_event}. */
@Service
public class LoginAudit {

    private static final Logger log = LoggerFactory.getLogger(LoginAudit.class);

    private final LoginEventRepository events;

    public LoginAudit(LoginEventRepository events) {
        this.events = events;
    }

    /**
     * Records one attempt.
     *
     * <p>REQUIRES_NEW because the interesting case is a failure: the
     * authentication transaction rolls back when it throws, and an audit row
     * that vanishes with the event it was recording is worse than no audit at
     * all. Its own transaction commits regardless of what happens around it.
     *
     * <p>Never throws. An audit write failing must not turn a successful
     * sign-in into a 500, so a failure here is logged and swallowed.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(String outcome, String emailTried, Long userId, HttpServletRequest request) {
        try {
            LoginEvent event = new LoginEvent();
            event.setOutcome(outcome);
            event.setEmailTried(emailTried);
            event.setUserId(userId);
            event.setIpAddress(clientIp(request));
            event.setUserAgent(request == null ? null : request.getHeader("User-Agent"));
            events.save(event);
        } catch (RuntimeException e) {
            log.warn("Could not write login audit row (outcome={})", outcome, e);
        }
    }

    /**
     * The caller's address as best it can be known.
     *
     * <p>The service sits behind an ECS-managed load balancer, so
     * {@code getRemoteAddr()} is the balancer. X-Forwarded-For carries the
     * chain, with the original client first.
     *
     * <p>This header is client-supplied and trivially spoofable. It is
     * recorded as evidence of where a request claimed to come from, and
     * nothing authorizes off it.
     */
    private static String clientIp(HttpServletRequest request) {
        if (request == null) {
            return null;
        }

        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            int comma = forwarded.indexOf(',');
            String first = comma < 0 ? forwarded : forwarded.substring(0, comma);
            if (!first.isBlank()) {
                return first.trim();
            }
        }

        return request.getRemoteAddr();
    }
}
