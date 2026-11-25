/**
 * The public marketing site and the free-consultation booking flow.
 *
 * Every page here has one job: get a qualified visitor onto a free
 * 30-minute call. The copy stays plain on purpose -- the audience has sat
 * through a lot of AI pitches, and the thing that differentiates us is the
 * data and delivery background, not adjectives.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { PilotToProduction, SourcesToOutput, Timeline } from './graphics';
import {
  bookConsultation,
  formatRate,
  getAvailability,
  getPublicInfo,
  PublicApiError,
  type BusyInterval,
  type ConsultationBooked,
  type PublicInfo,
  type Segment,
} from './public-api';
import './marketing.css';
import { DEFAULT_HOURS, describeHours, openSlots, type BusinessHours } from './hours';

/* ------------------------------------------------------------------ data */

interface SegmentInfo {
  id: Segment;
  anchor: string;
  name: string;
  audience: string;
  summary: string;
  covers: string[];
  outcomes: string[];
}

export const SEGMENTS: SegmentInfo[] = [
  {
    id: 'corporate',
    anchor: 'corporate-ai',
    name: 'Corporate AI Development',
    audience: 'For senior leaders and managers',
    summary:
      'Company-wide AI enablement, decided at the level where budgets and accountability sit. We help leadership choose where AI will move a number, sequence the work, and put the governance in place before the first pilot becomes a liability.',
    covers: [
      'AI strategy and a ranked opportunity portfolio, with effort and payback against each item',
      'Operating model: who owns models, data, risk and spend once the pilots end',
      'Governance, policy and vendor evaluation that survive an audit',
      'Roadmaps that move from pilot to production without a second budget cycle',
    ],
    outcomes: [
      'A short list of initiatives worth funding, and the reasons the rest are not',
      'Clear ownership and decision rights across business, data and engineering',
    ],
  },
  {
    id: 'data',
    anchor: 'ai-data',
    name: 'AI Data Development',
    audience: 'For business and data teams',
    summary:
      'The unglamorous prerequisite. Models are only as good as the data they read and the systems they write to. We advise business teams on how data is stored, how good it is, and whether it will scale when usage does.',
    covers: [
      'Data storage and platform choices: warehouse, lakehouse, vector and operational stores',
      'Data quality: profiling, contracts, lineage and the fixes that matter first',
      'Scalability and cost: volumes, latency and the bill at ten times today’s usage',
      'Access and security models that hold up once AI systems start reading everything',
    ],
    outcomes: [
      'An honest picture of what your data can support today',
      'The shortest path from where it is to where AI needs it to be',
    ],
  },
  {
    id: 'dev',
    anchor: 'dev-enablement',
    name: 'Development Team AI Enablement',
    audience: 'For engineering teams',
    summary:
      'AI development is an entirely new environment, top to bottom: how code is written and reviewed, how systems are tested and evaluated, how they are deployed and observed. We help engineering teams make that transition quickly and without losing the discipline they already have.',
    covers: [
      'AI-assisted development workflows, review practices and guardrails',
      'Pipelines for LLM and ML features: evaluation, versioning, release and rollback',
      'Testing and observability for non-deterministic systems',
      'Team skills, tooling choices and a practical adoption plan',
    ],
    outcomes: [
      'A working AI delivery pipeline your team owns and understands',
      'Faster delivery with the same standards for quality and security',
    ],
  },
];

const CLIENTS = [
  'Amazon',
  'Apple',
  'Blackboard',
  'Facebook',
  'Google',
  'IBM',
  'Microsoft',
  'NBC',
  'PwC',
  'United Airlines',
];

/* ----------------------------------------------------------------- hooks */

let infoCache: Promise<PublicInfo | null> | null = null;

