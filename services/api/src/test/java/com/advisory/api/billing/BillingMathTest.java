package com.advisory.api.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

/** The billing rule: time rounds up to 30-minute blocks at half the hourly rate each. */
class BillingMathTest {

    @Test
    void roundsUpToWholeBlocks() {
        assertThat(BillingService.blocksFor(0)).isZero();
        assertThat(BillingService.blocksFor(1)).isEqualTo(1);
        assertThat(BillingService.blocksFor(30)).isEqualTo(1);
        assertThat(BillingService.blocksFor(31)).isEqualTo(2);
        assertThat(BillingService.blocksFor(95)).isEqualTo(4);
    }

    @Test
    void eachBlockIsHalfTheHourlyRate() {
        assertThat(BillingService.amountFor(25_000, 4)).isEqualTo(50_000);
        assertThat(BillingService.amountFor(25_000, 1)).isEqualTo(12_500);
        assertThat(BillingService.amountFor(0, 3)).isZero();
    }

    @Test
    void oddCentRatesRoundHalfUp() {
        // $199.99/h for one block is $99.995, billed as $100.00.
        assertThat(BillingService.amountFor(19_999, 1)).isEqualTo(10_000);
    }

    @Test
    void parsesDollarInput() {
        assertThat(BillingController.cents("150", false)).isEqualTo(15_000);
        assertThat(BillingController.cents("$1,250.50", false)).isEqualTo(125_050);
        assertThat(BillingController.cents("-50", true)).isEqualTo(-5_000);
    }

    @Test
    void rejectsBadAmounts() {
        assertThatThrownBy(() -> BillingController.cents("-50", false))
                .isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> BillingController.cents("12.345", false))
                .isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> BillingController.cents("abc", false))
                .isInstanceOf(ResponseStatusException.class);
    }
}
