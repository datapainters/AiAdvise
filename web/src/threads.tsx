/**
 * Topic threads: everything said about a topic, in order. Posts from both
 * sides, and the notes taken on the topic in each meeting it was brought to.
 * Used by the client portal and the admin console.
 *
 * One component for both because it is the same conversation. Anyone on the
 * thread can attach files from their own machine. A Data Painters reader in
 * the console gets three more things -- how long a reply took, attachments
 * from the media library, and editing a meeting's notes -- switched on by
 * `staff`. The portal never passes it, whoever is signed in.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Paged } from './datagrid';
import {
  getThread,
  listThreads,
  postThreadMessage,
  saveMeetingNote,
  uploadThreadFile,
  type Thread,
  type ThreadMessage,
  type ThreadSummary,
} from './api';
import { listMedia, type MediaItem } from './billing-api';

type OnError = (e: unknown) => void;

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm';

function stamp(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const TOPIC_STATUS: Record<string, string> = {
  proposed: 'Open',
  scheduled: 'On a meeting',
  discussed: 'Discussed',
  dropped: 'Dropped',
};

/* ---------------------------------------------------------- meeting entry */

/** The notes taken on this topic in one meeting, set apart from the posts. */
function MeetingEntry({
  entry,
  topicId,
  staff,
  onSaved,
  onOpenMeeting,
  onError,
}: {
  entry: ThreadMessage;
  topicId: number;
  staff: boolean;
  onSaved: () => void;
  onOpenMeeting?: (appointmentId: number) => void;
  onError: OnError;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.body);
  const [busy, setBusy] = useState(false);
  const when = new Date(entry.createdAt).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const people = entry.participants ?? 0;

  async function save() {
    if (entry.appointmentId === null) return;
    setBusy(true);
    try {
      await saveMeetingNote(entry.appointmentId, topicId, draft);
      setEditing(false);
      onSaved();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="thread-message is-meeting">
      <header>
        <strong>Meeting on {when}</strong>
        {entry.meetingTitle && <span>{entry.meetingTitle}</span>}
        <span className="muted">
          {people > 0 ? `${people} ${people === 1 ? 'participant' : 'participants'}` : 'Participants not recorded'}
        </span>
        {staff && onOpenMeeting && entry.appointmentId !== null && (
          <button className="linklike thread-time" onClick={() => onOpenMeeting(entry.appointmentId!)}>
            Open meeting
          </button>
        )}
      </header>
      {editing ? (
        <div className="note-edit">
          <textarea
            rows={4}
            value={draft}
            autoFocus
            aria-label="Meeting notes"
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="button-row">
            <button className="btn btn-primary" onClick={save} disabled={busy || !draft.trim()}>
              {busy ? 'Saving...' : 'Save notes'}
            </button>
            <button
              className="linklike"
              onClick={() => {
                setDraft(entry.body);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p>{entry.body}</p>
          <footer className="muted">
            Notes by {entry.authorName}
            {staff && (
              <>
                {' '}
                <button className="linklike" onClick={() => setEditing(true)}>
                  Edit notes
                </button>
              </>
            )}
          </footer>
        </>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ thread */

export function ThreadView({
  topicId,
  staff = false,
  onPosted,
  onOpenMeeting,
  onError,
}: {
  topicId: number;
  /** The admin console: time, the media library and editing meeting notes. */
  staff?: boolean;
  /** Called after a post, so a list beside this can refresh. */
  onPosted?: () => void;
  /** Console only: opens the meeting an entry came from. */
  onOpenMeeting?: (appointmentId: number) => void;
  onError: OnError;
}) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [body, setBody] = useState('');
  const [minutes, setMinutes] = useState('');
  // Checked for every new reply: posting quietly is the exception.
  const [notify, setNotify] = useState(true);
  const [attached, setAttached] = useState<MediaItem[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [library, setLibrary] = useState<MediaItem[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => getThread(topicId).then(setThread).catch(onError), [topicId, onError]);

  useEffect(() => {
    setThread(null);
    setBody('');
    setMinutes('');
    setAttached([]);
    setFiles([]);
    setPicking(false);
    reload();
  }, [topicId, reload]);

  // Keep the newest entry in view, as a chat does.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [thread?.messages.length]);

  function openLibrary() {
    setPicking((v) => !v);
    if (!library) {
      listMedia()
        .then((items) => setLibrary(items.filter((i) => i.status === 'ready')))
        .catch(onError);
    }
  }

  function pickFiles(e: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    e.target.value = '';
    setFiles((prev) => [...prev, ...chosen].slice(0, 10));
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if ((!body.trim() && files.length === 0) || busy) return;
    setBusy(true);
    try {
      // Files go to storage first; the post then names them.
      const uploads = [];
      for (const f of files) uploads.push(await uploadThreadFile(topicId, f));
      const spent = Number(minutes);
      setThread(
        await postThreadMessage(topicId, {
          body: body.trim(),
          minutes: staff && spent > 0 ? spent : undefined,
          mediaItemIds: staff && attached.length ? attached.map((a) => a.id) : undefined,
          uploads: uploads.length ? uploads : undefined,
          notifyTeam: staff ? notify : undefined,
        }),
      );
      setBody('');
      setMinutes('');
      setAttached([]);
      setFiles([]);
      setPicking(false);
      setNotify(true);
      onPosted?.();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!thread) return <p className="empty">Loading...</p>;

  return (
    <div className="thread">
      <header className="thread-head">
        <h3>
          {thread.title}
          <span className={`status status-${thread.status}`}>{TOPIC_STATUS[thread.status] ?? thread.status}</span>
        </h3>
        <p className="muted">
          {staff && <>{thread.clientName} &middot; </>}
          {thread.engagementTitle}
          {thread.raisedBy && <> &middot; raised by {thread.raisedBy}</>} on{' '}
          {new Date(thread.raisedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
        {thread.detail && <p className="thread-opening">{thread.detail}</p>}
        {thread.desiredOutcome && (
          <p className="topic-outcome">
            <strong>Good outcome:</strong> {thread.desiredOutcome}
          </p>
        )}
      </header>

      <div className="thread-messages" aria-live="polite">
        {thread.messages.length === 0 && (
          <p className="empty">Nothing yet. {thread.canPost ? 'Write the first message below.' : ''}</p>
        )}
        {thread.messages.map((m) =>
          m.kind === 'meeting' ? (
            <MeetingEntry
              key={`meeting-${m.id}`}
              entry={m}
              topicId={topicId}
              staff={staff}
              onSaved={reload}
              onOpenMeeting={onOpenMeeting}
              onError={onError}
            />
          ) : (
            <article key={m.id} className={`thread-message is-${m.side}`}>
              <header>
                <strong>{m.authorName}</strong>
                {m.side === 'team' && <span className="pill pill-neutral">Data Painters</span>}
                <span className="muted">{stamp(m.createdAt)}</span>
                {m.minutes !== null && (
                  <span className="muted thread-time">
                    {m.minutes} min{m.charged ? ', charged' : ''}
                  </span>
                )}
              </header>
              <p>{m.body}</p>
              {m.attachments.length > 0 && (
                <ul className="thread-attachments">
                  {m.attachments.map((a, i) => (
                    <li key={i}>
                      <a href={a.url} target="_blank" rel="noreferrer">
                        {a.title}
                      </a>
                      <span className="muted"> {a.kind === 'pdf' ? 'PDF' : a.kind}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ),
        )}
        <div ref={end} />
      </div>

      {thread.canPost ? (
        <form onSubmit={send} className="thread-compose">
          <label>
            <span className="sr-only">Your message</span>
            <textarea
              rows={3}
              value={body}
              placeholder="Write a reply. Everyone on this engagement is emailed a copy."
              onChange={(e) => setBody(e.target.value)}
            />
          </label>

          {(files.length > 0 || (staff && attached.length > 0)) && (
            <ul className="thread-chips">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  {f.name}
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles((prev) => prev.filter((_, x) => x !== i))}
                  >
                    &times;
                  </button>
                </li>
              ))}
              {staff &&
                attached.map((a) => (
                  <li key={a.id}>
                    {a.title}
                    <button
                      type="button"
                      aria-label={`Remove ${a.title}`}
                      onClick={() => setAttached((prev) => prev.filter((x) => x.id !== a.id))}
                    >
                      &times;
                    </button>
                  </li>
                ))}
            </ul>
          )}

          {staff && picking && (
            <div className="thread-library">
              {!library ? (
                <p className="muted">Loading...</p>
              ) : library.length === 0 ? (
                <p className="muted">The media library is empty. Add items under Media library first.</p>
              ) : (
                <ul className="library-pick">
                  {library.map((item) => {
                    const on = attached.some((a) => a.id === item.id);
                    return (
                      <li key={item.id}>
                        <span>
                          <strong>{item.title}</strong>
                          <small className="muted"> {item.kind}</small>
                        </span>
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            setAttached((prev) => (on ? prev.filter((a) => a.id !== item.id) : [...prev, item]))
                          }
                        >
                          {on ? 'Remove' : 'Attach'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          <div className="thread-compose-row">
            {staff && (
              <label className="thread-minutes">
                Time spent
                <input
                  type="number"
                  min={1}
                  max={1440}
                  inputMode="numeric"
                  value={minutes}
                  placeholder="min"
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </label>
            )}
            <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
              Attach a file
            </button>
            <input ref={fileInput} type="file" multiple hidden accept={ACCEPT} onChange={pickFiles} />
            {staff && (
              <button type="button" className="btn" onClick={openLibrary}>
                {picking ? 'Hide media library' : 'Attach from media library'}
              </button>
            )}
            {staff && (
              <label className="check-row thread-notify">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                Notify Topic Team
              </label>
            )}
            <button className="btn btn-primary" type="submit" disabled={busy || (!body.trim() && files.length === 0)}>
              {busy ? 'Sending...' : 'Send'}
            </button>
          </div>
          <p className="hint">
            Attach PDFs, images, or MP4 and WebM video from your computer.
            {staff &&
              ' Time spent is billed to the engagement with its meetings, in 30-minute blocks across all replies; clients do not see it.'}
          </p>
        </form>
      ) : (
        <p className="notice thread-closed">{thread.closedReason}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- list */

/**
 * A list of topics beside the open one. `scope` narrows it to one engagement
 * or one client; with neither it is everything the reader may see. `all`
 * lists every topic; without it, only those that have or can take messages.
 */
export function MessagesPanel({
  scope,
  all = false,
  staff = false,
  groupByEngagement = false,
  filters = false,
  fill = false,
  initialTopicId,
  refreshKey,
  onOpenMeeting,
  onError,
  empty,
}: {
  scope?: { engagementId?: number; clientId?: number };
  all?: boolean;
  staff?: boolean;
  /** Sets the list out under a heading per engagement. */
  groupByEngagement?: boolean;
  /** Client, engagement and search controls above the list. */
  filters?: boolean;
  /** Fills its container: the list and the thread each scroll on their own. */
  fill?: boolean;
  /** Opens this topic first, as when arriving from an email. */
  initialTopicId?: number | null;
  /** Bumped by the parent to reload, as after a topic is added. */
  refreshKey?: number;
  onOpenMeeting?: (appointmentId: number) => void;
  onError: OnError;
  empty?: string;
}) {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [open, setOpen] = useState<number | null>(initialTopicId ?? null);
  const engagementId = scope?.engagementId;
  const clientId = scope?.clientId;
  const [pickClient, setPickClient] = useState<number | ''>('');
  const [pickEngagement, setPickEngagement] = useState<number | ''>('');
  const [search, setSearch] = useState('');

  const reload = useCallback(
    () => listThreads({ engagementId, clientId, all }).then(setThreads).catch(onError),
    [engagementId, clientId, all, onError],
  );

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  const everything = threads ?? [];

  // The choices come from the topics themselves, so a client or engagement
  // with nothing to show is never offered.
  const clientOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const t of everything) seen.set(t.clientId, t.clientName);
    return [...seen.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  }, [everything]);
  const engagementOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const t of everything) {
      if (pickClient === '' || t.clientId === pickClient) seen.set(t.engagementId, t.engagementTitle);
    }
    return [...seen.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  }, [everything, pickClient]);

  const words = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      everything.filter(
        (t) =>
          (pickClient === '' || t.clientId === pickClient) &&
          (pickEngagement === '' || t.engagementId === pickEngagement) &&
          (words === '' ||
            [t.title, t.lastSnippet, t.lastAuthor, t.raisedBy, t.engagementTitle, t.clientName].some((v) =>
              (v ?? '').toLowerCase().includes(words),
            )),
      ),
    [everything, pickClient, pickEngagement, words],
  );
  const filtering = pickClient !== '' || pickEngagement !== '' || words !== '';

  // Follow the list: with nothing chosen, or after the filters change to a
  // set that no longer holds the open topic, show the most recent. A topic
  // arrived at by link stays open until the reader filters.
  useEffect(() => {
    if (!threads) return;
    if (shown.length === 0) {
      if (open !== null && (open !== initialTopicId || filtering)) setOpen(null);
      return;
    }
    if (open === null || ((open !== initialTopicId || filtering) && !shown.some((t) => t.topicId === open))) {
      setOpen(shown[0].topicId);
    }
  }, [threads, shown, open, initialTopicId, filtering]);

  if (!threads) return <p className="empty">Loading...</p>;

  if (threads.length === 0 && open === null) {
    return <p className="empty">{empty ?? 'No topics yet.'}</p>;
  }

  // Under a heading per engagement the name is not repeated on every row.
  const showEngagement = !engagementId && !groupByEngagement;
  // Across clients, the heading has to say whose engagement it is.
  const headingNamesClient = groupByEngagement && !clientId && pickClient === '';

  // Engagements in order of their most recent activity, each with its topics.
  const groups: { id: number; title: string; items: ThreadSummary[] }[] = [];
  for (const t of shown) {
    const g = groups.find((x) => x.id === t.engagementId);
    if (g) g.items.push(t);
    else
      groups.push({
        id: t.engagementId,
        title: headingNamesClient ? `${t.clientName} \u00b7 ${t.engagementTitle}` : t.engagementTitle,
        items: [t],
      });
  }
  const sections = groupByEngagement ? groups : [{ id: 0, title: '', items: shown }];

  const inbox = (
    <div className={fill ? 'inbox inbox-fill' : 'inbox'}>
      <div className="inbox-list" aria-label="Topics">
        {shown.length === 0 && <p className="panel-empty">No topics match.</p>}
        {sections.map((section) => (
          <section key={section.id}>
            {groupByEngagement && (
              <h4 className="inbox-group">
                {section.title}
                <span className="tab-count">{section.items.length}</span>
              </h4>
            )}
            <Paged rows={section.items} narrow>{(pageItems) => (
            <ul>
              {pageItems.map((t) => {
          // Who is being waited on: a client post with no answer yet, or a
          // topic nobody has replied to.
          const waiting = staff ? t.open && t.lastSide !== 'team' : t.open && t.lastSide === 'team';
          return (
            <li key={t.topicId}>
              <button
                className={open === t.topicId ? 'inbox-item on' : 'inbox-item'}
                aria-current={open === t.topicId ? 'true' : undefined}
                onClick={() => setOpen(t.topicId)}
              >
                <span className="inbox-item-top">
                  <strong>{t.title}</strong>
                  <span className="muted">{stamp(t.lastActivityAt)}</span>
                </span>
                {(showEngagement || (staff && !clientId && !engagementId && !groupByEngagement)) && (
                  <span className="muted inbox-item-where">
                    {staff && !clientId ? `${t.clientName} · ` : ''}
                    {showEngagement ? t.engagementTitle : ''}
                  </span>
                )}
                <span className="inbox-item-snippet">
                  {t.lastSnippet ? (
                    <>
                      <b>{t.lastAuthor ?? 'Someone'}:</b> {t.lastSnippet}
                    </>
                  ) : (
                    <span className="muted">No messages yet</span>
                  )}
                </span>
                <span className="inbox-item-meta">
                  {waiting && <span className="pill pill-warn">{staff ? 'Needs a reply' : 'New reply'}</span>}
                  <span className={`status status-${t.status}`}>{TOPIC_STATUS[t.status] ?? t.status}</span>
                  <span className="muted">
                    {t.messageCount} {t.messageCount === 1 ? 'message' : 'messages'}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
            </ul>
            )}</Paged>
          </section>
        ))}
      </div>
      <div className="inbox-thread">
        {open === null ? (
          <p className="empty">Choose a topic.</p>
        ) : (
          <ThreadView topicId={open} staff={staff} onError={onError} onPosted={reload} onOpenMeeting={onOpenMeeting} />
        )}
      </div>
    </div>
  );

  if (!filters) return inbox;

  return (
    <div className={fill ? 'topics-screen topics-screen-fill' : 'topics-screen'}>
      <div className="topics-filters">
        <label>
          Client
          <select
            value={pickClient}
            onChange={(e) => {
              setPickClient(e.target.value === '' ? '' : Number(e.target.value));
              setPickEngagement('');
            }}
          >
            <option value="">All clients</option>
            {clientOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Engagement
          <select
            value={pickEngagement}
            onChange={(e) => setPickEngagement(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">{pickClient === '' ? 'All engagements' : 'All of this client\u2019s engagements'}</option>
            {engagementOptions.map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label className="topics-search">
          Search topics
          <input
            type="search"
            value={search}
            placeholder="Title, message or person"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span className="muted topics-count">
          {shown.length} of {everything.length} topics
        </span>
      </div>
      {inbox}
    </div>
  );
}