/** Published pricing, fetched once per page load and shared. */
function usePublicInfo(): PublicInfo | null {
  const [info, setInfo] = useState<PublicInfo | null>(null);
  useEffect(() => {
    if (!infoCache) {
      infoCache = getPublicInfo().catch(() => {
        infoCache = null; // allow a retry on the next page
        return null;
      });
    }
    let live = true;
    infoCache.then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, []);
  return info;
}

/** Tab title for a marketing page; the home page passes nothing. */
function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · Data Painters` : 'Data Painters · Enterprise AI advisory';
    // Signed-in screens do not set a title, so hand back the plain one.
    return () => {
      document.title = 'Data Painters';
    };
  }, [title]);
}

/** React Router does not scroll to #fragments; this does, and to top otherwise. */
function useScrollToHash() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
}

/* ---------------------------------------------------------------- chrome */

/**
 * Marketing header. `account` lets the app shell drop in its signed-in user
 * menu; without it the header shows a Client sign-in link.
 */
export function SiteNav({ account }: { account?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname, location.hash]);

  return (
    <header className="mk-header">
      <div className="mk-header-inner">
        <Link to="/" className="mk-brand" aria-label="Data Painters home">
          <span className="mk-brand-mark" aria-hidden="true" />
          Data Painters
        </Link>

        <button
          className="mk-menu-toggle"
          aria-expanded={open}
          aria-controls="mk-nav"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">Menu</span>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            {open ? (
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" />
            )}
          </svg>
        </button>

        <nav id="mk-nav" className={open ? 'mk-nav open' : 'mk-nav'} aria-label="Main">
          <NavLink to="/services">Services</NavLink>
          <NavLink to="/approach">Approach</NavLink>
          <Link to="/#pricing">Pricing</Link>
          {account ?? <NavLink to="/login">Client sign-in</NavLink>}
          <Link to="/book" className="btn btn-primary mk-nav-cta">
            Book a free consultation
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mk-footer">
      <div className="mk-footer-inner">
        <div className="mk-footer-brand">
          <span className="mk-brand">
            <span className="mk-brand-mark" aria-hidden="true" />
            Data Painters
          </span>
          <p>
            Enterprise AI advisory from engineers with twenty-five years in enterprise
            data and business intelligence.
          </p>
        </div>
        <div className="mk-footer-cols">
          <div>
            <h2>Services</h2>
            {SEGMENTS.map((s) => (
              <Link key={s.id} to={`/services#${s.anchor}`}>
                {s.name}
              </Link>
            ))}
          </div>
          <div>
            <h2>Company</h2>
            <Link to="/approach">Approach</Link>
            <Link to="/#pricing">Pricing</Link>
            <Link to="/book">Book a consultation</Link>
            <Link to="/login">Client sign-in</Link>
          </div>
        </div>
      </div>
      <div className="mk-footer-base">
        <span>&copy; {new Date().getFullYear()} Data Painters</span>
        <span>Hourly consulting, billed in 30-minute increments.</span>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------- shared bits */

