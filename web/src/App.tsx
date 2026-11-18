import { useEffect, useState, type FormEvent } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { createTopic, listTopics, updateTopicStatus, type Topic } from './api';

function Nav() {
  return (
    <nav className="nav">
      <Link to="/" className="brand">
        Data Painters
      </Link>
      <div className="nav-links">
        <Link to="/approach">Approach</Link>
        <Link to="/portal">Client portal</Link>
      </div>
    </nav>
  );
}

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
          down the baseline, the project cannot succeed or fail -- it can only end.
        </li>
        <li>
          <strong>Leave it operable.</strong> The test of an engagement is what still
          works six months after the consultant stops answering the phone.
        </li>
      </ol>
    </main>
  );
}

const DEMO_ENGAGEMENT_ID = 1;

function Portal() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listTopics(DEMO_ENGAGEMENT_ID)
      .then(setTopics)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      const created = await createTopic({
        engagementId: DEMO_ENGAGEMENT_ID,
        title: title.trim(),
      });
      setTopics((prev) => [...prev, created]);
      setTitle('');
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onAdvance(topic: Topic) {
    const next = topic.status === 'proposed' ? 'scheduled' : 'discussed';
    try {
      const updated = await updateTopicStatus(topic.id, next);
      setTopics((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="page">
      <h1>Session topics</h1>
      <p className="lede">
        What you want covered next time. Ordered by priority, lowest number first.
      </p>

      <div className="notice">
        Scaffolding: there is no sign-in yet, so this reads a fixed engagement.
        Authentication goes in before any real client data.
      </div>

      {error && <div className="error">{error}</div>}

      <form onSubmit={onAdd} className="add-form">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a topic..."
          aria-label="Topic title"
        />
        <button type="submit">Add</button>
      </form>

      {loading ? (
        <p>Loading...</p>
      ) : topics.length === 0 ? (
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
    </main>
  );
}

export default function App() {
  return (
    <div className="app">
      <Nav />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/approach" element={<Approach />} />
        <Route path="/portal" element={<Portal />} />
        <Route path="*" element={<main className="page"><h1>Not found</h1></main>} />
      </Routes>
      <footer className="footer">
        <span>&copy; {new Date().getFullYear()} Data Painters</span>
      </footer>
    </div>
  );
}
