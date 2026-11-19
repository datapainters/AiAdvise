/**
 * The two admin surfaces that open over the top of the appointment list: the
 * Meeting Manager an engineer works from during a call, and the client detail
 * popup.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createUser,
  getClientDetail,
  getMeeting,
  saveMeetingNote,
  setAgendaItemStatus,
  setAppointmentStatus,
  type AdminAppointment,
  type AgendaItem,
  type ClientDetail,
  type CreatedUser,
  type MeetingDetail,
} from './api';
import { formatLength, formatRange, statusLabel } from './scheduling';

/* --------------------------------------------------------------- modal shell */

/**
 * Both overlays share this. Closes on Escape and on a backdrop click, traps
 * nothing else -- it is a panel, not a dialog element, because the Meeting
 * Manager has to stay usable for an hour while someone talks.
 */
function Modal({
  title,
  onClose,
  wide,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    // Stop the page behind from scrolling under the overlay.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={wide ? 'modal modal-wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ meeting manager */

/**
 * One agenda item with its note field.
 *
 * The note saves on blur and via an explicit button rather than on every
 * keystroke. Someone typing through a live call should not be generating a
 * request per character, and an autosave that fires mid-sentence makes the
 * "saved" indicator meaningless.
 */
function AgendaRow({
  appointmentId,
  item,
  onChanged,
  onError,
}: {
  appointmentId: number;
  item: AgendaItem;
  onChanged: (updated: AgendaItem) => void;
  onError: (e: unknown) => void;
}) {
  const [draft, setDraft] = useState(item.note ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const lastSaved = useRef(item.note ?? '');

  // If the meeting is reloaded underneath us, adopt the server's text unless
  // there are unsaved local edits to lose.
  useEffect(() => {
    const incoming = item.note ?? '';
    if (incoming !== lastSaved.current && draft === lastSaved.current) {
      lastSaved.current = incoming;
      setDraft(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.note]);

  const dirty = draft !== lastSaved.current;

  const save = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const updated = await saveMeetingNote(appointmentId, item.topicId, draft);
      lastSaved.current = updated.note ?? '';
      onChanged(updated);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  }, [appointmentId, draft, dirty, item.topicId, onChanged, onError, saving]);

  async function mark(status: string) {
    try {
      onChanged(await setAgendaItemStatus(appointmentId, item.topicId, status));
    } catch (err) {
      onError(err);
    }
  }

  return (
    <article className={`agenda-item agenda-${item.status}`}>
      <header className="agenda-head">
        <span className="priority">P{item.priority}</span>
        <h3>{item.title}</h3>
        <span className={`status status-${item.status}`}>{item.status}</span>
      </header>

      {item.detail && <p className="topic-detail">{item.detail}</p>}
      {item.desiredOutcome && (
        <p className="topic-outcome">
          <strong>Wanted:</strong> {item.desiredOutcome}
        </p>
      )}

      <label className="note-label">
        Notes
        <textarea
          rows={5}
          value={draft}
          placeholder="What was discussed, what was decided, what happens next."
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
        />
      </label>

      <div className="button-row">
        <button onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving...' : dirty ? 'Save note' : saved ? 'Saved' : 'No changes'}
        </button>
        {item.status !== 'discussed' && (
          <button className="linklike" onClick={() => mark('discussed')}>
            Mark discussed
          </button>
        )}
        {item.status !== 'dropped' && (
          <button className="linklike" onClick={() => mark('dropped')}>
            Drop
          </button>
        )}
        {item.noteUpdatedAt && (
          <span className="muted">
            saved {new Date(item.noteUpdatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
    </article>
  );
}

export function MeetingManager({
  appointmentId,
  onClose,
  onChanged,
  onError,
}: {
  appointmentId: number;
  onClose: () => void;
  onChanged: (a: AdminAppointment) => void;
  onError: (e: unknown) => void;
}) {
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMeeting(appointmentId)
      .then(setMeeting)
      .catch(onError)
      .finally(() => setLoading(false));
  }, [appointmentId, onError]);

  async function changeStatus(status: string) {
    try {
      const updated = await setAppointmentStatus(appointmentId, status);
      onChanged(updated);
      setMeeting((m) => (m ? { ...m, appointment: updated } : m));
      if (status === 'cancelled') onClose();
    } catch (err) {
      onError(err);
    }
  }

  const a = meeting?.appointment;

  return (
    <Modal title="Meeting manager" onClose={onClose} wide>
      {loading || !a ? (
        <p>Loading...</p>
      ) : (
        <>
          <div className="meeting-head">
            <div>
              <h3>{a.clientName}</h3>
              <p className="muted">
                {a.engagementTitle} &middot; {formatRange(a.startsAt, a.endsAt)} &middot;{' '}
                {formatLength(a.durationMinutes)}
              </p>
            </div>
            <div className="button-row">
              <span className={`status status-ap-${a.status}`}>{statusLabel(a.status)}</span>
              {a.status === 'requested' && (
                <button onClick={() => changeStatus('confirmed')}>Confirm</button>
              )}
              {a.status !== 'completed' && a.status !== 'cancelled' && (
                <button onClick={() => changeStatus('completed')}>
                  Mark complete
                </button>
              )}
            </div>
          </div>

          {meeting.agenda.length === 0 ? (
            <p className="empty">
              No agenda items. The client booked this without selecting topics.
            </p>
          ) : (
            <div className="agenda">
              {meeting.agenda.map((item) => (
                <AgendaRow
                  key={item.topicId}
                  appointmentId={appointmentId}
                  item={item}
                  onError={onError}
                  onChanged={(updated) =>
                    setMeeting((m) =>
                      m
                        ? {
                            ...m,
                            agenda: m.agenda.map((x) =>
                              x.topicId === updated.topicId ? updated : x,
                            ),
                          }
                        : m,
                    )
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------- client detail */

type DetailTab = 'overview' | 'engagements' | 'appointments' | 'users' | 'notes';

export function ClientDetailModal({
  clientId,
  onClose,
  onIssued,
  onError,
  onOpenMeeting,
}: {
  clientId: number;
  onClose: () => void;
  onIssued: (created: CreatedUser) => void;
  onError: (e: unknown) => void;
  onOpenMeeting: (appointmentId: number) => void;
}) {
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [tab, setTab] = useState<DetailTab>('overview');
  const [loading, setLoading] = useState(true);

  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  const reload = useCallback(
    () => getClientDetail(clientId).then(setDetail).catch(onError),
    [clientId, onError],
  );

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, [reload]);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    try {
      const created = await createUser({
        clientId,
        email: email.trim(),
        displayName: name.trim(),
      });
      onIssued(created);
      setEmail('');
      setName('');
      setInviting(false);
      await reload();
    } catch (err) {
      onError(err);
    }
  }

  const tabs: DetailTab[] = ['overview', 'engagements', 'appointments', 'users', 'notes'];

  return (
    <Modal title={detail?.name ?? 'Client'} onClose={onClose} wide>
      {loading || !detail ? (
        <p>Loading...</p>
      ) : (
        <>
          <div className="tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? 'tab tab-on' : 'tab'}
                onClick={() => setTab(t)}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <dl className="detail-list">
              <dt>Client</dt>
              <dd>{detail.name}</dd>
              <dt>Primary email</dt>
              <dd>{detail.primaryEmail}</dd>
              <dt>Added</dt>
              <dd>{new Date(detail.createdAt).toLocaleDateString()}</dd>
              <dt>Engagements</dt>
              <dd>{detail.engagements.length}</dd>
              <dt>Meetings</dt>
              <dd>{detail.appointments.length}</dd>
              <dt>Portal logins</dt>
              <dd>{detail.users.length}</dd>
            </dl>
          )}

          {tab === 'engagements' &&
            (detail.engagements.length === 0 ? (
              <p className="empty">No engagements.</p>
            ) : (
              <div className="grid-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Status</th>
                      <th>Started</th>
                      <th>Open topics</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.engagements.map((e) => (
                      <tr key={e.id}>
                        <td>{e.title}</td>
                        <td>
                          <span className={`status status-${e.status}`}>{e.status}</span>
                        </td>
                        <td className="nowrap">{e.startedOn}</td>
                        <td>{e.openTopics}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

          {tab === 'appointments' &&
            (detail.appointments.length === 0 ? (
              <p className="empty">No meetings booked.</p>
            ) : (
              <div className="grid-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Length</th>
                      <th>Engagement</th>
                      <th>Agenda</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.appointments.map((a) => (
                      <tr
                        key={a.id}
                        className="clickable"
                        onClick={() => onOpenMeeting(a.id)}
                      >
                        <td className="nowrap">{formatRange(a.startsAt, a.endsAt)}</td>
                        <td className="nowrap">{formatLength(a.durationMinutes)}</td>
                        <td>{a.engagementTitle}</td>
                        <td>
                          {a.notedCount}/{a.topicCount} noted
                        </td>
                        <td>
                          <span className={`status status-ap-${a.status}`}>
                            {statusLabel(a.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

          {tab === 'users' && (
            <>
              <div className="tool-toolbar">
                <button onClick={() => setInviting((v) => !v)}>
                  {inviting ? 'Cancel' : 'Add user'}
                </button>
              </div>

              {inviting && (
                <form onSubmit={onInvite} className="stack-form inset">
                  <label>
                    Name
                    <input value={name} required onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label>
                    Email
                    <input
                      type="email"
                      value={email}
                      required
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <p className="hint">
                    There is no mail sender wired up yet, so this does not email
                    anyone. You get a one-time password to pass on; they are forced to
                    change it at first sign-in.
                  </p>
                  <button type="submit">Create login</button>
                </form>
              )}

              {detail.users.length === 0 ? (
                <p className="empty">No portal logins for this client.</p>
              ) : (
                <div className="grid-wrap">
                  <table className="grid">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Last sign-in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.users.map((u) => (
                        <tr key={u.id} className={u.enabled ? undefined : 'row-bad'}>
                          <td>{u.displayName}</td>
                          <td>{u.email}</td>
                          <td>{u.role.toLowerCase()}</td>
                          <td className="nowrap">
                            {u.lastLoginAt
                              ? new Date(u.lastLoginAt).toLocaleString()
                              : u.mustChangePassword
                                ? 'invited, not yet in'
                                : 'never'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === 'notes' &&
            (detail.notes.length === 0 ? (
              <p className="empty">No meeting notes yet.</p>
            ) : (
              <div className="notes-list">
                {detail.notes.map((n, i) => (
                  <article key={`${n.appointmentId}-${i}`} className="note-entry">
                    <header>
                      <strong>{n.topicTitle}</strong>
                      <span className="muted">
                        {new Date(n.meetingAt).toLocaleDateString()}
                      </span>
                    </header>
                    <p>{n.body}</p>
                  </article>
                ))}
              </div>
            ))}
        </>
      )}
    </Modal>
  );
}
