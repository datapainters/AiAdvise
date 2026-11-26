/**
 * The Engagement Manager and the Team screen.
 *
 * An engagement exists to meet one need. Everything that happens on the way
 * there -- the meetings, what was agreed in them, what was shown on screen,
 * the time spent and what it was billed at -- is collected in one popup so
 * progress towards the goal can be read without visiting five screens.
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  addEngagementNote,
  attachLibraryItem,
  deleteEngagementNote,
  editEngagementNote,
  removeEngagementFile,
  chargeMessageTime,
  COMMUNICATION_LABELS,
  closeEngagement,
  type Communication,
  uploadEngagementFile,
  getEngagementDetail,
  inviteTeamMember,
  invoiceEngagement,
  listTeam,
  resendInvite,
  updateEngagement,
  updateTeamMember,
  type CreatedUser,
  type EngagementDetail,
  type EngagementNote,
  type TeamMember,
} from './api';
import { listMedia, type MediaItem } from './billing-api';
import { NewMeetingForm } from './meeting-form';
import { MessagesPanel } from './threads';
import { Modal, Summary } from './admin-meetings';
import { TEAM_ROLE_LABELS, type TeamRole, type User } from './auth';
import { money } from './billing-api';
import { PeopleList } from './people';
import { formatLength, formatRange, statusLabel } from './scheduling';

type OnError = (e: unknown) => void;

function hours(minutes: number): string {
  if (minutes === 0) return '0 h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** How far off the target date is, in words. */
function dueHint(detail: EngagementDetail): string {
  if (!detail.dueOn) return 'open-ended';
  if (detail.status === 'closed') return 'engagement closed';
  const days = Math.round(
    (new Date(`${detail.dueOn}T00:00`).getTime() - new Date(`${today()}T00:00`).getTime()) / 86_400_000,
  );
  if (days < 0) return `${-days} ${days === -1 ? 'day' : 'days'} past due`;
  if (days === 0) return 'due today';
  return `${days} ${days === 1 ? 'day' : 'days'} left`;
}

