/**
 * The client portal: a full-screen application with its own navigation.
 *
 * Four views, kept in the URL (?view=) so refresh and back work:
 * Overview (what is next and what is owed), Topics (the agenda backlog),
 * Meetings (book, review, cancel) and Billing (invoices, payments, billed
 * time, statement).
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  cancelAppointment,
  createTopic,
  listAppointments,
  listEngagements,
  listTopics,
  updateTopicStatus,
  Unauthorized,
  type Appointment,
  type Engagement,
  type Topic,
} from './api';
import type { User } from './auth';
import { Modal } from './admin-meetings';
import { InvoiceStatus } from './billing';
import {
  PAYMENT_METHODS,
  day,
  getMyBilling,
  hours,
  money,
  type ClientBilling,
} from './billing-api';
import { BookingForm, formatLength, formatRange, plural, statusLabel } from './scheduling';
import { JoinCallButton } from './video';

type View = 'overview' | 'topics' | 'meetings' | 'billing';

const VIEWS: { id: View; label: string; blurb: string; icon: ReactNode }[] = [
  {
    id: 'overview',
    label: 'Overview',
    blurb: 'Your next meeting, open topics and account balance at a glance.',
    icon: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  },
  {
    id: 'topics',
    label: 'Topics',
    blurb: 'What you want covered. Say what a good answer looks like and we can prepare before the call.',
    icon: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  },
  {
    id: 'meetings',
    label: 'Meetings',
    blurb: 'Request a meeting for your open topics, and see what is booked.',
    icon: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="1.5" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </>
    ),
  },
  {
    id: 'billing',
    label: 'Billing',
    blurb: 'Invoices, payments and the time billed to your account, in 30-minute increments.',
    icon: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4" />,
  },
];

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const PRIORITY: Record<number, string> = {
  1: 'Blocking',
  2: 'High',
  3: 'Normal',
  4: 'Low',
  5: 'Whenever',
};

export function ClientPortal({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [params, setParams] = useSearchParams();
  const view: View = VIEWS.some((v) => v.id === params.get('view'))
    ? (params.get('view') as View)
    : 'overview';

  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [billing, setBilling] = useState<ClientBilling | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [booking, setBooking] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const onError = useCallback(
    (e: unknown) => {
      if (e instanceof Unauthorized) {
        onSignOut();
        return;
      }
      setError((e as Error).message);
    },
    [onSignOut],
  );

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const loadBilling = useCallback(
    // Billing is additive: the portal works if it fails. An admin previewing
    // the portal has no client account; the endpoint would answer 403, which
    // the API client treats as a dead session and signs them out.
    () =>
      user.role === 'ADMIN'
        ? Promise.resolve(setBilling(null))
        : getMyBilling().then(setBilling).catch(() => setBilling(null)),
    [user.role],
  );

  useEffect(() => {
    Promise.all([listEngagements(), listAppointments(), loadBilling()])
      .then(([list, appts]) => {
        setEngagements(list);
        setAppointments(appts);
        const live = list.find((e) => e.status === 'active') ?? list[0];
        setSelected(live ? live.id : null);
      })
      .catch(onError)
      .finally(() => setLoading(false));
  }, [onError, loadBilling]);

  const reloadTopics = useCallback(async () => {
    if (selected === null) {
      setTopics([]);
      return;
    }
    setTopics(await listTopics(selected));
  }, [selected]);

  useEffect(() => {
    reloadTopics().catch(onError);
  }, [reloadTopics, onError]);

  function go(v: View) {
    setParams(v === 'overview' ? {} : { view: v });
    setError(null);
    setNavOpen(false);
  }

  const bookable = engagements.filter((e) => e.status === 'active');
  const openTopics = topics.filter((t) => t.status === 'proposed');
  const now = new Date();
  const upcoming = appointments
    .filter((a) => a.status !== 'cancelled' && a.status !== 'completed' && new Date(a.endsAt) > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = appointments.filter((a) => !upcoming.includes(a));
  const firstName = user.name.split(/\s+/)[0];
  const current = VIEWS.find((v) => v.id === view)!;
  const engagementTitle = engagements.find((e) => e.id === selected)?.title;

  async function onCancelMeeting(a: Appointment) {
    if (!window.confirm('Cancel this meeting? Its topics go back to your list.')) return;
    try {
      const updated = await cancelAppointment(a.id);
      setAppointments((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      await reloadTopics();
      setToast('Meeting cancelled. Its topics are back in your list.');
    } catch (e) {
      onError(e);
    }
  }

  async function onDropTopic(t: Topic) {
    if (!window.confirm(`Drop “${t.title}”? It will not go on a meeting.`)) return;
    try {
      const updated = await updateTopicStatus(t.id, 'dropped');
      setTopics((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      onError(e);
    }
  }

  const startBooking = () => {
    if (view !== 'meetings') go('meetings');
    setBooking(true);
  };

  return (
    <div className="admin-shell portal-shell">
      <aside className={navOpen ? 'admin-side open' : 'admin-side'}>
        <div className="admin-brand">
          <Link to="/" className="admin-brand-mark">
            <span className="portal-mark" aria-hidden="true" />
            Data Painters
          </Link>
          <span className="admin-brand-sub">Client portal</span>
        </div>
        <button className="admin-nav-toggle" aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)}>
          {current.label}
          <span aria-hidden="true">▾</span>
        </button>
        <nav className="admin-nav" aria-label="Portal">
          <div className="admin-nav-group">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                className={view === v.id ? 'admin-nav-item on' : 'admin-nav-item'}
                aria-current={view === v.id ? 'page' : undefined}
                onClick={() => go(v.id)}
              >
                <Icon>{v.icon}</Icon>
                {v.label}
                {v.id === 'topics' && openTopics.length > 0 && <span className="nav-badge">{openTopics.length}</span>}
                {v.id === 'billing' && billing && billing.summary.amountDueCents > 0 && (
                  <span className={billing.summary.overdueCents > 0 ? 'nav-badge bad' : 'nav-badge'}>
                    {money(billing.summary.amountDueCents).replace('.00', '')}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="portal-help">
            <strong>Need something?</strong>
            <p>Reply to any email from us, or add a topic and we will pick it up before your next call.</p>
          </div>
        </nav>
        <div className="admin-side-foot">
          <div className="admin-me">
            <span className="avatar" aria-hidden="true">
              {user.name
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase())
                .join('')}
            </span>
            <span className="admin-me-text">
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
          </div>
          <div className="admin-me-actions">
            <Link to="/account">Password</Link>
            <button className="linklike" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-top portal-top">
          <div>
            <p className="crumbs">
              {view === 'overview' ? new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Client portal'}
            </p>
            <h1>{view === 'overview' ? `Welcome back, ${firstName}` : current.label}</h1>
            <p className="muted">{current.blurb}</p>
          </div>
          <div className="top-actions">
            {view !== 'billing' && (
              <>
                <button className="btn" onClick={() => setAdding(true)} disabled={selected === null}>
                  + Add topic
                </button>
                <button className="btn btn-primary" onClick={startBooking} disabled={bookable.length === 0}>
                  Schedule a meeting
                </button>
              </>
            )}
            {view === 'billing' && (
              <button className="btn" onClick={() => window.open('/portal/statement', '_blank')}>
                Download statement
              </button>
            )}
          </div>
        </header>

        <div className="admin-content">
          {error && (
            <div className="error" role="alert">
              <span>{error}</span>
              <button className="dismiss" aria-label="Dismiss" onClick={() => setError(null)}>
                &times;
              </button>
            </div>
          )}

          {loading ? (
            <div className="kpis">
              {[0, 1, 2, 3].map((i) => (
                <div className="kpi skeleton" key={i} />
              ))}
            </div>
          ) : engagements.length === 0 ? (
            <div className="empty-state">
              <p>
                <strong>Your workspace is being set up.</strong>
              </p>
              <p className="muted">Once we open an engagement for you, your topics and meetings will appear here.</p>
            </div>
          ) : (
            <>
              {engagements.length > 1 && view !== 'billing' && (
                <label className="engagement-switch">
                  Engagement
                  <select value={selected ?? ''} onChange={(e) => setSelected(Number(e.target.value))}>
                    {engagements.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.title}
                        {e.status !== 'active' ? ` (${e.status})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {view === 'overview' && (
                <Overview
                  onError={onError}
                  upcoming={upcoming}
                  openTopics={openTopics}
                  billing={billing}
                  engagementTitle={engagementTitle}
                  onGo={go}
                  onAddTopic={() => setAdding(true)}
                  onBook={startBooking}
                />
              )}

              {view === 'topics' && (
                <TopicsView topics={topics} onDrop={onDropTopic} onAdd={() => setAdding(true)} onBook={startBooking} canBook={bookable.length > 0} />
              )}

              {view === 'meetings' && (
                <MeetingsView onError={onError} upcoming={upcoming} past={past} onCancel={onCancelMeeting} onBook={startBooking} canBook={bookable.length > 0} />
              )}

              {view === 'billing' && <BillingView billing={billing} />}
            </>
          )}
        </div>
      </main>

      {adding && selected !== null && (
        <AddTopicModal
          engagementId={selected}
          engagementTitle={engagementTitle}
          onCancel={() => setAdding(false)}
          onError={onError}
          onAdded={(t) => {
            setTopics((prev) => [...prev, t]);
            setAdding(false);
            setToast(`Topic “${t.title}” added`);
          }}
        />
      )}

      {booking && (
        <Modal title="Schedule a meeting" onClose={() => setBooking(false)}>
          <BookingForm
            engagements={bookable}
            initialEngagementId={selected}
            openTopics={openTopics}
            onCancel={() => setBooking(false)}
            onError={onError}
            onBooked={async (a) => {
              setAppointments((prev) => [a, ...prev]);
              setBooking(false);
              setToast('Meeting requested. We will confirm the time by email.');
              await reloadTopics();
            }}
          />
        </Modal>
      )}

      {toast && (
        <div className="toast" role="status">
          <span className="toast-dot" aria-hidden="true" />
          {toast}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- overview */

