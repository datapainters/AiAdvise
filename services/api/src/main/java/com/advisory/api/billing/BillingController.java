package com.advisory.api.billing;

import com.advisory.api.admin.Grid;
import com.advisory.api.auth.CurrentUser;
import com.advisory.api.billing.BillingService.Account;
import com.advisory.api.billing.BillingService.AgingReport;
import com.advisory.api.billing.BillingService.ChargeView;
import com.advisory.api.billing.BillingService.InvoiceDetail;
import com.advisory.api.billing.BillingService.InvoiceView;
import com.advisory.api.billing.BillingService.MeetingSummary;
import com.advisory.api.billing.BillingService.PaymentView;
import com.advisory.api.billing.BillingService.RevenueReport;
import com.advisory.api.billing.BillingService.Snapshot;
import com.advisory.api.billing.BillingService.Statement;
import com.advisory.api.billing.BillingService.TimeSheet;
import com.advisory.api.billing.BillingService.UnbilledReport;
import com.advisory.api.billing.OptionsService.Option;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Admin endpoints for system options, meeting time, billing and reports.
 * ROLE_ADMIN is enforced for all of {@code /api/admin} in the filter chain.
 *
 * <p>Money crosses the wire two ways: responses carry integer cents
 * ({@code ...Cents}); requests take a decimal dollar amount, parsed here
 * once, so the client never does cents arithmetic on user input.
 */
@RestController
@RequestMapping("/api/admin")
public class BillingController {

    private final BillingService billing;
    private final OptionsService options;

    public BillingController(BillingService billing, OptionsService options) {
        this.billing = billing;
        this.options = options;
    }

    /* ------------------------------------------------------------ options */

    public record UpdateOption(String value) {}

    @GetMapping("/options")
    public List<Option> options() {
        return options.all();
    }

    @PutMapping("/options/{key}")
    public Option updateOption(@AuthenticationPrincipal Jwt jwt, @PathVariable String key,
            @RequestBody UpdateOption request) {
        return options.update(key, request.value(), CurrentUser.from(jwt).id());
    }

    /* --------------------------------------------------------------- time */

    public record AddTime(@NotNull Integer minutes, String note) {}

    @GetMapping("/appointments/{id}/time")
    public TimeSheet time(@PathVariable Long id) {
        return billing.timeSheet(id);
    }

    @PostMapping("/appointments/{id}/time/start")
    public TimeSheet start(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id) {
        return billing.startTimer(id, CurrentUser.from(jwt).id());
    }

    @PostMapping("/appointments/{id}/time/stop")
    public TimeSheet stop(@PathVariable Long id) {
        return billing.stopTimer(id);
    }

    @PostMapping("/appointments/{id}/time")
    public TimeSheet addTime(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id,
            @Valid @RequestBody AddTime request) {
        return billing.addTime(id, request.minutes(), request.note(),
                CurrentUser.from(jwt).id());
    }

    @DeleteMapping("/time/{entryId}")
    public TimeSheet deleteTime(@PathVariable Long entryId) {
        return billing.deleteTime(entryId);
    }

    @GetMapping("/appointments/{id}/summary")
    public MeetingSummary summary(@PathVariable Long id) {
        return billing.meetingSummary(id);
    }

    /* ------------------------------------------------------------ account */

    @GetMapping("/clients/{id}/account")
    public Account account(@PathVariable Long id) {
        return billing.account(id);
    }

    @GetMapping("/clients/{id}/statement")
    public Statement statement(@PathVariable Long id) {
        return billing.statement(id);
    }

    public record AddAdjustment(String description, @NotNull String amount,
            LocalDate serviceDate) {}

    @PostMapping("/clients/{id}/charges")
    @ResponseStatus(HttpStatus.CREATED)
    public ChargeView addAdjustment(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id,
            @Valid @RequestBody AddAdjustment request) {
        return billing.addAdjustment(id, request.description(), cents(request.amount(), true),
                request.serviceDate(), CurrentUser.from(jwt).id());
    }

    public record VoidRequest(String reason) {}

    @PostMapping("/charges/{id}/void")
    public void voidCharge(@PathVariable Long id, @RequestBody(required = false) VoidRequest r) {
        billing.voidCharge(id, r == null ? null : r.reason());
    }

    /* ----------------------------------------------------------- invoices */

    public record CreateInvoice(List<Long> chargeIds, LocalDate issuedOn, String notes) {}

    private static Grid.Spec<InvoiceView> invoiceSpec() {
        return new Grid.Spec<InvoiceView>()
                .add("number", "Invoice", "text", InvoiceView::number)
                .add("clientName", "Client", "text", InvoiceView::clientName)
                .add("issuedOn", "Issued", "date", InvoiceView::issuedOn)
                .add("dueOn", "Due", "date", InvoiceView::dueOn)
                .add("totalCents", "Total (cents)", "number", InvoiceView::totalCents)
                .add("balanceCents", "Balance (cents)", "number", InvoiceView::balanceCents)
                .add("status", "Status", "text", InvoiceView::status);
    }

