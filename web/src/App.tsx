import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  appointmentColumns,
  changePassword as apiChangePassword,
  clientColumns,
  createClient,
  createEngagement,
  createTopic,
  createUser,
  cancelAppointment,
  engagementColumns,
  acceptInvite,
  listAdminAppointments,
  listAllEngagements,
  listAppointments,
  listClients,
  listEngagements,
  listLoginEvents,
  listTopics,
  listUsers,
  login as apiLogin,
  me,
  peekInvite,
  updateAppointment,
  updateClient,
  updateEngagement,
  updateTopicStatus,
  Unauthorized,
  type AdminEngagement,
  type AdminUser,
  type Client,
  type CreatedUser,
  type AdminAppointment,
  type Appointment,
  type Engagement,
  type InviteView,
  type LoginEvent,
  type Topic,
} from './api';
import {
  BookingForm,
  formatLength,
  formatRange,
  LENGTH_OPTIONS,
  plural,
  statusLabel,
} from './scheduling';
import { ClientDetailModal, MeetingManager, Modal } from './admin-meetings';
import {
  buildQuery,
  DataGrid,
  FilterBar,
  Pager,
  type GridColumn,
  type GridColumnDef,
  type GridFilter,
  type GridPage,
} from './datagrid';
import { clearToken, getToken, type User } from './auth';
import {
  Approach,
  BookConsultation,
  Home,
  Services,
  SiteFooter,
  SiteNav,
} from './marketing';
import {
  AgingReport,
  InvoiceModal,
  InvoiceStatus,
  PrintInvoice,
  PrintMeeting,
  PrintStatement,
  RecordPaymentModal,
  RevenueReport,
  SystemOptions,
  UnbilledReport,
} from './billing';
import {
  getSnapshot,
  invoiceColumns,
  listInvoices,
  listPayments,
  money,
  paymentColumns,
  type Invoice,
  type Payment,
  type Snapshot,
} from './billing-api';

/* ------------------------------------------------------------------ auth */

interface AuthState {
  user: User | null;
  ready: boolean;
  setUser: (u: User | null) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth used outside AuthProvider');
  return ctx;
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  // A stored token may be expired or signed with a rotated key, so validate
  // it against the server before trusting it rather than finding out on the
  // first real request.
  useEffect(() => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    me()
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setReady(true));
  }, []);

  const signOut = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, setUser, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <main className="page"><p>Loading...</p></main>;
  if (!user) return <Navigate to="/login" replace />;
  // A one-time password gets you exactly one screen. This redirect is the
  // courtesy; the server's refusal to honour a reset-pending token anywhere
  // else is the enforcement.
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return (
    <RequireAuth>
      {user?.role === 'ADMIN' ? children : <Navigate to="/portal" replace />}
    </RequireAuth>
  );
}

/* ------------------------------------------------------------------ chrome */

/**
 * The user's name as the last nav item, opening Account and Sign out beneath
 * it. Closes on outside click, on Escape, and on route change -- a menu left
 * hanging open over the next page is the usual bug here.
 */
function UserMenu({ user }: { user: User }) {
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={wrap}>
      <button
        className="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {user.name}
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="user-menu-panel" role="menu">
          <span className="user-menu-email">{user.email}</span>
          {!user.mustChangePassword && (
            <Link to="/account" role="menuitem" onClick={() => setOpen(false)}>
              Account
            </Link>
          )}
          <button role="menuitem" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Site header; shows the account controls only when someone is signed in. */
function SiteHeader() {
  const { user } = useAuth();
  return <SiteNav account={user ? <NavAccount /> : undefined} />;
}

/** The signed-in part of the site header: the admin link and the user menu. */
function NavAccount() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <span className="nav-account">
      {user.role === 'ADMIN' && (
        <Link to="/admin" className="nav-admin-link">
          Admin
        </Link>
      )}
      <UserMenu user={user} />
    </span>
  );
}

/* ------------------------------------------------------------------ pages */

