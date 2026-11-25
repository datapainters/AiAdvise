import { Link } from 'react-router-dom';
import { contactHref } from '../site';
import { usePageTitle } from '../usePageTitle';

const PRINCIPLES = [
  {
    title: 'Start where the data already is.',
    body: 'An integration that needs a data migration first is two projects wearing one budget. The first version reads from the systems you have, in the shape they are in.',
  },
  {
    title: 'Measure before and after, on the same metric.',
    body: 'If nobody wrote down the baseline, the project cannot succeed or fail. It can only end. The baseline gets written down before anything is built.',
  },
  {
    title: 'Leave it operable.',
    body: 'The test of an engagement is what still works six months after the consultant stops answering the phone. Whoever will own the system is in the room while it is designed.',
  },
];

export function Approach() {
  usePageTitle('Approach');
  const contact = contactHref();

  return (
    <main id="main" className="wrap page">
      <header className="page-head">
        <h1>Approach</h1>
        <p className="lede">
          Three principles, learned from migrations that went well and a few that did not.
        </p>
      </header>

      <div className="principles">
        {PRINCIPLES.map((p) => (
          <section key={p.title} className="principle">
            <h2>{p.title}</h2>
            <p>{p.body}</p>
          </section>
        ))}
      </div>

      <div className="actions page-end">
        {contact && (
          <a href={contact} className="btn btn-primary">
            Book an introduction
          </a>
        )}
        <Link to="/#services" className={contact ? 'btn btn-quiet' : 'btn btn-primary'}>
          See the services
        </Link>
      </div>
    </main>
  );
}
