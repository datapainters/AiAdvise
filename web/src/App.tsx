import { useEffect } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Mark } from './components/Mark';
import { Approach } from './pages/Approach';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';
import { Portal } from './pages/Portal';
import { site } from './site';

/** Top of the page on navigation, or the target section when the link has a hash. */
function ScrollOnNavigate() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    const target = hash ? document.getElementById(hash.slice(1)) : null;
    if (target) {
      target.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
    }
  }, [pathname, hash]);
  return null;
}

function Brand() {
  return (
    <Link to="/" className="brand">
      <Mark />
      {site.name}
    </Link>
  );
}

function Nav() {
  return (
    <header className="site-head">
      <nav className="nav wrap" aria-label="Main">
        <Brand />
        <div className="nav-links">
          <Link to="/#services" className="nav-services">
            Services
          </Link>
          <NavLink to="/approach">Approach</NavLink>
          <NavLink to="/portal" className="nav-portal">
            Client portal
          </NavLink>
        </div>
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <div>
          <Brand />
          <p>{site.tagline}</p>
        </div>
        <nav aria-label="Footer">
          <Link to="/#services">Services</Link>
          <Link to="/approach">Approach</Link>
          <Link to="/portal">Client portal</Link>
          {site.contactEmail && <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>}
        </nav>
      </div>
      <p className="wrap footer-legal">
        &copy; {new Date().getFullYear()} {site.name}
      </p>
    </footer>
  );
}

export default function App() {
  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <ScrollOnNavigate />
      <Nav />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/approach" element={<Approach />} />
        <Route path="/portal" element={<Portal />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Footer />
    </div>
  );
}
