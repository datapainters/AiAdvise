/**
 * Topic threads: the written conversation on a topic, used by both the
 * client portal and the admin console.
 *
 * One component for both sides because it is the same conversation. A Data
 * Painters reader gets two extra controls on the reply box -- how long the
 * reply took, and attachments from the media library -- and sees the time
 * recorded on past replies. The server decides which of those it honours;
 * the `staff` flag here only decides what to draw.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  getThread,
  listThreads,
  postThreadMessage,
  type Thread,
  type ThreadSummary,
} from './api';
import { listMedia, type MediaItem } from './billing-api';

type OnError = (e: unknown) => void;

function stamp(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/* ------------------------------------------------------------------ thread */

export function ThreadView({
  topicId,
  staff,
  onPosted,
  onError,
}: {
  topicId: number;
  /** A Data Painters reader: shows time and media library controls. */
  staff: boolean;
  /** Called after a post, so a list beside this can refresh. */
  onPosted?: () => void;
  onError: OnError;
}) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [body, setBody] = useState('');
  const [minutes, setMinutes] = useState('');
  const [attached, setAttached] = useState<MediaItem[]>([]);
  const [library, setLibrary] = useState<MediaItem[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setThread(null);
    setBody('');
    setMinutes('');
    setAttached([]);
    setPicking(false);
    getThread(topicId).then(setThread).catch(onError);
  }, [topicId, onError]);

  // Keep the newest post in view, as a chat does.
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

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      const spent = Number(minutes);
      setThread(
        await postThreadMessage(topicId, {
          body: body.trim(),
          minutes: staff && spent > 0 ? spent : undefined,
          mediaItemIds: staff && attached.length ? attached.map((a) => a.id) : undefined,
        }),
      );
      setBody('');
      setMinutes('');
      setAttached([]);
      setPicking(false);
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
        <h3>{thread.title}</h3>
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
          <p className="empty">No replies yet. {thread.canPost ? 'Write the first one below.' : ''}</p>
        )}
        {thread.messages.map((m) => (
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
        ))}
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

          {staff && attached.length > 0 && (
            <ul className="thread-chips">
              {attached.map((a) => (
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
              <>
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
                <button type="button" className="btn" onClick={openLibrary}>
                  {picking ? 'Hide media library' : 'Attach from media library'}
                </button>
              </>
            )}
            <button className="btn btn-primary" type="submit" disabled={busy || !body.trim()}>
              {busy ? 'Sending...' : 'Send reply'}
            </button>
          </div>
          {staff && (
            <p className="hint">
              Time spent is billed to the engagement with its meetings, in 30-minute blocks across
              all replies. Clients do not see it.
            </p>
          )}
        </form>
      ) : (
        <p className="notice thread-closed">{thread.closedReason}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- inbox */

/**
 * A list of threads beside the open one. `scope` narrows it to one
 * engagement or one client; with neither it is everything the reader may see.
 */
export function MessagesPanel({
  scope,
  staff,
  initialTopicId,
  onError,
  empty,
}: {
  scope?: { engagementId?: number; clientId?: number };
  staff: boolean;
  /** Opens this thread first, as when arriving from an email. */
  initialTopicId?: number | null;
  onError: OnError;
  empty?: string;
}) {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [open, setOpen] = useState<number | null>(initialTopicId ?? null);
  const engagementId = scope?.engagementId;
  const clientId = scope?.clientId;

  const reload = useCallback(
    () => listThreads({ engagementId, clientId }).then(setThreads).catch(onError),
    [engagementId, clientId, onError],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  // With nothing chosen, start on the most recent conversation.
  useEffect(() => {
    if (open === null && threads && threads.length > 0) setOpen(threads[0].topicId);
  }, [threads, open]);

  if (!threads) return <p className="empty">Loading...</p>;

  if (threads.length === 0 && open === null) {
    return (
      <p className="empty">
        {empty ??
          'No conversations yet. A topic on an engagement run by message, or by both message and video, starts one.'}
      </p>
    );
  }

  const showEngagement = !engagementId;

  return (
    <div className="inbox">
      <ul className="inbox-list" aria-label="Conversations">
        {threads.map((t) => {
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
                {(showEngagement || (staff && !clientId && !engagementId)) && (
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
                    <span className="muted">No replies yet</span>
                  )}
                </span>
                <span className="inbox-item-meta">
                  {waiting && <span className="pill pill-warn">{staff ? 'Needs a reply' : 'New reply'}</span>}
                  {!t.open && <span className="pill pill-neutral">Closed</span>}
                  <span className="muted">
                    {t.messageCount} {t.messageCount === 1 ? 'message' : 'messages'}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="inbox-thread">
        {open === null ? (
          <p className="empty">Choose a conversation.</p>
        ) : (
          <ThreadView topicId={open} staff={staff} onError={onError} onPosted={reload} />
        )}
      </div>
    </div>
  );
}