/** Today as YYYY-MM-DD in the browser's zone, for comparing with date fields. */
function today(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function day(iso: string): string {
  // A bare date has no zone; parsed as-is it is read as UTC midnight and
  // shows as the day before anywhere west of Greenwich.
  const value = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00` : iso;
  return new Date(value).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

/* -------------------------------------------------------- engagement manager */

type Tab = 'overview' | 'meetings' | 'messages' | 'notes' | 'media' | 'team' | 'billing';

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  meetings: 'Meetings',
  messages: 'Topics',
  notes: 'Notes',
  media: 'Media',
  team: 'Team',
  billing: 'Billing',
};

const STATUS_TONE: Record<string, 'good' | 'warn' | 'neutral'> = {
  active: 'good',
  inquiry: 'warn',
  paused: 'neutral',
  closed: 'neutral',
};

export function EngagementManager({
  engagementId,
  onClose,
  onChanged,
  onError,
  onOpenMeeting,
  onOpenInvoice,
  onOpenClient,
  onToast,
}: {
  /** Opens the client record this engagement belongs to. */
  onOpenClient?: (clientId: number) => void;
  engagementId: number;
  onClose: () => void;
  /** Tells the list behind to reload after an edit. */
  onChanged: () => void;
  onError: OnError;
  onOpenMeeting: (appointmentId: number) => void;
  onOpenInvoice: (invoiceId: number) => void;
  onToast: (message: string) => void;
}) {
  const [detail, setDetail] = useState<EngagementDetail | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [addingMeeting, setAddingMeeting] = useState(false);

  const reload = useCallback(
    () => getEngagementDetail(engagementId).then(setDetail).catch(onError),
    [engagementId, onError],
  );

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, [reload]);

  const tabs: Tab[] = ['overview', 'meetings', 'messages', 'notes', 'media', 'team'];
  if (detail?.billing) tabs.push('billing');

  const noted = detail?.agenda.filter((a) => a.note).length ?? 0;
  const counts: Record<Tab, number | null> = {
    overview: null,
    meetings: detail?.meetings.length ?? 0,
    messages: detail?.agenda.length ?? 0,
    notes: detail?.notes.length ?? 0,
    media: (detail?.files.length ?? 0) + (detail?.media.length ?? 0),
    team: detail?.team.length ?? 0,
    billing: null,
  };

  const openTopics =
    detail?.agenda.filter((a) => a.status === 'proposed' || a.status === 'scheduled').length ?? 0;
  const pastDue = Boolean(
    detail?.dueOn && detail.status !== 'closed' && detail.dueOn < today(),
  );
  const held = detail?.meetings.filter((m) => m.status === 'completed').length ?? 0;
  const upcoming =
    detail?.meetings.filter(
      (m) => new Date(m.startsAt) > new Date() && m.status !== 'cancelled' && m.status !== 'completed',
    ).length ?? 0;

  // Shown in place of the manager, not on top of it: two stacked popups
  // would both answer Escape.
  if (addingMeeting && detail) {
    return (
      <NewMeetingForm
        clients={[]}
        engagement={{ id: detail.id, title: detail.title, clientName: detail.clientName }}
        onCancel={() => setAddingMeeting(false)}
        onError={onError}
        onDone={() => {
          setAddingMeeting(false);
          setTab('meetings');
          onToast('Meeting created');
          onChanged();
          reload();
        }}
      />
    );
  }

  return (
    <Modal
      title={detail?.title ?? 'Engagement'}
      badge={detail ? statusLabel(detail.status) : undefined}
      badgeTone={detail ? STATUS_TONE[detail.status] ?? 'neutral' : undefined}
      onClose={onClose}
      wide
    >
      {loading || !detail ? (
        <p>Loading...</p>
      ) : (
        <>
          <Summary
            figures={[
              {
                label: 'Target date',
                value: detail.dueOn ? day(detail.dueOn) : 'Not set',
                hint: dueHint(detail),
                tone: pastDue ? 'warn' : undefined,
              },
              {
                label: 'Open topics',
                value: openTopics,
                hint: `${detail.agenda.length - openTopics} closed`,
              },
              {
                label: 'Meetings',
                value: held,
                hint: upcoming > 0 ? `held, ${upcoming} upcoming` : 'held, none upcoming',
              },
              { label: 'Time recorded', value: hours(detail.recordedMinutes), hint: 'in meetings' },
              ...(detail.billing
                ? [
                    {
                      label: 'Unbilled',
                      value: money(detail.billing.unbilledCents),
                      hint:
                        detail.billing.unchargedMessageMinutes > 0
                          ? `plus ${hours(detail.billing.unchargedMessageMinutes)} of replies`
                          : 'ready to invoice',
                      tone: detail.billing.unbilledCents > 0 ? ('warn' as const) : undefined,
                    },
                    {
                      label: 'Invoiced',
                      value: money(detail.billing.invoicedCents),
                      hint: `of ${money(detail.billing.chargedCents)} charged`,
                    },
                  ]
                : []),
            ]}
            facts={[
              <>
                Client{' '}
                {onOpenClient ? (
                  <button className="linklike" onClick={() => onOpenClient(detail.clientId)}>
                    {detail.clientName}
                  </button>
                ) : (
                  <strong>{detail.clientName}</strong>
                )}
              </>,
              <>
                Run by <strong>{COMMUNICATION_LABELS[detail.communication].toLowerCase()}</strong>
              </>,
              <>
                Started <strong>{day(detail.startedOn)}</strong>
              </>,
              <>
                <strong>{detail.team.length}</strong> {detail.team.length === 1 ? 'person' : 'people'} on
                the team
              </>,
            ]}
          />

          <div className="tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? 'tab tab-on' : 'tab'}
                onClick={() => setTab(t)}
              >
                {TAB_LABELS[t]}
                {counts[t] !== null && <span className="tab-count">{counts[t]}</span>}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <OverviewTab
              detail={detail}
              noted={noted}
              onError={onError}
              onSaved={(message) => {
                onToast(message);
                onChanged();
                reload();
              }}
            />
          )}

          {tab === 'meetings' && (
            <div className="tool-toolbar">
              <button onClick={() => setAddingMeeting(true)} disabled={detail.status === 'closed'}>
                Add meeting
              </button>
            </div>
          )}
          {tab === 'meetings' &&
            (detail.meetings.length === 0 ? (
              <p className="empty">
                No meetings yet. Add one here, or the client can book one from their portal.
              </p>
            ) : (
              <div className="grid-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Meeting</th>
                      <th>When</th>
                      <th>Length</th>
                      <th>Agenda</th>
                      <th>Time recorded</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.meetings.map((m) => (
                      <tr key={m.id} className="clickable" onClick={() => onOpenMeeting(m.id)}>
                        <td>
                          {m.title ? <strong>{m.title}</strong> : <span className="muted">Booked by client</span>}
                        </td>
                        <td className="nowrap">{formatRange(m.startsAt, m.endsAt)}</td>
                        <td className="nowrap">{formatLength(m.durationMinutes)}</td>
                        <td>
                          {m.notedCount}/{m.topicCount} noted
                        </td>
                        <td className="nowrap">{hours(m.recordedMinutes)}</td>
                        <td>
                          <span className={`status status-ap-${m.status}`}>{statusLabel(m.status)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

          {tab === 'messages' && (
            <MessagesPanel
              scope={{ engagementId }}
              all
              staff
              onError={onError}
              onOpenMeeting={onOpenMeeting}
              empty="No topics yet. The client adds what they want covered from their portal, and you can add agenda items from a meeting."
            />
          )}

          {tab === 'notes' && (
            <NotesTab
              engagementId={engagementId}
              notes={detail.notes}
              onError={onError}
              onChange={(notes) => setDetail((d) => (d ? { ...d, notes } : d))}
            />
          )}

          {tab === 'media' && (
            <FilesSection
              detail={detail}
              onError={onError}
              onToast={onToast}
              onChange={(files) => setDetail((d) => (d ? { ...d, files } : d))}
            />
          )}

          {tab === 'media' && <h4 className="people-side-title section-gap">Shared in meetings</h4>}
          {tab === 'media' &&
            (detail.media.length === 0 ? (
              <p className="empty">
                Nothing has been shared in this engagement&rsquo;s meetings yet. Templates, videos
                and screenshots put on screen during a call are collected here.
              </p>
            ) : (
              <div className="grid-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Type</th>
                      <th>Shared by</th>
                      <th>Meeting</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {detail.media.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.title}</strong>
                        </td>
                        <td>{s.kind === 'pdf' ? 'PDF' : s.kind === 'video' ? 'Video' : 'Image'}</td>
                        <td>{s.sharedByName}</td>
                        <td className="nowrap">
                          <button className="linklike" onClick={() => onOpenMeeting(s.appointmentId)}>
                            {day(s.meetingAt)}
                          </button>
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

          {tab === 'team' && (
            <PeopleList
              scope={{ kind: 'engagement', id: engagementId }}
              people={detail.team}
              clientName={detail.clientName}
              onError={onError}
              onChange={(team) => setDetail((d) => (d ? { ...d, team } : d))}
            />
          )}

          {tab === 'billing' && detail.billing && (
            <BillingTab
              detail={detail}
              onError={onError}
              onOpenMeeting={onOpenMeeting}
              onOpenInvoice={onOpenInvoice}
              onCharged={() => {
                onToast('Reply time charged');
                onChanged();
                reload();
              }}
              onInvoiced={(number) => {
                onToast(`Invoice ${number} created`);
                onChanged();
                reload();
              }}
            />
          )}
        </>
      )}
    </Modal>
  );
}

function OverviewTab({
  detail,
  noted,
  onSaved,
  onError,
}: {
  detail: EngagementDetail;
  noted: number;
  onSaved: (message: string) => void;
  onError: OnError;
}) {
  const [title, setTitle] = useState(detail.title);
  const [goal, setGoal] = useState(detail.goal ?? '');
  const [status, setStatus] = useState(detail.status);
  const [startedOn, setStartedOn] = useState(detail.startedOn);
  const [dueOn, setDueOn] = useState(detail.dueOn ?? '');
  const [communication, setCommunication] = useState<Communication>(detail.communication);
  const [closing, setClosing] = useState(false);
  const [closeNotes, setCloseNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function close(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await closeEngagement(detail.id, closeNotes.trim());
      onSaved(`Closed “${detail.title}”`);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  const dirty =
    communication !== detail.communication ||
    title !== detail.title ||
    goal !== (detail.goal ?? '') ||
    status !== detail.status ||
    startedOn !== detail.startedOn ||
    dueOn !== (detail.dueOn ?? '');

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateEngagement(detail.id, {
        title: title.trim(),
        status,
        goal: goal.trim() || null,
        startedOn,
        dueOn: dueOn || null,
        communication,
      });
      onSaved(`Saved “${title.trim()}”`);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  const discussed = detail.agenda.filter((a) => a.status === 'discussed').length;
  const open = detail.agenda.filter((a) => a.status === 'proposed' || a.status === 'scheduled').length;

  return (
    <>
    {detail.closure && (detail.status === 'closed' || detail.closure.notes) && (
      <div className={detail.status === 'closed' ? 'notice closure' : 'inset closure'}>
        <strong>
          {detail.status === 'closed'
            ? `Closed${detail.closure.closedOn ? ` on ${day(detail.closure.closedOn)}` : ''}${detail.closure.closedBy ? ` by ${detail.closure.closedBy}` : ''}`
            : 'Reopened. Notes from when it was last closed:'}
        </strong>
        {detail.closure.notes && <p>{detail.closure.notes}</p>}
      </div>
    )}
    <form onSubmit={save} className="stack-form engagement-overview">
      <label>
        Goal
        <textarea
          rows={3}
          value={goal}
          placeholder="The need this engagement exists to meet, in a sentence or two. Its meetings work towards this."
          onChange={(e) => setGoal(e.target.value)}
        />
      </label>
      <div className="field-row">
        <label>
          Title
          <input value={title} required onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="inquiry">Inquiry</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="closed">Closed</option>
          </select>
        </label>
      </div>
      <label>
        Communication
        <select value={communication} onChange={(e) => setCommunication(e.target.value as Communication)}>
          <option value="both">Messages and video meetings</option>
          <option value="message">Messages only</option>
          <option value="video">Video meetings only</option>
        </select>
      </label>
      <div className="field-row">
        <label>
          Start date
          <input type="date" value={startedOn} required onChange={(e) => setStartedOn(e.target.value)} />
        </label>
        <label>
          Target date
          <input type="date" value={dueOn} min={startedOn} onChange={(e) => setDueOn(e.target.value)} />
        </label>
      </div>
      <p className="hint">The target date is when the goal should be met. Leave it empty for open-ended work.</p>
      <div className="button-row">
        <button className="btn btn-primary" type="submit" disabled={!dirty || busy}>
          {busy ? 'Saving...' : 'Save changes'}
        </button>
        {detail.status !== 'closed' && !closing && (
          <button type="button" className="btn" onClick={() => setClosing(true)}>
            Close engagement
          </button>
        )}
      </div>

      <dl className="detail-list">
        <dt>Topics discussed</dt>
        <dd>{discussed}</dd>
        <dt>Topics still open</dt>
        <dd>{open}</dd>
        <dt>Notes taken</dt>
        <dd>{noted}</dd>
        <dt>Items shared</dt>
        <dd>{detail.media.length}</dd>
        <dt>People</dt>
        <dd>
          {detail.team.filter((p) => p.side === 'team').length} from Data Painters,{' '}
          {detail.team.filter((p) => p.side === 'client').length} from {detail.clientName}
        </dd>
      </dl>
    </form>
    {closing && (
      <form onSubmit={close} className="stack-form inset close-form">
        <label>
          Closure notes
          <textarea
            rows={4}
            value={closeNotes}
            required
            autoFocus
            placeholder="How it ended: what was delivered, what was left open, why it is closing."
            onChange={(e) => setCloseNotes(e.target.value)}
          />
        </label>
        <p className="hint">
          Closing stops new meetings and messages on this engagement and charges any reply time not
          yet charged. These notes are for your team; the client does not see them. It can be
          reopened by changing its status.
        </p>
        <div className="button-row">
          <button className="btn btn-primary" type="submit" disabled={busy || !closeNotes.trim()}>
            {busy ? 'Closing...' : 'Close engagement'}
          </button>
          <button type="button" className="linklike" onClick={() => setClosing(false)}>
            Cancel
          </button>
        </div>
      </form>
    )}
    </>
  );
}

/* ---------------------------------------------------------- engagement notes */

function when(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function NotesTab({
  engagementId,
  notes,
  onChange,
  onError,
}: {
  engagementId: number;
  notes: EngagementNote[];
  onChange: (next: EngagementNote[]) => void;
  onError: OnError;
}) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<EngagementNote[]>, after: () => void) {
    setBusy(true);
    try {
      onChange(await work());
      after();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    run(
      () => addEngagementNote(engagementId, draft),
      () => setDraft(''),
    );
  }

  return (
    <div className="engagement-notes">
      <form onSubmit={add} className="stack-form inset">
        <label>
          New note
          <textarea
            rows={3}
            value={draft}
            placeholder="A call, a decision, a change of scope: anything about this engagement worth keeping."
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <div className="button-row">
          <button className="btn btn-primary" type="submit" disabled={busy || !draft.trim()}>
            Add note
          </button>
        </div>
      </form>

      {notes.length === 0 ? (
        <p className="empty">
          No notes yet. Notes taken on a topic in a meeting appear in that topic&rsquo;s thread, under Topics.
        </p>
      ) : (
        <div className="notes-list">
          {notes.map((n) => (
            <article key={n.id} className="note-entry">
              <header>
                <strong>{n.authorName ?? 'Former team member'}</strong>
                <span className="muted">
                  {when(n.createdAt)}
                  {n.updatedAt !== n.createdAt && `, edited ${when(n.updatedAt)}`}
                </span>
              </header>
              {editing?.id === n.id ? (
                <div className="note-edit">
                  <textarea
                    rows={4}
                    value={editing.body}
                    autoFocus
                    aria-label="Edit note"
                    onChange={(e) => setEditing({ id: n.id, body: e.target.value })}
                  />
                  <div className="button-row">
                    <button
                      className="btn btn-primary"
                      disabled={busy || !editing.body.trim()}
                      onClick={() =>
                        run(
                          () => editEngagementNote(engagementId, n.id, editing.body),
                          () => setEditing(null),
                        )
                      }
                    >
                      Save note
                    </button>
                    <button className="linklike" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p>{n.body}</p>
                  <div className="button-row">
                    <button className="linklike" onClick={() => setEditing({ id: n.id, body: n.body })}>
                      Edit
                    </button>
                    <button
                      className="linklike"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm('Delete this note? This cannot be undone.')) {
                          run(
                            () => deleteEngagementNote(engagementId, n.id),
                            () => undefined,
                          );
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- engagement files */

const KIND_LABEL = { pdf: 'PDF', video: 'Video', image: 'Image' } as const;

function FilesSection({
  detail,
  onChange,
  onError,
  onToast,
}: {
  detail: EngagementDetail;
  onChange: (next: EngagementDetail['files']) => void;
  onError: OnError;
  onToast: (message: string) => void;
}) {
  const [mode, setMode] = useState<'closed' | 'upload' | 'library'>('closed');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [library, setLibrary] = useState<MediaItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    // The file name without its extension is usually a fair first title.
    if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''));
  }

  async function run(work: () => Promise<EngagementDetail['files']>, done: string) {
    setBusy(true);
    try {
      onChange(await work());
      onToast(done);
      setMode('closed');
      setFile(null);
      setTitle('');
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  function openLibrary() {
    setMode('library');
    if (!library) {
      listMedia()
        .then((items) => setLibrary(items.filter((i) => i.status === 'ready')))
        .catch(onError);
    }
  }

  function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    run(() => uploadEngagementFile(detail.id, file, title.trim()), `Added “${title.trim()}”`);
  }

  return (
    <div className="engagement-files">
      <div className="tool-toolbar">
        <button onClick={() => setMode(mode === 'upload' ? 'closed' : 'upload')}>Upload a file</button>
        <button onClick={() => (mode === 'library' ? setMode('closed') : openLibrary())}>
          Add from the media library
        </button>
      </div>

      {mode === 'upload' && (
        <form onSubmit={upload} className="stack-form inset">
          <label>
            File
            <input
              ref={input}
              type="file"
              required
              accept="application/pdf,image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm"
              onChange={pickFile}
            />
          </label>
          <label>
            Title
            <input value={title} required maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <p className="hint">
            PDFs up to 50 MB, images up to 15 MB, MP4 or WebM video up to 500 MB.
          </p>
          <div className="button-row">
            <button className="btn btn-primary" type="submit" disabled={busy || !file}>
              {busy ? 'Uploading...' : 'Upload and add'}
            </button>
            <button type="button" className="linklike" onClick={() => setMode('closed')}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === 'library' && (
        <div className="inset">
          {!library ? (
            <p className="muted">Loading...</p>
          ) : library.length === 0 ? (
            <p className="muted">The media library is empty. Add items under Media library first.</p>
          ) : (
            <ul className="library-pick">
              {library.map((item) => {
                const already = detail.files.some((f) => f.fromLibrary && f.title === item.title);
                return (
                  <li key={item.id}>
                    <span>
                      <strong>{item.title}</strong>
                      <small className="muted"> {item.kind}</small>
                    </span>
                    <button
                      className="btn"
                      disabled={busy || already}
                      onClick={() => run(() => attachLibraryItem(detail.id, item.id), `Added “${item.title}”`)}
                    >
                      {already ? 'Added' : 'Add'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <h4 className="people-side-title">Engagement files</h4>
      {detail.files.length === 0 ? (
        <p className="empty">No files attached to this engagement yet.</p>
      ) : (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>File</th>
                <th>Type</th>
                <th>Added by</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {detail.files.map((f) => (
                <tr key={f.id}>
                  <td>
                    <strong>{f.title}</strong>
                    {f.fromLibrary && <span className="muted"> (media library)</span>}
                  </td>
                  <td>{KIND_LABEL[f.kind]}</td>
                  <td>{f.addedBy ?? <span className="muted">&mdash;</span>}</td>
                  <td className="nowrap">{day(f.addedAt)}</td>
                  <td className="nowrap">
                    <a className="linklike" href={f.url} target="_blank" rel="noreferrer">
                      Open
                    </a>{' '}
                    <button
                      className="linklike"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Remove “${f.title}” from this engagement?`)) {
                          run(() => removeEngagementFile(detail.id, f.id), `Removed “${f.title}”`);
                        }
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BillingTab({
  detail,
  onInvoiced,
  onCharged,
  onOpenMeeting,
  onOpenInvoice,
  onError,
}: {
  detail: EngagementDetail;
  /** Reply time was compiled into a charge; reload to show it. */
  onCharged: () => void;
  onInvoiced: (invoiceNumber: string) => void;
  onOpenMeeting: (appointmentId: number) => void;
  onOpenInvoice: (invoiceId: number) => void;
  onError: OnError;
}) {
  const b = detail.billing!;
  const [busy, setBusy] = useState(false);

  async function chargeReplies() {
    setBusy(true);
    try {
      await chargeMessageTime(detail.id);
      onCharged();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function invoice() {
    if (
      !window.confirm(
        `Create an invoice to ${detail.clientName} for ${money(b.unbilledCents)} of unbilled work on this engagement?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      onInvoiced((await invoiceEngagement(detail.id)).number);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="tool-toolbar">
        <button onClick={invoice} disabled={busy || (b.unbilledCents <= 0 && b.unchargedMessageMinutes === 0)}>
          {busy ? 'Creating...' : `Invoice unbilled work (${money(b.unbilledCents)})`}
        </button>
        {b.unchargedMessageMinutes > 0 && (
          <button onClick={chargeReplies} disabled={busy}>
            Charge reply time ({hours(b.unchargedMessageMinutes)})
          </button>
        )}
      </div>
      {b.unchargedMessageMinutes > 0 && (
        <p className="hint">
          {hours(b.unchargedMessageMinutes)} of time recorded on written replies is not yet a charge.
          Charging it rounds the total up to 30-minute blocks; invoicing does this for you.
        </p>
      )}
      <p className="hint">
        Time is recorded per meeting and becomes a charge when the meeting is marked complete, in
        30-minute blocks. {hours(detail.recordedMinutes)} recorded so far; {hours(b.billedMinutes)}{' '}
        of it charged.
      </p>
      {b.charges.length === 0 ? (
        <p className="empty">No charges yet. Complete a meeting to compile its time into a charge.</p>
      ) : (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Time</th>
                <th className="num">Amount</th>
                <th>Invoice</th>
              </tr>
            </thead>
            <tbody>
              {b.charges.map((c) => (
                <tr
                  key={c.id}
                  className={c.appointmentId ? 'clickable' : undefined}
                  onClick={c.appointmentId ? () => onOpenMeeting(c.appointmentId!) : undefined}
                >
                  <td className="nowrap">{day(c.serviceDate)}</td>
                  <td>{c.description}</td>
                  <td className="nowrap">{c.minutes ? hours(c.minutes) : <span className="muted">&mdash;</span>}</td>
                  <td className="num">
                    <strong>{money(c.amountCents)}</strong>
                  </td>
                  <td>
                    {c.invoiceId ? (
                      <button
                        className="linklike"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenInvoice(c.invoiceId!);
                        }}
                      >
                        {c.invoiceNumber}
                      </button>
                    ) : (
                      <span className="pill pill-warn">Unbilled</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------- team */

const ROLE_HELP: Record<TeamRole, string> = {
  admin: 'Everything, including team members and system options.',
  billing: 'Invoices, payments and financial reports, plus clients, engagements and meetings.',
  relations: 'Clients, engagements, meetings and client portal logins. No billing.',
  engineer: 'Engagements and meetings: agenda, notes, time and media. No billing.',
};

const ROLE_ORDER: TeamRole[] = ['admin', 'billing', 'relations', 'engineer'];

function MemberForm({
  existing,
  isSelf,
  onDone,
  onCancel,
  onError,
}: {
  existing?: TeamMember;
  isSelf: boolean;
  onDone: (result: { created?: CreatedUser; name: string }) => void;
  onCancel: () => void;
  onError: OnError;
}) {
  const [firstName, setFirstName] = useState(existing?.firstName ?? '');
  const [lastName, setLastName] = useState(existing?.lastName ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [teamRole, setTeamRole] = useState<TeamRole>(existing?.teamRole ?? 'engineer');
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const name = `${firstName.trim()} ${lastName.trim()}`.trim();
    try {
      if (existing) {
        await updateTeamMember(existing.id, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || undefined,
          teamRole,
          enabled,
        });
        onDone({ name });
      } else {
        const created = await inviteTeamMember({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          teamRole,
        });
        onDone({ created, name });
      }
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={existing ? 'Edit team member' : 'Invite a team member'} onClose={onCancel}>
      <form onSubmit={submit} className="stack-form">
        <div className="field-row">
          <label>
            First name
            <input value={firstName} required autoFocus onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label>
            Last name
            <input value={lastName} required onChange={(e) => setLastName(e.target.value)} />
          </label>
        </div>
        <div className="field-row">
          <label>
            Email address
            <input
              type="email"
              value={email}
              required
              disabled={Boolean(existing)}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Phone
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>
        <fieldset className="role-picker" disabled={isSelf}>
          <legend>Role</legend>
          {ROLE_ORDER.map((r) => (
            <label key={r} className={teamRole === r ? 'role-option on' : 'role-option'}>
              <input type="radio" name="teamRole" checked={teamRole === r} onChange={() => setTeamRole(r)} />
              <span>
                <strong>{TEAM_ROLE_LABELS[r]}</strong>
                <small>{ROLE_HELP[r]}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {existing && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={enabled}
              disabled={isSelf}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Account is active. Turn this off to lock them out straight away.
          </label>
        )}
        {isSelf && (
          <p className="hint">
            You cannot change your own role or disable your own account. Another administrator can.
          </p>
        )}
        {!existing && (
          <p className="hint">
            They are emailed a single-use link to set their own password. The link is also shown
            here so you can pass it on yourself.
          </p>
        )}
        <div className="button-row">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving...' : existing ? 'Save changes' : 'Send invitation'}
          </button>
          <button type="button" className="linklike" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function TeamAdmin({
  me,
  onError,
  onIssued,
  onToast,
}: {
  me: User | null;
  onError: OnError;
  onIssued: (created: CreatedUser) => void;
  onToast: (message: string) => void;
}) {
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [editing, setEditing] = useState<TeamMember | 'new' | null>(null);

  const reload = useCallback(() => listTeam().then(setTeam).catch(onError), [onError]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <section>
      <div className="tool-toolbar">
        <button onClick={() => setEditing('new')}>Invite a team member</button>
      </div>

      {!team ? (
        <p className="empty">Loading...</p>
      ) : (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last sign-in</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.id} className="clickable" onClick={() => setEditing(m)}>
                  <td>
                    <strong>{m.displayName}</strong>
                    {m.id === me?.id && <span className="muted"> (you)</span>}
                  </td>
                  <td>{m.email}</td>
                  <td>{TEAM_ROLE_LABELS[m.teamRole]}</td>
                  <td>
                    {!m.enabled ? (
                      <span className="pill pill-bad">Disabled</span>
                    ) : m.invitePending ? (
                      <span className="pill pill-warn">Invited</span>
                    ) : (
                      <span className="pill pill-good">Active</span>
                    )}
                  </td>
                  <td className="nowrap">
                    {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString() : 'never'}
                  </td>
                  <td className="nowrap">
                    {m.enabled && m.id !== me?.id && (
                      <button
                        className="linklike"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            onIssued(await resendInvite(m.id));
                          } catch (err) {
                            onError(err);
                          }
                        }}
                      >
                        {m.invitePending ? 'Resend invite' : 'Send reset link'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="role-key">
        {ROLE_ORDER.map((r) => (
          <p key={r}>
            <strong>{TEAM_ROLE_LABELS[r]}</strong>
            <span>{ROLE_HELP[r]}</span>
          </p>
        ))}
      </div>

      {editing && (
        <MemberForm
          existing={editing === 'new' ? undefined : editing}
          isSelf={editing !== 'new' && editing.id === me?.id}
          onCancel={() => setEditing(null)}
          onError={onError}
          onDone={({ created, name }) => {
            if (created) onIssued(created);
            onToast(created ? `Invitation sent to ${name}` : `Saved ${name}`);
            setEditing(null);
            reload();
          }}
        />
      )}
    </section>
  );
}
