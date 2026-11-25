package com.advisory.api.auth;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.server.ResponseStatusException;

/**
 * The team-role authorities a staff account can hold, and the checks built
 * on them.
 *
 * <p>Every staff account has ROLE_ADMIN, which opens the console. Exactly one
 * of these sits beside it:
 *
 * <ul>
 *   <li>{@link #ADMIN} -- everything, including team members and system
 *       options.</li>
 *   <li>{@link #BILLING} -- invoices, payments, charges and the financial
 *       reports, plus the shared workspace.</li>
 *   <li>{@link #RELATIONS} -- clients, engagements, meetings and client
 *       portal logins.</li>
 *   <li>{@link #ENGINEER} -- engagements and meetings: agenda, notes, time
 *       and media.</li>
 * </ul>
 *
 * <p>Money is the only thing fenced off from the last two. Path-level rules
 * live in {@link SecurityConfig}; these helpers cover the cases a path cannot
 * express, such as leaving the billing figures out of a response.
 */
public final class Staff {

    public static final String ADMIN = "TEAM_ADMIN";
    public static final String BILLING = "TEAM_BILLING";
    public static final String RELATIONS = "TEAM_RELATIONS";
    public static final String ENGINEER = "TEAM_ENGINEER";

    private Staff() {}

    /** A staff row with no team role predates V13 and was a full admin. */
    static String authorityFor(String teamRole) {
        return "TEAM_" + (teamRole == null ? AppUser.TEAM_ADMIN : teamRole).toUpperCase();
    }

    public static boolean has(Authentication auth, String... authorities) {
        if (auth == null) {
            return false;
        }
        return auth.getAuthorities().stream().anyMatch(g -> {
            for (String a : authorities) {
                if (a.equals(g.getAuthority())) {
                    return true;
                }
            }
            return false;
        });
    }

    public static boolean seesMoney(Authentication auth) {
        return has(auth, ADMIN, BILLING);
    }

    public static void requireAdmin(Authentication auth) {
        if (!has(auth, ADMIN)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Only an administrator can do that");
        }
    }
}
