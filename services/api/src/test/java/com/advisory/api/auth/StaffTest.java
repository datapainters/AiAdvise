package com.advisory.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.web.server.ResponseStatusException;

class StaffTest {

    private static Authentication staff(String teamAuthority) {
        return new TestingAuthenticationToken("u", "p",
                List.of(new org.springframework.security.core.authority.SimpleGrantedAuthority(
                                "ROLE_ADMIN"),
                        new org.springframework.security.core.authority.SimpleGrantedAuthority(
                                teamAuthority)));
    }

    @Test
    void aStaffRowWithNoTeamRolePredatesTheSplitAndIsAnAdministrator() {
        assertThat(Staff.authorityFor(null)).isEqualTo(Staff.ADMIN);
    }

    @Test
    void eachTeamRoleMapsToItsOwnAuthority() {
        assertThat(Staff.authorityFor(AppUser.TEAM_ADMIN)).isEqualTo(Staff.ADMIN);
        assertThat(Staff.authorityFor(AppUser.TEAM_BILLING)).isEqualTo(Staff.BILLING);
        assertThat(Staff.authorityFor(AppUser.TEAM_RELATIONS)).isEqualTo(Staff.RELATIONS);
        assertThat(Staff.authorityFor(AppUser.TEAM_ENGINEER)).isEqualTo(Staff.ENGINEER);
    }

    @Test
    void onlyAdministratorsAndBillingSeeMoney() {
        assertThat(Staff.seesMoney(staff(Staff.ADMIN))).isTrue();
        assertThat(Staff.seesMoney(staff(Staff.BILLING))).isTrue();
        assertThat(Staff.seesMoney(staff(Staff.RELATIONS))).isFalse();
        assertThat(Staff.seesMoney(staff(Staff.ENGINEER))).isFalse();
        assertThat(Staff.seesMoney(null)).isFalse();
    }

    @Test
    void requireAdminRefusesEveryOtherRole() {
        Staff.requireAdmin(staff(Staff.ADMIN));
        for (String other : List.of(Staff.BILLING, Staff.RELATIONS, Staff.ENGINEER)) {
            assertThatThrownBy(() -> Staff.requireAdmin(staff(other)))
                    .isInstanceOf(ResponseStatusException.class);
        }
    }
}