function Overview({
  onError,
  upcoming,
  openTopics,
  billing,
  engagementTitle,
  onGo,
  onAddTopic,
  onBook,
}: {
  upcoming: Appointment[];
  openTopics: Topic[];
  billing: ClientBilling | null;
  engagementTitle?: string;
  onGo: (v: View) => void;
  onAddTopic: () => void;
  onBook: () => void;
  onError: (e: unknown) => void;
}) {
  const next = upcoming[0];
  const s = billing?.summary;

  return (
    <>
      <div className="kpis">
        <button className="kpi" onClick={() => onGo('meetings')}>
          <span className="kpi-label">Next meeting</span>
          <span className="kpi-value kpi-value-sm">
            {next ? new Date(next.startsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
          </span>
          <span className="kpi-hint">
            {next
              ? `${new Date(next.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${statusLabel(next.status)}`
              : 'Nothing booked'}
          </span>
        </button>
        <button className="kpi" onClick={() => onGo('topics')}>
          <span className="kpi-label">Open topics</span>
          <span className="kpi-value">{openTopics.length}</span>
          <span className="kpi-hint">{openTopics.length ? 'Ready to go on a meeting' : 'Add what you want covered'}</span>
        </button>
        <button className={s && s.overdueCents > 0 ? 'kpi kpi-bad' : 'kpi'} onClick={() => onGo('billing')}>
          <span className="kpi-label">Amount due</span>
          <span className="kpi-value kpi-value-sm">{s ? money(s.amountDueCents) : '—'}</span>
          <span className="kpi-hint">
            {!s
              ? 'Billing unavailable'
              : s.overdueCents > 0
                ? `${money(s.overdueCents)} past due`
                : s.nextDueOn
                  ? `Next due ${day(s.nextDueOn)}`
                  : 'Nothing outstanding'}
          </span>
        </button>
        <button className="kpi" onClick={() => onGo('billing')}>
          <span className="kpi-label">Time billed</span>
          <span className="kpi-value kpi-value-sm">{s ? hours(s.billedBlocks * 30) : '—'}</span>
          <span className="kpi-hint">{s ? `${s.billedBlocks} × 30-minute blocks` : ''}</span>
        </button>
      </div>

      <div className="panels">
        <section className="panel-card">
          <header>
            <h2>Coming up</h2>
            <button className="linklike" onClick={() => onGo('meetings')}>
              All meetings →
            </button>
          </header>
          {upcoming.length === 0 ? (
            <div className="panel-empty">
              <p>No meetings booked{engagementTitle ? ` for ${engagementTitle}` : ''}.</p>
              <button className="btn btn-primary" onClick={onBook}>
                Schedule a meeting
              </button>
            </div>
          ) : (
            <ul className="meeting-list static">
              {upcoming.slice(0, 4).map((a) => (
                <li key={a.id}>
                  <div className="ml-row">
                    <span className="ml-date">
                      <b>{new Date(a.startsAt).getDate()}</b>
                      <small>{new Date(a.startsAt).toLocaleDateString(undefined, { month: 'short' })}</small>
                    </span>
                    <span className="ml-main">
                      <strong>{formatRange(a.startsAt, a.endsAt)}</strong>
                      <span className="muted">
                        {a.engagementTitle} · {plural(a.topicCount, 'topic')}
                      </span>
                    </span>
                    <span className="ml-actions">
                      <span className={`status status-ap-${a.status}`}>{statusLabel(a.status)}</span>
                      <JoinCallButton appointment={a} onError={onError} size="sm" />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel-card">
          <header>
            <h2>Open topics</h2>
            <button className="linklike" onClick={() => onGo('topics')}>
              All topics →
            </button>
          </header>
          {openTopics.length === 0 ? (
            <div className="panel-empty">
              <p>Nothing waiting. Add the next thing you want covered.</p>
              <button className="btn" onClick={onAddTopic}>
                + Add topic
              </button>
            </div>
          ) : (
            <ul className="topic-mini">
              {openTopics.slice(0, 5).map((t) => (
                <li key={t.id}>
                  <span className={`prio prio-${t.priority}`}>{PRIORITY[t.priority] ?? `P${t.priority}`}</span>
                  <span>{t.title}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {billing && billing.invoices.length > 0 && (
        <section className="panel-card spaced">
          <header>
            <h2>Recent invoices</h2>
            <button className="linklike" onClick={() => onGo('billing')}>
              Billing →
            </button>
          </header>
          <InvoiceTable invoices={billing.invoices.slice(0, 3)} />
        </section>
      )}
    </>
  );
}

/* ----------------------------------------------------------------- topics */

function TopicsView({
  topics,
  onDrop,
  onAdd,
  onBook,
  canBook,
}: {
  topics: Topic[];
  onDrop: (t: Topic) => void;
  onAdd: () => void;
  onBook: () => void;
  canBook: boolean;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const open = topics.filter((t) => t.status === 'proposed').sort((a, b) => a.priority - b.priority);
  const scheduled = topics.filter((t) => t.status === 'scheduled');
  const closed = topics.filter((t) => t.status === 'discussed' || t.status === 'dropped');

  if (topics.length === 0) {
    return (
      <div className="empty-state">
        <p>
          <strong>No topics yet.</strong>
        </p>
        <p className="muted">Add the first thing you want covered. A clear desired outcome helps us prepare before the call.</p>
        <p>
          <button className="btn btn-primary" onClick={onAdd}>
            + Add topic
          </button>
        </p>
      </div>
    );
  }

  const card = (t: Topic) => (
    <article key={t.id} className={`topic-card topic-${t.status}`}>
      <header>
        <span className={`prio prio-${t.priority}`}>{PRIORITY[t.priority] ?? `P${t.priority}`}</span>
        <h3>{t.title}</h3>
        <span className={`status status-${t.status}`}>{t.status === 'scheduled' ? 'on a meeting' : t.status}</span>
      </header>
      {t.detail && <p className="muted">{t.detail}</p>}
      {t.desiredOutcome && (
        <p className="topic-outcome">
          <strong>Good outcome:</strong> {t.desiredOutcome}
        </p>
      )}
      {t.status === 'proposed' && (
        <footer>
          <button className="linklike danger" onClick={() => onDrop(t)}>
            Drop
          </button>
        </footer>
      )}
    </article>
  );

  return (
    <div className="topic-board">
      <section>
        <div className="board-head">
          <h2>Open</h2>
          <span className="tab-count">{open.length}</span>
          {open.length > 0 && canBook && (
            <button className="btn btn-sm" onClick={onBook}>
              Put on a meeting
            </button>
          )}
        </div>
        {open.length === 0 ? <p className="empty">No open topics.</p> : open.map(card)}
      </section>
      <section>
        <div className="board-head">
          <h2>On a meeting</h2>
          <span className="tab-count">{scheduled.length}</span>
        </div>
        {scheduled.length === 0 ? <p className="empty">Nothing scheduled.</p> : scheduled.map(card)}
      </section>
      {closed.length > 0 && (
        <section className="board-closed">
          <button className="linklike" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? 'Hide' : 'Show'} {closed.length} discussed or dropped
          </button>
          {showClosed && closed.map(card)}
        </section>
      )}
    </div>
  );
}

function AddTopicModal({
  engagementId,
  engagementTitle,
  onAdded,
  onCancel,
  onError,
}: {
  engagementId: number;
  engagementTitle?: string;
  onAdded: (t: Topic) => void;
  onCancel: () => void;
  onError: (e: unknown) => void;
}) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [outcome, setOutcome] = useState('');
  const [priority, setPriority] = useState(3);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onAdded(
        await createTopic({
          engagementId,
          title: title.trim(),
          detail: detail.trim() || undefined,
          desiredOutcome: outcome.trim() || undefined,
          priority,
        }),
      );
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New topic" onClose={onCancel}>
      <form className="stack-form" onSubmit={submit}>
        {engagementTitle && <p className="muted">For {engagementTitle}</p>}
        <label>
          Title
          <input value={title} required autoFocus maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Short name for the topic" />
        </label>
        <label>
          Background
          <textarea value={detail} rows={3} onChange={(e) => setDetail(e.target.value)} placeholder="What you have tried, where it is stuck" />
        </label>
        <label>
          What would a good outcome be?
          <textarea value={outcome} rows={2} onChange={(e) => setOutcome(e.target.value)} placeholder="What should be true once we have discussed this?" />
        </label>
        <label>
          Priority
          <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((p) => (
              <option key={p} value={p}>
                {PRIORITY[p]}
              </option>
            ))}
          </select>
        </label>
        <div className="button-row">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add topic'}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------------- meetings */

function MeetingsView({
  onError,
  upcoming,
  past,
  onCancel,
  onBook,
  canBook,
}: {
  upcoming: Appointment[];
  past: Appointment[];
  onCancel: (a: Appointment) => void;
  onBook: () => void;
  canBook: boolean;
  onError: (e: unknown) => void;
}) {
  const table = (rows: Appointment[], allowCancel: boolean) => (
    <div className="grid-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th>When</th>
            <th>Length</th>
            <th>Engagement</th>
            <th>Agenda</th>
            <th>Status</th>
            {allowCancel && <th>Video</th>}
            {allowCancel && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className={a.status === 'cancelled' ? 'row-bad' : undefined}>
              <td className="nowrap">
                <strong>{formatRange(a.startsAt, a.endsAt)}</strong>
              </td>
              <td className="nowrap">{formatLength(a.durationMinutes)}</td>
              <td>{a.engagementTitle}</td>
              <td>{plural(a.topicCount, 'topic')}</td>
              <td>
                <span className={`status status-ap-${a.status}`}>{statusLabel(a.status)}</span>
              </td>
              {allowCancel && (
                <td className="nowrap">
                  {a.video ? (
                    <JoinCallButton appointment={a} onError={onError} size="sm" />
                  ) : (
                    <span className="muted small">
                      {a.status === 'requested' ? 'After confirmation' : '—'}
                    </span>
                  )}
                </td>
              )}
              {allowCancel && (
                <td>
                  <button className="linklike danger" onClick={() => onCancel(a)}>
                    Cancel
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <h2 className="section-label first">Upcoming</h2>
      {upcoming.length === 0 ? (
        <div className="empty-state">
          <p>
            <strong>Nothing scheduled.</strong>
          </p>
          <p className="muted">Pick your open topics and a time; we confirm by email. Meetings run in 30-minute blocks.</p>
          {canBook && (
            <p>
              <button className="btn btn-primary" onClick={onBook}>
                Schedule a meeting
              </button>
            </p>
          )}
        </div>
      ) : (
        table(upcoming, true)
      )}
      {past.length > 0 && (
        <>
          <h2 className="section-label">Past and cancelled</h2>
          {table(past, false)}
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- billing */

function InvoiceTable({ invoices }: { invoices: ClientBilling['invoices'] }) {
  return (
    <div className="grid-wrap flush">
      <table className="grid">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Issued</th>
            <th>Due</th>
            <th className="num">Total</th>
            <th className="num">Balance</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id}>
              <td className="nowrap">
                <strong>{i.number}</strong>
              </td>
              <td className="nowrap">{day(i.issuedOn)}</td>
              <td className="nowrap">
                {day(i.dueOn)}
                {i.daysOverdue > 0 && <div className="small neg-text">{i.daysOverdue} days overdue</div>}
              </td>
              <td className="num">{money(i.totalCents)}</td>
              <td className="num">
                <strong>{money(i.balanceCents)}</strong>
              </td>
              <td>
                <InvoiceStatus status={i.status} />
              </td>
              <td>
                <button className="linklike" onClick={() => window.open(`/portal/invoice/${i.id}`, '_blank')}>
                  View / PDF
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BillingView({ billing }: { billing: ClientBilling | null }) {
  const [tab, setTab] = useState<'invoices' | 'payments' | 'time'>('invoices');
  const byMonth = useMemo(() => {
    const m = new Map<string, { minutes: number; blocks: number; amount: number }>();
    billing?.billed.forEach((b) => {
      const k = b.serviceDate.slice(0, 7);
      const cur = m.get(k) ?? { minutes: 0, blocks: 0, amount: 0 };
      m.set(k, { minutes: cur.minutes + (b.minutes ?? 0), blocks: cur.blocks + (b.blocks ?? 0), amount: cur.amount + b.amountCents });
    });
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [billing]);

  if (!billing) {
    return <p className="empty">Billing is not available right now. Please try again shortly.</p>;
  }
  const s = billing.summary;

  return (
    <>
      <div className="kpis">
        <div className={s.overdueCents > 0 ? 'kpi kpi-static kpi-bad' : s.amountDueCents > 0 ? 'kpi kpi-static kpi-warn' : 'kpi kpi-static'}>
          <span className="kpi-label">Amount due</span>
          <span className="kpi-value kpi-value-sm">{money(s.amountDueCents)}</span>
          <span className="kpi-hint">
            {s.overdueCents > 0 ? `${money(s.overdueCents)} past due` : s.nextDueOn ? `Next due ${day(s.nextDueOn)}` : 'You are all paid up'}
          </span>
        </div>
        <div className="kpi kpi-static">
          <span className="kpi-label">Paid to date</span>
          <span className="kpi-value kpi-value-sm">{money(s.paidCents)}</span>
          <span className="kpi-hint">{s.lastPaymentOn ? `Last payment ${day(s.lastPaymentOn)}` : 'No payments yet'}</span>
        </div>
        <div className="kpi kpi-static">
          <span className="kpi-label">Time billed</span>
          <span className="kpi-value kpi-value-sm">{hours(s.billedBlocks * 30)}</span>
          <span className="kpi-hint">
            {s.billedMinutes} min recorded · {s.billedBlocks} × 30-min blocks
          </span>
        </div>
        <div className="kpi kpi-static">
          <span className="kpi-label">Not yet invoiced</span>
          <span className="kpi-value kpi-value-sm">{money(s.notYetInvoicedCents)}</span>
          <span className="kpi-hint">Appears on your next invoice</span>
        </div>
      </div>

      {s.creditCents > 0 && (
        <div className="notice">
          <span>
            You have {money(s.creditCents)} on account. It is applied against your open invoices.
          </span>
        </div>
      )}

      <div className="billing-layout">
        <div>
          <div className="tabs" role="tablist">
            {(
              [
                ['invoices', `Invoices`, billing.invoices.length],
                ['payments', 'Payments', billing.payments.length],
                ['time', 'Billed time', billing.billed.length],
              ] as const
            ).map(([id, label, count]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'tab tab-on' : 'tab'} onClick={() => setTab(id)}>
                {label}
                <span className="tab-count">{count}</span>
              </button>
            ))}
          </div>

          {tab === 'invoices' &&
            (billing.invoices.length === 0 ? (
              <div className="empty-state">
                <p>
                  <strong>No invoices yet.</strong>
                </p>
                <p className="muted">Invoices appear here as soon as we issue them.</p>
              </div>
            ) : (
              <InvoiceTable invoices={billing.invoices} />
            ))}

          {tab === 'payments' &&
            (billing.payments.length === 0 ? (
              <div className="empty-state">
                <p>
                  <strong>No payments recorded.</strong>
                </p>
              </div>
            ) : (
              <div className="grid-wrap flush">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Received</th>
                      <th>Applied to</th>
                      <th>Method</th>
                      <th>Reference</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billing.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="nowrap">{day(p.receivedOn)}</td>
                        <td>{p.invoiceNumber ?? <span className="muted">On account</span>}</td>
                        <td>{PAYMENT_METHODS.find((m) => m.value === p.method)?.label ?? p.method}</td>
                        <td>{p.reference ?? <span className="muted">—</span>}</td>
                        <td className="num">
                          <strong>{money(p.amountCents)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

          {tab === 'time' &&
            (billing.billed.length === 0 ? (
              <div className="empty-state">
                <p>
                  <strong>No billed time yet.</strong>
                </p>
                <p className="muted">Time from completed meetings appears here, rounded to 30-minute blocks.</p>
              </div>
            ) : (
              <>
                <div className="month-strip">
                  {byMonth.slice(0, 6).map(([m, v]) => (
                    <div key={m}>
                      <span className="kpi-label">
                        {new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1).toLocaleDateString(undefined, {
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                      <b>{hours(v.blocks * 30)}</b>
                      <small>{money(v.amount)}</small>
                    </div>
                  ))}
                </div>
                <div className="grid-wrap flush">
                  <table className="grid">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th className="num">Recorded</th>
                        <th className="num">Billed</th>
                        <th className="num">Amount</th>
                        <th>Invoice</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billing.billed.map((b) => (
                        <tr key={b.id}>
                          <td className="nowrap">{day(b.serviceDate)}</td>
                          <td>{b.description}</td>
                          <td className="num">{b.minutes ? `${b.minutes} min` : '—'}</td>
                          <td className="num">{b.blocks ? `${b.blocks} × 30 min` : '—'}</td>
                          <td className="num">
                            <strong>{money(b.amountCents)}</strong>
                          </td>
                          <td>{b.invoiceNumber ?? <span className="muted">Next invoice</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ))}
        </div>

        <aside className="billing-aside">
          <section className="panel-card">
            <header>
              <h2>How billing works</h2>
            </header>
            <ul className="facts">
              <li>
                <span>Rate</span>
                <b>{billing.hourlyRateCents > 0 ? `${money(billing.hourlyRateCents)} / hour` : 'Per your agreement'}</b>
              </li>
              <li>
                <span>Increments</span>
                <b>30 minutes</b>
              </li>
              <li>
                <span>Payment terms</span>
                <b>{billing.paymentTermsDays} days</b>
              </li>
            </ul>
            <p className="aside-copy muted">
              Time is tracked during each meeting and rounded up to the next 30-minute block when the
              meeting is completed. Your first consultation is free.
            </p>
          </section>
          {billing.paymentInstructions && (
            <section className="panel-card">
              <header>
                <h2>How to pay</h2>
              </header>
              <p className="aside-copy">{billing.paymentInstructions}</p>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
