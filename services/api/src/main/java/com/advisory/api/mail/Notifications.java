package com.advisory.api.mail;

import com.advisory.api.auth.AppUser;
import com.advisory.api.auth.AppUserRepository;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * The actual messages the platform sends.
 *
 * <p>Kept separate from {@link MailSender} so the wording lives in one place
 * rather than being assembled inline in whichever controller happens to
 * trigger it.
 *
 * <p>Every method here is called <em>after</em> the database work it reports
 * on has committed. Sending inside a transaction risks announcing something
 * that then rolls back, and an email cannot be unsent.
 */
@Service
public class Notifications {

    private static final Logger log = LoggerFactory.getLogger(Notifications.class);

    private static final DateTimeFormatter WHEN =
            DateTimeFormatter.ofPattern("EEEE d MMMM, h:mm a");

    private final MailSender mail;
    private final AppUserRepository users;
    private final ZoneId displayZone;

    public Notifications(MailSender mail, AppUserRepository users,
            @Value("${MAIL_DISPLAY_TIMEZONE:America/Chicago}") String zone) {
        this.mail = mail;
        this.users = users;
        // Times in email have to be absolute -- the reader has no browser to
        // localise them. One configured zone, named in the text, is honest
        // and beats rendering UTC that nobody converts.
        this.displayZone = ZoneId.of(zone);
    }

    /* ----------------------------------------------------------- accounts */

    /**
     * Invites someone to set up their account.
     *
     * <p>Carries a single-use link, never a password. The link expires, works
     * once, and cannot be replayed out of a mailbox months later -- none of
     * which is true of a credential sent by email. The recipient chooses
     * their own password at the end of it, so no password the firm knows
     * ever exists for the account.
     *
     * @return whether the message reached the mail provider, so the caller
     *     can tell an admin to hand the link over by another route
     */
    public boolean invitation(String email, String displayName, String clientName,
            String inviteUrl, Instant expiresAt) {

        String expires = when(expiresAt);

        String plain = """
                Hello %s,

                You have been invited to the Data Painters client portal for %s.

                Set your password and sign in:
                %s

                The link works once and expires on %s (%s). If it has already
                expired, ask us to send another.

                If you were not expecting this, you can ignore it -- the account
                cannot be used until someone follows that link.

                Data Painters
                """.formatted(displayName, clientName, inviteUrl, expires,
                displayZone.getId());

        String html = wrap("""
                <p>Hello %s,</p>
                <p>You have been invited to the Data Painters client portal for
                <strong>%s</strong>.</p>
                <p style="margin:24px 0">
                  <a href="%s" style="background:#16181d;color:#fcfcfd;\
text-decoration:none;padding:11px 20px;border-radius:2px;display:inline-block">\
Set your password</a>
                </p>
                <p style="color:#595f6b;font-size:13px">The link works once and
                expires on %s (%s). If it has already expired, ask us to send
                another.</p>
                <p style="color:#595f6b;font-size:13px">If you were not expecting
                this, you can ignore it &mdash; the account cannot be used until
                someone follows that link.</p>
                """.formatted(esc(displayName), esc(clientName), esc(inviteUrl),
                esc(expires), esc(displayZone.getId())));

        return mail.send(email, "Your Data Painters portal invitation", plain, html);
    }

    /* ----------------------------------------------------------- meetings */

