package com.advisory.api.billing;

import com.advisory.api.auth.CurrentUser;
import com.advisory.api.billing.BillingService.AccountSummary;
import com.advisory.api.billing.BillingService.ChargeView;
import com.advisory.api.billing.BillingService.InvoiceDetail;
import com.advisory.api.billing.BillingService.InvoiceView;
import com.advisory.api.billing.BillingService.PaymentView;
import com.advisory.api.billing.BillingService.Statement;
import java.time.LocalDate;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Billing as a client sees it: their own invoices, payments, billed time and
 * statement. Always scoped to the client in the caller's token, never to an
 * id in the request.
 *
 * <p>Voided records are left out entirely, and so is anything internal: void
 * reasons, who recorded what, unbilled work still being reviewed.
 */
@RestController
@RequestMapping("/api/billing")
public class ClientBillingController {

    private final BillingService billing;
    private final OptionsService options;

    public ClientBillingController(BillingService billing, OptionsService options) {
        this.billing = billing;
        this.options = options;
    }

    /** A charge as the client sees it. */
    public record BilledItem(Long id, LocalDate serviceDate, String description,
            Integer minutes, Integer blocks, Long rateCents, long amountCents,
            Long invoiceId, String invoiceNumber, Long appointmentId) {

        static BilledItem of(ChargeView c) {
            return new BilledItem(c.id(), c.serviceDate(), c.description(), c.minutes(),
                    c.blocks(), c.rateCents(), c.amountCents(), c.invoiceId(),
                    c.invoiceNumber(), c.appointmentId());
        }
    }

    public record ClientPayment(Long id, LocalDate receivedOn, long amountCents, String method,
            String reference, Long invoiceId, String invoiceNumber) {

        static ClientPayment of(PaymentView p) {
            return new ClientPayment(p.id(), p.receivedOn(), p.amountCents(), p.method(),
                    p.reference(), p.invoiceId(), p.invoiceNumber());
        }
    }

    public record ClientInvoice(Long id, String number, LocalDate issuedOn, LocalDate dueOn,
            long totalCents, long paidCents, long balanceCents, String status,
            int daysOverdue) {

        static ClientInvoice of(InvoiceView i) {
            return new ClientInvoice(i.id(), i.number(), i.issuedOn(), i.dueOn(), i.totalCents(),
                    i.paidCents(), i.balanceCents(), i.status(), i.daysOverdue());
        }
    }

    /**
     * Only invoiced amounts are "due" to a client. Work the firm has not yet
     * invoiced is shown separately as billed time, not as a debt.
     */
    public record ClientSummary(long amountDueCents, long overdueCents, long creditCents,
            long paidCents, long invoicedCents, long notYetInvoicedCents,
            LocalDate nextDueOn, LocalDate lastPaymentOn, int billedMinutes, int billedBlocks) {}

    public record ClientBilling(ClientSummary summary, List<ClientInvoice> invoices,
            List<ClientPayment> payments, List<BilledItem> billed, long hourlyRateCents,
            String paymentInstructions, int paymentTermsDays) {}

    @GetMapping
    public ClientBilling billing(@AuthenticationPrincipal Jwt jwt) {
        Long clientId = CurrentUser.from(jwt).requireClientId();
        BillingService.Account acc = billing.account(clientId);

        List<InvoiceView> invoices = acc.invoices().stream()
                .filter(i -> i.voidedAt() == null).toList();
        List<PaymentView> payments = acc.payments().stream()
                .filter(p -> p.voidedAt() == null).toList();
        List<ChargeView> charges = acc.charges().stream()
                .filter(c -> c.voidedAt() == null).toList();

        AccountSummary s = acc.summary();
        LocalDate nextDue = invoices.stream().filter(i -> i.balanceCents() > 0)
                .map(InvoiceView::dueOn).min(LocalDate::compareTo).orElse(null);
        long invoiced = invoices.stream().mapToLong(InvoiceView::totalCents).sum();

        ClientSummary summary = new ClientSummary(
                Math.max(0, s.invoicedOutstandingCents() - s.creditCents()),
                s.overdueCents(), s.creditCents(), s.paidCents(), invoiced, s.unbilledCents(),
                nextDue, s.lastPaymentOn(),
                charges.stream().mapToInt(c -> c.minutes() == null ? 0 : c.minutes()).sum(),
                charges.stream().mapToInt(c -> c.blocks() == null ? 0 : c.blocks()).sum());

        return new ClientBilling(summary,
                invoices.stream().map(ClientInvoice::of).toList(),
                payments.stream().map(ClientPayment::of).toList(),
                charges.stream().map(BilledItem::of).toList(),
                options.hourlyRateCents(), options.invoiceNotes(), options.paymentTermsDays());
    }

    @GetMapping("/invoices/{id}")
    public InvoiceDetail invoice(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id) {
        Long clientId = CurrentUser.from(jwt).requireClientId();
        InvoiceDetail d = billing.invoiceDetail(id);
        // Someone else's invoice reads as missing, not forbidden.
        if (!d.invoice().clientId().equals(clientId) || d.invoice().voidedAt() != null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return new InvoiceDetail(d.invoice(), d.client(), d.lines(),
                d.payments().stream().filter(p -> p.voidedAt() == null).toList(), d.footer());
    }

    @GetMapping("/statement")
    public Statement statement(@AuthenticationPrincipal Jwt jwt) {
        return billing.statement(CurrentUser.from(jwt).requireClientId());
    }
}