function SegmentIcon({ id }: { id: Segment }) {
  const common = {
    viewBox: '0 0 32 32',
    width: 32,
    height: 32,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (id === 'corporate') {
    return (
      <svg {...common}>
        <rect x="5" y="6" width="22" height="20" rx="2" />
        <path d="M10 21v-5M16 21v-9M22 21v-12" />
      </svg>
    );
  }
  if (id === 'data') {
    return (
      <svg {...common}>
        <ellipse cx="16" cy="8" rx="9" ry="3.5" />
        <path d="M7 8v8c0 1.9 4 3.5 9 3.5s9-1.6 9-3.5V8M7 16v8c0 1.9 4 3.5 9 3.5s9-1.6 9-3.5v-8" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M11 10 5 16l6 6M21 10l6 6-6 6M18 7l-4 18" />
    </svg>
  );
}

function CtaButtons({ secondary }: { secondary?: ReactNode }) {
  return (
    <div className="mk-cta-row">
      <Link to="/book" className="btn btn-primary mk-btn-lg">
        Book a free 30-minute consultation
      </Link>
      {secondary}
    </div>
  );
}

function CtaBand({ title, text }: { title: string; text: string }) {
  return (
    <section className="mk-cta-band">
      <div className="mk-wrap mk-cta-band-inner">
        <div>
          <h2>{title}</h2>
          <p>{text}</p>
        </div>
        <Link to="/book" className="btn mk-btn-light mk-btn-lg">
          Book a free 30-minute consultation
        </Link>
      </div>
    </section>
  );
}

function RateLine({ info }: { info: PublicInfo | null }) {
  const rate = formatRate(info);
  return rate ? (
    <>
      <strong>{rate} per hour</strong>, billed in 30-minute increments.
    </>
  ) : (
    <>Billed hourly in 30-minute increments. Contact us for current rates.</>
  );
}

/* ------------------------------------------------------------------ home */

export function Home() {
  usePageTitle();
  useScrollToHash();
  const info = usePublicInfo();
  const rate = formatRate(info);

  return (
    <main className="mk">
      <section className="mk-hero">
        <div className="mk-wrap mk-hero-grid">
          <div>
            <p className="mk-eyebrow">AI advisory for enterprise teams</p>
            <h1>Enterprise AI, built by people who built enterprise BI.</h1>
            <p className="mk-lede">
              We advise leadership, data and engineering teams on getting AI into
              production &mdash; and keeping it there. Twenty-five years of making data
              trustworthy inside large organisations, applied to the tools that changed.
            </p>
            <CtaButtons
              secondary={
                <Link to="/services" className="btn mk-btn-lg">
                  Explore services
                </Link>
              }
            />
            <ul className="mk-hero-points">
              <li>Free 30-minute first call</li>
              <li>No retainer, no minimums</li>
              <li>Pay only for time used</li>
            </ul>
          </div>
          <figure className="mk-hero-figure">
            <SourcesToOutput />
            <figcaption>
              Sources rarely agree. Everything expensive happens before the model.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="mk-section" aria-labelledby="segments-h">
        <div className="mk-wrap">
          <div className="mk-section-head">
            <h2 id="segments-h">Three practices, one standard of delivery</h2>
            <p>
              Each practice is sold the same way: hourly consulting in 30-minute
              increments, starting with a free call to decide whether we can help.
            </p>
          </div>
          <div className="mk-segments">
            {SEGMENTS.map((s) => (
              <article key={s.id} className="mk-segment">
                <span className="mk-segment-icon">
                  <SegmentIcon id={s.id} />
                </span>
                <p className="mk-segment-audience">{s.audience}</p>
                <h3>{s.name}</h3>
                <p>{s.summary}</p>
                <div className="mk-segment-links">
                  <Link to={`/services#${s.anchor}`} className="mk-link">
                    Learn more <span aria-hidden="true">→</span>
                  </Link>
                  <Link to={`/book?segment=${s.id}`} className="mk-link">
                    Book a call <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section mk-alt" aria-labelledby="how-h">
        <div className="mk-wrap">
          <div className="mk-section-head">
            <h2 id="how-h">Start with a conversation, not a contract</h2>
          </div>
          <ol className="mk-steps">
            <li>
              <span className="mk-step-num">1</span>
              <h3>Book a free 30-minute call</h3>
              <p>
                Pick a time and list the topics you want covered. We read them before
                the call, so the half hour is spent on your problem.
              </p>
            </li>
            <li>
              <span className="mk-step-num">2</span>
              <h3>We scope it together</h3>
              <p>
                You leave the call with a view on what is worth doing, what it involves,
                and roughly how many hours it should take.
              </p>
            </li>
            <li>
              <span className="mk-step-num">3</span>
              <h3>Hourly work, 30-minute blocks</h3>
              <p>
                Book sessions as you need them. Time is tracked per meeting and billed
                in 30-minute increments &mdash; you pay only for time used.
              </p>
            </li>
          </ol>
        </div>
      </section>

      <section className="mk-section" aria-labelledby="why-h">
        <div className="mk-wrap mk-split">
          <div>
            <h2 id="why-h">Why the scaling problem is the familiar one</h2>
            <p>
              Most AI pilots work. Most AI programmes stall anyway, and they stall on
              things an enterprise data team has seen before: lineage nobody can trace,
              access controls that do not survive an audit, a pipeline that was never
              going to run twice, an output no owner will sign off on.
            </p>
            <p>
              We recognise those failures because we spent a career fixing the business
              intelligence versions of them &mdash; and we moved into AI the way we moved
              into everything else: by shipping it inside organisations where it had to
              integrate with what already existed, clear review, and keep working after
              we left.
            </p>
            <dl className="mk-stats">
              <div>
                <dt>Years in enterprise data</dt>
                <dd>25+</dd>
              </div>
              <div>
                <dt>Practices</dt>
                <dd>3</dd>
              </div>
              <div>
                <dt>First call</dt>
                <dd>Free</dd>
              </div>
            </dl>
          </div>
          <figure className="mk-figure">
            <PilotToProduction />
            <figcaption>
              A pilot is one workload that worked once. Production is the same workload,
              replicated, observed and on somebody&rsquo;s rota.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="mk-section mk-alt" id="pricing" aria-labelledby="pricing-h">
        <div className="mk-wrap">
          <div className="mk-section-head">
            <h2 id="pricing-h">Simple, transparent, hourly</h2>
            <p>One rate across all three practices. No retainers and no minimum commitment.</p>
          </div>
          <div className="mk-pricing">
            <div className="mk-price-card mk-price-free">
              <h3>First consultation</h3>
              <p className="mk-price">
                Free<span>30 minutes</span>
              </p>
              <ul>
                <li>Your topics, reviewed before the call</li>
                <li>An honest view on fit and next steps</li>
                <li>No obligation</li>
              </ul>
              <Link to="/book" className="btn btn-primary">
                Book your free call
              </Link>
            </div>
            <div className="mk-price-card">
              <h3>Advisory sessions</h3>
              <p className="mk-price">
                {rate ?? 'Hourly'}
                <span>{rate ? 'per hour' : 'contact us for rates'}</span>
              </p>
              <ul>
                <li>Billed in 30-minute increments</li>
                <li>Time tracked per meeting; you pay for time used</li>
                <li>Written meeting summary after every session</li>
                <li>Any of the three practices, mixed as you need</li>
              </ul>
              <Link to="/book" className="btn">
                Start with a free call
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mk-section" aria-labelledby="clients-h">
        <div className="mk-wrap">
          <div className="mk-section-head">
            <h2 id="clients-h">Where our team has worked</h2>
            <p>
              Data Painters is a small group of engineers. Between us, our work has been
              delivered for:
            </p>
          </div>
          <ul className="mk-logos">
            {CLIENTS.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="mk-fine">
            Engagements were delivered by members of our team, in some cases through
            previous employers. Named for experience, not as endorsements.
          </p>
        </div>
      </section>

      <section className="mk-section mk-alt" aria-labelledby="faq-h">
        <div className="mk-wrap mk-faq-wrap">
          <div className="mk-section-head">
            <h2 id="faq-h">Common questions</h2>
          </div>
          <Faq info={info} />
        </div>
      </section>

      <CtaBand
        title="Talk it through with someone who has done it before"
        text="Thirty minutes, no charge, no obligation. Bring the question that is blocking you."
      />
    </main>
  );
}

function Faq({ info }: { info: PublicInfo | null }) {
  const items: { q: string; a: ReactNode }[] = [
    {
      q: 'How does billing work?',
      a: (
        <>
          All work is hourly consulting: <RateLine info={info} /> Time is tracked
          during each meeting and rounded up to the next 30-minute block. You receive a
          meeting summary with the time recorded, and invoices list every session.
        </>
      ),
    },
    {
      q: 'What happens in the free consultation?',
      a: 'We review the topics you send when booking, then use the 30 minutes to understand the problem, share an initial view, and agree whether and how we can help. You will not be billed for it and there is no obligation to continue.',
    },
    {
      q: 'Who should attend?',
      a: 'Whoever owns the problem. For Corporate AI Development that is usually a senior sponsor; for AI Data Development, the business or data owner; for Development Team AI Enablement, an engineering lead. One or two people is ideal for the first call.',
    },
    {
      q: 'Is what we discuss confidential?',
      a: 'Yes. We treat everything shared in a consultation as confidential and are happy to sign your NDA before any detailed work begins.',
    },
    {
      q: 'Do you build, or only advise?',
      a: 'Our engagements are advisory: we work alongside your team or your vendor so that what ships can be operated by the people who own it after we step back.',
    },
  ];
  return (
    <div className="mk-faq">
      {items.map((i) => (
        <details key={i.q}>
          <summary>{i.q}</summary>
          <div className="mk-faq-a">{i.a}</div>
        </details>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- services */

export function Services() {
  usePageTitle('Services');
  useScrollToHash();
  const info = usePublicInfo();

  return (
    <main className="mk">
      <section className="mk-hero mk-hero-compact">
        <div className="mk-wrap">
          <p className="mk-eyebrow">Services</p>
          <h1>AI advisory across strategy, data and engineering</h1>
          <p className="mk-lede">
            Three practices for the three places AI programmes succeed or stall. Every
            engagement is hourly consulting, <RateLine info={info} />
          </p>
          <nav className="mk-jump" aria-label="Practices">
            {SEGMENTS.map((s) => (
              <a key={s.id} href={`#${s.anchor}`}>
                <SegmentIcon id={s.id} />
                {s.name}
              </a>
            ))}
          </nav>
        </div>
      </section>

      {SEGMENTS.map((s, i) => (
        <section
          key={s.id}
          id={s.anchor}
          className={i % 2 === 1 ? 'mk-section mk-alt mk-anchor' : 'mk-section mk-anchor'}
          aria-labelledby={`${s.anchor}-h`}
        >
          <div className="mk-wrap mk-service">
            <div className="mk-service-intro">
              <span className="mk-segment-icon">
                <SegmentIcon id={s.id} />
              </span>
              <p className="mk-segment-audience">{s.audience}</p>
              <h2 id={`${s.anchor}-h`}>{s.name}</h2>
              <p>{s.summary}</p>
              <Link to={`/book?segment=${s.id}`} className="btn btn-primary">
                Book a free consultation
              </Link>
            </div>
            <div className="mk-service-detail">
              <h3>What we cover</h3>
              <ul className="mk-checks">
                {s.covers.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <h3>What you leave with</h3>
              <ul className="mk-checks">
                {s.outcomes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ))}

      <CtaBand
        title="Not sure which practice fits?"
        text="Most problems touch more than one. Book a free call and we will point you in the right direction."
      />
    </main>
  );
}

/* -------------------------------------------------------------- approach */

export function Approach() {
  usePageTitle('Approach');
  useScrollToHash();
  return (
    <main className="mk">
      <section className="mk-hero mk-hero-compact">
        <div className="mk-wrap mk-hero-grid">
          <div>
            <p className="mk-eyebrow">Approach</p>
            <h1>We were doing most of this before it was called AI</h1>
            <p className="mk-lede">
              The principles came from enterprise data work &mdash; migrations that went
              well, and a few that did not.
            </p>
          </div>
          <figure className="mk-hero-figure">
            <Timeline />
            <figcaption>
              The same line, not a new one. Each era inherited the previous era&rsquo;s
              unsolved problems.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="mk-section" aria-labelledby="principles-h">
        <div className="mk-wrap">
          <div className="mk-section-head">
            <p className="mk-eyebrow">Principles</p>
            <h2 id="principles-h">How we work</h2>
          </div>
          <ol className="mk-principles">
            <li>
              <h3>Start where the data already is.</h3>
              <p>An integration that needs a data migration first is two projects wearing one budget.</p>
            </li>
            <li>
              <h3>Measure before and after, on the same metric.</h3>
              <p>
                If nobody wrote down the baseline, the project cannot succeed or fail
                &mdash; it can only end.
              </p>
            </li>
            <li>
              <h3>Design for the second year.</h3>
              <p>
                Anything can be made to work once by the people who built it. Enterprise
                scale is mostly a question of what happens on the day none of them are
                available.
              </p>
            </li>
            <li>
              <h3>Leave it operable.</h3>
              <p>
                The test of an engagement is what still works six months after the
                consultant stops answering the phone.
              </p>
            </li>
          </ol>
        </div>
      </section>

      <section className="mk-section mk-alt" aria-labelledby="years-h">
        <div className="mk-wrap mk-split">
          <div>
            <h2 id="years-h">What twenty-five years actually buys you</h2>
            <p>
              Pattern recognition, mostly. An enterprise AI programme fails in a small
              number of recognisable ways, and nearly all of them are data and
              organisational problems wearing new vocabulary. Having watched the business
              intelligence generation of the same mistakes, we tend to know which corner a
              project is about to turn before it turns it.
            </p>
            <h2>How engagements run</h2>
            <p>
              Hourly, in 30-minute blocks, booked as you need them. Each session has an
              agenda you set, notes we keep against every topic, and a written summary
              afterwards &mdash; so progress is visible and spend is never a surprise.
            </p>
          </div>
          <figure className="mk-figure">
            <PilotToProduction />
            <figcaption>From one workload that worked once to one that runs on a rota.</figcaption>
          </figure>
        </div>
      </section>

      <CtaBand
        title="See whether our approach fits your problem"
        text="A free 30-minute call is the quickest way to find out."
      />
    </main>
  );
}

/* --------------------------------------------------------------- booking */

const HORIZON_DAYS = 60;
const MAX_TOPICS = 5;

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Days from tomorrow to the horizon, in local time, with at least one open slot. */
function bookableDays(hours: BusinessHours, minutes: number): string[] {
  const out: string[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  for (let i = 1; i <= HORIZON_DAYS; i++) {
    const d = new Date(cursor);
    d.setDate(cursor.getDate() + i);
    if (openSlots(dayKey(d), minutes, hours).length > 0) out.push(dayKey(d));
  }
  return out;
}

function overlaps(start: Date, minutes: number, busy: BusyInterval[]): boolean {
  const s = start.getTime();
  const e = s + minutes * 60000;
  return busy.some((b) => new Date(b.startsAt).getTime() < e && new Date(b.endsAt).getTime() > s);
}

const fmtDayLong = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const tzName = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'your local time';
  }
};

const STEPS = ['Focus', 'Time', 'Your details', 'Review'] as const;

interface TopicDraft {
  title: string;
  detail: string;
}

export function BookConsultation() {
  usePageTitle('Book a free consultation');
  useScrollToHash();
  const info = usePublicInfo();
  const rate = formatRate(info);
  const [params] = useSearchParams();
  const initialSegment = SEGMENTS.some((s) => s.id === params.get('segment'))
    ? (params.get('segment') as Segment)
    : null;

  const [step, setStep] = useState(0);
  const [segment, setSegment] = useState<Segment | null>(initialSegment);
  const [topics, setTopics] = useState<TopicDraft[]>([{ title: '', detail: '' }]);
  const hours = info?.businessHours ?? DEFAULT_HOURS;
  const days = useMemo(() => bookableDays(hours, info?.consultationMinutes ?? 30), [hours, info]);
  const [page, setPage] = useState(0);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyInterval[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');

  const [stepError, setStepError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [booked, setBooked] = useState<ConsultationBooked | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const duration = info?.consultationMinutes ?? 30;
  const perPage = 10;
  const visibleDays = days.slice(page * perPage, page * perPage + perPage);

  useEffect(() => {
    if (!day) return;
    const start = parseDay(day);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    let live = true;
    setLoadingSlots(true);
    setSlotError(null);
    getAvailability(start.toISOString(), end.toISOString())
      .then((r) => live && setBusy(r.taken ?? []))
      .catch((e: Error) => {
        if (!live) return;
        setBusy([]);
        setSlotError(e.message);
      })
      .finally(() => live && setLoadingSlots(false));
    return () => {
      live = false;
    };
  }, [day]);

  function goto(next: number) {
    setStepError(null);
    setStep(next);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function validate(s: number): string | null {
    if (s === 0) {
      if (!segment) return 'Choose the area you would like to discuss.';
      const filled = topics.filter((t) => t.title.trim());
      if (filled.length === 0) return 'Add at least one topic for the call.';
      if (topics.some((t) => !t.title.trim() && t.detail.trim()))
        return 'Each topic needs a short title.';
      if (topics.some((t) => t.title.length > 200)) return 'Keep topic titles under 200 characters.';
    }
    if (s === 1 && !slot) return 'Pick a date and a start time.';
    if (s === 2) {
      if (!name.trim() || !email.trim() || !company.trim())
        return 'Name, work email and company are required.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
    }
    return null;
  }

  function next(e?: FormEvent) {
    e?.preventDefault();
    const err = validate(step);
    if (err) {
      setStepError(err);
      return;
    }
    goto(step + 1);
  }

  async function submit() {
    for (let s = 0; s < 3; s++) {
      const err = validate(s);
      if (err) {
        goto(s);
        setStepError(err);
        return;
      }
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await bookConsultation({
        name: name.trim(),
        email: email.trim(),
        company: company.trim(),
        phone: phone.trim() || undefined,
        role: role.trim() || undefined,
        segment: segment!,
        startsAt: slot!,
        topics: topics
          .filter((t) => t.title.trim())
          .map((t) => ({ title: t.title.trim(), detail: t.detail.trim() || undefined })),
        message: message.trim() || undefined,
        website,
      });
      setBooked(result);
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      const err = e as PublicApiError;
      setSubmitError(err.message);
      if (err.status === 409) {
        // The slot went; send them back to pick another and refresh the day.
        setSlot(null);
        const d = day;
        setDay(null);
        setTimeout(() => setDay(d), 0);
        goto(1);
        setStepError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const segInfo = SEGMENTS.find((s) => s.id === segment);
  const slotDate = slot ? new Date(slot) : null;
  const priceNote = (
    <>
      Free &mdash; no obligation. Follow-on work is billed
      {rate ? ` at ${rate}/hour` : ' hourly'} in 30-minute increments.
    </>
  );

  if (booked) {
    const s = new Date(booked.startsAt);
    return (
      <main className="mk mk-book" ref={topRef as never}>
        <div className="mk-wrap mk-book-wrap">
          <section className="mk-confirm" aria-live="polite">
            <span className="mk-confirm-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="m5 12 5 5 9-10" />
              </svg>
            </span>
            <h1>Your consultation is requested</h1>
            <p className="mk-lede">
              {fmtDayLong(s)} at {fmtTime(s)} ({tzName()}), {booked.durationMinutes} minutes.
            </p>
            <dl className="mk-confirm-meta">
              <div>
                <dt>Reference</dt>
                <dd>{booked.reference}</dd>
              </div>
              <div>
                <dt>Area</dt>
                <dd>{segInfo?.name}</dd>
              </div>
              <div>
                <dt>Confirmation sent to</dt>
                <dd>{email}</dd>
              </div>
            </dl>
            <p>We&rsquo;ll confirm by email. If the time no longer suits, reply to that email and we will move it.</p>
            <h2>To get the most from the call</h2>
            <ul className="mk-checks">
              <li>Have the one or two people who own the problem attend.</li>
              <li>Bring any numbers that describe it today &mdash; volumes, costs, cycle times.</li>
              <li>Note what a good outcome would look like six months from now.</li>
            </ul>
            <div className="mk-cta-row">
              <Link to="/" className="btn">
                Back to home
              </Link>
              <Link to="/services" className="btn">
                Read about our services
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="mk mk-book">
      <div className="mk-wrap mk-book-wrap" ref={topRef}>
        <header className="mk-book-head">
          <p className="mk-eyebrow">Free consultation</p>
          <h1>Book a free 30-minute consultation</h1>
          <p className="mk-lede">
            Tell us what you want to cover and pick a time. We review your topics before
            the call so the half hour is spent on your problem.
          </p>
        </header>

        <ol className="mk-stepper" aria-label="Booking steps">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={i === step ? 'current' : i < step ? 'done' : undefined}
              aria-current={i === step ? 'step' : undefined}
            >
              <button
                type="button"
                className="mk-step-btn"
                disabled={i > step}
                onClick={() => i < step && goto(i)}
              >
                <span className="mk-step-dot">{i < step ? '✓' : i + 1}</span>
                <span className="mk-step-label">{label}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="mk-book-grid">
          <form className="mk-book-card" onSubmit={step < 3 ? next : (e) => { e.preventDefault(); submit(); }} noValidate>
            {stepError && (
              <div className="error" role="alert">
                <span>{stepError}</span>
              </div>
            )}

            {step === 0 && (
              <>
                <fieldset className="mk-fieldset">
                  <legend>What would you like to discuss?</legend>
                  <div className="mk-choice-grid">
                    {SEGMENTS.map((s) => (
                      <label key={s.id} className={segment === s.id ? 'mk-choice on' : 'mk-choice'}>
                        <input
                          type="radio"
                          name="segment"
                          value={s.id}
                          checked={segment === s.id}
                          onChange={() => setSegment(s.id)}
                        />
                        <span className="mk-segment-icon">
                          <SegmentIcon id={s.id} />
                        </span>
                        <strong>{s.name}</strong>
                        <small>{s.audience}</small>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="mk-fieldset">
                  <legend>Topics for the call</legend>
                  <p className="mk-help">
                    Up to {MAX_TOPICS}. A clear title is enough; add detail if it helps us prepare.
                  </p>
                  {topics.map((t, i) => (
                    <div className="mk-topic" key={i}>
                      <div className="mk-topic-head">
                        <span className="mk-topic-num">{i + 1}</span>
                        <label className="mk-field mk-grow">
                          <span className="sr-only">Topic {i + 1} title</span>
                          <input
                            value={t.title}
                            maxLength={200}
                            placeholder={
                              i === 0
                                ? 'e.g. Where should we start with AI across the business?'
                                : 'Another topic'
                            }
                            onChange={(e) =>
                              setTopics((prev) =>
                                prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                              )
                            }
                          />
                        </label>
                        {topics.length > 1 && (
                          <button
                            type="button"
                            className="mk-icon-btn"
                            aria-label={`Remove topic ${i + 1}`}
                            onClick={() => setTopics((prev) => prev.filter((_, j) => j !== i))}
                          >
                            &times;
                          </button>
                        )}
                      </div>
                      <label className="mk-field">
                        <span className="sr-only">Topic {i + 1} detail</span>
                        <textarea
                          rows={2}
                          maxLength={2000}
                          value={t.detail}
                          placeholder="Optional: background, what you have tried, what a good answer looks like"
                          onChange={(e) =>
                            setTopics((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)),
                            )
                          }
                        />
                      </label>
                    </div>
                  ))}
                  {topics.length < MAX_TOPICS && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setTopics((prev) => [...prev, { title: '', detail: '' }])}
                    >
                      + Add another topic
                    </button>
                  )}
                </fieldset>
              </>
            )}

            {step === 1 && (
              <>
                <fieldset className="mk-fieldset">
                  <legend>Choose a day</legend>
                  <div className="mk-days-nav">
                    <button
                      type="button"
                      className="btn"
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                      aria-label="Earlier dates"
                    >
                      ‹
                    </button>
                    <span className="mk-help">
                      {visibleDays.length > 0 &&
                        `${parseDay(visibleDays[0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${parseDay(visibleDays[visibleDays.length - 1]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
                    </span>
                    <button
                      type="button"
                      className="btn"
                      disabled={(page + 1) * perPage >= days.length}
                      onClick={() => setPage((p) => p + 1)}
                      aria-label="Later dates"
                    >
                      ›
                    </button>
                  </div>
                  <div className="mk-days">
                    {visibleDays.map((k) => {
                      const d = parseDay(k);
                      return (
                        <button
                          type="button"
                          key={k}
                          className={k === day ? 'mk-day on' : 'mk-day'}
                          aria-pressed={k === day}
                          onClick={() => {
                            setDay(k);
                            setSlot(null);
                          }}
                        >
                          <small>{d.toLocaleDateString(undefined, { weekday: 'short' })}</small>
                          <b>{d.getDate()}</b>
                          <small>{d.toLocaleDateString(undefined, { month: 'short' })}</small>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset className="mk-fieldset">
                  <legend>Choose a start time</legend>
                  <p className="mk-help">
                    Times shown in {tzName()}. Our hours: {describeHours(hours)} ({hours.timezone}).
                  </p>
                  {!day ? (
                    <p className="mk-empty">Pick a day to see open times.</p>
                  ) : loadingSlots ? (
                    <p className="mk-empty">Checking availability…</p>
                  ) : (
                    <>
                      {slotError && (
                        <p className="hint hint-warn">
                          {slotError} Times below may already be taken.
                        </p>
                      )}
                      <div className="mk-slots">
                        {openSlots(day, duration, hours).map((d) => {
                          const iso = d.toISOString();
                          const taken = d.getTime() <= Date.now() || overlaps(d, duration, busy);
                          return (
                            <button
                              type="button"
                              key={iso}
                              className={slot === iso ? 'mk-slot on' : 'mk-slot'}
                              disabled={taken}
                              aria-pressed={slot === iso}
                              onClick={() => setSlot(iso)}
                            >
                              {fmtTime(d)}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </fieldset>
              </>
            )}

            {step === 2 && (
              <fieldset className="mk-fieldset">
                <legend>Your details</legend>
                <div className="mk-form-grid">
                  <label className="mk-field">
                    <span>Full name *</span>
                    <input value={name} autoComplete="name" required onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label className="mk-field">
                    <span>Work email *</span>
                    <input
                      type="email"
                      value={email}
                      autoComplete="email"
                      required
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <label className="mk-field">
                    <span>Company *</span>
                    <input
                      value={company}
                      autoComplete="organization"
                      required
                      onChange={(e) => setCompany(e.target.value)}
                    />
                  </label>
                  <label className="mk-field">
                    <span>Job title</span>
                    <input value={role} autoComplete="organization-title" onChange={(e) => setRole(e.target.value)} />
                  </label>
                  <label className="mk-field">
                    <span>Phone</span>
                    <input type="tel" value={phone} autoComplete="tel" onChange={(e) => setPhone(e.target.value)} />
                  </label>
                  <label className="mk-field mk-span2">
                    <span>Anything else we should know?</span>
                    <textarea rows={3} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
                  </label>
                  {/* Honeypot: invisible to people, irresistible to form bots. */}
                  <label className="mk-hp" aria-hidden="true">
                    Website
                    <input
                      tabIndex={-1}
                      autoComplete="off"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                    />
                  </label>
                </div>
              </fieldset>
            )}

            {step === 3 && (
              <section className="mk-review">
                <h2>Review your request</h2>
                <dl>
                  <div>
                    <dt>Area</dt>
                    <dd>{segInfo?.name}</dd>
                  </div>
                  <div>
                    <dt>When</dt>
                    <dd>
                      {slotDate && `${fmtDayLong(slotDate)}, ${fmtTime(slotDate)}`} ({duration} min,{' '}
                      {tzName()})
                    </dd>
                  </div>
                  <div>
                    <dt>Topics</dt>
                    <dd>
                      <ol>
                        {topics
                          .filter((t) => t.title.trim())
                          .map((t, i) => (
                            <li key={i}>
                              <strong>{t.title}</strong>
                              {t.detail.trim() && <p>{t.detail}</p>}
                            </li>
                          ))}
                      </ol>
                    </dd>
                  </div>
                  <div>
                    <dt>Contact</dt>
                    <dd>
                      {name} &middot; {email}
                      <br />
                      {[role, company].filter(Boolean).join(', ')}
                      {phone && ` · ${phone}`}
                    </dd>
                  </div>
                  {message.trim() && (
                    <div>
                      <dt>Note</dt>
                      <dd>{message}</dd>
                    </div>
                  )}
                </dl>
                {submitError && (
                  <div className="error" role="alert">
                    <span>{submitError}</span>
                  </div>
                )}
              </section>
            )}

            <div className="mk-book-actions">
              {step > 0 ? (
                <button type="button" className="btn" onClick={() => goto(step - 1)}>
                  Back
                </button>
              ) : (
                <span />
              )}
              {step < 3 ? (
                <button type="submit" className="btn btn-primary">
                  Continue
                </button>
              ) : (
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Booking…' : 'Request my free consultation'}
                </button>
              )}
            </div>
          </form>

          <aside className="mk-book-aside" aria-label="Summary">
            <h2>Your consultation</h2>
            <ul className="mk-summary">
              <li>
                <span>Length</span>
                <b>{duration} minutes</b>
              </li>
              <li>
                <span>Price</span>
                <b>Free</b>
              </li>
              <li>
                <span>Area</span>
                <b>{segInfo?.name ?? '—'}</b>
              </li>
              <li>
                <span>When</span>
                <b>
                  {slotDate
                    ? `${slotDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(slotDate)}`
                    : '—'}
                </b>
              </li>
            </ul>
            <p className="mk-aside-note">{priceNote}</p>
            <p className="mk-aside-note">Everything you share is treated as confidential.</p>
          </aside>
        </div>
      </div>
    </main>
  );
}