    @GetMapping("/invoices/columns")
    public List<Grid.Column> invoiceColumns() {
        return invoiceSpec().columns();
    }

    @GetMapping("/invoices")
    public Grid.Page<InvoiceView> invoices(
            @RequestParam(name = "filter", required = false) List<String> filter,
            @RequestParam(defaultValue = "issuedOn:desc") String sort,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size) {
        return Grid.apply(billing.invoices(null), invoiceSpec().accessors(),
                Grid.parse(filter), sort, page, size);
    }

    @GetMapping("/invoices/{id}")
    public InvoiceDetail invoice(@PathVariable Long id) {
        return billing.invoiceDetail(id);
    }

    @PostMapping("/clients/{id}/invoices")
    @ResponseStatus(HttpStatus.CREATED)
    public InvoiceView createInvoice(@AuthenticationPrincipal Jwt jwt, @PathVariable Long id,
            @RequestBody(required = false) CreateInvoice request) {
        CreateInvoice r = request == null ? new CreateInvoice(null, null, null) : request;
        return billing.createInvoice(id, r.chargeIds(), r.issuedOn(), r.notes(),
                CurrentUser.from(jwt).id());
    }

    @PostMapping("/invoices/{id}/void")
    public InvoiceView voidInvoice(@PathVariable Long id,
            @RequestBody(required = false) VoidRequest r) {
        return billing.voidInvoice(id, r == null ? null : r.reason());
    }

    /* ----------------------------------------------------------- payments */

    public record RecordPayment(@NotNull Long clientId, Long invoiceId, LocalDate receivedOn,
            @NotNull String amount, @NotNull String method, String reference, String note) {}

    private static Grid.Spec<PaymentView> paymentSpec() {
        return new Grid.Spec<PaymentView>()
                .add("receivedOn", "Received", "date", PaymentView::receivedOn)
                .add("clientName", "Client", "text", PaymentView::clientName)
                .add("invoiceNumber", "Invoice", "text", PaymentView::invoiceNumber)
                .add("method", "Method", "text", PaymentView::method)
                .add("reference", "Reference", "text", PaymentView::reference)
                .add("amountCents", "Amount (cents)", "number", PaymentView::amountCents);
    }

    @GetMapping("/payments/columns")
    public List<Grid.Column> paymentColumns() {
        return paymentSpec().columns();
    }

    @GetMapping("/payments")
    public Grid.Page<PaymentView> payments(
            @RequestParam(name = "filter", required = false) List<String> filter,
            @RequestParam(defaultValue = "receivedOn:desc") String sort,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size) {
        return Grid.apply(billing.payments(null), paymentSpec().accessors(),
                Grid.parse(filter), sort, page, size);
    }

    @PostMapping("/payments")
    @ResponseStatus(HttpStatus.CREATED)
    public PaymentView recordPayment(@AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody RecordPayment r) {
        return billing.recordPayment(r.clientId(), r.invoiceId(), r.receivedOn(),
                cents(r.amount(), false), r.method(), r.reference(), r.note(),
                CurrentUser.from(jwt).id());
    }

    @PostMapping("/payments/{id}/void")
    public void voidPayment(@PathVariable Long id, @RequestBody(required = false) VoidRequest r) {
        billing.voidPayment(id, r == null ? null : r.reason());
    }

    /* ------------------------------------------------------------ reports */

    @GetMapping("/reports/aging")
    public AgingReport aging() {
        return billing.aging();
    }

    @GetMapping("/reports/revenue")
    public RevenueReport revenue(@RequestParam(required = false) LocalDate from,
            @RequestParam(required = false) LocalDate to) {
        return billing.revenue(from, to);
    }

    @GetMapping("/reports/unbilled")
    public UnbilledReport unbilled() {
        return billing.unbilled();
    }

    @GetMapping("/billing/snapshot")
    public Snapshot snapshot() {
        return billing.snapshot();
    }

    /* ------------------------------------------------------------ helpers */

    /** "1,250.5" -> 125050. Negative allowed only where a credit makes sense. */
    static long cents(String raw, boolean allowNegative) {
        String s = raw == null ? "" : raw.trim().replace("$", "").replace(",", "");
        try {
            BigDecimal d = new BigDecimal(s);
            if (d.scale() > 2) {
                throw new NumberFormatException();
            }
            if (!allowNegative && d.signum() < 0) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Amount must be positive");
            }
            if (d.abs().compareTo(new BigDecimal("10000000")) >= 0) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Amount is too large");
            }
            return d.movePointRight(2).longValueExact();
        } catch (NumberFormatException | ArithmeticException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Enter an amount like 150 or 150.00");
        }
    }
}
