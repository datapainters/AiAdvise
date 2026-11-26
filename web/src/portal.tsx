/**
 * The client portal: a full-screen application with its own navigation.
 *
 * Four views, kept in the URL (?view=) so refresh and back work:
 * Overview (what is next and what is owed), Topics (the agenda backlog),
 * Meetings (book, review, cancel) and Billing (invoices, payments, billed
 * time, statement).
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Paged } from './datagrid';
import { Link, useSearchParams } from 'react-router-dom';
import {
  cancelAppointment,
  createTopic,
  listAppointments,
  listEngagements,
  listTopics,
  COMMUNICATION_LABELS,
  getClientTeam,
  listThreads,
  Unauthorized,
  type ClientTeamMember,
  type ThreadSummary,
  type Appointment,
  type Engagement,
  type Topic,
} from './api';
import { CLIENT_ROLE_LABELS, managesClient, type User } from './auth';
import { EngagementsView, NewEngagementModal, TeamMembersView } from './portal-team';
import { MessagesPanel, ThreadView } from './threads';
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

/** `messages` is the Topics screen; the id is kept because emailed links use it. */
type View = 'overview' | 'engagements' | 'meetings' | 'messages' | 'team' | 'billing';

/** Views that are about one engagement, and so show the engagement picker. */
const PER_ENGAGEMENT: View[] = ['overview', 'meetings'];

