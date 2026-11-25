import { Link } from 'react-router-dom';
import { SystemDrawing } from '../components/SystemDrawing';
import { StatusChip } from '../components/StatusChip';
import { contactHref } from '../site';
import { usePageTitle } from '../usePageTitle';
import type { Topic } from '../api';

const SERVICES = [
  {
    name: 'Assessment',
    body: 'Where AI would actually move a number in your business, and where it would just add a subscription.',
    result: 'A ranked list of opportunities, with effort and payback against each one.',
  },
  {
    name: 'Data readiness',
    body: 'The unglamorous prerequisite: what your data looks like now, and what it needs to look like before a model can use it.',
    result: 'The shortest path between the two, written as work your team can schedule.',
  },
  {
    name: 'Implementation oversight',
    body: 'Working alongside your team or your vendor while the thing gets built, with an eye on who has to run it afterwards.',
    result: 'A system the people who own it can operate after the engagement ends.',
  },
];

/** Illustrative rows for the agenda preview; the real list lives in the portal. */
const SAMPLE_AGENDA: Pick<Topic, 'title' | 'priority' | 'status'>[] = [
  { title: 'Which invoices can be matched without a person', priority: 1, status: 'scheduled' },
  { title: 'Vendor shortlist for document extraction', priority: 2, status: 'proposed' },
  { title: 'Baseline for support response time', priority: 3, status: 'discussed' },
];

export function Home() {
  usePageTitle();
  const contact = contactHref();

  return (
    <main id="main">
      <section className="hero wrap">
        <div className="hero-copy">
          <h1>AI that fits the systems you already run.</h1>
          <p className="lede">
            Most AI programs stall for the same reason: the model was never the hard part.
            The hard part is the data it has to read, the systems it has to write to, and
            the people who have to trust the output.
          </p>
          <div className="actions">
            {contact ? (
              <a href={contact} className="btn btn-primary">
                Book an introduction
              </a>
            ) : (
              <Link to="/approach" className="btn btn-primary">
                Read the approach
              </Link>
            )}
            <a href="#services" className="btn btn-quiet">
              See the services
            </a>
          </div>
        </div>
        <SystemDrawing />
      </section>

      <section id="services" className="services wrap" aria-labelledby="services-h">
        <h2 id="services-h">Three ways to work together</h2>
        <div className="service-rows">
          {SERVICES.map((s) => (
            <article key={s.name} className="service">
              <h3>{s.name}</h3>
              <p>{s.body}</p>
              <p className="service-result">
                <span>You leave with</span>
                {s.result}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="agenda wrap" aria-labelledby="agenda-h">
        <div className="agenda-copy">
          <h2 id="agenda-h">You set the agenda</h2>
          <p>
            Between sessions, add what you want covered to your topic list in the client
            portal and rank it. Each session starts at the top of that list.
          </p>
          <p>
            Every topic is marked as scheduled and then discussed, so you can see what
            was covered and nothing quietly disappears.
          </p>
          <Link to="/portal" className="text-link">
            Open the client portal
          </Link>
        </div>
        <div className="agenda-preview" aria-label="Example topic list">
          <p className="agenda-preview-title">Session topics</p>
          <ul>
            {SAMPLE_AGENDA.map((t) => (
              <li key={t.title}>
                <span className="priority-badge" data-priority={t.priority}>
                  {t.priority}
                </span>
                <span className="agenda-preview-topic">{t.title}</span>
                <StatusChip status={t.status} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="closing">
        <div className="wrap">
          <blockquote>
            The test of an engagement is what still works six months after the consultant
            stops answering the phone.
          </blockquote>
          <div className="actions">
            <Link to="/approach" className="btn btn-on-dark">
              Read the approach
            </Link>
            {contact && (
              <a href={contact} className="btn btn-on-dark-quiet">
                Book an introduction
              </a>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