function Login() {
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const signedIn = await apiLogin(email, password);
      setUser(signedIn);
      // Admins work from the console; sending them to an empty client
      // portal first was a wasted click on every sign-in.
      navigate(signedIn.role === 'ADMIN' ? '/admin' : '/portal', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <h1>Client sign-in</h1>
      <p className="lede">
        Accounts are created by us. If you need access, get in touch.
      </p>

      {error && <div className="error">{error}</div>}

      <form onSubmit={onSubmit} className="stack-form">
        <label>
          Email
          <input
            type="email"
            value={email}
            autoComplete="username"
            required
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

function Portal() {
  const { signOut, user } = useAuth();

  const [tab, setTab] = useState<'topics' | 'meetings'>('topics');
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The topic form collects the four things the engineer needs before the
  // call. Title alone produced agenda items nobody could prepare for.
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [outcome, setOutcome] = useState('');
  const [priority, setPriority] = useState(3);
  const [adding, setAdding] = useState(false);

  const onError = useCallback(
    (e: unknown) => {
      if (e instanceof Unauthorized) {
        signOut();
        return;
      }
      setError((e as Error).message);
    },
    [signOut],
  );

  useEffect(() => {
    Promise.all([listEngagements(), listAppointments()])
      .then(([list, appts]) => {
        setEngagements(list);
        setAppointments(appts);
        setSelected(list.length > 0 ? list[0].id : null);
      })
      .catch(onError)
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => {
    if (selected === null) {
      setTopics([]);
      return;
    }
    listTopics(selected).then(setTopics).catch(onError);
  }, [selected, onError]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || selected === null) return;
    try {
      const created = await createTopic({
        engagementId: selected,
        title: title.trim(),
        detail: detail.trim() || undefined,
        desiredOutcome: outcome.trim() || undefined,
        priority,
      });
      setTopics((prev) => [...prev, created]);
      setTitle('');
      setDetail('');
      setOutcome('');
      setPriority(3);
      setAdding(false);
      setError(null);
    } catch (err) {
      onError(err);
    }
  }

  async function onDropTopic(topic: Topic) {
    try {
      const updated = await updateTopicStatus(topic.id, 'dropped');
      setTopics((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      onError(err);
    }
  }

  async function onCancelMeeting(id: number) {
    try {
      const updated = await cancelAppointment(id);
      setAppointments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      // Cancelling returns the agenda to the backlog, so the topic list is
      // now stale.
      if (selected !== null) setTopics(await listTopics(selected));
      setNotice('Meeting cancelled. Its topics are back in your list.');
    } catch (err) {
      onError(err);
    }
  }

  if (loading) {
    return <main className="page"><p>Loading...</p></main>;
  }

  const openTopics = topics.filter((t) => t.status === 'proposed');
  // Paused and closed engagements stay visible for their history, but new
  // meetings only go on live ones.
  const bookable = engagements.filter((e) => e.status === 'active');
  const upcoming = appointments.filter(
    (a) => a.status !== 'cancelled' && a.status !== 'completed' && new Date(a.endsAt) > new Date(),
  );
  const firstName = user?.name.split(/\s+/)[0];

  return (
    <main className="page portal">
      <header className="screen-head">
        <p className="eyebrow">Client portal</p>
        <h1>{firstName ? `Welcome, ${firstName}` : 'Client portal'}</h1>
        <p className="muted">
          {openTopics.length > 0
            ? `${plural(openTopics.length, 'open topic')} ready for a meeting`
            : 'Add the topics you want covered, then request a meeting.'}
          {upcoming.length > 0 && ` · ${plural(upcoming.length, 'upcoming meeting')}`}
        </p>
      </header>

      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'topics'}
          className={tab === 'topics' ? 'tab tab-on' : 'tab'}
          onClick={() => setTab('topics')}
        >
          Session topics
          {openTopics.length > 0 && <span className="tab-count">{openTopics.length}</span>}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'meetings'}
          className={tab === 'meetings' ? 'tab tab-on' : 'tab'}
          onClick={() => setTab('meetings')}
        >
          Meetings
          {upcoming.length > 0 && <span className="tab-count">{upcoming.length}</span>}
        </button>
      </div>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button className="dismiss" aria-label="Dismiss" onClick={() => setError(null)}>
            &times;
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button className="dismiss" aria-label="Dismiss" onClick={() => setNotice(null)}>
            &times;
          </button>
        </div>
      )}

      {engagements.length === 0 ? (
        <div className="notice">
          No engagements are set up for your account yet. Once we open one, your topics
          will appear here.
        </div>
      ) : tab === 'topics' ? (
        <>
          <p className="lede">
            What you want covered next time. Say what a good answer looks like and we
            can prepare before the call rather than during it.
          </p>

          {engagements.length > 1 && (
            <label className="engagement-picker">
              Engagement
              <select
                value={selected ?? ''}
                onChange={(e) => setSelected(Number(e.target.value))}
              >
                {engagements.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="toolbar">
            <button className="btn btn-primary" onClick={() => setAdding((v) => !v)}>
              {adding ? 'Close form' : '+ Add topic'}
            </button>
            <button
              className="btn"
              onClick={() => {
                setBooking(true);
                setNotice(null);
                setTab('meetings');
              }}
              disabled={openTopics.length === 0 || bookable.length === 0}
              title={openTopics.length === 0 ? 'Add a topic first' : undefined}
            >
              Schedule a meeting
            </button>
          </div>

          {adding && (
            <form onSubmit={onAdd} className="stack-form panel">
              <h2 className="panel-title">New topic</h2>
              <label>
                Title
                <input
                  value={title}
                  required
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Short name for the topic"
                />
              </label>
              <label>
                Description
                <textarea
                  value={detail}
                  rows={3}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="Background, what you have tried, where it is stuck"
                />
              </label>
              <label>
                Desired outcome
                <textarea
                  value={outcome}
                  rows={2}
                  onChange={(e) => setOutcome(e.target.value)}
                  placeholder="What should be true once we have discussed this?"
                />
              </label>
              <label>
                Priority
                <select
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                >
                  <option value={1}>1 &mdash; blocking</option>
                  <option value={2}>2 &mdash; high</option>
                  <option value={3}>3 &mdash; normal</option>
                  <option value={4}>4 &mdash; low</option>
                  <option value={5}>5 &mdash; whenever</option>
                </select>
              </label>
              <div className="button-row">
                <button type="submit" className="btn btn-primary">
                  Add topic
                </button>
                <button type="button" className="btn" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {topics.length === 0 ? (
            <div className="empty-state">
              <p>
                <strong>No topics yet.</strong>
              </p>
              <p className="muted">
                Add the first thing you want covered. A clear desired outcome helps us
                prepare before the call.
              </p>
            </div>
          ) : (
            <ul className="topics detailed">
              {topics.map((t) => (
                <li key={t.id}>
                  <div className="topic-head">
                    <span className={`status status-${t.status}`}>{t.status}</span>
                    <span className="topic-title">{t.title}</span>
                    <span className="priority">P{t.priority}</span>
                    {/* Only an unscheduled topic can be dropped here. Once it
                        is on an agenda, removing it is a scheduling decision
                        and belongs with the meeting. */}
                    {t.status === 'proposed' && (
                      <button
                        className="linklike"
                        onClick={() => {
                          if (window.confirm(`Drop “${t.title}”? It will not go on a meeting.`)) {
                            onDropTopic(t);
                          }
                        }}
                      >
                        Drop
                      </button>
                    )}
                  </div>
                  {t.detail && <p className="topic-detail">{t.detail}</p>}
                  {t.desiredOutcome && (
                    <p className="topic-outcome">
                      <strong>Wanted:</strong> {t.desiredOutcome}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <p className="lede">
            Meetings run in 30-minute blocks. Pick the topics first, then a time long
            enough to cover them.
          </p>

          {!booking && (
            <div className="toolbar">
              <button
                className="btn btn-primary"
                onClick={() => {
                  setBooking(true);
                  setNotice(null);
                }}
                disabled={bookable.length === 0}
              >
                Schedule a meeting
              </button>
            </div>
          )}

          {booking && (
            <BookingForm
              engagements={bookable}
              initialEngagementId={selected}
              openTopics={topics.filter((t) => t.status === 'proposed')}
              onCancel={() => setBooking(false)}
              onError={onError}
              onBooked={async (a) => {
                setAppointments((prev) => [a, ...prev]);
                setBooking(false);
                setNotice('Meeting requested. We will confirm the time.');
                if (selected !== null) setTopics(await listTopics(selected));
              }}
            />
          )}

          {appointments.length === 0 ? (
            <div className="empty-state">
              <p>
                <strong>Nothing scheduled yet.</strong>
              </p>
              <p className="muted">Request a meeting and we will confirm the time.</p>
            </div>
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
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((a) => (
                    <tr key={a.id} className={a.status === 'cancelled' ? 'row-bad' : undefined}>
                      <td className="nowrap">{formatRange(a.startsAt, a.endsAt)}</td>
                      <td className="nowrap">{formatLength(a.durationMinutes)}</td>
                      <td>{a.engagementTitle}</td>
                      <td>{plural(a.topicCount, 'topic')}</td>
                      <td>
                        <span className={`status status-ap-${a.status}`}>
                          {statusLabel(a.status)}
                        </span>
                      </td>
                      <td>
                        {a.status !== 'cancelled' && a.status !== 'completed' && (
                          <button
                            className="linklike"
                            onClick={() => {
                              if (window.confirm('Cancel this meeting? Its topics go back to your list.')) {
                                onCancelMeeting(a.id);
                              }
                            }}
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}

const MIN_PASSWORD_LENGTH = 12;

/**
 * Serves two jobs: the forced change after a one-time password, and a normal
 * voluntary change from the Account link. The only difference is the copy and
 * whether leaving is an option.
 */
function ChangePassword({ forced }: { forced: boolean }) {
  const { user, ready, setUser } = useAuth();
  const navigate = useNavigate();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!ready) return <main className="page"><p>Loading...</p></main>;
  if (!user) return <Navigate to="/login" replace />;
  // Nothing to force once it is done; don't trap people on this page.
  if (forced && !user.mustChangePassword) return <Navigate to="/portal" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await apiChangePassword(current, next);
      setUser(updated);
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
      if (forced) navigate(updated.role === 'ADMIN' ? '/admin' : '/portal', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <h1>{forced ? 'Choose a password' : 'Change password'}</h1>
      <p className="lede">
        {forced
          ? 'Your account was set up with a one-time password. Pick your own to continue.'
          : 'Signed in as ' + user.email + '.'}
      </p>

      {error && <div className="error">{error}</div>}
      {done && !forced && <div className="notice">Password changed.</div>}

      <form onSubmit={onSubmit} className="stack-form">
        <label>
          {forced ? 'One-time password' : 'Current password'}
          <input
            type="password"
            value={current}
            autoComplete="current-password"
            required
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label>
          New password
          <input
            type="password"
            value={next}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            value={confirm}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={72}
            required
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <p className="hint">
          At least {MIN_PASSWORD_LENGTH} characters, up to 72 bytes &mdash; accented
          characters and emoji count as more than one.
        </p>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Save password'}
        </button>
      </form>
    </main>
  );
}

/* ------------------------------------------------------------------ admin */

/**
 * Shown once after an invite is issued.
 *
 * <p>The link is displayed even when the email went out, because mail goes
 * missing and a working fallback beats re-issuing. When the email did not go
 * out -- which is every client address while SES is sandboxed -- the copy
 * says so plainly rather than letting an admin assume it was sent.
 */
function InviteIssued({
  issued,
  onDismiss,
}: {
  issued: CreatedUser;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the link is on screen regardless.
      setCopied(false);
    }
  }

  return (
    <div className="notice issued">
      <p>
        {issued.emailed ? (
          <>
            Invitation emailed to <strong>{issued.user.email}</strong>.
          </>
        ) : (
          <>
            Account created for <strong>{issued.user.email}</strong>, but the
            invitation could not be emailed. Send them this link yourself.
          </>
        )}
      </p>
      <code className="one-time">{issued.inviteUrl}</code>
      <p className="fine">
        Works once, expires{' '}
        {new Date(issued.inviteExpiresAt).toLocaleDateString()}. Issuing another
        invitation cancels this link.
      </p>
      <div className="button-row">
        <button onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
        <button className="linklike" onClick={onDismiss}>
          Done
        </button>
      </div>
    </div>
  );
}

type AdminView =
  | 'overview'
  | 'clients'
  | 'engagements'
  | 'appointments'
  | 'invoices'
  | 'payments'
  | 'ar'
  | 'revenue'
  | 'unbilled'
  | 'signins'
  | 'logins'
  | 'options';
type SystemTool = 'signins' | 'logins';

/**
 * Reduces a user-agent string to something a person can scan. Deliberately
 * crude: this answers "was that my laptop or someone else's phone", not
 * "which exact build". Order matters -- Edge and Chrome both claim Chrome,
 * and Chrome claims Safari.
 */
function describeAgent(ua: string | null): string {
  if (!ua) return 'unknown client';

  const browser =
    /\bEdg\//.test(ua) ? 'Edge'
    : /\bOPR\//.test(ua) ? 'Opera'
    : /\bChrome\//.test(ua) ? 'Chrome'
    : /\bFirefox\//.test(ua) ? 'Firefox'
    : /\bSafari\//.test(ua) ? 'Safari'
    : /\bcurl\//i.test(ua) ? 'curl'
    : /python-requests|okhttp|axios|Go-http/i.test(ua) ? 'script'
    : 'other browser';

  const os =
    /\biPhone\b/.test(ua) ? 'iPhone'
    : /\biPad\b/.test(ua) ? 'iPad'
    : /\bAndroid\b/.test(ua) ? 'Android'
    : /\bMac OS X\b/.test(ua) ? 'macOS'
    : /\bWindows\b/.test(ua) ? 'Windows'
    : /\bLinux\b/.test(ua) ? 'Linux'
    : null;

  return os ? `${browser} on ${os}` : browser;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Who signed in, when, and from what. The first System tool. */
function SignInActivity({ onError }: { onError: (e: unknown) => void }) {
  const [events, setEvents] = useState<LoginEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [failuresOnly, setFailuresOnly] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return listLoginEvents(200)
      .then(setEvents)
      .catch(onError)
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = failuresOnly ? events.filter((e) => e.outcome === 'failure') : events;

  return (
    <>
      <div className="tool-toolbar">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={failuresOnly}
            onChange={(e) => setFailuresOnly(e.target.checked)}
          />
          Failed attempts only
        </label>
        <button onClick={load} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="empty">
          {loading ? 'Loading...' : 'Nothing recorded yet.'}
        </p>
      ) : (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Result</th>
                <th>From</th>
                <th>How</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} className={e.outcome === 'failure' ? 'row-bad' : undefined}>
                  <td className="nowrap">{formatWhen(e.at)}</td>
                  <td>
                    {e.emailTried}
                    {e.userId === null && (
                      <span className="muted"> &middot; no such account</span>
                    )}
                  </td>
                  <td>
                    <span className={`status status-ev-${e.outcome}`}>
                      {e.outcome === 'password_change' ? 'password set' : e.outcome}
                    </span>
                  </td>
                  <td className="nowrap">{e.ipAddress ?? 'unknown'}</td>
                  <td title={e.userAgent ?? ''}>{describeAgent(e.userAgent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="hint">
        Most recent 200 attempts. The address is taken from the forwarded-for
        header, which the caller controls, so treat it as a claim rather than
        proof.
      </p>
    </>
  );
}

/** Create and review portal logins. The second System tool. */
function PortalLogins({
  clients,
  users,
  onCreated,
  onError,
}: {
  clients: Client[];
  users: AdminUser[];
  onCreated: (created: CreatedUser) => void;
  onError: (e: unknown) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [clientId, setClientId] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');

  const nameOf = (id: number | null) =>
    id === null ? '--' : (clients.find((c) => c.id === id)?.name ?? `#${id}`);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      onCreated(
        await createUser({
          clientId: Number(clientId),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          companyName: companyName.trim() || undefined,
          phone: phone.trim() || undefined,
        }),
      );
      setFirstName('');
      setLastName('');
      setEmail('');
      setCompanyName('');
      setPhone('');
      setAdding(false);
    } catch (err) {
      onError(err);
    }
  }

  return (
    <>
      <div className="tool-toolbar">
        <button onClick={() => setAdding((v) => !v)} disabled={clients.length === 0}>
          {adding ? 'Cancel' : 'Add New'}
        </button>
      </div>

      {clients.length === 0 && (
        <p className="empty">Create a client first -- every login belongs to one.</p>
      )}

      {adding && (
        <form onSubmit={onSubmit} className="stack-form inset">
          <label>
            Client
            <select value={clientId} required onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field-row">
            <label>
              First name
              <input
                value={firstName}
                required
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
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </label>
            <label>
              Phone
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
          </div>
          <button className="btn btn-primary" type="submit">
            Send invitation
          </button>
        </form>
      )}

      {users.length === 0 ? (
        <p className="empty">No logins yet.</p>
      ) : (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Client</th>
                <th>Role</th>
                <th>Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.enabled ? undefined : 'row-bad'}>
                  <td>{u.displayName}</td>
                  <td>{u.email}</td>
                  <td>{nameOf(u.clientId)}</td>
                  <td>{u.role.toLowerCase()}</td>
                  <td className="nowrap">
                    {u.lastLoginAt ? formatWhen(u.lastLoginAt) : 'never'}
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

const SYSTEM_TOOLS: { id: SystemTool; title: string; blurb: string }[] = [
  {
    id: 'signins',
    title: 'Sign-in activity',
    blurb: 'Who signed in, when, from what address and what client -- including attempts that failed.',
  },
  {
    id: 'logins',
    title: 'Portal logins',
    blurb: 'Issue a login for a client contact, and see every account with its last sign-in.',
  },
];

const ADMIN_VIEWS: {
  id: AdminView;
  label: string;
  group: string;
  icon: IconName;
  blurb: string;
}[] = [
  {
    id: 'overview',
    label: 'Overview',
    group: 'Workspace',
    icon: 'home',
    blurb: 'What needs you today: meetings awaiting confirmation and the week ahead.',
  },
  {
    id: 'clients',
    label: 'Clients',
    group: 'Workspace',
    icon: 'building',
    blurb: 'Every client company. Click a row for its engagements, meetings, users and notes.',
  },
  {
    id: 'engagements',
    label: 'Engagements',
    group: 'Workspace',
    icon: 'briefcase',
    blurb: 'Open, paused and closed engagements across all clients.',
  },
  {
    id: 'appointments',
    label: 'Meetings',
    group: 'Workspace',
    icon: 'calendar',
    blurb: 'Requested and confirmed meetings. Click a row to run the meeting and take notes.',
  },
  {
    id: 'invoices',
    label: 'Invoices',
    group: 'Billing',
    icon: 'receipt',
    blurb: 'Every invoice with its balance. Click one to record a payment, print it or void it.',
  },
  {
    id: 'payments',
    label: 'Payments',
    group: 'Billing',
    icon: 'cash',
    blurb: 'Payments received, applied to invoices or held on account.',
  },
  {
    id: 'ar',
    label: 'Accounts receivable',
    group: 'Reports',
    icon: 'chart',
    blurb: 'What each client owes, aged by days past due.',
  },
  {
    id: 'revenue',
    label: 'Revenue & hours',
    group: 'Reports',
    icon: 'trend',
    blurb: 'Hours and amounts billed by month and by client, against cash collected.',
  },
  {
    id: 'unbilled',
    label: 'Unbilled work',
    group: 'Reports',
    icon: 'clock',
    blurb: 'Charges not yet invoiced, and past meetings whose billing needs attention.',
  },
  {
    id: 'logins',
    label: 'Portal logins',
    group: 'System',
    icon: 'users',
    blurb: SYSTEM_TOOLS[1].blurb,
  },
  {
    id: 'signins',
    label: 'Sign-in activity',
    group: 'System',
    icon: 'shield',
    blurb: SYSTEM_TOOLS[0].blurb,
  },
  {
    id: 'options',
    label: 'System options',
    group: 'System',
    icon: 'sliders',
    blurb: 'Settings that apply across the system, such as the hourly rate used for every charge.',
  },
];

const ADMIN_NAV_GROUPS: { title: string; items: AdminView[] }[] = [
  { title: 'Workspace', items: ['overview', 'clients', 'engagements', 'appointments'] },
  { title: 'Billing', items: ['invoices', 'payments'] },
  { title: 'Reports', items: ['ar', 'revenue', 'unbilled'] },
  { title: 'System', items: ['logins', 'signins', 'options'] },
];

type IconName =
  | 'home'
  | 'building'
  | 'briefcase'
  | 'calendar'
  | 'users'
  | 'shield'
  | 'receipt'
  | 'cash'
  | 'chart'
  | 'trend'
  | 'clock'
  | 'sliders';

/** Small stroke icons for the admin sidebar; inline so nothing is fetched. */
function NavIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
    building: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="1" />
        <path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3" />
      </>
    ),
    briefcase: (
      <>
        <rect x="3" y="7" width="18" height="13" rx="1.5" />
        <path d="M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M3 12h18" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="1.5" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
      </>
    ),
    shield: <path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z M9 12l2 2 4-4" />,
    receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4" />,
    cash: (
      <>
        <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M6 9v.01M18 15v.01" />
      </>
    ),
    chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
    trend: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    sliders: <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4" />,
  };
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
      {paths[name]}
    </svg>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?'
  );
}

/**
 * One date style everywhere in the admin: "Nov 20, 2026". Accepts an ISO
 * instant or a bare yyyy-mm-dd; a bare date is read as a calendar day, not
 * as UTC midnight, so it never slips to the previous day west of Greenwich.
 */
function formatDay(value: string | null | undefined): string {
  if (!value) return '—';
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = bare
    ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)))
    : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The admin landing page. Four numbers worth knowing on arrival and the two
 * lists that usually need action: requests to confirm, and what is coming up.
 */
function Overview({
  refreshKey,
  onError,
  onGo,
  onOpenMeeting,
}: {
  refreshKey: number;
  onError: (e: unknown) => void;
  onGo: (v: AdminView) => void;
  onOpenMeeting: (id: number) => void;
}) {
  const [data, setData] = useState<{
    clients: number;
    active: number;
    pending: GridPage<AdminAppointment>;
    upcoming: GridPage<AdminAppointment>;
    billing: Snapshot | null;
  } | null>(null);

  useEffect(() => {
    const now = new Date().toISOString();
    Promise.all([
      listClients('size=1'),
      listAllEngagements('filter=status:eq:active&size=1'),
      listAdminAppointments('filter=status:eq:requested&sort=startsAt:asc&size=8'),
      listAdminAppointments(
        `filter=status:eq:confirmed&filter=startsAt:gte:${encodeURIComponent(now)}&sort=startsAt:asc&size=8`,
      ),
      // Billing is additive: the dashboard still renders if it fails.
      getSnapshot().catch(() => null),
    ])
      .then(([c, e, pending, upcoming, billing]) =>
        setData({ clients: c.total, active: e.total, pending, upcoming, billing }),
      )
      .catch(onError);
  }, [refreshKey, onError]);

  if (!data) {
    return (
      <div className="kpis">
        {[0, 1, 2, 3].map((i) => (
          <div className="kpi skeleton" key={i} />
        ))}
      </div>
    );
  }

  const kpis: { label: string; value: number; hint: string; view: AdminView; tone?: string }[] = [
    { label: 'Clients', value: data.clients, hint: 'All client companies', view: 'clients' },
    {
      label: 'Active engagements',
      value: data.active,
      hint: 'Currently open',
      view: 'engagements',
    },
    {
      label: 'Awaiting confirmation',
      value: data.pending.total,
      hint: data.pending.total ? 'Needs your reply' : 'Nothing waiting',
      view: 'appointments',
      tone: data.pending.total ? 'warn' : undefined,
    },
    {
      label: 'Upcoming meetings',
      value: data.upcoming.total,
      hint: 'Confirmed, from now on',
      view: 'appointments',
    },
  ];

  const b = data.billing;
  const money2: { label: string; value: string; hint: string; view: AdminView; tone?: string }[] = b
    ? [
        {
          label: 'Accounts receivable',
          value: money(b.receivableCents),
          hint: b.overdueCents > 0 ? `${money(b.overdueCents)} past due` : 'Nothing past due',
          view: 'ar',
          tone: b.overdueCents > 0 ? 'warn' : undefined,
        },
        { label: 'Unbilled', value: money(b.unbilledCents), hint: 'Ready to invoice', view: 'unbilled' },
        {
          label: 'Billed this month',
          value: money(b.billedThisMonthCents),
          hint: `Collected ${money(b.collectedThisMonthCents)}`,
          view: 'revenue',
        },
        {
          label: 'New inquiries',
          value: String(b.openInquiries),
          hint: b.openInquiries ? 'Free consultations to follow up' : 'None open',
          view: 'engagements',
          tone: b.openInquiries ? 'warn' : undefined,
        },
      ]
    : [];

  const list = (rows: AdminAppointment[], empty: string) =>
    rows.length === 0 ? (
      <p className="panel-empty">{empty}</p>
    ) : (
      <ul className="meeting-list">
        {rows.map((a) => (
          <li key={a.id}>
            <button onClick={() => onOpenMeeting(a.id)}>
              <span className="ml-date">
                <b>{new Date(a.startsAt).toLocaleDateString(undefined, { day: 'numeric' })}</b>
                <small>
                  {new Date(a.startsAt).toLocaleDateString(undefined, { month: 'short' })}
                </small>
              </span>
              <span className="ml-main">
                <strong>{a.clientName}</strong>
                <span className="muted">
                  {a.engagementTitle} · {formatRange(a.startsAt, a.endsAt)}
                </span>
              </span>
              <span className="ml-meta">
                {plural(a.topicCount, 'topic')} · {formatLength(a.durationMinutes)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <>
      {b && b.hourlyRateCents === 0 && (
        <div className="notice" role="status">
          <span>
            <strong>Set your hourly rate.</strong> Until it is set, completed meetings are charged at
            $0 and the website shows “contact us for rates”.
          </span>
          <button className="btn" onClick={() => onGo('options')}>
            System options
          </button>
        </div>
      )}
      <div className="kpis">
        {[...kpis, ...money2].map((k) => (
          <button
            key={k.label}
            className={k.tone ? `kpi kpi-${k.tone}` : 'kpi'}
            onClick={() => onGo(k.view)}
          >
            <span className="kpi-label">{k.label}</span>
            <span className="kpi-value">{k.value}</span>
            <span className="kpi-hint">{k.hint}</span>
          </button>
        ))}
      </div>

      <div className="panels">
        <section className="panel-card">
          <header>
            <h2>Awaiting confirmation</h2>
            <button className="linklike" onClick={() => onGo('appointments')}>
              All meetings →
            </button>
          </header>
          {list(data.pending.rows, 'No meeting requests waiting. You are all caught up.')}
        </section>
        <section className="panel-card">
          <header>
            <h2>Coming up</h2>
            <button className="linklike" onClick={() => onGo('appointments')}>
              All meetings →
            </button>
          </header>
          {list(data.upcoming.rows, 'No confirmed meetings ahead.')}
        </section>
      </div>
    </>
  );
}

/**
 * One list tab: filter bar, sortable grid, pager.
 *
 * Generic over the row type so clients, engagements and appointments share
 * one implementation. Query state lives here rather than in Admin, so
 * switching tabs does not carry one list's filters onto another.
 */
function ListTab<T>({
  columns,
  load,
  gridColumns,
  addLabel,
  onAdd,
  onRowClick,
  rowClassName,
  empty,
  defaultSort,
  refreshKey,
}: {
  columns: GridColumn[];
  load: (query: string) => Promise<GridPage<T>>;
  gridColumns: GridColumnDef<T>[];
  addLabel: string;
  onAdd: () => void;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  empty: string;
  defaultSort: string;
  /** Bumped by the parent after a create or edit, to force a reload. */
  refreshKey: number;
}) {
  const [filters, setFilters] = useState<GridFilter[]>([]);
  const [sort, setSort] = useState(defaultSort);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const [data, setData] = useState<GridPage<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    load(buildQuery(filters, sort, page, size))
      .then((p) => {
        setData(p);
        setError(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [filters, sort, page, size, refreshKey, load]);

  // Any change to what is being asked for returns to the first page --
  // staying on page 4 of a result set that now has one page is disorienting.
  function changeFilters(next: GridFilter[]) {
    setFilters(next);
    setPage(0);
  }

  return (
    <section>
      <FilterBar
        columns={columns}
        filters={filters}
        onChange={changeFilters}
        addLabel={addLabel}
        onAdd={onAdd}
      />

      {error && <div className="error">{error}</div>}

      {loading && !data ? (
        <p className="empty">Loading...</p>
      ) : (
        <>
          <DataGrid
            columns={gridColumns}
            rows={data?.rows ?? []}
            sort={sort}
            onSort={(next) => {
              setSort(next);
              setPage(0);
            }}
            onRowClick={onRowClick}
            rowClassName={rowClassName}
            empty={filters.length > 0 ? 'No rows match those filters.' : empty}
          />
          {data && data.total > 0 && (
            <Pager
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              size={data.size}
              onPage={setPage}
              onSize={(n) => {
                setSize(n);
                setPage(0);
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- editors */

/** Create or edit a client. One form for both; the id decides which. */
function ClientForm({
  existing,
  onDone,
  onCancel,
  onError,
}: {
  existing?: Client;
  onDone: (c: Client) => void;
  onCancel: () => void;
  onError: (e: unknown) => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [email, setEmail] = useState(existing?.primaryEmail ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onDone(
        existing
          ? await updateClient(existing.id, { name: name.trim(), primaryEmail: email.trim() })
          : await createClient({ name: name.trim(), primaryEmail: email.trim() }),
      );
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={existing ? 'Edit client' : 'New client'} onClose={onCancel}>
      <form onSubmit={submit} className="stack-form">
        <label>
          Company name
          <input value={name} required autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Primary email
          <input
            type="email"
            value={email}
            required
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <div className="button-row">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving...' : existing ? 'Save changes' : 'Create client'}
          </button>
          <button type="button" className="linklike" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EngagementForm({
  existing,
  clients,
  onDone,
  onCancel,
  onError,
}: {
  existing?: AdminEngagement;
  clients: Client[];
  onDone: (e: AdminEngagement) => void;
  onCancel: () => void;
  onError: (e: unknown) => void;
}) {
  const [clientId, setClientId] = useState(String(existing?.clientId ?? ''));
  const [title, setTitle] = useState(existing?.title ?? '');
  const [status, setStatus] = useState(existing?.status ?? 'active');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onDone(
        existing
          ? await updateEngagement(existing.id, { title: title.trim(), status })
          : await createEngagement({ clientId: Number(clientId), title: title.trim() }),
      );
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={existing ? 'Edit engagement' : 'New engagement'} onClose={onCancel}>
      <form onSubmit={submit} className="stack-form">
        <label>
          Client
          {/* Moving an engagement between clients would orphan its topics
              and meetings, so it is fixed once created. */}
          <select
            value={clientId}
            required
            disabled={Boolean(existing)}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">Select...</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input
            value={title}
            required
            autoFocus
            placeholder="AI readiness assessment"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {existing && (
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="inquiry">Inquiry</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="closed">Closed</option>
            </select>
          </label>
        )}
        <div className="button-row">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving...' : existing ? 'Save changes' : 'Open engagement'}
          </button>
          <button type="button" className="linklike" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AppointmentForm({
  existing,
  onDone,
  onCancel,
  onError,
}: {
  existing: AdminAppointment;
  onDone: (a: AdminAppointment) => void;
  onCancel: () => void;
  onError: (e: unknown) => void;
}) {
  // Datetime-local wants the browser's wall clock, not an ISO instant.
  const start = new Date(existing.startsAt);
  const localValue = new Date(start.getTime() - start.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  const [when, setWhen] = useState(localValue);
  const [length, setLength] = useState(existing.durationMinutes);
  const [status, setStatus] = useState(existing.status);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onDone(
        await updateAppointment(existing.id, {
          startsAt: new Date(when).toISOString(),
          durationMinutes: length,
          status,
        }),
      );
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit meeting" onClose={onCancel}>
      <form onSubmit={submit} className="stack-form">
        <dl className="detail-list">
          <dt>Client</dt>
          <dd>{existing.clientName}</dd>
          <dt>Engagement</dt>
          <dd>{existing.engagementTitle}</dd>
        </dl>
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
        <p className="hint">Must fall on the hour or the half hour.</p>
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
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="requested">Requested</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <div className="button-row">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving...' : 'Save changes'}
          </button>
          <button type="button" className="linklike" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ----------------------------------------------------------------- admin */

function Admin() {
  const { signOut } = useAuth();

  const { user } = useAuth();
  // The view lives in the URL so a refresh, a bookmark or the back button
  // lands on the same screen.
  const [params, setParams] = useSearchParams();
  const view: AdminView = ADMIN_VIEWS.some((v) => v.id === params.get('view'))
    ? (params.get('view') as AdminView)
    : 'overview';
  const [navOpen, setNavOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  function go(next: AdminView) {
    setParams(next === 'overview' ? {} : { view: next });
    // A notice about the last screen is noise on the next one.
    setError(null);
    setIssued(null);
    setNavOpen(false);
  }
  const [issued, setIssued] = useState<CreatedUser | null>(null);

  // Column metadata comes from the server so the dropdowns can never offer
  // a filter the API would reject.
  const [cols, setCols] = useState<{
    clients: GridColumn[];
    engagements: GridColumn[];
    appointments: GridColumn[];
    invoices: GridColumn[];
    payments: GridColumn[];
  }>({ clients: [], engagements: [], appointments: [], invoices: [], payments: [] });

  // Every client, for the pickers in the forms. Separate from the paged
  // grid: a dropdown must show all of them, not page 1 of them.
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);

  const [refresh, setRefresh] = useState(0);
  const bump = useCallback(() => setRefresh((n) => n + 1), []);

  const [editClient, setEditClient] = useState<Client | 'new' | null>(null);
  const [editEngagement, setEditEngagement] = useState<AdminEngagement | 'new' | null>(null);
  const [editAppointment, setEditAppointment] = useState<AdminAppointment | null>(null);

  const [openClient, setOpenClient] = useState<{ id: number; tab?: 'accounting' } | null>(null);
  const [openInvoice, setOpenInvoice] = useState<number | null>(null);
  const [paying, setPaying] = useState(false);
  const [openMeeting, setOpenMeeting] = useState<number | null>(null);

  const onError = useCallback(
    (e: unknown) => {
      if (e instanceof Unauthorized) {
        signOut();
        return;
      }
      setError((e as Error).message);
    },
    [signOut],
  );

  useEffect(() => {
    Promise.all([
      clientColumns(),
      engagementColumns(),
      appointmentColumns(),
      listClients('size=200&sort=name:asc'),
      listUsers(),
      invoiceColumns(),
      paymentColumns(),
    ])
      .then(([c, e, a, clientPage, u, inv, pay]) => {
        setCols({ clients: c, engagements: e, appointments: a, invoices: inv, payments: pay });
        setAllClients(clientPage.rows);
        setUsers(u);
      })
      .catch(onError);
  }, [onError, refresh]);

  const loadClients = useCallback((q: string) => listClients(q), []);
  const loadEngagements = useCallback((q: string) => listAllEngagements(q), []);
  const loadAppointments = useCallback((q: string) => listAdminAppointments(q), []);
  const loadInvoices = useCallback((q: string) => listInvoices(q), []);
  const loadPayments = useCallback((q: string) => listPayments(q), []);

  const current = ADMIN_VIEWS.find((v) => v.id === view)!;

  return (
    <div className="admin-shell">
      <aside className={navOpen ? 'admin-side open' : 'admin-side'}>
        <div className="admin-brand">
          <Link to="/" className="admin-brand-mark">
            Data Painters
          </Link>
          <span className="admin-brand-sub">Admin console</span>
        </div>
        <button
          className="admin-nav-toggle"
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          {current.label}
          <span aria-hidden="true">▾</span>
        </button>
        <nav className="admin-nav" aria-label="Admin">
          {ADMIN_NAV_GROUPS.map((g) => (
            <div className="admin-nav-group" key={g.title}>
              <span className="admin-nav-title">{g.title}</span>
              {g.items.map((id) => {
                const v = ADMIN_VIEWS.find((x) => x.id === id)!;
                return (
                  <button
                    key={id}
                    className={view === id ? 'admin-nav-item on' : 'admin-nav-item'}
                    aria-current={view === id ? 'page' : undefined}
                    onClick={() => go(id)}
                  >
                    <NavIcon name={v.icon} />
                    {v.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="admin-side-foot">
          <Link to="/portal" className="admin-side-link">
            Client portal view
          </Link>
          <Link to="/" className="admin-side-link">
            Public site
          </Link>
          {user && (
            <div className="admin-me">
              <span className="avatar" aria-hidden="true">
                {initials(user.name)}
              </span>
              <span className="admin-me-text">
                <strong>{user.name}</strong>
                <small>{user.email}</small>
              </span>
            </div>
          )}
          <div className="admin-me-actions">
            <Link to="/account">Account</Link>
            <button className="linklike" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-top">
          <div>
            <p className="crumbs">
              Admin <span aria-hidden="true">/</span> {current.group}
            </p>
            <h1>{current.label}</h1>
            <p className="muted">{current.blurb}</p>
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
      {issued && <InviteIssued issued={issued} onDismiss={() => setIssued(null)} />}

      {view === 'overview' && (
        <Overview
          refreshKey={refresh}
          onError={onError}
          onGo={go}
          onOpenMeeting={(id) => setOpenMeeting(id)}
        />
      )}

      {view === 'clients' && (
        <ListTab<Client>
          columns={cols.clients}
          load={loadClients}
          refreshKey={refresh}
          defaultSort="name:asc"
          addLabel="Add New"
          onAdd={() => setEditClient('new')}
          onRowClick={(c) => setOpenClient({ id: c.id })}
          empty="No clients yet."
          gridColumns={[
            { field: 'name', label: 'Client', render: (c) => <strong>{c.name}</strong> },
            { field: 'primaryEmail', label: 'Primary email' },
            {
              field: 'createdAt',
              label: 'Added',
              render: (c) => (
                <span className="nowrap">
                  {formatDay(c.createdAt)}
                </span>
              ),
            },
            {
              field: 'actions',
              label: '',
              sortable: false,
              render: (c) => (
                <button
                  className="linklike"
                  onClick={(e) => {
                    // Without this the row's own click handler also fires
                    // and the detail popup opens behind the editor.
                    e.stopPropagation();
                    setEditClient(c);
                  }}
                >
                  Edit
                </button>
              ),
            },
          ]}
        />
      )}

      {view === 'engagements' && (
        <ListTab<AdminEngagement>
          columns={cols.engagements}
          load={loadEngagements}
          refreshKey={refresh}
          defaultSort="startedOn:desc"
          addLabel="Add New"
          onAdd={() => setEditEngagement('new')}
          empty="No engagements yet."
          gridColumns={[
            { field: 'title', label: 'Engagement', render: (e) => <strong>{e.title}</strong> },
            {
              field: 'clientName',
              label: 'Client',
              render: (e) =>
                allClients.find((c) => c.id === e.clientId)?.name ?? `#${e.clientId}`,
            },
            {
              field: 'status',
              label: 'Status',
              render: (e) => <span className={`status status-${e.status}`}>{e.status}</span>,
            },
            {
              field: 'startedOn',
              label: 'Started',
              render: (e) => <span className="nowrap">{formatDay(e.startedOn)}</span>,
            },
            {
              field: 'actions',
              label: '',
              sortable: false,
              render: (e) => (
                <button
                  className="linklike"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setEditEngagement(e);
                  }}
                >
                  Edit
                </button>
              ),
            },
          ]}
        />
      )}

      {view === 'appointments' && (
        <ListTab<AdminAppointment>
          columns={cols.appointments}
          load={loadAppointments}
          refreshKey={refresh}
          defaultSort="startsAt:desc"
          addLabel="Add New"
          onAdd={() =>
            setToast('Meetings are booked by clients from the portal.')
          }
          onRowClick={(a) => setOpenMeeting(a.id)}
          rowClassName={(a) => (a.status === 'cancelled' ? 'row-bad' : undefined)}
          empty="No meetings booked."
          gridColumns={[
            {
              field: 'startsAt',
              label: 'When',
              render: (a) => (
                <span className="nowrap">{formatRange(a.startsAt, a.endsAt)}</span>
              ),
            },
            { field: 'clientName', label: 'Client', render: (a) => <strong>{a.clientName}</strong> },
            { field: 'engagementTitle', label: 'Engagement' },
            {
              field: 'durationMinutes',
              label: 'Length',
              type: 'number',
              render: (a) => <span className="nowrap">{formatLength(a.durationMinutes)}</span>,
            },
            {
              field: 'topicCount',
              label: 'Agenda',
              type: 'number',
              render: (a) => (
                <span className="nowrap">
                  {a.notedCount}/{plural(a.topicCount, 'topic')} noted
                </span>
              ),
            },
            {
              field: 'status',
              label: 'Status',
              render: (a) => (
                <span className={`status status-ap-${a.status}`}>{statusLabel(a.status)}</span>
              ),
            },
            {
              field: 'actions',
              label: '',
              sortable: false,
              render: (a) => (
                <button
                  className="linklike"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setEditAppointment(a);
                  }}
                >
                  Edit
                </button>
              ),
            },
          ]}
        />
      )}

      {view === 'invoices' && (
        <ListTab<Invoice>
          columns={cols.invoices}
          load={loadInvoices}
          refreshKey={refresh}
          defaultSort="issuedOn:desc"
          addLabel="Record payment"
          onAdd={() => setPaying(true)}
          onRowClick={(i) => setOpenInvoice(i.id)}
          rowClassName={(i) => (i.status === 'void' ? 'row-bad' : undefined)}
          empty="No invoices yet. Create one from a client's Accounting tab."
          gridColumns={[
            { field: 'number', label: 'Invoice', render: (i) => <strong>{i.number}</strong> },
            { field: 'clientName', label: 'Client' },
            { field: 'issuedOn', label: 'Issued', render: (i) => <span className="nowrap">{formatDay(i.issuedOn)}</span> },
            { field: 'dueOn', label: 'Due', render: (i) => <span className="nowrap">{formatDay(i.dueOn)}</span> },
            { field: 'totalCents', label: 'Total', type: 'number', render: (i) => money(i.totalCents) },
            { field: 'balanceCents', label: 'Balance', type: 'number', render: (i) => <strong>{money(i.balanceCents)}</strong> },
            { field: 'status', label: 'Status', render: (i) => <InvoiceStatus status={i.status} /> },
          ]}
        />
      )}

      {view === 'payments' && (
        <ListTab<Payment>
          columns={cols.payments}
          load={loadPayments}
          refreshKey={refresh}
          defaultSort="receivedOn:desc"
          addLabel="Record payment"
          onAdd={() => setPaying(true)}
          onRowClick={(p) => setOpenClient({ id: p.clientId, tab: 'accounting' })}
          rowClassName={(p) => (p.voidedAt ? 'row-bad' : undefined)}
          empty="No payments recorded yet."
          gridColumns={[
            { field: 'receivedOn', label: 'Received', render: (p) => <span className="nowrap">{formatDay(p.receivedOn)}</span> },
            { field: 'clientName', label: 'Client', render: (p) => <strong>{p.clientName}</strong> },
            {
              field: 'invoiceNumber',
              label: 'Applied to',
              render: (p) => p.invoiceNumber ?? <span className="muted">On account</span>,
            },
            { field: 'method', label: 'Method', render: (p) => p.method.toUpperCase() },
            { field: 'reference', label: 'Reference', render: (p) => p.reference ?? '—' },
            {
              field: 'amountCents',
              label: 'Amount',
              type: 'number',
              render: (p) => (p.voidedAt ? <s>{money(p.amountCents)}</s> : <strong>{money(p.amountCents)}</strong>),
            },
          ]}
        />
      )}

      {view === 'ar' && (
        <AgingReport onError={onError} onOpenClient={(id) => setOpenClient({ id, tab: 'accounting' })} />
      )}
      {view === 'revenue' && <RevenueReport onError={onError} />}
      {view === 'unbilled' && (
        <UnbilledReport
          onError={onError}
          onOpenMeeting={(id) => setOpenMeeting(id)}
          onOpenClient={(id) => setOpenClient({ id, tab: 'accounting' })}
        />
      )}
      {view === 'options' && <SystemOptions onError={onError} onSaved={(m) => setToast(m)} />}

      {view === 'signins' && <SignInActivity onError={onError} />}
      {view === 'logins' && (
        <PortalLogins
          clients={allClients}
          users={users}
          onError={onError}
          onCreated={(created) => {
            setIssued(created);
            bump();
          }}
        />
      )}

      {editClient && (
        <ClientForm
          existing={editClient === 'new' ? undefined : editClient}
          onCancel={() => setEditClient(null)}
          onError={onError}
          onDone={(c) => {
            setToast(editClient === 'new' ? `Client “${c.name}” created` : `Saved “${c.name}”`);
            setEditClient(null);
            bump();
          }}
        />
      )}

      {editEngagement && (
        <EngagementForm
          existing={editEngagement === 'new' ? undefined : editEngagement}
          clients={allClients}
          onCancel={() => setEditEngagement(null)}
          onError={onError}
          onDone={(e) => {
            setToast(
              editEngagement === 'new' ? `Engagement “${e.title}” opened` : `Saved “${e.title}”`,
            );
            setEditEngagement(null);
            bump();
          }}
        />
      )}

      {editAppointment && (
        <AppointmentForm
          existing={editAppointment}
          onCancel={() => setEditAppointment(null)}
          onError={onError}
          onDone={() => {
            setToast('Meeting updated');
            setEditAppointment(null);
            bump();
          }}
        />
      )}

      {openClient !== null && (
        <ClientDetailModal
          key={`${openClient.id}-${openClient.tab ?? ''}`}
          clientId={openClient.id}
          initialTab={openClient.tab}
          onToast={(m) => setToast(m)}
          onClose={() => {
            setOpenClient(null);
            bump();
          }}
          onError={onError}
          onIssued={(created) => setIssued(created)}
          onOpenMeeting={(id) => setOpenMeeting(id)}
        />
      )}

      {openInvoice !== null && (
        <InvoiceModal
          invoiceId={openInvoice}
          onClose={() => setOpenInvoice(null)}
          onChanged={bump}
          onError={onError}
          onToast={(m) => setToast(m)}
        />
      )}

      {paying && (
        <RecordPaymentModal
          clients={allClients}
          onCancel={() => setPaying(false)}
          onError={onError}
          onDone={(p) => {
            setPaying(false);
            setToast(`Payment of ${money(p.amountCents)} recorded for ${p.clientName}`);
            bump();
          }}
        />
      )}

      {openMeeting !== null && (
        <MeetingManager
          appointmentId={openMeeting}
          onClose={() => {
            setOpenMeeting(null);
            bump();
          }}
          onError={onError}
          onChanged={bump}
        />
      )}
        </div>
      </main>

      {toast && (
        <div className="toast" role="status">
          <span className="toast-dot" aria-hidden="true" />
          {toast}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- invite */

/**
 * Public invitation page. The token in the URL is the credential, so this
 * route deliberately sits outside RequireAuth -- someone arriving here has
 * no password yet.
 */
function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const [invite, setInvite] = useState<InviteView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('That invitation link is not valid.');
      setLoading(false);
      return;
    }
    peekInvite(token)
      .then(setInvite)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Accepting signs them straight in; asking them to retype the
      // password they just chose adds a step and a chance to mistype.
      setUser(await acceptInvite(token, password));
      navigate('/portal', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="page"><p>Loading...</p></main>;
  }

  if (!invite) {
    return (
      <main className="page narrow">
        <h1>Invitation</h1>
        <div className="error">{error ?? 'That invitation link is not valid.'}</div>
        <p className="body">
          Links expire after seven days and work only once. Ask us to send a new
          one, or <Link to="/login">sign in</Link> if you have already set a
          password.
        </p>
      </main>
    );
  }

  return (
    <main className="page narrow">
      <h1>Set your password</h1>
      <p className="lede">
        Welcome, {invite.displayName}.
        {invite.clientName ? ` You have been invited to the ${invite.clientName} portal.` : ''}
      </p>

      {error && <div className="error">{error}</div>}

      <form onSubmit={onSubmit} className="stack-form">
        <label>
          Email
          {/* Shown, not editable: the invite is bound to this address. */}
          <input type="email" value={invite.email} readOnly disabled />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={72}
            required
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            value={confirm}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={72}
            required
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <p className="hint">
          At least {MIN_PASSWORD_LENGTH} characters, up to 72 bytes &mdash; accented
          characters and emoji count as more than one.
        </p>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Setting...' : 'Set password and sign in'}
        </button>
      </form>
    </main>
  );
}

/* ------------------------------------------------------------------ shell */

export default function App() {
  // The admin console is a full-screen application with its own navigation;
  // the marketing header and footer would only take space from it.
  const { pathname } = useLocation();
  const isConsole = pathname.startsWith('/admin');

  return (
    <AuthProvider>
      <div className={isConsole ? 'app app-console' : 'app'}>
        {!isConsole && <SiteHeader />}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/services" element={<Services />} />
          <Route path="/approach" element={<Approach />} />
          <Route path="/book" element={<BookConsultation />} />
          <Route path="/login" element={<Login />} />
          {/* Not wrapped in RequireAuth: that would bounce straight back
              here, since the whole point is that this user must change
              their password before anything else. */}
          {/* Public: the token is the credential. */}
          <Route path="/invite/:token" element={<AcceptInvite />} />
          <Route path="/change-password" element={<ChangePassword forced />} />
          <Route path="/account" element={<ChangePassword forced={false} />} />
          <Route
            path="/portal"
            element={
              <RequireAuth>
                <Portal />
              </RequireAuth>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <Admin />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/print/meeting/:id"
            element={
              <RequireAdmin>
                <PrintMeeting />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/print/invoice/:id"
            element={
              <RequireAdmin>
                <PrintInvoice />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/print/statement/:id"
            element={
              <RequireAdmin>
                <PrintStatement />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<main className="page"><h1>Not found</h1></main>} />
        </Routes>
        {!isConsole && <SiteFooter />}
      </div>
    </AuthProvider>
  );
}
