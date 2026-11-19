import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import {
  changePassword as apiChangePassword,
  createClient,
  createEngagement,
  createTopic,
  createUser,
  listClients,
  listEngagements,
  listTopics,
  listUsers,
  login as apiLogin,
  me,
  updateTopicStatus,
  Unauthorized,
  type AdminUser,
  type Client,
  type CreatedUser,
  type Engagement,
  type Topic,
} from './api';
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

function Nav() {
  const { user, signOut } = useAuth();

  return (
    <nav className="nav">
      <Link to="/" className="brand">
        Data Painters
      </Link>
      <div className="nav-links">
        <Link to="/approach">Approach</Link>
        <Link to="/portal">Client portal</Link>
        {user?.role === 'ADMIN' && <Link to="/admin">Admin</Link>}
        {user && !user.mustChangePassword && <Link to="/account">Account</Link>}
        {user && (
          <button className="linklike" onClick={signOut}>
            Sign out
          </button>
        )}
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ pages */

function Home() {
  return (
    <main className="page">
      <section className="hero">
        <h1>AI that fits the systems you already run.</h1>
        <p className="lede">
          Most AI programs stall for the same reason: the model was never the hard part.
          The hard part is the data it has to read, the systems it has to write to, and
          the people who have to trust the output. That is the part we work on.
        </p>
        <Link to="/portal" className="cta">
          Client portal
        </Link>
      </section>

      <section className="services">
        <article>
          <h2>Assessment</h2>
          <p>
            Where AI would actually move a number in your business, and where it would
            just add a subscription. Delivered as a ranked list with effort and payback
            against each item.
          </p>
        </article>
        <article>
          <h2>Data readiness</h2>
          <p>
            The unglamorous prerequisite. What your data looks like now, what it needs
            to look like, and the shortest path between the two — schema, quality,
            access, and the migrations nobody wants to own.
          </p>
        </article>
        <article>
          <h2>Implementation oversight</h2>
          <p>
            Working alongside your team or your vendor, making sure what ships can be
            operated by the people who will own it after the engagement ends.
          </p>
        </article>
      </section>
    </main>
  );
}

function Approach() {
  return (
    <main className="page">
      <h1>Approach</h1>
      <p className="lede">
        Three principles, learned from migrations that went well and a few that did not.
      </p>
      <ol className="principles">
        <li>
          <strong>Start where the data already is.</strong> An integration that needs a
          data migration first is two projects wearing one budget.
        </li>
        <li>
          <strong>Measure before and after, on the same metric.</strong> If nobody wrote
          down the baseline, the project cannot succeed or fail — it can only end.
        </li>
        <li>
          <strong>Leave it operable.</strong> The test of an engagement is what still
          works six months after the consultant stops answering the phone.
        </li>
      </ol>
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

  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    listEngagements()
      .then((list) => {
        setEngagements(list);
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
      const created = await createTopic({ engagementId: selected, title: title.trim() });
      setTopics((prev) => [...prev, created]);
      setTitle('');
      setError(null);
    } catch (err) {
      onError(err);
    }
  }

  async function onAdvance(topic: Topic) {
    const next = topic.status === 'proposed' ? 'scheduled' : 'discussed';
    try {
      const updated = await updateTopicStatus(topic.id, next);
      setTopics((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      onError(err);
    }
  }

  if (loading) {
    return <main className="page"><p>Loading...</p></main>;
  }

  return (
    <main className="page">
      <h1>Session topics</h1>
      <p className="lede">
        What you want covered next time. Ordered by priority, lowest number first.
      </p>

      {error && <div className="error">{error}</div>}

      {engagements.length === 0 ? (
        <div className="notice">
          No engagements are set up for your account yet. Once we open one, your topics
          will appear here.
        </div>
      ) : (
        <>
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

          <form onSubmit={onAdd} className="add-form">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add a topic..."
              aria-label="Topic title"
            />
            <button type="submit">Add</button>
          </form>

          {topics.length === 0 ? (
            <p className="empty">No topics yet.</p>
          ) : (
            <ul className="topics">
              {topics.map((t) => (
                <li key={t.id}>
                  <span className={`status status-${t.status}`}>{t.status}</span>
                  <span className="topic-title">{t.title}</span>
                  <span className="priority">P{t.priority}</span>
                  {t.status !== 'discussed' && t.status !== 'dropped' && (
                    <button onClick={() => onAdvance(t)}>
                      {t.status === 'proposed' ? 'Schedule' : 'Mark discussed'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
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

function Admin() {
  const { signOut } = useAuth();

  const [clients, setClients] = useState<Client[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Shown once, after a create. There is no way to get it back, so it stays on
  // screen until the admin dismisses it rather than clearing on the next render.
  const [issued, setIssued] = useState<CreatedUser | null>(null);

  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [engClient, setEngClient] = useState('');
  const [engTitle, setEngTitle] = useState('');
  const [userClient, setUserClient] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');

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

  const reload = useCallback(() => {
    return Promise.all([listClients(), listUsers()])
      .then(([c, u]) => {
        setClients(c);
        setUsers(u);
      })
      .catch(onError);
  }, [onError]);

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, [reload]);

  async function onCreateClient(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await createClient({
        name: clientName.trim(),
        primaryEmail: clientEmail.trim(),
      });
      setClients((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setClientName('');
      setClientEmail('');
    } catch (err) {
      onError(err);
    }
  }

  async function onCreateEngagement(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createEngagement({ clientId: Number(engClient), title: engTitle.trim() });
      setEngTitle('');
    } catch (err) {
      onError(err);
    }
  }

  async function onCreateUser(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await createUser({
        clientId: Number(userClient),
        email: userEmail.trim(),
        displayName: userName.trim(),
      });
      setIssued(created);
      setUsers((prev) => [...prev, created.user]);
      setUserEmail('');
      setUserName('');
    } catch (err) {
      onError(err);
    }
  }

  if (loading) {
    return <main className="page"><p>Loading...</p></main>;
  }

  const clientName_ = (id: number | null) =>
    id === null ? '--' : (clients.find((c) => c.id === id)?.name ?? `#${id}`);

  return (
    <main className="page">
      <h1>Admin</h1>
      <p className="lede">Clients, engagements, and portal logins.</p>

      {error && <div className="error">{error}</div>}

      {issued && (
        <div className="notice issued">
          <p>
            <strong>{issued.user.email}</strong> can now sign in with this one-time
            password. It is not stored anywhere readable and cannot be shown again --
            send it now, by a channel other than the email address above where you can.
          </p>
          <code className="one-time">{issued.oneTimePassword}</code>
          <p>They will be asked to choose their own password at first sign-in.</p>
          <button onClick={() => setIssued(null)}>Done</button>
        </div>
      )}

      <section className="admin-section">
        <h2>New client</h2>
        <form onSubmit={onCreateClient} className="stack-form">
          <label>
            Company name
            <input value={clientName} required onChange={(e) => setClientName(e.target.value)} />
          </label>
          <label>
            Primary email
            <input
              type="email"
              value={clientEmail}
              required
              onChange={(e) => setClientEmail(e.target.value)}
            />
          </label>
          <button type="submit">Create client</button>
        </form>
      </section>

      {clients.length === 0 ? (
        <p className="empty">No clients yet. Create one to open an engagement.</p>
      ) : (
        <>
          <section className="admin-section">
            <h2>Open an engagement</h2>
            <form onSubmit={onCreateEngagement} className="stack-form">
              <label>
                Client
                <select
                  value={engClient}
                  required
                  onChange={(e) => setEngClient(e.target.value)}
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
                  value={engTitle}
                  required
                  placeholder="AI readiness assessment"
                  onChange={(e) => setEngTitle(e.target.value)}
                />
              </label>
              <button type="submit">Open engagement</button>
            </form>
          </section>

          <section className="admin-section">
            <h2>New portal login</h2>
            <form onSubmit={onCreateUser} className="stack-form">
              <label>
                Client
                <select
                  value={userClient}
                  required
                  onChange={(e) => setUserClient(e.target.value)}
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
                Name
                <input value={userName} required onChange={(e) => setUserName(e.target.value)} />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={userEmail}
                  required
                  onChange={(e) => setUserEmail(e.target.value)}
                />
              </label>
              <button type="submit">Create login</button>
            </form>
          </section>
        </>
      )}

      <section className="admin-section">
        <h2>Clients</h2>
        {clients.length === 0 ? (
          <p className="empty">None.</p>
        ) : (
          <ul className="admin-list">
            {clients.map((c) => (
              <li key={c.id}>
                <span className="topic-title">{c.name}</span>
                <span className="muted">{c.primaryEmail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin-section">
        <h2>Logins</h2>
        <ul className="admin-list">
          {users.map((u) => (
            <li key={u.id}>
              <span className={`status status-${u.enabled ? 'scheduled' : 'dropped'}`}>
                {u.role.toLowerCase()}
              </span>
              <span className="topic-title">{u.displayName}</span>
              <span className="muted">{u.email}</span>
              <span className="muted">{clientName_(u.clientId)}</span>
              <span className="muted">
                {u.lastLoginAt
                  ? new Date(u.lastLoginAt).toLocaleDateString()
                  : 'never signed in'}
              </span>
            </li>
          ))}
        </ul>
      </section>
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