const VIEWS: { id: View; label: string; blurb: string; icon: ReactNode }[] = [
  {
    id: 'overview',
    label: 'Overview',
    blurb: 'Replies waiting for you, what is coming up, and the work in progress.',
    icon: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  },
  {
    id: 'engagements',
    label: 'Engagements',
    blurb: 'Each piece of work we are doing together, how it is run, and who is on it.',
    icon: <path d="M3 8h18v12H3zM8 8V5h8v3M3 13h18" />,
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
    id: 'messages',
    label: 'Topics',
    blurb: 'Everything you want covered, with the conversation and meeting notes on each.',
    icon: <path d="M4 5h16v11H9l-5 4zM8 9h8M8 12.5h5" />,
  },
  {
    id: 'team',
    label: 'Team Members',
    blurb: 'The people at your organisation who have a login here.',
    icon: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14.3c2.4.6 4 2.6 4 5.7" />
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
  // Bookmarks to the old Topics screen land on its replacement.
  const asked = params.get('view') === 'topics' ? 'messages' : params.get('view');
  const view: View = VIEWS.some((v) => v.id === asked) ? (asked as View) : 'overview';

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
  const [opening, setOpening] = useState(false);
  const [roster, setRoster] = useState<ClientTeamMember[] | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [openThread, setOpenThread] = useState<number | null>(null);
  /** Narrows the Topics screen to one engagement; null shows them all. */
  const [topicFilter, setTopicFilter] = useState<number | null>(null);
  const [topicsVersion, setTopicsVersion] = useState(0);
  // An admin previewing the portal has no client account; the client-only
  // endpoints would answer 403, which signs them out.
  const isClient = user.role === 'CLIENT';
  const canOpen = isClient && managesClient(user);
  const onRoster = useCallback((members: ClientTeamMember[]) => setRoster(members), []);

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

  // Who can be put on an engagement, and which topics have conversations.
  useEffect(() => {
    if (isClient) getClientTeam().then((t) => setRoster(t.members)).catch(() => setRoster(null));
  }, [isClient]);

  const reloadThreads = useCallback(() => listThreads().then(setThreads).catch(() => setThreads([])), []);

  useEffect(() => {
    reloadThreads();
  }, [reloadThreads, topics.length]);

  function go(v: View) {
    setParams(v === 'overview' ? {} : { view: v });
    setError(null);
    setNavOpen(false);
  }

  // A message-only engagement has no meetings to book.
  const bookable = engagements.filter((e) => e.status === 'active' && e.communication !== 'message');
  const waitingReplies = threads.filter((t) => t.open && t.lastSide === 'team').length;
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

  const startBooking = () => {
    if (view !== 'meetings') go('meetings');
    setBooking(true);
  };

  return (
    <div className="admin-shell portal-shell">
      <aside className={navOpen ? 'admin-side open' : 'admin-side'}>
        <div className="admin-brand">
          <Link to="/" className="admin-brand-mark" aria-label="Data Painters home">
            <img className="brand-logo" src="/brand/logo-horizontal.svg" alt="Data Painters" />
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
                {v.id === 'messages' && waitingReplies > 0 && <span className="nav-badge">{waitingReplies}</span>}
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
            <p>Add a topic and we will pick it up, by message or before your next call.</p>
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
            {(PER_ENGAGEMENT.includes(view) || view === 'messages') && (
              <>
                <button className="btn" onClick={() => setAdding(true)} disabled={selected === null}>
                  + Add topic
                </button>
                <button className="btn btn-primary" onClick={startBooking} disabled={bookable.length === 0}>
                  Schedule a meeting
                </button>
              </>
            )}
            {view === 'engagements' && canOpen && (
              <button className="btn btn-primary" onClick={() => setOpening(true)}>
                New engagement
              </button>
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
          ) : view === 'engagements' ? (
            <EngagementsView
              engagements={engagements}
              roster={roster}
              canOpen={canOpen}
              onNew={() => setOpening(true)}
              onError={onError}
              onOpenTopics={(id) => {
                setSelected(id);
                setTopicFilter(id);
                go('messages');
              }}
            />
          ) : view === 'team' ? (
            isClient ? (
              <TeamMembersView user={user} onLoaded={onRoster} onError={onError} onToast={(m) => setToast(m)} />
            ) : (
              <p className="empty">Team members are managed by each client&rsquo;s own account owner.</p>
            )
          ) : view === 'messages' ? (
            <>
              {engagements.length > 1 && (
                <label className="engagement-switch">
                  Engagement
                  <select
                    value={topicFilter ?? ''}
                    onChange={(e) => setTopicFilter(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">All engagements</option>
                    {engagements.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.title}
                        {e.status !== 'active' ? ` (${e.status})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <MessagesPanel
                all
                scope={topicFilter ? { engagementId: topicFilter } : undefined}
                refreshKey={topicsVersion}
                onError={onError}
                initialTopicId={Number(params.get('topic')) || null}
                empty="No topics yet. Add the first thing you want covered."
              />
            </>
          ) : engagements.length === 0 ? (
            <div className="empty-state">
              <p>
                <strong>You have no engagements yet.</strong>
              </p>
              <p className="muted">
                An engagement is one piece of work with a goal. Topics, meetings and messages are kept
                under it.
              </p>
              {canOpen && (
                <p>
                  <button className="btn btn-primary" onClick={() => setOpening(true)}>
                    New engagement
                  </button>
                </p>
              )}
            </div>
          ) : (
            <>
              {engagements.length > 1 && view === 'meetings' && (
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
                  engagements={engagements}
                  upcoming={upcoming}
                  threads={threads}
                  roster={roster}
                  openTopics={openTopics}
                  billing={billing}
                  engagementTitle={engagementTitle}
                  canOpen={canOpen}
                  onGo={go}
                  onAddTopic={() => setAdding(true)}
                  onBook={startBooking}
                  onOpenThread={(id) => setOpenThread(id)}
                  onNewEngagement={() => setOpening(true)}
                  onOpenEngagement={(id) => {
                    setSelected(id);
                    setTopicFilter(id);
                    go('messages');
                  }}
                />
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
          engagements={engagements.filter((e) => e.status !== 'closed')}
          initialEngagementId={view === 'messages' && topicFilter ? topicFilter : selected}
          onCancel={() => setAdding(false)}
          onError={onError}
          onAdded={(t) => {
            if (t.engagementId === selected) setTopics((prev) => [...prev, t]);
            setTopicsVersion((n) => n + 1);
            setAdding(false);
            setToast(`Topic “${t.title}” added`);
          }}
        />
      )}

      {opening && (
        <NewEngagementModal
          onCancel={() => setOpening(false)}
          onError={onError}
          onDone={(created) => {
            setEngagements((prev) => [created, ...prev]);
            setSelected(created.id);
            setOpening(false);
            setToast(`Engagement “${created.title}” opened`);
          }}
        />
      )}

      {openThread !== null && (
        <Modal title="Conversation" onClose={() => setOpenThread(null)} wide>
          <ThreadView topicId={openThread} onError={onError} onPosted={reloadThreads} />
        </Modal>
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

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

/**
 * The dashboard. It answers, in order: is anyone waiting on me, what is
 * coming up, what work is open, who is involved, and what do I owe.
 *
 * Everything here spans the whole account. The Topics and Meetings screens
 * are where one engagement is looked at on its own.
 */
function Overview({
  onError,
  engagements,
  upcoming,
  threads,
  roster,
  openTopics,
  billing,
  engagementTitle,
  canOpen,
  onGo,
  onAddTopic,
  onBook,
  onOpenThread,
  onNewEngagement,
  onOpenEngagement,
}: {
  engagements: Engagement[];
  upcoming: Appointment[];
  threads: ThreadSummary[];
  /** The client's own people; null when it could not be loaded. */
  roster: ClientTeamMember[] | null;
  openTopics: Topic[];
  billing: ClientBilling | null;
  engagementTitle?: string;
  canOpen: boolean;
  onGo: (v: View) => void;
  onAddTopic: () => void;
  onBook: () => void;
  onOpenThread: (topicId: number) => void;
  onNewEngagement: () => void;
  onOpenEngagement: (engagementId: number) => void;
  onError: (e: unknown) => void;
}) {
  const next = upcoming[0];
  const s = billing?.summary;
  const active = engagements.filter((e) => e.status === 'active' || e.status === 'inquiry');
  const newReplies = threads.filter((t) => t.open && t.lastSide === 'team');
  const openThreads = threads.filter((t) => t.open);
  const people = (roster ?? []).filter((m) => m.enabled);
  // Answers waiting to be read come first; then whatever moved most recently.
  const recent = [...newReplies, ...threads.filter((t) => !newReplies.includes(t))].slice(0, 4);

  return (
    <>
      <div className="kpis">
        <button className={newReplies.length > 0 ? 'kpi kpi-warn' : 'kpi'} onClick={() => onGo('messages')}>
          <span className="kpi-label">New replies</span>
          <span className="kpi-value">{newReplies.length}</span>
          <span className="kpi-hint">
            {newReplies.length > 0
              ? 'From Data Painters, waiting for you'
              : openThreads.length > 0
                ? `${plural(openThreads.length, 'conversation')} open`
                : 'No conversations yet'}
          </span>
        </button>
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
        <button className="kpi" onClick={() => onGo('engagements')}>
          <span className="kpi-label">Active engagements</span>
          <span className="kpi-value">{active.length}</span>
          <span className="kpi-hint">
            {engagements.length > active.length ? `${engagements.length - active.length} closed or paused` : 'All in progress'}
          </span>
        </button>
        <button className="kpi" onClick={() => onGo('messages')}>
          <span className="kpi-label">Open topics</span>
          <span className="kpi-value">{openTopics.length}</span>
          <span className="kpi-hint">{engagementTitle ? `In ${engagementTitle}` : 'Add what you want covered'}</span>
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
                  : `${hours(s.billedBlocks * 30)} billed to date`}
          </span>
        </button>
      </div>

      <div className="panels dash-panels">
        <section className="panel-card">
          <header>
            <h2>Messages</h2>
            <button className="linklike" onClick={() => onGo('messages')}>
              All messages →
            </button>
          </header>
          {recent.length === 0 ? (
            <div className="panel-empty">
              <p>
                No conversations yet. Add a topic to an engagement run by message and we will answer it
                in writing.
              </p>
              <button className="btn" onClick={onAddTopic}>
                + Add topic
              </button>
            </div>
          ) : (
            <ul className="dash-list">
              {recent.map((t) => (
                <li key={t.topicId}>
                  <button onClick={() => onOpenThread(t.topicId)}>
                    <span className="dash-main">
                      <strong>{t.title}</strong>
                      <span className="muted dash-snippet">
                        {t.lastSnippet ? `${t.lastAuthor ?? 'Someone'}: ${t.lastSnippet}` : 'No replies yet'}
                      </span>
                    </span>
                    <span className="dash-side">
                      {t.open && t.lastSide === 'team' ? (
                        <span className="pill pill-warn">New reply</span>
                      ) : (
                        <span className="muted">{plural(t.messageCount, 'message')}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel-card">
          <header>
            <h2>Coming up</h2>
            <button className="linklike" onClick={() => onGo('meetings')}>
              All meetings →
            </button>
          </header>
          {upcoming.length === 0 ? (
            <div className="panel-empty">
              <p>No meetings booked.</p>
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
            <h2>Engagements</h2>
            <button className="linklike" onClick={() => onGo('engagements')}>
              All engagements →
            </button>
          </header>
          {active.length === 0 ? (
            <div className="panel-empty">
              <p>Nothing in progress.</p>
              {canOpen && (
                <button className="btn btn-primary" onClick={onNewEngagement}>
                  New engagement
                </button>
              )}
            </div>
          ) : (
            <ul className="dash-list">
              {active.slice(0, 4).map((e) => {
                const waiting = threads.filter((t) => t.engagementId === e.id && t.open && t.lastSide === 'team').length;
                const meetings = upcoming.filter((a) => a.engagementId === e.id).length;
                return (
                  <li key={e.id}>
                    <button onClick={() => onOpenEngagement(e.id)}>
                      <span className="dash-main">
                        <strong>{e.title}</strong>
                        <span className="muted dash-snippet">
                          {COMMUNICATION_LABELS[e.communication]}
                          {e.dueOn ? ` · target ${day(e.dueOn)}` : ''}
                          {meetings > 0 ? ` · ${plural(meetings, 'meeting')} booked` : ''}
                        </span>
                      </span>
                      <span className="dash-side">
                        {waiting > 0 ? (
                          <span className="pill pill-warn">{waiting === 1 ? '1 new reply' : `${waiting} new replies`}</span>
                        ) : (
                          <span className={`status status-${e.status}`}>
                            {e.status === 'inquiry' ? 'consultation' : e.status}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel-card">
          <header>
            <h2>Your team</h2>
            <button className="linklike" onClick={() => onGo('team')}>
              Team members →
            </button>
          </header>
          {people.length === 0 ? (
            <p className="panel-empty">Your team will appear here.</p>
          ) : (
            <ul className="dash-people">
              {people.slice(0, 6).map((m) => (
                <li key={m.id}>
                  <span className="avatar" aria-hidden="true">
                    {initialsOf(m.displayName)}
                  </span>
                  <span className="dash-main">
                    <strong>{m.displayName}</strong>
                    <span className="muted">
                      {CLIENT_ROLE_LABELS[m.clientRole]}
                      {m.invitePending ? ' · invited, not yet signed in' : ''}
                    </span>
                  </span>
                </li>
              ))}
              {people.length > 6 && <li className="muted dash-more">and {people.length - 6} more</li>}
            </ul>
          )}
        </section>

        <section className="panel-card">
          <header>
            <h2>Open topics</h2>
            <button className="linklike" onClick={() => onGo('messages')}>
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

        {billing && billing.invoices.length > 0 && (
          <section className="panel-card">
            <header>
              <h2>Recent invoices</h2>
              <button className="linklike" onClick={() => onGo('billing')}>
                Billing →
              </button>
            </header>
            <InvoiceTable invoices={billing.invoices.slice(0, 3)} />
          </section>
        )}
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- topics */

function AddTopicModal({
  engagements,
  initialEngagementId,
  onAdded,
  onCancel,
  onError,
}: {
  /** The engagements a topic can be added to. */
  engagements: Engagement[];
  initialEngagementId: number;
  onAdded: (t: Topic) => void;
  onCancel: () => void;
  onError: (e: unknown) => void;
}) {
  const [engagementId, setEngagementId] = useState(
    engagements.some((e) => e.id === initialEngagementId) ? initialEngagementId : engagements[0]?.id ?? initialEngagementId,
  );
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [outcome, setOutcome] = useState('');
  const [priority, setPriority] = useState(3);
  const [busy, setBusy] = useState(false);
  const chosen = engagements.find((e) => e.id === engagementId);

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
        {engagements.length > 1 ? (
          <label>
            Engagement
            <select value={engagementId} onChange={(e) => setEngagementId(Number(e.target.value))}>
              {engagements.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>
        ) : (
          chosen && <p className="muted">For {chosen.title}</p>
        )}
        {chosen && (
          <p className="hint">
            {chosen.communication === 'video'
              ? 'This engagement is run by video meetings: the topic goes on a meeting, and the notes from it appear in its thread.'
              : 'We will answer in the topic’s thread, and you can reply there.'}
          </p>
        )}
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
    <Paged rows={rows} size={15}>{(pageRows) => (
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
          {pageRows.map((a) => (
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
)}</Paged>
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
      <Paged rows={invoices} size={15}>{(pageRows) => (
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
          {pageRows.map((i) => (
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
)}</Paged>
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
                <Paged rows={billing.payments} size={15}>{(pageRows) => (
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
                    {pageRows.map((p) => (
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
)}</Paged>
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
                  <Paged rows={billing.billed} size={15}>{(pageRows) => (
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
                      {pageRows.map((b) => (
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
)}</Paged>
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
