package com.advisory.api.mail;

import jakarta.annotation.PreDestroy;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.sesv2.SesV2Client;
import software.amazon.awssdk.services.sesv2.model.Body;
import software.amazon.awssdk.services.sesv2.model.Content;
import software.amazon.awssdk.services.sesv2.model.Destination;
import software.amazon.awssdk.services.sesv2.model.EmailContent;
import software.amazon.awssdk.services.sesv2.model.Message;
import software.amazon.awssdk.services.sesv2.model.SendEmailRequest;

/**
 * Sends transactional mail through Amazon SES.
 *
 * <p><strong>Sending never fails the thing that triggered it.</strong> Every
 * send here is a side effect of an action the user already completed --
 * creating a login, booking a meeting. If SES is unreachable, throttled, or
 * the recipient is suppressed, the user's action still succeeded and must not
 * be rolled back or reported as an error. Failures are logged and swallowed,
 * deliberately. The cost of that choice is that a lost email is quiet, which
 * is why every send logs at INFO on the way out.
 *
 * <p>When {@code MAIL_ENABLED} is false the message is logged instead of
 * sent. That is the normal state while SES is in the sandbox, where anything
 * addressed to an unverified recipient is rejected anyway, and it is what
 * makes local development work with no AWS credentials at all.
 */
@Service
public class MailSender {

    private static final Logger log = LoggerFactory.getLogger(MailSender.class);

    private final boolean enabled;
    private final String from;
    private final String fromName;
    private final String configurationSet;
    private final String adminRecipient;
    private final String baseUrl;
    private final String redirectTo;

    /** Created lazily so a disabled service needs no credentials. */
    private volatile SesV2Client client;

    public MailSender(
            @Value("${MAIL_ENABLED:false}") boolean enabled,
            @Value("${MAIL_FROM:}") String from,
            @Value("${MAIL_FROM_NAME:Data Painters}") String fromName,
            @Value("${MAIL_CONFIGURATION_SET:}") String configurationSet,
            @Value("${MAIL_ADMIN_RECIPIENT:}") String adminRecipient,
            @Value("${APP_BASE_URL:https://ai.datapainters.com}") String baseUrl,
            @Value("${MAIL_REDIRECT_TO:}") String redirectTo) {

        this.enabled = enabled;
        this.from = from;
        this.fromName = fromName;
        this.configurationSet = configurationSet;
        this.adminRecipient = adminRecipient;
        this.baseUrl = baseUrl;
        this.redirectTo = redirectTo == null ? "" : redirectTo.trim();
        if (!this.redirectTo.isEmpty()) {
            log.warn("All outbound mail is redirected to {} (non-production environment)",
                    this.redirectTo);
        }

        if (enabled && from.isBlank()) {
            // Fail at startup rather than at the first send. A service that
            // boots healthy and then silently drops every email is worse
            // than one that refuses to boot.
            throw new IllegalStateException(
                    "MAIL_ENABLED is true but MAIL_FROM is empty");
        }

        log.info("Mail sending {}{}", enabled ? "enabled as " + from : "disabled",
                enabled ? " (configuration set: " + configurationSet + ")" : "");
    }

    public String baseUrl() {
        return baseUrl;
    }

    /** Where firm-side notifications go. Empty if none is configured. */
    public String adminRecipient() {
        return adminRecipient;
    }

    /**
     * Sends one message.
     *
     * @return true if it was handed to SES, false if sending is off or the
     *     attempt failed. Callers are not expected to check; the return value
     *     exists for tests and for the one caller that reports delivery state
     *     back to an admin screen.
     */
    public boolean send(String to, String subject, String plainBody, String htmlBody) {
        if (to == null || to.isBlank()) {
            log.warn("Skipping '{}': no recipient", subject);
            return false;
        }

        if (!redirectTo.isEmpty()) {
            // A development copy must never mail real clients. Everything goes
            // to one address, with the intended recipient kept in the subject.
            subject = "[DEV for " + to + "] " + subject;
            to = redirectTo;
        }

        if (!enabled) {
            log.info("Mail disabled; would have sent '{}' to {}", subject, to);
            return false;
        }

        try {
            SendEmailRequest.Builder request = SendEmailRequest.builder()
                    .fromEmailAddress(String.format("%s <%s>", fromName, from))
                    .destination(Destination.builder().toAddresses(to).build())
                    .content(EmailContent.builder()
                            .simple(Message.builder()
                                    .subject(utf8(subject))
                                    .body(Body.builder()
                                            .text(utf8(plainBody))
                                            .html(utf8(htmlBody))
                                            .build())
                                    .build())
                            .build());

            if (!configurationSet.isBlank()) {
                request.configurationSetName(configurationSet);
            }

            client().sendEmail(request.build());
            log.info("Sent '{}' to {}", subject, to);
            return true;

        } catch (RuntimeException e) {
            // Includes MessageRejected (sandbox, unverified recipient),
            // AccountSuspendedException, and throttling. None of them should
            // surface to the user whose action triggered this.
            log.error("Could not send '{}' to {}", subject, to, e);
            return false;
        }
    }

    /** Sends to every address given, continuing past individual failures. */
    public void sendAll(List<String> recipients, String subject, String plain, String html) {
        for (String to : recipients) {
            send(to, subject, plain, html);
        }
    }

    private static Content utf8(String data) {
        return Content.builder().data(data).charset("UTF-8").build();
    }

    private SesV2Client client() {
        SesV2Client local = client;
        if (local == null) {
            synchronized (this) {
                local = client;
                if (local == null) {
                    local = SesV2Client.create();
                    client = local;
                }
            }
        }
        return local;
    }

    @PreDestroy
    void close() {
        SesV2Client local = client;
        if (local != null) {
            local.close();
        }
    }
}
