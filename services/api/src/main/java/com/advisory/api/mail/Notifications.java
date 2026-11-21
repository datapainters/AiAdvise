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
            Instant startsAt, int durationMinutes, int topicCount, boolean video) {

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

                %s
                %s/portal?view=meetings

                Data Painters
                """.formatted(engagementTitle, when, displayZone.getId(),
                durationMinutes, topicCount,
                video ? "This is a video meeting. Join from your portal; the room opens\n"
                        + "15 minutes before the start:"
                        : "You can review the agenda in the portal:",
                mail.baseUrl());

        String html = wrap("""
                <p>Your meeting is confirmed.</p>
                <table cellpadding="4" style="border-collapse:collapse;font-size:14px">
                  <tr><td style="color:#595f6b">Engagement</td><td>%s</td></tr>
                  <tr><td style="color:#595f6b">When</td><td>%s (%s)</td></tr>
                  <tr><td style="color:#595f6b">Length</td><td>%d minutes</td></tr>
                  <tr><td style="color:#595f6b">Agenda</td><td>%d topic(s)</td></tr>
                </table>
                %s
                """.formatted(esc(engagementTitle), esc(when), esc(displayZone.getId()),
                durationMinutes, topicCount,
                video
                        ? "<p>This is a video meeting. Join from your portal &mdash; the room "
                                + "opens 15 minutes before the start.</p><p style=\"margin:24px 0\">"
                                + "<a href=\"" + esc(mail.baseUrl()) + "/portal?view=meetings\" "
                                + "style=\"background:#16181d;color:#fcfcfd;text-decoration:none;"
                                + "padding:11px 20px;border-radius:2px;display:inline-block\">"
                                + "Open the portal to join</a></p>"
                        : "<p><a href=\"" + esc(mail.baseUrl())
                                + "/portal\" style=\"color:#8a5a2b\">Review the agenda</a></p>"));

        mail.sendAll(recipients.stream().map(AppUser::getEmail).toList(),
                subject, plain, html);
    }

    /**
     * Confirms a meeting to someone with no portal login, such as a website
     * inquiry. The join link carries a personal token that works from 15
     * minutes before the start until the room closes.
     */
    public void meetingConfirmedGuest(String email, String name, String engagementTitle,
            Instant startsAt, int durationMinutes, int topicCount, String joinUrl) {

        String when = when(startsAt);
        String subject = "Confirmed: %s on %s".formatted(engagementTitle, when);

        String plain = """
                Hello %s,

                Your meeting with Data Painters is confirmed.

                Meeting:  %s
                When:     %s (%s)
                Length:   %d minutes
                Agenda:   %d topic(s)

                %s

                Data Painters
                """.formatted(name, engagementTitle, when, displayZone.getId(), durationMinutes,
                topicCount,
                joinUrl == null ? "We will send joining details before the meeting."
                        : "Join the video call (opens 15 minutes before the start):\n" + joinUrl
                                + "\n\nThis link is personal to you; please do not forward it.");

        String html = wrap("""
                <p>Hello %s,</p>
                <p>Your meeting with Data Painters is confirmed.</p>
                <table cellpadding="4" style="border-collapse:collapse;font-size:14px">
                  <tr><td style="color:#595f6b">Meeting</td><td>%s</td></tr>
                  <tr><td style="color:#595f6b">When</td><td>%s (%s)</td></tr>
                  <tr><td style="color:#595f6b">Length</td><td>%d minutes</td></tr>
                  <tr><td style="color:#595f6b">Agenda</td><td>%d topic(s)</td></tr>
                </table>
                %s
                """.formatted(esc(name), esc(engagementTitle), esc(when), esc(displayZone.getId()),
                durationMinutes, topicCount,
                joinUrl == null ? "<p>We will send joining details before the meeting.</p>"
                        : "<p style=\"margin:24px 0\"><a href=\"" + esc(joinUrl) + "\" "
                                + "style=\"background:#16181d;color:#fcfcfd;text-decoration:none;"
                                + "padding:11px 20px;border-radius:2px;display:inline-block\">"
                                + "Join the video call</a></p><p style=\"color:#595f6b;font-size:13px\">"
                                + "The room opens 15 minutes before the start. This link is "
                                + "personal to you; please do not forward it.</p>"));

        mail.send(email, subject, plain, html);
    }

    /* -------------------------------------------------------- inquiries */

    /**
     * Tells the firm a free consultation was requested from the website.
     *
     * @param overrideTo the inquiry-email system option; blank falls back to
     *     the configured admin recipient
     */
    public void consultationRequested(String overrideTo, String reference, Long clientId,
            String clientName, String contactName, String email, String phone, String role,
            String segment, Instant startsAt, List<String> topics, String message) {

        String to = overrideTo != null && !overrideTo.isBlank() ? overrideTo
                : mail.adminRecipient();
        if (to == null || to.isBlank()) {
            log.warn("No inquiry recipient configured; consultation {} was not announced",
                    reference);
            return;
        }

        String when = when(startsAt);
        String subject = "New consultation request: %s (%s), %s"
                .formatted(contactName, clientName, when);
        String topicLines = topics.stream().map(t -> "  - " + t)
                .collect(java.util.stream.Collectors.joining("\n"));

        String plain = """
                A free 30-minute consultation was requested on the website.

                Reference:   %s
                Name:        %s%s
                Company:     %s
                Email:       %s
                Phone:       %s
                Interest:    %s
                Requested:   %s (%s)

                Topics:
                %s
                %s
                Confirm it in the admin console (Meetings, or the client's record):
                %s/admin?view=appointments

                Data Painters
                """.formatted(reference, contactName, role == null ? "" : ", " + role,
                clientName, email, phone == null ? "-" : phone, segment, when,
                displayZone.getId(), topicLines,
                message == null ? "" : "\nAdditional context:\n" + message + "\n",
                mail.baseUrl());

        StringBuilder items = new StringBuilder();
        for (String t : topics) {
            items.append("<li>").append(esc(t)).append("</li>");
        }
        String html = wrap("""
                <p><strong>New free consultation request</strong> from the website.</p>
                <table cellpadding="4" style="border-collapse:collapse;font-size:14px">
                  <tr><td style="color:#595f6b">Reference</td><td>%s</td></tr>
                  <tr><td style="color:#595f6b">Name</td><td>%s%s</td></tr>
                  <tr><td style="color:#595f6b">Company</td><td>%s</td></tr>
                  <tr><td style="color:#595f6b">Email</td><td><a href="mailto:%s">%s</a></td></tr>
                  <tr><td style="color:#595f6b">Phone</td><td>%s</td></tr>
                  <tr><td style="color:#595f6b">Interest</td><td>%s</td></tr>
                  <tr><td style="color:#595f6b">Requested</td><td>%s (%s)</td></tr>
                </table>
                <p style="margin:16px 0 4px"><strong>Topics</strong></p>
                <ul style="margin:0;padding-left:20px">%s</ul>
                %s
                <p style="margin:24px 0">
                  <a href="%s/admin?view=appointments" style="background:#16181d;color:#fcfcfd;\
text-decoration:none;padding:11px 20px;border-radius:2px;display:inline-block">\
Review and confirm</a>
                </p>
                """.formatted(esc(reference), esc(contactName),
                role == null ? "" : ", " + esc(role), esc(clientName), esc(email), esc(email),
                esc(phone == null ? "-" : phone), esc(segment), esc(when),
                esc(displayZone.getId()), items,
                message == null ? "" : "<p style=\"margin:16px 0 4px\"><strong>Additional "
                        + "context</strong></p><p style=\"white-space:pre-wrap\">"
                        + esc(message) + "</p>",
                esc(mail.baseUrl())));

        mail.send(to, subject, plain, html);
        log.info("Consultation {} for client {} announced", reference, clientId);
    }

    /** Acknowledges a consultation request to the person who made it. */
    public void consultationReceived(String email, String name, String reference,
            String segment, Instant startsAt, List<String> topics) {

        String when = when(startsAt);
        String subject = "We received your consultation request (" + reference + ")";
        String topicLines = topics.stream().map(t -> "  - " + t)
                .collect(java.util.stream.Collectors.joining("\n"));

        String plain = """
                Hello %s,

                Thank you for requesting a free 30-minute consultation with Data Painters.

                Reference:  %s
                Area:       %s
                Requested:  %s (%s)

                You asked to cover:
                %s

                We will confirm the time by email, or suggest another if that slot
                does not work. There is no charge for this call and no obligation.

                Data Painters
                """.formatted(name, reference, segment, when, displayZone.getId(),
                topicLines);

        StringBuilder items = new StringBuilder();
        for (String t : topics) {
            items.append("<li>").append(esc(t)).append("</li>");
        }
        String html = wrap("""
                <p>Hello %s,</p>
                <p>Thank you for requesting a free 30-minute consultation with Data Painters.</p>
                <table cellpadding="4" style="border-collapse:collapse;font-size:14px">
                  <tr><td style="color:#595f6b">Reference</td><td>%s</td></tr>
                  <tr><td style="color:#595f6b">Area</td><td>%s</td></tr>
                  <tr><td style="color:#595f6b">Requested</td><td>%s (%s)</td></tr>
                </table>
                <p style="margin:16px 0 4px">You asked to cover:</p>
                <ul style="margin:0;padding-left:20px">%s</ul>
                <p>We will confirm the time by email, or suggest another if that slot does
                not work. There is no charge for this call and no obligation.</p>
                """.formatted(esc(name), esc(reference), esc(segment), esc(when),
                esc(displayZone.getId()), items));

        mail.send(email, subject, plain, html);
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
