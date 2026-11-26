/**
 * The console's landing page.
 *
 * It is laid out as three questions, in the order someone signing in needs
 * them answered: what is waiting on us, how does the work stand, and where
 * is everything else. The first row is deliberately the short one -- only
 * figures that mean somebody is waiting or money is late -- so that a row of
 * zeros reads as "nothing needs you", not as an empty dashboard.
 */

import { useEffect, useState } from 'react';
import {
  getAdminOverview,
  listAdminAppointments,
  type AdminAppointment,
  type AdminOverview,
} from './api';
import { money } from './billing-api';
import { formatLength, formatRange, plural } from './scheduling';

/** The screens this page links to; a subset of the console's views. */
type Target =
  | 'messages'
  | 'appointments'
  | 'engagements'
  | 'clients'
  | 'calendar'
  | 'media'
  | 'team'
  | 'logins'
  | 'ar'
  | 'unbilled'
  | 'revenue'
  | 'invoices'
  | 'costs'
  | 'options';

interface Figure {
  label: string;
  value: string;
  hint: string;
  view: Target;
  tone?: 'warn' | 'bad';
}

function hours(minutes: number): string {
  if (minutes === 0) return '0 h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function shortDay(iso: string): string {
  const value = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00` : iso;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Figures({ items, onGo }: { items: Figure[]; onGo: (v: Target) => void }) {
  return (
    <div className="kpis">
      {items.map((k) => (
        <button key={k.label} className={k.tone ? `kpi kpi-${k.tone}` : 'kpi'} onClick={() => onGo(k.view)}>
          <span className="kpi-label">{k.label}</span>
          <span className="kpi-value">{k.value}</span>
          <span className="kpi-hint">{k.hint}</span>
        </button>
      ))}
    </div>
  );
}

export function AdminOverviewPage({
  refreshKey,
  onError,
  onGo,
  onOpenMeeting,
  onOpenEngagement,
  onOpenThread,
}: {
  refreshKey: number;
  onError: (e: unknown) => void;
  onGo: (v: Target) => void;
  onOpenMeeting: (id: number) => void;
  onOpenEngagement: (id: number) => void;
  onOpenThread: (topicId: number) => void;
}) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [pending, setPending] = useState<AdminAppointment[]>([]);
  const [upcoming, setUpcoming] = useState<AdminAppointment[]>([]);

  useEffect(() => {
    const now = encodeURIComponent(new Date().toISOString());
    Promise.all([
      getAdminOverview(),
      listAdminAppointments(`filter=status:eq:requested&filter=startsAt:gte:${now}&sort=startsAt:asc&size=5`),
      listAdminAppointments(`filter=status:eq:confirmed&filter=startsAt:gte:${now}&sort=startsAt:asc&size=5`),
    ])
      .then(([overview, toConfirm, ahead]) => {
        setData(overview);
        setPending(toConfirm.rows);
        setUpcoming(ahead.rows);
      })
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

  const { work, people, money: m } = data;

  const attention: Figure[] = [
    {
      label: 'Awaiting reply',
      value: String(data.awaitingReply),
      hint: data.awaitingReply ? 'Conversations where the client spoke last' : 'Every conversation is answered',
      view: 'messages',
      tone: data.awaitingReply ? 'warn' : undefined,
    },
    {
      label: 'Meetings to confirm',
      value: String(work.meetingsToConfirm),
      hint: work.meetingsToConfirm ? 'Requested by clients' : 'No requests waiting',
      view: 'appointments',
      tone: work.meetingsToConfirm ? 'warn' : undefined,
    },
    {
      label: 'Past target date',
      value: String(data.pastDue),
      hint: data.pastDue ? 'Open engagements overdue' : 'No engagement is overdue',
      view: 'engagements',
      tone: data.pastDue ? 'bad' : undefined,
    },
    ...(m
      ? [
          {
            label: 'Overdue receivables',
            value: money(m.overdueCents),
            hint: `of ${money(m.receivableCents)} outstanding`,
            view: 'ar' as const,
            tone: m.overdueCents > 0 ? ('bad' as const) : undefined,
          },
          {
            label: 'Unbilled work',
            value: money(m.unbilledCents),
            hint:
              m.unchargedReplyMinutes > 0
                ? `plus ${hours(m.unchargedReplyMinutes)} of replies not yet charged`
                : m.unbilledCents > 0
                  ? 'Ready to invoice'
                  : 'Everything is invoiced',
            view: 'unbilled' as const,
            tone: m.unbilledCents > 0 || m.unchargedReplyMinutes > 0 ? ('warn' as const) : undefined,
          },
        ]
      : []),
  ];

  const standing: Figure[] = [
    {
      label: 'Active engagements',
      value: String(work.activeEngagements),
      hint: work.inquiries ? `${plural(work.inquiries, 'new inquiry').replace('inquirys', 'inquiries')} to follow up` : 'No new inquiries',
      view: 'engagements',
    },
    {
      label: 'Meetings, next 7 days',
      value: String(work.meetingsNext7Days),
      hint: work.meetingsToday ? `${work.meetingsToday} today` : 'None today',
      view: 'calendar',
    },
    {
      label: 'Open topics',
      value: String(work.openTopics),
      hint: 'Across open engagements',
      view: 'messages',
    },
    {
      label: 'Time this month',
      value: hours(work.minutesThisMonth + work.replyMinutesThisMonth),
      hint: `${hours(work.minutesThisMonth)} in meetings, ${hours(work.replyMinutesThisMonth)} on replies`,
      view: m ? 'revenue' : 'appointments',
    },
    ...(m
      ? [
          {
            label: 'Billed this month',
            value: money(m.billedThisMonthCents),
            hint: `${money(m.collectedThisMonthCents)} collected`,
            view: 'revenue' as const,
          },
        ]
      : []),
  ];

  const meetings = (rows: AdminAppointment[], empty: string) =>
    rows.length === 0 ? (
      <p className="panel-empty">{empty}</p>
    ) : (
      <ul className="meeting-list">
        {rows.map((a) => (
          <li key={a.id}>
            <button onClick={() => onOpenMeeting(a.id)}>
              <span className="ml-date">
                <b>{new Date(a.startsAt).toLocaleDateString(undefined, { day: 'numeric' })}</b>
                <small>{new Date(a.startsAt).toLocaleDateString(undefined, { month: 'short' })}</small>
              </span>
              <span className="ml-main">
                <strong>{a.title ?? a.clientName}</strong>
                <span className="muted">
                  {a.title ? `${a.clientName} · ` : ''}
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
      {m && m.hourlyRateCents === 0 && (
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

      <section className="overview-section" aria-labelledby="ov-attention">
        <h2 id="ov-attention">Needs attention</h2>
        <Figures items={attention} onGo={onGo} />
      </section>

      <section className="overview-section" aria-labelledby="ov-standing">
        <h2 id="ov-standing">How the work stands</h2>
        <Figures items={standing} onGo={onGo} />
      </section>

      <div className="panels dash-panels">
        <section className="panel-card">
          <header>
            <h2>Conversations awaiting reply</h2>
            <button className="linklike" onClick={() => onGo('messages')}>
              All topics →
            </button>
          </header>
          {data.waiting.length === 0 ? (
            <p className="panel-empty">Nobody is waiting on an answer.</p>
          ) : (
            <ul className="dash-list">
              {data.waiting.map((w) => (
                <li key={w.topicId}>
                  <button onClick={() => onOpenThread(w.topicId)}>
                    <span className="dash-main">
                      <strong>{w.title}</strong>
                      <span className="muted dash-snippet">
                        {w.clientName} · {w.lastSnippet ? `${w.lastAuthor ?? 'Client'}: ${w.lastSnippet}` : 'New topic, no reply yet'}
                      </span>
                    </span>
                    <span className="dash-side muted">{shortDay(w.since)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel-card">
          <header>
            <h2>Meetings to confirm</h2>
            <button className="linklike" onClick={() => onGo('appointments')}>
              All meetings →
            </button>
          </header>
          {meetings(pending, 'No meeting requests waiting.')}
        </section>

        <section className="panel-card">
          <header>
            <h2>Coming up</h2>
            <button className="linklike" onClick={() => onGo('calendar')}>
              Calendar →
            </button>
          </header>
          {meetings(upcoming, 'No confirmed meetings ahead.')}
        </section>

        <section className="panel-card">
          <header>
            <h2>Target dates</h2>
            <button className="linklike" onClick={() => onGo('engagements')}>
              All engagements →
            </button>
          </header>
          {data.due.length === 0 ? (
            <p className="panel-empty">No engagement is due in the next two weeks.</p>
          ) : (
            <ul className="dash-list">
              {data.due.map((d) => (
                <li key={d.id}>
                  <button onClick={() => onOpenEngagement(d.id)}>
                    <span className="dash-main">
                      <strong>{d.title}</strong>
                      <span className="muted dash-snippet">
                        {d.clientName} · target {shortDay(d.dueOn)}
                      </span>
                    </span>
                    <span className="dash-side">
                      {d.daysLeft < 0 ? (
                        <span className="pill pill-bad">{plural(-d.daysLeft, 'day')} past</span>
                      ) : d.daysLeft === 0 ? (
                        <span className="pill pill-warn">Due today</span>
                      ) : (
                        <span className="pill pill-warn">{plural(d.daysLeft, 'day')} left</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="overview-section" aria-labelledby="ov-system">
        <h2 id="ov-system">Across the system</h2>
        {/* Six tiles sit three across; the four a non-billing role sees sit two across. */}
        <div className="system-tiles" style={{ ['--cols' as string]: m ? 3 : 2 }}>
          <button onClick={() => onGo('clients')}>
            <strong>{plural(work.clients, 'client')}</strong>
            <span>
              {plural(people.clientUsers, 'portal user')}
              {people.clientInvitesPending ? `, ${people.clientInvitesPending} not yet signed in` : ''}
            </span>
          </button>
          <button onClick={() => onGo('team')}>
            <strong>{plural(people.team, 'team member')}</strong>
            <span>{people.teamInvitesPending ? `${plural(people.teamInvitesPending, 'invitation')} pending` : 'Everyone has signed in'}</span>
          </button>
          <button onClick={() => onGo('media')}>
            <strong>{plural(data.mediaItems, 'media item')}</strong>
            <span>Templates, videos and images to share</span>
          </button>
          <button onClick={() => onGo('calendar')}>
            <strong>Calendar</strong>
            <span>{work.meetingsToday ? `${plural(work.meetingsToday, 'meeting')} today` : 'Nothing booked today'}</span>
          </button>
          {m && (
            <button onClick={() => onGo('invoices')}>
              <strong>Invoices</strong>
              <span>{money(m.receivableCents)} outstanding</span>
            </button>
          )}
          {m && (
            <button onClick={() => onGo('costs')}>
              <strong>Reports</strong>
              <span>Receivables, revenue, unbilled work, costs</span>
            </button>
          )}
        </div>
      </section>
    </>
  );
}
