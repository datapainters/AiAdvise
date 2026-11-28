/**
 * The public site's plain pages: contact, privacy, terms, the password reset
 * request and the page shown for an address that does not exist.
 *
 * The privacy policy and terms describe what the system actually does. When
 * the system changes what it keeps or who it sends things to, they change
 * with it.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { requestPasswordReset } from './public-api';

export const CONTACT_EMAIL = 'info@datapainters.com';

const UPDATED = 'November 28, 2026';

function useTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · DataPainters`;
    window.scrollTo(0, 0);
    return () => {
      document.title = previous;
    };
  }, [title]);
}

function Plain({ title, lede, children }: { title: string; lede?: ReactNode; children: ReactNode }) {
  useTitle(title);
  return (
    <main className="mk">
      <section className="mk-hero mk-hero-compact">
        <div className="mk-wrap">
          <h1>{title}</h1>
          {lede && <p className="mk-lede">{lede}</p>}
        </div>
      </section>
      <section className="mk-section">
        <div className="mk-wrap">{children}</div>
      </section>
    </main>
  );
}

/* ----------------------------------------------------------------- contact */

export function Contact() {
  return (
    <Plain
      title="Contact us"
      lede="Two ways to reach us. Pick whichever suits the question."
    >
      <div className="mk-contact">
        <article className="mk-contact-card">
          <h2>Email us</h2>
          <p>
            For a question, a request for portal access, or anything about an invoice.
          </p>
          <a className="btn btn-primary" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
        </article>
        <article className="mk-contact-card">
          <h2>Book a free consultation</h2>
          <p>
            Thirty minutes on a video call, no charge and no obligation. Tell us what you want to
            cover and choose a time that suits you.
          </p>
          <Link className="btn btn-primary" to="/book">
            Choose a time
          </Link>
        </article>
      </div>
      <p className="mk-contact-note">
        DataPainters is based in Austin, Texas. Meetings are offered on weekdays, 8 AM to 6 PM
        Central. Already a client? <Link to="/login">Sign in to the client portal</Link>.
      </p>
    </Plain>
  );
}

/* ----------------------------------------------------------------- privacy */

export function Privacy() {
  return (
    <Plain
      title="Privacy policy"
      lede={`How DataPainters collects, uses and keeps information. Last updated ${UPDATED}.`}
    >
      <div className="mk-prose">
        <h2>Who we are</h2>
        <p>
          DataPainters is an AI advisory firm based in Austin, Texas. This policy covers this
          website, the client portal and the video meetings we hold through it. Questions about it
          go to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>What you give us when you book or sign up:</strong> your name, email address,
            company, phone number if you provide one, and the topics you want to discuss.
          </li>
          <li>
            <strong>What you put in the client portal:</strong> engagements, topics, messages,
            files you attach, and the people from your organization you add to your account.
          </li>
          <li>
            <strong>Records of our work together:</strong> meeting times, agendas, notes, time
            spent, files shared during meetings, invoices and payments.
          </li>
          <li>
            <strong>Account and security records:</strong> sign-in attempts, with the time, the
            network address and the browser used. Passwords are stored only in hashed form.
          </li>
        </ul>

        <h2 id="recording">Meetings are recorded and transcribed</h2>
        <p>
          Video meetings with us, including the free consultation, are recorded and transcribed.
          We do this so the notes and summaries we send you are accurate and so we can refer back
          to what was agreed. Recordings and transcripts are used only for your engagement, are
          available only to the DataPainters people working on it, and are covered by the same
          confidentiality as everything else you share with us.
        </p>
        <p>
          If you would rather a meeting not be recorded, tell us before it starts, by email or at
          the beginning of the call, and we will not record it.
        </p>

        <h2>How we use it</h2>
        <ul>
          <li>To schedule and hold meetings, and to send confirmations, summaries and updates.</li>
          <li>To do the advisory work you have engaged us for.</li>
          <li>To bill for time and keep the accounting records the law requires.</li>
          <li>To keep accounts secure and investigate misuse.</li>
        </ul>
        <p>We do not sell your information, and we do not use it for advertising.</p>

        <h2>Who we share it with</h2>
        <p>
          Only the service providers we need to run the system, each handling data on our
          instructions:
        </p>
        <ul>
          <li>Amazon Web Services, which hosts the site, the database and stored files in the United States, and delivers our email.</li>
          <li>Daily, which carries the video calls.</li>
          <li>The service we use to record and transcribe meetings.</li>
        </ul>
        <p>
          We may also disclose information when the law requires it. People on your own team see
          what your account&rsquo;s owner has given them access to.
        </p>

        <h2>Cookies and tracking</h2>
        <p>
          This site does not use advertising or analytics cookies. When you sign in, your browser
          stores a sign-in token so you stay signed in; signing out removes it.
        </p>

        <h2>How long we keep it</h2>
        <p>
          We keep engagement records for as long as you are a client and for a reasonable period
          afterwards, and billing records for as long as tax and accounting rules require.
          Screenshots captured during meetings are deleted after one year. You can ask us to
          delete your information sooner, and we will unless we are required to keep it.
        </p>

        <h2>Your choices</h2>
        <p>
          You can ask for a copy of the information we hold about you, ask us to correct it, or ask
          us to delete it. Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we
          will respond within thirty days.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          If we change this policy we will post the new version here with its date. If the change
          is significant, we will tell current clients by email.
        </p>
      </div>
    </Plain>
  );
}

