import { Link } from 'react-router-dom';
import { usePageTitle } from '../usePageTitle';

export function NotFound() {
  usePageTitle('Page not found');
  return (
    <main id="main" className="wrap page">
      <header className="page-head">
        <h1>That page is not here.</h1>
        <p className="lede">The address may be mistyped, or the page may have moved.</p>
      </header>
      <div className="actions">
        <Link to="/" className="btn btn-primary">
          Go to the home page
        </Link>
        <Link to="/portal" className="btn btn-quiet">
          Open the client portal
        </Link>
      </div>
    </main>
  );
}
