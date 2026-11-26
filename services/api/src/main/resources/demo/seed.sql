-- Demo data for the development site: enough rows that every list and every
-- tab inside a record runs to several pages. Run once, by DemoDataSeeder,
-- only where SEED_DEMO_DATA is on. Everything it creates hangs off a client
-- whose email ends in @demo.datapainters.test, so it can be told apart from
-- records entered by hand, and removed by deleting those clients' rows.
--
-- "Paging Test Co" is the heavy record: dozens of engagements, users,
-- meetings, topics, charges, invoices and payments on one client, with one
-- engagement, one meeting and one topic loaded up the same way.
DO $$
DECLARE
    staff      BIGINT;
    names_a    TEXT[] := ARRAY['Northwind','Bluepeak','Harbor','Ironwood','Juniper','Keystone','Lakeshore',
                               'Meridian','Oakline','Pinecrest','Quarry','Redfern','Summit','Tidewater','Upland'];
    names_b    TEXT[] := ARRAY['Logistics','Health','Foods','Capital','Robotics','Energy','Retail','Insurance'];
    eng_titles TEXT[] := ARRAY['Data platform review','Forecasting pilot','Support triage assistant',
                               'Contract analysis','Reporting modernisation','Knowledge search'];
    topic_titles TEXT[] := ARRAY['Source system inventory','Data quality baseline','Model evaluation plan',
                               'Access and security','Cost estimate','Rollout plan','Vendor shortlist',
                               'Success measures','Training for the team'];
    roles_c    TEXT[] := ARRAY['sponsor','project_owner','technical','billing_contact','stakeholder'];
    c          INT;
    e          INT;
    t          INT;
    m          INT;
    u          INT;
    heavy      BOOLEAN;
    cid        BIGINT;
    owner_id   BIGINT;
    uid        BIGINT;
    eid        BIGINT;
    tid        BIGINT;
    aid        BIGINT;
    chid       BIGINT;
    invid      BIGINT;
    n_eng      INT;
    n_users    INT;
    n_meet     INT;
    n_topics   INT;
    starts     TIMESTAMPTZ;
    st         TEXT;
    inv_no     INT := 0;
    topic_ids  BIGINT[];
    user_ids   BIGINT[];
    eng_status TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM client WHERE primary_email LIKE '%@demo.datapainters.test') THEN
        RETURN;
    END IF;

    SELECT min(id) INTO staff FROM app_user WHERE role = 'ADMIN';

    FOR c IN 1..60 LOOP
        heavy := (c = 1);
        INSERT INTO client (name, primary_email, contact_name, source, status, created_at)
        VALUES (CASE WHEN heavy THEN 'Paging Test Co'
                     ELSE names_a[1 + (c % 15)] || ' ' || names_b[1 + (c % 8)] || ' ' || lpad(c::text, 2, '0') END,
                'client' || c || '@demo.datapainters.test',
                'Contact ' || c,
                'admin',
                (ARRAY['active','active','prospect','on_hold','former'])[1 + (c % 5)],
                now() - make_interval(days => 400 - c * 5))
        RETURNING id INTO cid;

        n_users := CASE WHEN heavy THEN 32 ELSE 3 END;
        user_ids := ARRAY[]::BIGINT[];
        FOR u IN 1..n_users LOOP
            -- '!' is not a password hash, so none of these accounts can sign in.
            INSERT INTO app_user (client_id, email, password_hash, display_name, first_name, last_name,
                                  role, enabled, must_change_password, client_role)
            VALUES (cid, 'user' || u || '.client' || c || '@demo.datapainters.test', '!',
                    'Person ' || u || ' of ' || c, 'Person ' || u, 'Client ' || c,
                    'CLIENT', TRUE, TRUE,
                    CASE WHEN u = 1 THEN 'owner' WHEN u = 2 THEN 'manager' ELSE 'member' END)
            RETURNING id INTO uid;
            user_ids := user_ids || uid;
            IF u = 1 THEN owner_id := uid; END IF;
        END LOOP;
        UPDATE client SET owner_user_id = owner_id WHERE id = cid;

        n_eng := CASE WHEN heavy THEN 36 ELSE 2 + (c % 3) END;
        FOR e IN 1..n_eng LOOP
            eng_status := (ARRAY['active','active','active','paused','closed','inquiry'])[1 + ((c + e) % 6)];
            INSERT INTO engagement (client_id, title, status, started_on, due_on, goal, communication,
                                    created_by_user_id, closed_on, closure_notes)
            VALUES (cid,
                    eng_titles[1 + ((c + e) % 6)] || CASE WHEN heavy THEN ' ' || e ELSE '' END,
                    eng_status,
                    current_date - (200 - e * 4),
                    current_date + ((c * 7 + e * 11) % 120) - 30,
                    'Agree the approach, prove it on a small scope, and hand over something the team can run.',
                    (ARRAY['both','video','message'])[1 + (e % 3)],
                    owner_id,
                    CASE WHEN eng_status = 'closed' THEN current_date - 10 END,
                    CASE WHEN eng_status = 'closed' THEN 'Delivered and handed over.' END)
            RETURNING id INTO eid;

            -- Team: the client's people, plus one of ours.
            FOR u IN 1..(CASE WHEN heavy AND e = 1 THEN 30 ELSE 2 END) LOOP
                INSERT INTO engagement_member (engagement_id, user_id, role)
                VALUES (eid, user_ids[u], roles_c[1 + (u % 5)]);
            END LOOP;
            IF staff IS NOT NULL THEN
                INSERT INTO engagement_member (engagement_id, user_id, role) VALUES (eid, staff, 'lead');
            END IF;

            n_topics := CASE WHEN heavy AND e = 1 THEN 45 ELSE 4 + (e % 4) END;
            topic_ids := ARRAY[]::BIGINT[];
            FOR t IN 1..n_topics LOOP
                INSERT INTO topic (engagement_id, title, detail, priority, status, created_by_user_id,
                                   created_at, updated_at)
                VALUES (eid, topic_titles[1 + (t % 9)] || CASE WHEN n_topics > 9 THEN ' ' || t ELSE '' END,
                        'What we know so far, and what we need decided.',
                        1 + (t % 5), 'proposed', owner_id,
                        now() - make_interval(days => 60 - t), now() - make_interval(days => 60 - t))
                RETURNING id INTO tid;
                topic_ids := topic_ids || tid;

                -- A conversation on the first topics of each engagement; a long
                -- one on the heavy engagement's first topic.
                IF t <= 2 THEN
                    FOR m IN 1..(CASE WHEN heavy AND e = 1 AND t = 1 THEN 26 ELSE 3 END) LOOP
                        INSERT INTO topic_message (topic_id, author_user_id, author_side, body, created_at)
                        VALUES (tid,
                                CASE WHEN m % 2 = 1 THEN owner_id ELSE staff END,
                                CASE WHEN m % 2 = 1 THEN 'client' ELSE 'team' END,
                                CASE WHEN m % 2 = 1 THEN 'Here is where we have got to, message ' || m || '.'
                                     ELSE 'Thanks. Our view on that, message ' || m || '.' END,
                                now() - make_interval(days => 30, hours => -m));
                    END LOOP;
                END IF;
            END LOOP;

            IF heavy AND e = 1 THEN
                FOR m IN 1..14 LOOP
                    INSERT INTO engagement_note (engagement_id, body, author_user_id, created_at, updated_at)
                    VALUES (eid, 'Internal note ' || m || ': where things stand and what is next.', staff,
                            now() - make_interval(days => 40 - m), now() - make_interval(days => 40 - m));
                END LOOP;
            END IF;

            -- Meetings: most in the past and completed, the rest ahead.
            n_meet := CASE WHEN heavy AND e = 1 THEN 42 ELSE 1 + (e % 3) END;
            FOR m IN 1..n_meet LOOP
                IF m <= n_meet * 2 / 3 OR n_meet = 1 THEN
                    starts := date_trunc('day', now()) - make_interval(days => 3 + m * 3 + (c % 5))
                              + make_interval(hours => 14 + (m % 4));
                    st := CASE WHEN m % 9 = 0 THEN 'cancelled' ELSE 'completed' END;
                ELSE
                    starts := date_trunc('day', now()) + make_interval(days => 2 + m + (c % 20))
                              + make_interval(hours => 15 + (m % 3), mins => 30 * (m % 2));
                    st := CASE WHEN m % 2 = 0 THEN 'confirmed' ELSE 'requested' END;
                END IF;

                INSERT INTO appointment (client_id, engagement_id, starts_at, duration_minutes, status,
                                         requested_by, billable, title)
                VALUES (cid, eid, starts, 30 * (1 + (m % 3)), st, owner_id, TRUE,
                        (ARRAY['Kickoff','Working session','Review','Decision meeting'])[1 + (m % 4)] || ' ' || m)
                RETURNING id INTO aid;

                -- Agenda: a few of the engagement's topics; many on one meeting.
                FOR t IN 1..least(array_length(topic_ids, 1),
                                  CASE WHEN heavy AND e = 1 AND m = 1 THEN 18 ELSE 3 END) LOOP
                    INSERT INTO meeting_topic (appointment_id, topic_id) VALUES (aid, topic_ids[t]);
                    IF st = 'completed' THEN
                        INSERT INTO meeting_note (appointment_id, topic_id, body, author_user_id)
                        VALUES (aid, topic_ids[t], 'Discussed in meeting ' || m || '. Agreed the next step.', staff);
                    END IF;
                END LOOP;

                FOR u IN 1..(CASE WHEN heavy AND e = 1 AND m = 1 THEN 24 ELSE 2 END) LOOP
                    INSERT INTO appointment_participant (appointment_id, user_id, role, attending, send_summary)
                    VALUES (aid, user_ids[u], roles_c[1 + (u % 5)], TRUE, u <= 2);
                END LOOP;
                IF staff IS NOT NULL THEN
                    INSERT INTO appointment_participant (appointment_id, user_id, role) VALUES (aid, staff, 'lead');
                END IF;

                IF st = 'completed' THEN
                    FOR u IN 1..(CASE WHEN heavy AND e = 1 AND m = 1 THEN 14 ELSE 1 END) LOOP
                        INSERT INTO time_entry (appointment_id, started_at, minutes, note, user_id, source)
                        VALUES (aid, starts + make_interval(mins => u), CASE WHEN u = 1 THEN 60 ELSE 5 END,
                                'Recorded for the demo data', staff, 'manual');
                    END LOOP;

                    INSERT INTO charge (client_id, engagement_id, appointment_id, kind, description,
                                        service_date, minutes, blocks, rate_cents, amount_cents, created_by)
                    VALUES (cid, eid, aid, 'meeting', 'Meeting ' || m || ' on ' || to_char(starts, 'Mon DD'),
                            starts::date, 60, 2, 20000, 20000, staff)
                    RETURNING id INTO chid;

                    -- Invoice two charges in three, and pay about half of those,
                    -- so balances, unbilled work and overdue invoices all appear.
                    IF (c + e + m) % 3 <> 0 THEN
                        inv_no := inv_no + 1;
                        INSERT INTO invoice (number, client_id, issued_on, due_on, total_cents, created_by)
                        VALUES ('DEMO-' || lpad(inv_no::text, 4, '0'), cid, starts::date + 2,
                                starts::date + 32, 20000, staff)
                        RETURNING id INTO invid;
                        UPDATE charge SET invoice_id = invid WHERE id = chid;
                        IF (c + e + m) % 2 = 0 THEN
                            INSERT INTO payment (client_id, invoice_id, received_on, amount_cents, method,
                                                 reference, created_by)
                            VALUES (cid, invid, starts::date + 12, 20000,
                                    (ARRAY['ach','wire','check','card'])[1 + (m % 4)],
                                    'DEMO-PAY-' || inv_no, staff);
                        END IF;
                    END IF;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
END $$;