/* ------------------------------------------------------------------- terms */

export function Terms() {
  return (
    <Plain
      title="Terms of service"
      lede={`The terms for using this website, the client portal and our advisory services. Last updated ${UPDATED}.`}
    >
      <div className="mk-prose">
        <h2>The service</h2>
        <p>
          DataPainters provides AI advisory services: we advise and work alongside your team. We
          do not guarantee a particular business result, and decisions about what to build, buy or
          deploy remain yours. A signed agreement or statement of work between us, if there is one,
          takes priority over these terms where they differ.
        </p>

        <h2>Free consultation</h2>
        <p>
          The first consultation is thirty minutes, free of charge, and carries no obligation to
          continue for either of us.
        </p>

        <h2>Fees and billing</h2>
        <ul>
          <li>Work is billed by the hour at the rate published on this site or agreed with you in writing.</li>
          <li>Time is recorded for each meeting and for written replies, and billed in 30-minute blocks, rounded up.</li>
          <li>Invoices list the sessions they cover and are due by the date shown on the invoice.</li>
          <li>If you need to cancel or move a meeting, please do it in the portal or by email before it starts.</li>
        </ul>

        <h2>Confidentiality</h2>
        <p>
          We treat what you share with us as confidential and use it only for your engagement. We
          are happy to sign your non-disclosure agreement before detailed work begins.
        </p>

        <h2>Recording</h2>
        <p>
          Meetings are recorded and transcribed as described in our{' '}
          <Link to="/privacy#recording">privacy policy</Link>. By joining a meeting you agree to
          this, unless you have told us beforehand that you do not want it recorded.
        </p>

        <h2>Your account</h2>
        <p>
          Keep your password to yourself and tell us promptly if you think someone else has used
          your account. The account owner is responsible for the people they add to it. Do not use
          the portal to store unlawful material or to attempt to access anyone else&rsquo;s data.
        </p>

        <h2>Your content and ours</h2>
        <p>
          What you upload or write remains yours; you give us permission to use it to deliver the
          service. Templates, methods and materials we bring remain ours; you may use what we
          deliver to you within your own organization.
        </p>

        <h2>Liability</h2>
        <p>
          The site and portal are provided as they are. To the extent the law allows, our total
          liability arising from the services is limited to the fees you paid us in the three
          months before the claim arose, and neither of us is liable to the other for indirect or
          consequential losses.
        </p>

        <h2>Governing law</h2>
        <p>These terms are governed by the laws of the State of Texas.</p>

        <h2>Changes and contact</h2>
        <p>
          We may update these terms; the current version is always on this page with its date.
          Questions go to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </div>
    </Plain>
  );
}

/* --------------------------------------------------------- forgot password */

export function ForgotPassword() {
  useTitle('Reset your password');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <h1>Reset your password</h1>
      {sent ? (
        <>
          <p className="lede">
            If <strong>{email.trim()}</strong> has an account, we have emailed it a link to choose
            a new password. The link works once and expires in seven days.
          </p>
          <p>
            Nothing arrived after a few minutes? Check your spam folder, or{' '}
            <Link to="/contact">contact us</Link>.
          </p>
          <p>
            <Link to="/login">Back to sign-in</Link>
          </p>
        </>
      ) : (
        <>
          <p className="lede">
            Enter the email address you sign in with and we will send you a link to choose a new
            password.
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
                autoFocus
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? 'Sending...' : 'Send reset link'}
            </button>
          </form>
          <p>
            <Link to="/login">Back to sign-in</Link>
          </p>
        </>
      )}
    </main>
  );
}

/* --------------------------------------------------------------- not found */

export function NotFound() {
  useTitle('Page not found');
  return (
    <main className="mk">
      <section className="mk-hero mk-hero-compact">
        <div className="mk-wrap">
          <h1>We could not find that page</h1>
          <p className="mk-lede">
            The address may be mistyped, or the page may have moved. These will get you back on
            track.
          </p>
          <div className="mk-notfound-links">
            <Link className="btn btn-primary" to="/">
              Go to the home page
            </Link>
            <Link className="btn" to="/services">
              Services
            </Link>
            <Link className="btn" to="/book">
              Book a free consultation
            </Link>
            <Link className="btn" to="/contact">
              Contact us
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
