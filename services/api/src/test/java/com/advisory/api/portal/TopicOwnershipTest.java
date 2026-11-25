package com.advisory.api.portal;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.advisory.api.auth.AppUser;
import com.advisory.api.auth.CurrentUser;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * The topic privacy rule.
 *
 * <p>Topics are private to the user who created them, including from other
 * users of the same client. That is a change from the original rule, where a
 * topic belonged to an engagement and so to a client -- which meant every
 * user invited under a client could read and close the whole backlog.
 *
 * <p>These assert the predicate itself rather than going through HTTP,
 * because the predicate is the guarantee. A test that needed a database and
 * a token to prove "a colleague cannot read my topic" would be slow enough
 * that it would not be run.
 */
class TopicOwnershipTest {

    private static CurrentUser client(long id, long clientId) {
        return new CurrentUser(id, "u" + id + "@example.com", AppUser.ROLE_CLIENT, clientId);
    }

    private static CurrentUser admin(long id) {
        return new CurrentUser(id, "eng@datapainters.com", AppUser.ROLE_ADMIN, null);
    }

    private static Topic topicOwnedBy(Long userId) {
        Topic t = new Topic();
        t.setEngagementId(1L);
        t.setTitle("Migration cutover plan");
        t.setCreatedByUserId(userId);
        return t;
    }

    @Test
    @DisplayName("the creator may act on their own topic")
    void ownerAllowed() {
        assertDoesNotThrow(
                () -> TopicController.requireOwnership(client(7L, 3L), topicOwnedBy(7L)));
    }

    @Test
    @DisplayName("a colleague at the same client is refused, and told nothing")
    void colleagueRefused() {
        // Users 7 and 8 share client 3. Sharing a client is exactly the
        // condition the old rule treated as sufficient.
        ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> TopicController.requireOwnership(client(8L, 3L), topicOwnedBy(7L)));

        assertEquals(HttpStatus.NOT_FOUND, e.getStatusCode());
        // A 403 here would confirm the topic exists. With sequential ids that
        // is enough to count a colleague's topics without reading one.
        assertEquals(null, e.getReason());
    }

    @Test
    @DisplayName("an unowned legacy row is refused for every client user")
    void nullCreatorRefusedForClients() {
        // V8 could not attribute topics written before the column existed
        // where the client had no users. Null must not read as a wildcard:
        // `user.id().equals(null)` is false, and that is load-bearing.
        assertThrows(ResponseStatusException.class,
                () -> TopicController.requireOwnership(client(7L, 3L), topicOwnedBy(null)));
        assertThrows(ResponseStatusException.class,
                () -> TopicController.requireOwnership(client(8L, 3L), topicOwnedBy(null)));
    }

    @Test
    @DisplayName("an admin may act on anyone's topic, including an unowned one")
    void adminUnscoped() {
        // The engineer taking the call needs the whole agenda, whoever on the
        // client side typed each item.
        assertDoesNotThrow(
                () -> TopicController.requireOwnership(admin(1L), topicOwnedBy(7L)));
        assertDoesNotThrow(
                () -> TopicController.requireOwnership(admin(1L), topicOwnedBy(null)));
    }

    @Test
    @DisplayName("ownership is by user id, not by client")
    void clientIdIsNotEnough() {
        // Same user id, different client: still allowed, because the client
        // check is a separate layer (requireAccess) and this one is only
        // about authorship. Both run on every path; neither is sufficient
        // alone, and this test pins down which question this one answers.
        assertDoesNotThrow(
                () -> TopicController.requireOwnership(client(7L, 99L), topicOwnedBy(7L)));
    }
}
