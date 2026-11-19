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
  PilotToProduction,
  ServiceIcon,
  SourcesToOutput,
  Timeline,
} from './graphics';
import {
  BookingForm,
  formatLength,
  formatRange,
  LENGTH_OPTIONS,
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

function Nav() {
  const { user } = useAuth();

  return (
    <nav className="nav">
      <Link to="/" className="brand">
        Data Painters
      </Link>
      <div className="nav-links">
        <Link to="/approach">Approach</Link>
        <Link to="/portal">Client portal</Link>
        {user?.role === 'ADMIN' && <Link to="/admin">Admin</Link>}
        {user && <UserMenu user={user} />}
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ pages */

function Home() {
  return (
    <main className="page">
      {/* Copy and figure share the width; the hero used to leave the right
          third of a 68rem container empty. */}
      <section className="hero split">
        <div>
          <h1>Enterprise AI, built by people who built enterprise BI.</h1>
          <p className="lede">
            We spent twenty-five years making data trustworthy inside large
            organisations &mdash; the warehouses, the semantic layers, the governance,
            the migrations nobody wanted to own. The hard part was never the model. It
            was the data it has to read, the systems it has to write to, and the people
            who have to defend the output in a meeting. That has not changed. The tools
            have.
          </p>
          <Link to="/portal" className="cta">
            Client portal
          </Link>
        </div>
        <figure className="figure-wrap">
          <SourcesToOutput />
          <figcaption>
            Sources rarely agree. Everything expensive happens before the model.
          </figcaption>
        </figure>
      </section>

      <section className="split">
        <div>
          <h2 className="section-head">Why the scaling problem is the familiar one</h2>
          <p className="body">
            Most AI pilots work. Most AI programmes stall anyway, and they stall on
            things an enterprise data team has seen before: lineage nobody can trace,
            access controls that do not survive an audit, a pipeline that was never
            going to run twice, an output no owner will sign off on. We recognise those
            failures because we spent a career fixing the business intelligence versions
            of them.
          </p>
          <p className="body">
            We moved into AI the way we moved into everything else &mdash; by shipping
            it inside organisations where it had to integrate with what already existed,
            clear review, and keep working after we left.
          </p>
        </div>
        <figure className="figure-wrap">
          <PilotToProduction />
          <figcaption>
            A pilot is one workload that worked once. Production is the same workload,
            replicated, observed and on somebody&rsquo;s rota.
          </figcaption>
        </figure>
      </section>

      <section className="services">
        <article>
          <ServiceIcon name="assess" />
          <h2>Assessment</h2>
          <p>
            Where AI would actually move a number in your business, and where it would
            just add a subscription. Delivered as a ranked list with effort and payback
            against each item.
          </p>
        </article>
        <article>
          <ServiceIcon name="data" />
          <h2>Data readiness</h2>
          <p>
            The unglamorous prerequisite. What your data looks like now, what it needs
            to look like, and the shortest path between the two &mdash; schema, quality,
            access, and the migrations nobody wants to own.
          </p>
        </article>
        <article>
          <ServiceIcon name="scale" />
          <h2>Build and scale</h2>
          <p>
            From a working prototype to something that holds a production load, an
            audit and a support rotation. The step most pilots never budget for, and
            the one our background is actually in.
          </p>
        </article>
        <article>
          <ServiceIcon name="oversee" />
          <h2>Implementation oversight</h2>
          <p>
            Working alongside your team or your vendor, making sure what ships can be
            operated by the people who will own it after the engagement ends.
          </p>
        </article>
      </section>

      <section className="clients">
        <h2 className="section-head">Where our team has worked</h2>
        <p className="body">
          Data Painters is a small group of engineers. Between us, our work has been
          delivered for:
        </p>
        <ul className="client-list">
          <li>Amazon</li>
          <li>Apple</li>
          <li>Blackboard</li>
          <li>Facebook</li>
          <li>Google</li>
          <li>IBM</li>
          <li>Microsoft</li>
          <li>NBC</li>
          <li>PwC</li>
          <li>United Airlines</li>
        </ul>
        <p className="fine">
          Engagements were delivered by members of our team, in some cases through
          previous employers. Named for experience, not as endorsements.
        </p>
      </section>
    </main>
  );
}

function Approach() {
  return (
    <main className="page">
      <section className="hero split">
        <div>
          <h1>Approach</h1>
          <p className="lede">
            We were doing most of this before it was called AI. The principles came from
            enterprise data work &mdash; migrations that went well, and a few that did
            not.
          </p>
        </div>
        <figure className="figure-wrap">
          <Timeline />
          <figcaption>
            The same line, not a new one. Each era inherited the previous era&rsquo;s
            unsolved problems.
          </figcaption>
        </figure>
      </section>

      <section className="split">
        <ol className="principles">
          <li>
            <strong>Start where the data already is.</strong> An integration that needs
            a data migration first is two projects wearing one budget.
          </li>
          <li>
            <strong>Measure before and after, on the same metric.</strong> If nobody
            wrote down the baseline, the project cannot succeed or fail &mdash; it can
            only end.
          </li>
          <li>
            <strong>Design for the second year.</strong> Anything can be made to work
            once by the people who built it. Enterprise scale is mostly a question of
            what happens on the day none of them are available.
          </li>
          <li>
            <strong>Leave it operable.</strong> The test of an engagement is what still
            works six months after the consultant stops answering the phone.
          </li>
        </ol>
        <div className="aside">
          <h2 className="section-head">What twenty-five years actually buys you</h2>
          <p className="body">
            Pattern recognition, mostly. An enterprise AI programme fails in a small
            number of recognisable ways, and nearly all of them are data and
            organisational problems wearing new vocabulary. Having watched the business
            intelligence generation of the same mistakes, we tend to know which corner a
            project is about to turn before it turns it.
          </p>
        </div>
      </section>
    </main>
  );
}

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
      setUser(await apiLogin(email, password));
      navigate('/portal', { replace: true });
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
  const { signOut } = useAuth();

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

  return (
    <main className="page">
      <h1>Client portal</h1>

      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'topics'}
          className={tab === 'topics' ? 'tab tab-on' : 'tab'}
          onClick={() => setTab('topics')}
        >
          Session topics
        </button>
        <button
          role="tab"
          aria-selected={tab === 'meetings'}
          className={tab === 'meetings' ? 'tab tab-on' : 'tab'}
          onClick={() => setTab('meetings')}
        >
          Meetings
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

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

          <div className="tool-toolbar">
            <button onClick={() => setAdding((v) => !v)}>
              {adding ? 'Cancel' : 'Add topic'}
            </button>
            <button
              onClick={() => {
                setBooking(true);
                setTab('meetings');
              }}
              disabled={openTopics.length === 0}
            >
              Schedule a meeting
            </button>
          </div>

          {adding && (
            <form onSubmit={onAdd} className="stack-form inset">
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
              <button type="submit">Add topic</button>
            </form>
          )}

          {topics.length === 0 ? (
            <p className="empty">No topics yet.</p>
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
                      <button className="linklike" onClick={() => onDropTopic(t)}>
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

          <div className="tool-toolbar">
            <button onClick={() => setBooking((v) => !v)}>
              {booking ? 'Cancel' : 'Schedule a meeting'}
            </button>
          </div>

          {booking && (
            <BookingForm
              engagements={engagements}
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
            <p className="empty">Nothing scheduled yet.</p>
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
                      <td>{a.topicCount} topics</td>
                      <td>
                        <span className={`status status-ap-${a.status}`}>
                          {statusLabel(a.status)}
                        </span>
                      </td>
                      <td>
                        {a.status !== 'cancelled' && a.status !== 'completed' && (
                          <button
                            className="linklike"
                            onClick={() => onCancelMeeting(a.id)}
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
      if (forced) navigate('/portal', { replace: true });
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
            required
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <p className="hint">At least {MIN_PASSWORD_LENGTH} characters.</p>
        <button type="submit" disabled={busy}>
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

type AdminTab = 'clients' | 'engagements' | 'appointments' | 'system';
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

  const [tab, setTab] = useState<AdminTab>('clients');
  const [tool, setTool] = useState<SystemTool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<CreatedUser | null>(null);

  // Column metadata comes from the server so the dropdowns can never offer
  // a filter the API would reject.
  const [cols, setCols] = useState<{
    clients: GridColumn[];
    engagements: GridColumn[];
    appointments: GridColumn[];
  }>({ clients: [], engagements: [], appointments: [] });

  // Every client, for the pickers in the forms. Separate from the paged
  // grid: a dropdown must show all of them, not page 1 of them.
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);

  const [refresh, setRefresh] = useState(0);
  const bump = useCallback(() => setRefresh((n) => n + 1), []);

  const [editClient, setEditClient] = useState<Client | 'new' | null>(null);
  const [editEngagement, setEditEngagement] = useState<AdminEngagement | 'new' | null>(null);
  const [editAppointment, setEditAppointment] = useState<AdminAppointment | null>(null);

  const [openClient, setOpenClient] = useState<number | null>(null);
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
    ])
      .then(([c, e, a, clientPage, u]) => {
        setCols({ clients: c, engagements: e, appointments: a });
        setAllClients(clientPage.rows);
        setUsers(u);
      })
      .catch(onError);
  }, [onError, refresh]);

  const loadClients = useCallback((q: string) => listClients(q), []);
  const loadEngagements = useCallback((q: string) => listAllEngagements(q), []);
  const loadAppointments = useCallback((q: string) => listAdminAppointments(q), []);

  const activeTool = SYSTEM_TOOLS.find((t) => t.id === tool);
  const tabs: AdminTab[] = ['clients', 'engagements', 'appointments', 'system'];
  const label = (t: AdminTab) => t[0].toUpperCase() + t.slice(1);

  return (
    <main className="page">
      <header className="screen-head">
        <h1>Admin</h1>
        <p className="muted">Clients, engagements, meetings and system tools.</p>
      </header>

      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'tab tab-on' : 'tab'}
            onClick={() => {
              setTab(t);
              setTool(null);
            }}
          >
            {label(t)}
          </button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}
      {issued && <InviteIssued issued={issued} onDismiss={() => setIssued(null)} />}

      {tab === 'clients' && (
        <ListTab<Client>
          columns={cols.clients}
          load={loadClients}
          refreshKey={refresh}
          defaultSort="name:asc"
          addLabel="Add New"
          onAdd={() => setEditClient('new')}
          onRowClick={(c) => setOpenClient(c.id)}
          empty="No clients yet."
          gridColumns={[
            { field: 'name', label: 'Client', render: (c) => <strong>{c.name}</strong> },
            { field: 'primaryEmail', label: 'Primary email' },
            {
              field: 'createdAt',
              label: 'Added',
              render: (c) => (
                <span className="nowrap">
                  {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '--'}
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

      {tab === 'engagements' && (
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
              render: (e) => <span className="nowrap">{e.startedOn ?? '--'}</span>,
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

      {tab === 'appointments' && (
        <ListTab<AdminAppointment>
          columns={cols.appointments}
          load={loadAppointments}
          refreshKey={refresh}
          defaultSort="startsAt:desc"
          addLabel="Add New"
          onAdd={() =>
            setError('Meetings are booked by clients from the portal, or from a client’s detail screen.')
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
                  {a.notedCount}/{a.topicCount} noted
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

      {tab === 'system' && (
        <section>
          {tool === null ? (
            <div className="cards">
              {SYSTEM_TOOLS.map((t) => (
                <button key={t.id} className="card" onClick={() => setTool(t.id)}>
                  <span className="card-title">{t.title}</span>
                  <span className="card-blurb">{t.blurb}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <button className="linklike back" onClick={() => setTool(null)}>
                &larr; System
              </button>
              <h2 className="section-head">{activeTool?.title}</h2>

              {tool === 'signins' && <SignInActivity onError={onError} />}
              {tool === 'logins' && (
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
            </>
          )}
        </section>
      )}

      {editClient && (
        <ClientForm
          existing={editClient === 'new' ? undefined : editClient}
          onCancel={() => setEditClient(null)}
          onError={onError}
          onDone={() => {
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
          onDone={() => {
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
            setEditAppointment(null);
            bump();
          }}
        />
      )}

      {openClient !== null && (
        <ClientDetailModal
          clientId={openClient}
          onClose={() => {
            setOpenClient(null);
            bump();
          }}
          onError={onError}
          onIssued={(created) => setIssued(created)}
          onOpenMeeting={(id) => setOpenMeeting(id)}
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
    </main>
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
            required
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <p className="hint">At least {MIN_PASSWORD_LENGTH} characters.</p>
        <button type="submit" disabled={busy}>
          {busy ? 'Setting...' : 'Set password and sign in'}
        </button>
      </form>
    </main>
  );
}

/* ------------------------------------------------------------------ shell */

export default function App() {
  return (
    <AuthProvider>
      <div className="app">
        <Nav />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/approach" element={<Approach />} />
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
          <Route path="*" element={<main className="page"><h1>Not found</h1></main>} />
        </Routes>
        <footer className="footer">
          <span>&copy; {new Date().getFullYear()} Data Painters</span>
        </footer>
      </div>
    </AuthProvider>
  );
}
