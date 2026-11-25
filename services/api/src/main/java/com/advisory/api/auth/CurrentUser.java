package com.advisory.api.auth;

import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;

/**
 * The caller, as asserted by their verified token.
 *
 * <p>Every field here comes from a signature-checked JWT, never from a
 * request parameter. That distinction is the whole point: the previous
 * version of the portal took an engagement id from the caller and trusted
 * it, which let any client read any other client's topics.
 */
public record CurrentUser(Long id, String email, String role, Long clientId) {

    public static CurrentUser from(Jwt jwt) {
        if (jwt == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }

        Object cid = jwt.getClaim("cid");

        return new CurrentUser(
                Long.valueOf(jwt.getSubject()),
                jwt.getClaimAsString("email"),
                jwt.getClaimAsString("role"),
                cid == null ? null : ((Number) cid).longValue());
    }

    public boolean isAdmin() {
        return AppUser.ROLE_ADMIN.equals(role);
    }

    /**
     * The client this user is scoped to, or a 403 for a client user whose
     * token somehow carries no client. Admins have no single client and must
     * not call this.
     */
    public Long requireClientId() {
        if (clientId == null) {
            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN, "This account is not linked to a client");
        }
        return clientId;
    }
}
