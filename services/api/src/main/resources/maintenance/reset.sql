-- Empties the system of everything except one staff sign-in, and puts the
-- system options back to their defaults. Run by DataReset, in a transaction,
-- once per token. :keep is the id of the account that stays.
--
-- Children before parents, so nothing depends on cascade rules.
DELETE FROM topic_message_attachment;
DELETE FROM topic_message;
DELETE FROM meeting_note;
DELETE FROM meeting_topic;
DELETE FROM meeting_share;
DELETE FROM appointment_participant;
DELETE FROM time_entry;
DELETE FROM video_session;
DELETE FROM payment;
DELETE FROM charge;
DELETE FROM invoice;
DELETE FROM engagement_cost;
DELETE FROM engagement_media;
DELETE FROM engagement_member;
DELETE FROM engagement_note;
DELETE FROM topic;
DELETE FROM appointment;
DELETE FROM engagement;
DELETE FROM media_item;
DELETE FROM invite_token;
DELETE FROM login_event;
UPDATE client SET owner_user_id = NULL;
DELETE FROM app_user WHERE id <> :keep;
DELETE FROM client;
DELETE FROM company;

ALTER SEQUENCE invoice_number_seq RESTART WITH 1;

UPDATE system_option SET updated_at = now(), updated_by = NULL, value = CASE key
    WHEN 'hourly_rate' THEN '0.00'
    WHEN 'payment_terms_days' THEN '30'
    WHEN 'invoice_prefix' THEN 'INV-'
    WHEN 'invoice_notes' THEN 'Thank you for your business. Please include the invoice number with your payment.'
    WHEN 'inquiry_email' THEN ''
    WHEN 'video_cost_per_participant_minute' THEN '0.004'
    WHEN 'business_hours' THEN '{"timezone":"America/Chicago","days":{"mon":{"open":"08:00","close":"18:00"},"tue":{"open":"08:00","close":"18:00"},"wed":{"open":"08:00","close":"18:00"},"thu":{"open":"08:00","close":"18:00"},"fri":{"open":"08:00","close":"18:00"},"sat":null,"sun":null}}'
    ELSE value END;
