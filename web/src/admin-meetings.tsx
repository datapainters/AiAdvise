/**
 * The two admin surfaces that open over the top of the appointment list: the
 * Meeting Manager an engineer works from during a call, and the client detail
 * popup.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createUser,
  getClientDetail,
  updateClient,
  CLIENT_STATUS_LABEL,
  type ClientStatus,
  listCompanies,
  resendInvite,
  getMeeting,
  saveMeetingNote,
  setAgendaItemStatus,
  setAppointmentStatus,
  addAgendaItem,
  carryOverTopic,
  listTopics,
  type Topic,
  listMeetingParticipants,
  listMeetingShares,
  listThreads,
  type AgendaItem,
  type Person,
  type SharedItem,
  type ClientDetail,
  type CreatedUser,
  type MeetingDetail,
} from './api';
import { formatLength, formatRange, statusLabel } from './scheduling';
import { AccountingTab, TimeTracker } from './billing';
import { getAccount, money, type AccountSummary } from './billing-api';
import { VideoPanel } from './video';
import { PeopleList } from './people';
import { MessagesPanel } from './threads';

/* --------------------------------------------------------------- modal shell */

/**
 * Both overlays share this. Closes on Escape and on a backdrop click, traps
 * nothing else -- it is a panel, not a dialog element, because the Meeting
 * Manager has to stay usable for an hour while someone talks.
 */
