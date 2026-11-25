import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createTopic, listTopics, updateTopicStatus, type Topic } from '../api';
import { StatusChip } from '../components/StatusChip';
import { usePageTitle } from '../usePageTitle';

const DEMO_ENGAGEMENT_ID = 1;

const PRIORITY_LABELS: Record<number, string> = {
  1: '1, most urgent',
  2: '2',
  3: '3, normal',
  4: '4',
  5: '5, whenever',
};

/** Same order the API returns: priority first, then oldest first. */
function byPriority(a: Topic, b: Topic) {
  return a.priority - b.priority || a.createdAt.localeCompare(b.createdAt);
}

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

function TopicRow({
  topic,
  busy,
  onSetStatus,
}: {
  topic: Topic;
  busy: boolean;
  onSetStatus: (topic: Topic, status: Topic['status']) => void;
}) {
  const open = topic.status === 'proposed' || topic.status === 'scheduled';
  return (
    <li className={`topic topic-${topic.status}`} aria-busy={busy}>
      <span
        className="priority-badge"
        data-priority={topic.priority}
        title={`Priority ${topic.priority}`}
      >
        <span className="visually-hidden">Priority </span>
        {topic.priority}
      </span>
      <div className="topic-body">
        <p className="topic-title">{topic.title}</p>
        {topic.detail && <p className="topic-detail">{topic.detail}</p>}
        <p className="topic-meta">Added {dateFormat.format(new Date(topic.createdAt))}</p>
      </div>
      <StatusChip status={topic.status} />
      <div className="topic-actions">
        {open ? (
          <>
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() =>
                onSetStatus(topic, topic.status === 'proposed' ? 'scheduled' : 'discussed')
              }
            >
              {topic.status === 'proposed' ? 'Schedule' : 'Mark discussed'}
            </button>
            <button
              type="button"
              className="btn btn-small btn-ghost"
              disabled={busy}
              onClick={() => onSetStatus(topic, 'dropped')}
            >
              Drop
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-small btn-ghost"
            disabled={busy}
            onClick={() => onSetStatus(topic, 'proposed')}
          >
            Reopen
          </button>
        )}
      </div>
    </li>
  );
}

export function Portal() {
  usePageTitle('Session topics');

  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [priority, setPriority] = useState(3);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    listTopics(DEMO_ENGAGEMENT_ID)
      .then((found) => setTopics(found))
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const openTopics = useMemo(
    () => topics.filter((t) => t.status === 'proposed' || t.status === 'scheduled').sort(byPriority),
    [topics],
  );
  const closedTopics = useMemo(
    () => topics.filter((t) => t.status === 'discussed' || t.status === 'dropped').sort(byPriority),
    [topics],
  );
  const scheduledCount = openTopics.filter((t) => t.status === 'scheduled').length;
  const discussedCount = closedTopics.filter((t) => t.status === 'discussed').length;

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || adding) return;

    setAdding(true);
    try {
      const created = await createTopic({
        engagementId: DEMO_ENGAGEMENT_ID,
        title: title.trim(),
        detail: detail.trim() || undefined,
        priority,
      });
      setTopics((prev) => [...prev, created]);
      setTitle('');
      setDetail('');
      setPriority(3);
      setActionError(null);
    } catch (err) {
      setActionError(`Topic not added. ${(err as Error).message}`);
    } finally {
      setAdding(false);
    }
  }

  async function onSetStatus(topic: Topic, status: Topic['status']) {
    setBusyIds((prev) => new Set(prev).add(topic.id));
    try {
      const updated = await updateTopicStatus(topic.id, status);
      setTopics((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setActionError(null);
    } catch (err) {
      setActionError(`"${topic.title}" not updated. ${(err as Error).message}`);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(topic.id);
        return next;
      });
    }
  }

  return (
    <main id="main" className="wrap page portal">
      <header className="page-head">
        <h1>Session topics</h1>
        <p className="lede">
          What you want covered next time. Sessions start at the top of this list.
        </p>
      </header>

      <p className="notice">
        <strong>Preview.</strong> Sign-in is not built yet, so this page shows one fixed
        engagement. Do not enter real client information.
      </p>

      <form onSubmit={onAdd} className="add-form" aria-label="Add a topic">
        <div className="field field-title">
          <label htmlFor="topic-title">Topic</label>
          <input
            id="topic-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What should the next session cover?"
            autoComplete="off"
          />
        </div>
        <div className="field field-priority">
          <label htmlFor="topic-priority">Priority</label>
          <select
            id="topic-priority"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5].map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="field field-detail">
          <label htmlFor="topic-detail">
            Background <span className="optional">optional</span>
          </label>
          <textarea
            id="topic-detail"
            rows={2}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Anything worth knowing before the session"
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={!title.trim() || adding}>
          {adding ? 'Adding…' : 'Add topic'}
        </button>
      </form>

      {actionError && (
        <p className="error" role="alert">
          {actionError}
        </p>
      )}

      {loading ? (
        <ul className="topics" aria-label="Loading topics" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="topic topic-skeleton" />
          ))}
        </ul>
      ) : loadError ? (
        <div className="error load-error" role="alert">
          <p>Topics did not load. {loadError}</p>
          <button type="button" className="btn btn-small" onClick={load}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <section aria-labelledby="open-h">
            <div className="list-head">
              <h2 id="open-h">Up next</h2>
              <p>
                {openTopics.length} open, {scheduledCount} scheduled, {discussedCount} discussed
              </p>
            </div>
            {openTopics.length === 0 ? (
              <p className="empty">
                Nothing queued. Add the first thing you want covered in the form above.
              </p>
            ) : (
              <ul className="topics">
                {openTopics.map((t) => (
                  <TopicRow
                    key={t.id}
                    topic={t}
                    busy={busyIds.has(t.id)}
                    onSetStatus={onSetStatus}
                  />
                ))}
              </ul>
            )}
          </section>

          {closedTopics.length > 0 && (
            <details className="closed">
              <summary>
                <h2>Discussed and dropped</h2>
                <span>{closedTopics.length}</span>
              </summary>
              <ul className="topics">
                {closedTopics.map((t) => (
                  <TopicRow
                    key={t.id}
                    topic={t}
                    busy={busyIds.has(t.id)}
                    onSetStatus={onSetStatus}
                  />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </main>
  );
}