    /** Tells the firm a client has asked for time. */
    public void meetingRequested(String clientName, String engagementTitle,
            Instant startsAt, int durationMinutes, int topicCount, String requestedBy) {

        String to = mail.adminRecipient();
        if (to == null || to.isBlank()) {
            log.debug("No admin recipient configured; not announcing the meeting request");
            return;
        }

        String when = when(startsAt);
        String subject = "Meeting requested: %s, %s".formatted(clientName, when);

        String plain = """
                %s has requested a meeting.

                Client:      %s
                Engagement:  %s
                When:        %s (%s)
                Length:      %d minutes
                Agenda:      %d topic(s)

                Open it in the admin tools to confirm and work the agenda:
                %s/admin

                Data Painters
                """.formatted(requestedBy, clientName, engagementTitle, when,
                displayZone.getId(), durationMinutes, topicCount, mail.baseUrl());

        String html = wrap("""
                <p><strong>%s</strong> has requested a meeting.</p>
                <table cellpadding="4" style="border-collapse:collapse;font-size:14px">
                  <tr><td style="color:#595f6b">Client</td><td>%s</td></tr>
                  <tr><td style="color:#595f6b">Engagement</td><td>%s</td></tr>
                  <tr><td style="color:#595f6b">When</td><td>%s (%s)</td></tr>
                  <tr><td style="color:#595f6b">Length</td><td>%d minutes</td></tr>
                  <tr><td style="color:#595f6b">Agenda</td><td>%d topic(s)</td></tr>
                </table>
                <p><a href="%s/admin" style="color:#8a5a2b">Open the admin tools</a></p>
                """.formatted(esc(requestedBy), esc(clientName), esc(engagementTitle),
                esc(when), esc(displayZone.getId()), durationMinutes, topicCount,
                esc(mail.baseUrl())));

        mail.send(to, subject, plain, html);
    }

    /** Tells a client's people that a requested meeting is now confirmed. */
    public void meetingConfirmed(Long clientId, String engagementTitle,
            Instant startsAt, int durationMinutes, int topicCount) {

        List<AppUser> recipients = users.findAllByClientIdOrderByDisplayNameAsc(clientId)
                .stream().filter(AppUser::isEnabled).toList();

        if (recipients.isEmpty()) {
            log.debug("Client {} has no enabled logins; nobody to tell", clientId);
            return;
        }

        String when = when(startsAt);
        String subject = "Confirmed: %s on %s".formatted(engagementTitle, when);

        String plain = """
                Your meeting is confirmed.

                Engagement:  %s
                When:        %s (%s)
                Length:      %d minutes
                Agenda:      %d topic(s)

                You can review the agenda in the portal:
                %s/portal

                Data Painters
                """.formatted(engagementTitle, when, displayZone.getId(),
                durationMinutes, topicCount, mail.baseUrl());

        String html = wrap("""
                <p>Your meeting is confirmed.</p>
                <table cellpadding="4" style="border-collapse:collapse;font-size:14px">
                  <tr><td style="color:#595f6b">Engagement</td><td>%s</td></tr>
                  <tr><td style="color:#595f6b">When</td><td>%s (%s)</td></tr>
                  <tr><td style="color:#595f6b">Length</td><td>%d minutes</td></tr>
                  <tr><td style="color:#595f6b">Agenda</td><td>%d topic(s)</td></tr>
                </table>
                <p><a href="%s/portal" style="color:#8a5a2b">Review the agenda</a></p>
                """.formatted(esc(engagementTitle), esc(when), esc(displayZone.getId()),
                durationMinutes, topicCount, esc(mail.baseUrl())));

        mail.sendAll(recipients.stream().map(AppUser::getEmail).toList(),
                subject, plain, html);
    }

    /* ------------------------------------------------------------ helpers */

    private String when(Instant instant) {
        return WHEN.format(instant.atZone(displayZone));
    }

    /**
     * Minimal HTML shell. No stylesheet: mail clients strip {@code <style>}
     * blocks with enough regularity that inline attributes are the only
     * thing that reliably survives.
     */
    private static String wrap(String inner) {
        return """
                <!doctype html>
                <html><body style="margin:0;padding:24px;background:#fcfcfd">
                <div style="max-width:560px;margin:0 auto;font-family:Helvetica,Arial,sans-serif;\
                font-size:15px;line-height:1.55;color:#16181d">
                <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;\
                color:#595f6b;margin:0 0 24px">Data Painters</p>
                %s
                </div></body></html>
                """.formatted(inner);
    }

    /** Escapes interpolated values so a client name cannot inject markup. */
    private static String esc(String raw) {
        if (raw == null) {
            return "";
        }
        return raw.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;");
    }
}