export function Modal({
  title,
  badge,
  badgeTone,
  toolbar,
  onClose,
  wide,
  fixed,
  footer,
  children,
}: {
  title: string;
  /** Status word beside the title, as in the reference layout. */
  badge?: string;
  badgeTone?: 'good' | 'warn' | 'bad' | 'neutral';
  /** Action row directly under the title bar. */
  toolbar?: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** One size whatever the content: centred, with the body scrolling inside. */
  fixed?: boolean;
  /** Action row pinned to the bottom edge. */
  footer?: React.ReactNode;
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
    <div className={fixed ? 'modal-backdrop modal-backdrop-fixed' : 'modal-backdrop'} onMouseDown={onClose}>
      <div
        className={fixed ? 'modal modal-fixed' : wide ? 'modal modal-wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <div className="modal-title">
            <h2>{title}</h2>
            {badge && <span className={`pill pill-${badgeTone ?? 'neutral'}`}>{badge}</span>}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </header>
        {toolbar && <div className="modal-toolbar">{toolbar}</div>}
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ summary */

export interface SummaryFigure {
  label: string;
  value: React.ReactNode;
  /** One short line under the figure: what it is made of or why it matters. */
  hint?: React.ReactNode;
  tone?: 'warn' | 'bad' | 'good';
}

/**
 * The band at the top of the client and engagement popups: a row of figures
 * in order of importance, and a line of plain facts beneath. Figures first
 * because they are what changes; the facts are for reference.
 */
export function Summary({
  figures,
  facts,
  compact,
}: {
  figures: SummaryFigure[];
  facts: React.ReactNode[];
  /** Every figure on one short row, with the hint beside the number. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <dl className="summary summary-compact" style={{ ['--cols' as string]: figures.length }}>
        {figures.map((f) => (
          <div key={f.label} className={f.tone ? `summary-figure is-${f.tone}` : 'summary-figure'}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
            {f.hint && <small title={typeof f.hint === 'string' ? f.hint : undefined}>{f.hint}</small>}
          </div>
        ))}
      </dl>
    );
  }
  return (
    <div className="summary">
      {/* Up to four sit in one row; more are set three across so the rows
          stay full and nothing is left as an empty cell. */}
      <dl className="summary-figures" style={{ ['--cols' as string]: figures.length > 4 ? 3 : figures.length }}>
        {figures.map((f) => (
          <div key={f.label} className={f.tone ? `summary-figure is-${f.tone}` : 'summary-figure'}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
            {f.hint && <small>{f.hint}</small>}
          </div>
        ))}
      </dl>
      <ul className="summary-facts">
        {facts.filter(Boolean).map((fact, i) => (
          <li key={i}>{fact}</li>
        ))}
      </ul>
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

/** Adds an item to a meeting's agenda, so there is somewhere to take notes. */
function AddAgendaItem({
  appointmentId,
  engagementId,
  onAgenda,
  onAdded,
  onError,
}: {
  /** The engagement, to offer its other topics. */
  engagementId: number;
  /** Topic ids already on this agenda. */
  onAgenda: number[];
  appointmentId: number;
  onAdded: (item: AgendaItem) => void;
  onError: (e: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [outcome, setOutcome] = useState('');
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<Topic[]>([]);
  const [pick, setPick] = useState('');

  // The engagement's other topics, so one left unfinished in an earlier
  // meeting can be picked up again here.
  useEffect(() => {
    if (!open) return;
    listTopics(engagementId)
      .then(setExisting)
      .catch(() => setExisting([]));
  }, [open, engagementId]);

  const available = existing.filter((t) => !onAgenda.includes(t.id) && t.status !== 'dropped');

  async function bringBack() {
    if (!pick) return;
    setBusy(true);
    try {
      onAdded(await carryOverTopic(appointmentId, Number(pick)));
      setPick('');
      setOpen(false);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onAdded(
        await addAgendaItem(appointmentId, {
          title: title.trim(),
          desiredOutcome: outcome.trim() || undefined,
        }),
      );
      setTitle('');
      setOutcome('');
      setOpen(false);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="tool-toolbar">
        <button onClick={() => setOpen((v) => !v)}>{open ? 'Cancel' : 'Add agenda item'}</button>
      </div>
      {open && available.length > 0 && (
        <div className="stack-form inset">
          <label>
            Continue a topic from this engagement
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Select...</option>
              {available.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} ({t.status === 'proposed' ? 'open' : t.status})
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            Notes taken here are added to the topic&rsquo;s thread beside the notes from its earlier
            meetings.
          </p>
          <div className="button-row">
            <button type="button" className="btn btn-primary" disabled={busy || !pick} onClick={bringBack}>
              Add to agenda
            </button>
          </div>
        </div>
      )}
      {open && (
        <form onSubmit={submit} className="stack-form inset">
          <label>
            {available.length > 0 ? 'Or add a new topic' : 'Topic'}
            <input value={title} required maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Wanted outcome
            <input
              value={outcome}
              placeholder="Optional: what a good result looks like"
              onChange={(e) => setOutcome(e.target.value)}
            />
          </label>
          <div className="button-row">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Adding...' : 'Add to agenda'}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

type MeetingTab = 'agenda' | 'users' | 'time' | 'media';

const MEETING_TAB_LABELS: Record<MeetingTab, string> = {
  agenda: 'Agenda & notes',
  users: 'Users',
  time: 'Time & billing',
  media: 'Media',
};

export function MeetingManager({
  appointmentId,
  onClose,
  onChanged,
  onError,
  onOpenEngagement,
}: {
  appointmentId: number;
  onClose: () => void;
  /** Signals the parent to reload; the row itself comes from the server. */
  onChanged: () => void;
  onError: (e: unknown) => void;
  /** Opens the engagement this meeting belongs to. */
  onOpenEngagement?: (engagementId: number) => void;
}) {
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<MeetingTab>('agenda');
  const [people, setPeople] = useState<Person[]>([]);
  const [shares, setShares] = useState<SharedItem[]>([]);

  useEffect(() => {
    listMeetingParticipants(appointmentId).then(setPeople).catch(onError);
    listMeetingShares(appointmentId).then(setShares).catch(onError);
  }, [appointmentId, onError]);
  // Completing a meeting compiles its time into a charge; the tracker
  // reloads on this key to show the result.
  const [timeKey, setTimeKey] = useState(0);

  useEffect(() => {
    getMeeting(appointmentId)
      .then(setMeeting)
      .catch(onError)
      .finally(() => setLoading(false));
  }, [appointmentId, onError]);

  async function changeStatus(status: string) {
    try {
      const updated = await setAppointmentStatus(appointmentId, status);
      setMeeting((m) => (m ? { ...m, appointment: updated } : m));
      setTimeKey((k) => k + 1);
      onChanged();
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
              <h3>{a.title ?? a.clientName}</h3>
              <p className="muted">
                {a.title && <>{a.clientName} &middot; </>}
                {onOpenEngagement ? (
                  <button className="linklike" onClick={() => onOpenEngagement(a.engagementId)}>
                    {a.engagementTitle}
                  </button>
                ) : (
                  a.engagementTitle
                )}{' '}
                &middot; {formatRange(a.startsAt, a.endsAt)} &middot;{' '}
                {formatLength(a.durationMinutes)}
              </p>
            </div>
            <div className="button-row">
              <span className={`status status-ap-${a.status}`}>{statusLabel(a.status)}</span>
              {a.status === 'requested' && (
                <button onClick={() => changeStatus('confirmed')}>Confirm</button>
              )}
              {a.status !== 'completed' && a.status !== 'cancelled' && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Mark this meeting complete? Recorded time will be compiled into a charge in 30-minute blocks.',
                      )
                    ) {
                      changeStatus('completed');
                    }
                  }}
                >
                  Mark complete
                </button>
              )}
              <button
                className="btn"
                onClick={() => window.open(`/admin/print/meeting/${appointmentId}`, '_blank')}
              >
                Summary report
              </button>
            </div>
          </div>

          <VideoPanel
            appointment={a}
            onError={onError}
            onChanged={() => {
              getMeeting(appointmentId).then(setMeeting).catch(onError);
              onChanged();
            }}
          />

          <div className="tabs" role="tablist">
            {(['agenda', 'users', 'time', 'media'] as MeetingTab[]).map((t) => {
              const count =
                t === 'agenda'
                  ? meeting.agenda.length
                  : t === 'users'
                    ? people.length
                    : t === 'media'
                      ? shares.length
                      : null;
              return (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  className={tab === t ? 'tab tab-on' : 'tab'}
                  onClick={() => setTab(t)}
                >
                  {MEETING_TAB_LABELS[t]}
                  {count !== null && <span className="tab-count">{count}</span>}
                </button>
              );
            })}
          </div>

          {tab === 'time' && (
            <TimeTracker
              appointmentId={appointmentId}
              refreshKey={timeKey}
              onError={onError}
              hasVideo={a.video}
            />
          )}

          {tab === 'users' && (
            <PeopleList
              scope={{ kind: 'meeting', id: appointmentId }}
              people={people}
              clientName={a.clientName}
              onError={onError}
              onChange={setPeople}
            />
          )}

          {tab === 'media' &&
            (shares.length === 0 ? (
              <p className="empty">
                Nothing has been shared in this meeting. Templates, videos and screenshots put on
                screen during the call are listed here afterwards.
              </p>
            ) : (
              <div className="grid-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Type</th>
                      <th>Shared by</th>
                      <th>At</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shares.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.title}</strong>
                        </td>
                        <td>{s.kind === 'pdf' ? 'PDF' : s.kind === 'video' ? 'Video' : 'Image'}</td>
                        <td>{s.sharedByName}</td>
                        <td className="nowrap">
                          {new Date(s.sharedAt).toLocaleTimeString([], {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </td>
                        <td>
                          <a className="linklike" href={s.url} target="_blank" rel="noreferrer">
                            Open
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

          {tab === 'agenda' && a.status !== 'cancelled' && (
            <AddAgendaItem
              appointmentId={appointmentId}
              engagementId={a.engagementId}
              onAgenda={meeting.agenda.map((x) => x.topicId)}
              onError={onError}
              onAdded={(item) =>
                setMeeting((m) => (m ? { ...m, agenda: [...m.agenda, item] } : m))
              }
            />
          )}

          {tab === 'agenda' &&
            (meeting.agenda.length === 0 ? (
              <p className="empty">
                No agenda items yet. Add the first one above; notes are taken against each item.
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
            ))}
        </>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------- client detail */

type DetailTab = 'overview' | 'engagements' | 'appointments' | 'messages' | 'users' | 'accounting';

export function ClientDetailModal({
  clientId,
  onClose,
  onIssued,
  onError,
  onOpenMeeting,
  onToast,
  initialTab,
  showAccounting = true,
  onOpenEngagement,
  onSaved,
}: {
  /** Called after the name, email or status is saved, to refresh the list. */
  onSaved?: () => void;
  /** Opens the Engagement Manager for a row on the Engagements tab. */
  onOpenEngagement?: (engagementId: number) => void;
  /** False for team roles that do not handle billing. */
  showAccounting?: boolean;
  clientId: number;
  onClose: () => void;
  onIssued: (created: CreatedUser) => void;
  onError: (e: unknown) => void;
  onOpenMeeting: (appointmentId: number) => void;
  onToast?: (message: string) => void;
  initialTab?: DetailTab;
}) {
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [companies, setCompanies] = useState<string[]>([]);
  const [tab, setTab] = useState<DetailTab>(initialTab ?? 'overview');
  const [loading, setLoading] = useState(true);

  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [awaitingReply, setAwaitingReply] = useState(0);

  // The two figures that live outside the client record. Both are extras:
  // the popup still opens if either is unavailable.
  useEffect(() => {
    if (showAccounting) {
      getAccount(clientId)
        .then((a) => setAccount(a.summary))
        .catch(() => setAccount(null));
    }
    listThreads({ clientId })
      .then((threads) => setAwaitingReply(threads.filter((t) => t.open && t.lastSide !== 'team').length))
      .catch(() => setAwaitingReply(0));
  }, [clientId, showAccounting]);

  const [inviting, setInviting] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');

  // The editable part of the record. Held apart from `detail` so the Save
  // button can tell whether anything has changed.
  const [name, setName] = useState('');
  const [primaryEmail, setPrimaryEmail] = useState('');
  const [status, setStatus] = useState<ClientStatus>('prospect');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(
    () =>
      getClientDetail(clientId)
        .then((d) => {
          setDetail(d);
          setName(d.name);
          setPrimaryEmail(d.primaryEmail);
          setStatus(d.status);
        })
        .catch(onError),
    [clientId, onError],
  );

  const dirty =
    !!detail &&
    (name.trim() !== detail.name || primaryEmail.trim() !== detail.primaryEmail || status !== detail.status);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setSaving(true);
    try {
      await updateClient(clientId, { name: name.trim(), primaryEmail: primaryEmail.trim(), status });
      await reload();
      onToast?.(`Saved \u201c${name.trim()}\u201d`);
      onSaved?.();
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
    // Suggestions only; a company that does not exist yet is created on save.
    listCompanies().then(setCompanies).catch(() => setCompanies([]));
  }, [reload]);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    try {
      const created = await createUser({
        clientId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        companyName: companyName.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      onIssued(created);
      setFirstName('');
      setLastName('');
      setEmail('');
      setCompanyName('');
      setPhone('');
      setInviting(false);
      await reload();
    } catch (err) {
      onError(err);
    }
  }

  const tabs: DetailTab[] = ['overview', 'engagements', 'appointments', 'messages', 'users'];
  if (showAccounting) tabs.push('accounting');

  const counts: Record<DetailTab, number | null> = {
    overview: null,
    engagements: detail?.engagements.length ?? 0,
    appointments: detail?.appointments.length ?? 0,
    messages: null,
    users: detail?.users.length ?? 0,
    accounting: null,
  };

  const active = detail?.engagements.filter((e) => e.status === 'active').length ?? 0;
  const ahead = (detail?.appointments ?? [])
    .filter(
      (a) => new Date(a.endsAt) > new Date() && a.status !== 'cancelled' && a.status !== 'completed',
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const upcoming = ahead.length;
  const next = ahead[0];
  const toConfirm = ahead.filter((a) => a.status === 'requested').length;
  const openTopics =
    detail?.engagements.reduce((sum, e) => sum + e.openTopics, 0) ?? 0;

  return (
    <Modal
      title={detail?.name ?? 'Client'}
      badge={detail ? CLIENT_STATUS_LABEL[detail.status] : undefined}
      badgeTone={
        detail?.status === 'active'
          ? 'good'
          : detail?.status === 'prospect' || detail?.status === 'on_hold'
            ? 'warn'
            : 'neutral'
      }
      onClose={onClose}
      fixed
      footer={
        <>
          <span className="modal-foot-note">{dirty ? 'Unsaved changes' : ''}</span>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="submit"
            form="client-record-form"
            className="btn btn-primary"
            disabled={!dirty || saving || !name.trim() || !primaryEmail.trim()}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      {loading || !detail ? (
        <p>Loading...</p>
      ) : (
        <>
          {/* Money first where the reader handles it, then what needs doing,
              then what is simply true about the client. */}
          <Summary
            compact
            figures={[
              ...(account
                ? [
                    {
                      label: 'Balance due',
                      value: money(account.balanceCents),
                      hint:
                        account.overdueCents > 0
                          ? `${money(account.overdueCents)} past due`
                          : account.balanceCents > 0
                            ? 'nothing past due'
                            : 'all paid',
                      tone: account.overdueCents > 0 ? ('bad' as const) : undefined,
                    },
                    {
                      label: 'Unbilled',
                      value: money(account.unbilledCents),
                      hint: account.unbilledCents > 0 ? 'ready to invoice' : 'nothing waiting',
                      tone: account.unbilledCents > 0 ? ('warn' as const) : undefined,
                    },
                  ]
                : []),
              {
                label: 'Awaiting reply',
                value: awaitingReply,
                hint: awaitingReply === 1 ? 'conversation' : 'conversations',
                tone: awaitingReply > 0 ? ('warn' as const) : undefined,
              },
              {
                label: 'Next meeting',
                value: next
                  ? new Date(next.startsAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
                  : 'None',
                hint: next
                  ? `${upcoming} upcoming${toConfirm > 0 ? `, ${toConfirm} to confirm` : ''}`
                  : 'nothing booked',
                tone: toConfirm > 0 ? ('warn' as const) : undefined,
              },
              {
                label: 'Active engagements',
                value: active,
                hint: `of ${detail.engagements.length} in total`,
              },
              { label: 'Open topics', value: openTopics, hint: 'not yet on a meeting' },
            ]}
            facts={[
              <>
                Primary contact <strong>{detail.primaryEmail}</strong>
              </>,
              <>
                Client since <strong>{new Date(detail.createdAt).toLocaleDateString()}</strong>
              </>,
              <>
                <strong>{detail.users.length}</strong> portal {detail.users.length === 1 ? 'user' : 'users'}
              </>,
            ]}
          />

          <div className="tabs tabs-classic" role="tablist">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? 'tab tab-on' : 'tab'}
                onClick={() => setTab(t)}
              >
                {t === 'messages' ? 'Topics' : t === 'appointments' ? 'Meetings' : t[0].toUpperCase() + t.slice(1)}
                {counts[t] !== null && <span className="tab-count">{counts[t]}</span>}
              </button>
            ))}
          </div>

          <div className="tab-panel" role="tabpanel">
          {tab === 'overview' && (
            <>
              <form id="client-record-form" className="stack-form record-form" onSubmit={onSave}>
                <div className="field-row">
                  <label>
                    Client name
                    <input value={name} required onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label>
                    Status
                    <select value={status} onChange={(e) => setStatus(e.target.value as ClientStatus)}>
                      {(Object.keys(CLIENT_STATUS_LABEL) as ClientStatus[]).map((v) => (
                        <option key={v} value={v}>
                          {CLIENT_STATUS_LABEL[v]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  Primary email
                  <input
                    type="email"
                    value={primaryEmail}
                    required
                    onChange={(e) => setPrimaryEmail(e.target.value)}
                  />
                </label>
              </form>
              <dl className="detail-list">
                <dt>Added</dt>
                <dd>{new Date(detail.createdAt).toLocaleDateString()}</dd>
                <dt>Engagements</dt>
                <dd>{detail.engagements.length}</dd>
                <dt>Meetings</dt>
                <dd>{detail.appointments.length}</dd>
                <dt>Portal users</dt>
                <dd>{detail.users.length}</dd>
              </dl>
            </>
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
                      <tr
                        key={e.id}
                        className={onOpenEngagement ? 'clickable' : undefined}
                        onClick={onOpenEngagement ? () => onOpenEngagement(e.id) : undefined}
                      >
                        <td>
                          <strong>{e.title}</strong>
                        </td>
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
                  <div className="field-row">
                    <label>
                      First name
                      <input
                        value={firstName}
                        required
                        autoFocus
                        onChange={(e) => setFirstName(e.target.value)}
                      />
                    </label>
                    <label>
                      Last name
                      <input
                        value={lastName}
                        required
                        onChange={(e) => setLastName(e.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    Email address
                    <input
                      type="email"
                      value={email}
                      required
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <div className="field-row">
                    <label>
                      Company
                      {/* Stored as its own record, not a field on the
                          contact: a consultant at a partner firm belongs to
                          this client's portal and to their own employer. */}
                      <input
                        value={companyName}
                        list="known-companies"
                        placeholder={detail.name}
                        onChange={(e) => setCompanyName(e.target.value)}
                      />
                      <datalist id="known-companies">
                        {companies.map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                    </label>
                    <label>
                      Phone
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </label>
                  </div>
                  <p className="hint">
                    They are emailed a single-use link to set their own password.
                    The link is also shown here so you can pass it on yourself.
                  </p>
                  <div className="button-row">
                    <button className="btn btn-primary" type="submit">
                      Send invitation
                    </button>
                    <button
                      type="button"
                      className="linklike"
                      onClick={() => setInviting(false)}
                    >
                      Cancel
                    </button>
                  </div>
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
                        <th>Company</th>
                        <th>Phone</th>
                        <th>Last sign-in</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {detail.users.map((u) => (
                        <tr key={u.id} className={u.enabled ? undefined : 'row-bad'}>
                          <td>
                            <strong>{u.displayName}</strong>
                          </td>
                          <td>{u.email}</td>
                          <td>{u.companyName ?? <span className="muted">&mdash;</span>}</td>
                          <td className="nowrap">
                            {u.phone ?? <span className="muted">&mdash;</span>}
                          </td>
                          <td className="nowrap">
                            {u.lastLoginAt
                              ? new Date(u.lastLoginAt).toLocaleString()
                              : u.mustChangePassword
                                ? 'invited, not yet in'
                                : 'never'}
                          </td>
                          <td>
                            {/* Any link they already hold is cancelled by
                                this, so it doubles as a revoke. */}
                            <button
                              className="linklike"
                              onClick={async () => {
                                try {
                                  onIssued(await resendInvite(u.id));
                                } catch (err) {
                                  onError(err);
                                }
                              }}
                            >
                              {u.lastLoginAt ? 'Send reset link' : 'Resend invite'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === 'messages' && (
            <MessagesPanel
              scope={{ clientId }}
              all
              groupByEngagement
              staff
              onError={onError}
              onOpenMeeting={onOpenMeeting}
              empty="This client has no topics yet. They are collected here from all of its engagements."
            />
          )}

          {tab === 'accounting' && showAccounting && (
            <AccountingTab
              clientId={clientId}
              onError={onError}
              onToast={onToast ?? (() => undefined)}
              onOpenMeeting={onOpenMeeting}
            />
          )}

          </div>
        </>
      )}
    </Modal>
  );
}
