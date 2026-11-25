/**
 * Creating a meeting from the console.
 *
 * Clients book their own meetings from the portal; this is for the ones the
 * firm sets up itself. It is opened two ways: from the Meetings list, where
 * the client and then the engagement are chosen first, and from inside an
 * engagement, where both are already known.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createAdminAppointment,
  listAllEngagements,
  type AdminAppointment,
  type AdminEngagement,
  type Client,
} from './api';
import { Modal } from './admin-meetings';
import { formatLength, LENGTH_OPTIONS } from './scheduling';

/** The next half-hour boundary, as a datetime-local value in the browser's zone. */
function nextSlot(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function NewMeetingForm({
  clients,
  engagement,
  onDone,
  onCancel,
  onError,
}: {
  /** Every client, for the first picker. Unused when `engagement` is given. */
  clients: Client[];
  /** Fixes the client and engagement, when opened from inside one. */
  engagement?: { id: number; title: string; clientName: string };
  onDone: (created: AdminAppointment) => void;
  onCancel: () => void;
  onError: (e: unknown) => void;
}) {
  const [engagements, setEngagements] = useState<AdminEngagement[]>([]);
  const [clientId, setClientId] = useState('');
  const [engagementId, setEngagementId] = useState(engagement ? String(engagement.id) : '');
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(nextSlot);
  const [length, setLength] = useState(60);
  const [status, setStatus] = useState<'confirmed' | 'requested'>('confirmed');
  const [billable, setBillable] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (engagement) return;
    listAllEngagements('size=200&sort=title:asc')
      .then((page) => setEngagements(page.rows))
      .catch(onError);
  }, [engagement, onError]);

  // A closed engagement cannot take a new meeting, so it is not offered.
  const choices = useMemo(
    () => engagements.filter((e) => String(e.clientId) === clientId && e.status !== 'closed'),
    [engagements, clientId],
  );

  function pickClient(id: string) {
    setClientId(id);
    const open = engagements.filter((e) => String(e.clientId) === id && e.status !== 'closed');
    // With a single open engagement there is nothing to choose.
    setEngagementId(open.length === 1 ? String(open[0].id) : '');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onDone(
        await createAdminAppointment({
          engagementId: Number(engagementId),
          title: title.trim(),
          startsAt: new Date(when).toISOString(),
          durationMinutes: length,
          status,
          billable,
        }),
      );
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New meeting" onClose={onCancel}>
      <form onSubmit={submit} className="stack-form">
        {engagement ? (
          <dl className="detail-list">
            <dt>Client</dt>
            <dd>{engagement.clientName}</dd>
            <dt>Engagement</dt>
            <dd>{engagement.title}</dd>
          </dl>
        ) : (
          <>
            <label>
              Client
              <select value={clientId} required autoFocus onChange={(e) => pickClient(e.target.value)}>
                <option value="">Select...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Engagement
              <select
                value={engagementId}
                required
                disabled={!clientId || choices.length === 0}
                onChange={(e) => setEngagementId(e.target.value)}
              >
                <option value="">{clientId ? 'Select...' : 'Choose a client first'}</option>
                {choices.map((en) => (
                  <option key={en.id} value={en.id}>
                    {en.title}
                  </option>
                ))}
              </select>
            </label>
            {clientId && choices.length === 0 && (
              <p className="hint">
                This client has no open engagement. Open one from the Engagements list first.
              </p>
            )}
          </>
        )}

        <label>
          Title
          <input
            value={title}
            required
            maxLength={200}
            placeholder="Kickoff, weekly review, vendor demo..."
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="field-row">
          <label>
            Starts
            <input
              type="datetime-local"
              value={when}
              required
              step={1800}
              onChange={(e) => setWhen(e.target.value)}
            />
          </label>
          <label>
            Length
            <select value={length} onChange={(e) => setLength(Number(e.target.value))}>
              {LENGTH_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {formatLength(o)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="hint">
          Starts on the hour or the half hour. A past time is allowed, to record a meeting that has
          already happened.
        </p>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="confirmed">Confirmed: create the video room and tell the client</option>
            <option value="requested">Requested: hold it until confirmed</option>
          </select>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
          Billable. Time recorded in this meeting is charged to the engagement.
        </label>
        <div className="button-row">
          <button className="btn btn-primary" type="submit" disabled={busy || !engagementId}>
            {busy ? 'Creating...' : 'Create meeting'}
          </button>
          <button type="button" className="linklike" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
