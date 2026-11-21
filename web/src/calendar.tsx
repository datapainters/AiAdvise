/**
 * The admin calendar: every client meeting in a month or week view.
 *
 * Shown in the viewer's local time. Business hours (from System options)
 * shade the week view, converted from the business's time zone.
 */
import { useEffect, useMemo, useState } from 'react';
import { listCalendar, type AdminAppointment } from './api';
import { DEFAULT_HOURS, loadBusinessHours, openSlots, describeHours, type BusinessHours } from './hours';
import { formatLength, statusLabel } from './scheduling';
import { VideoIcon } from './video';

type Mode = 'month' | 'week';

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Monday of the week containing d. */
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const time = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function CalendarView({
  onOpenMeeting,
  onError,
  refreshKey,
}: {
  onOpenMeeting: (id: number) => void;
  onError: (e: unknown) => void;
  refreshKey: number;
}) {
  const [mode, setMode] = useState<Mode>(() => (window.innerWidth < 700 ? 'week' : 'month'));
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [rows, setRows] = useState<AdminAppointment[] | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [hours, setHours] = useState<BusinessHours>(DEFAULT_HOURS);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    loadBusinessHours().then(setHours);
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // The visible range: whole weeks covering the month, or one week.
  const { from, to, days } = useMemo(() => {
    if (mode === 'week') {
      const f = startOfWeek(anchor);
      return { from: f, to: addDays(f, 7), days: Array.from({ length: 7 }, (_, i) => addDays(f, i)) };
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const f = startOfWeek(first);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const t = addDays(startOfWeek(last), 7);
    const n = Math.round((t.getTime() - f.getTime()) / DAY_MS);
    return { from: f, to: t, days: Array.from({ length: n }, (_, i) => addDays(f, i)) };
  }, [mode, anchor]);

  useEffect(() => {
    setRows(null);
    listCalendar(from, to).then(setRows).catch(onError);
  }, [from, to, refreshKey, onError]);

  const visible = (rows ?? []).filter((a) => showCancelled || a.status !== 'cancelled');
  const byDay = useMemo(() => {
    const m = new Map<string, AdminAppointment[]>();
    visible.forEach((a) => {
      const k = isoDay(new Date(a.startsAt));
      m.set(k, [...(m.get(k) ?? []), a]);
    });
    return m;
  }, [visible]);

  function move(dir: -1 | 1) {
    setAnchor((a) =>
      mode === 'week' ? addDays(a, 7 * dir) : new Date(a.getFullYear(), a.getMonth() + dir, 1),
    );
  }

  const title =
    mode === 'month'
      ? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : `${from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(from, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;

  const counts = {
    requested: visible.filter((a) => a.status === 'requested').length,
    confirmed: visible.filter((a) => a.status === 'confirmed').length,
    completed: visible.filter((a) => a.status === 'completed').length,
  };

  return (
    <section className="cal">
      <div className="cal-bar">
        <div className="cal-nav">
          <button className="btn" onClick={() => setAnchor(startOfDay(new Date()))}>
            Today
          </button>
          <button className="btn cal-arrow" aria-label="Previous" onClick={() => move(-1)}>
            ‹
          </button>
          <button className="btn cal-arrow" aria-label="Next" onClick={() => move(1)}>
            ›
          </button>
          <h2 className="cal-title">{title}</h2>
        </div>
        <div className="cal-tools">
          <label className="checkbox">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
            Show cancelled
          </label>
          <div className="segmented" role="radiogroup" aria-label="View">
            {(['month', 'week'] as Mode[]).map((m) => (
              <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : undefined} onClick={() => setMode(m)}>
                {m === 'month' ? 'Month' : 'Week'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="cal-legend">
        <span><i className="dot ev-requested" /> Awaiting confirmation · {counts.requested}</span>
        <span><i className="dot ev-confirmed" /> Confirmed · {counts.confirmed}</span>
        <span><i className="dot ev-completed" /> Completed · {counts.completed}</span>
        <span className="muted">Business hours: {describeHours(hours)} ({hours.timezone})</span>
      </div>

      {rows === null && <div className="cal-loading">Loading…</div>}

      {mode === 'month' ? (
        <div className="cal-month" role="grid" aria-label={title}>
          {WEEKDAYS.map((d) => (
            <div key={d} className="cal-dow" role="columnheader">
              {d}
            </div>
          ))}
          {days.map((d) => {
            const k = isoDay(d);
            const list = (byDay.get(k) ?? []).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
            const other = d.getMonth() !== anchor.getMonth();
            const today = k === isoDay(now);
            const closed = openSlots(k, 30, hours).length === 0;
            return (
              <div
                key={k}
                role="gridcell"
                className={['cal-cell', other ? 'other' : '', today ? 'today' : '', closed ? 'closed' : ''].filter(Boolean).join(' ')}
              >
                <button
                  className="cal-daynum"
                  onClick={() => {
                    setAnchor(d);
                    setMode('week');
                  }}
                  aria-label={`Week of ${d.toDateString()}`}
                >
                  {d.getDate()}
                </button>
                {list.slice(0, 3).map((a) => (
                  <button
                    key={a.id}
                    className={`cal-chip ev-${a.status}`}
                    onClick={() => onOpenMeeting(a.id)}
                    title={`${a.clientName} · ${a.engagementTitle} · ${statusLabel(a.status)}`}
                  >
                    <span className="cal-chip-time">{time(new Date(a.startsAt))}</span>
                    <span className="cal-chip-name">{a.clientName}</span>
                    {a.video && <VideoIcon />}
                  </button>
                ))}
                {list.length > 3 && (
                  <button
                    className="cal-more"
                    onClick={() => {
                      setAnchor(d);
                      setMode('week');
                    }}
                  >
                    +{list.length - 3} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <WeekGrid days={days} byDay={byDay} hours={hours} now={now} onOpenMeeting={onOpenMeeting} />
      )}
    </section>
  );
}

const HOUR_PX = 48;

function WeekGrid({
  days,
  byDay,
  hours,
  now,
  onOpenMeeting,
}: {
  days: Date[];
  byDay: Map<string, AdminAppointment[]>;
  hours: BusinessHours;
  now: Date;
  onOpenMeeting: (id: number) => void;
}) {
  // Rows from an hour before the earliest opening (or 7 AM) to an hour
  // after the latest close or meeting (or 7 PM), in local time.
  const open = days.map((d) => openSlots(isoDay(d), 30, hours));
  const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
  let first = 7 * 60;
  let last = 19 * 60;
  open.flat().forEach((s) => {
    first = Math.min(first, minutesOf(s));
    last = Math.max(last, minutesOf(s) + 30);
  });
  days.forEach((d) =>
    (byDay.get(isoDay(d)) ?? []).forEach((a) => {
      const s = new Date(a.startsAt);
      first = Math.min(first, minutesOf(s));
      last = Math.max(last, minutesOf(s) + a.durationMinutes);
    }),
  );
  first = Math.max(0, Math.floor(first / 60) * 60 - 60);
  last = Math.min(24 * 60, Math.ceil(last / 60) * 60 + 60);
  const span = last - first;
  const px = (m: number) => ((m - first) / 60) * HOUR_PX;
  const hourMarks = Array.from({ length: span / 60 }, (_, i) => first + i * 60);

  return (
    <div className="cal-week">
      <div className="cal-week-head">
        <div />
        {days.map((d) => (
          <div key={isoDay(d)} className={isoDay(d) === isoDay(now) ? 'today' : undefined}>
            <span>{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
            <b>{d.getDate()}</b>
          </div>
        ))}
      </div>
      <div className="cal-week-body" style={{ height: (span / 60) * HOUR_PX }}>
        <div className="cal-hours">
          {hourMarks.map((m) => (
            <span key={m} style={{ top: px(m) }}>
              {new Date(2000, 0, 1, m / 60).toLocaleTimeString([], { hour: 'numeric' })}
            </span>
          ))}
        </div>
        {days.map((d, i) => {
          const k = isoDay(d);
          const list = (byDay.get(k) ?? []).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          return (
            <div key={k} className="cal-col">
              {hourMarks.map((m) => (
                <div key={m} className="cal-line" style={{ top: px(m) }} />
              ))}
              {open[i].map((s) => (
                <div key={s.toISOString()} className="cal-open" style={{ top: px(minutesOf(s)), height: HOUR_PX / 2 }} />
              ))}
              {k === isoDay(now) && minutesOf(now) >= first && minutesOf(now) <= last && (
                <div className="cal-now" style={{ top: px(minutesOf(now)) }} />
              )}
              {list.map((a, j) => {
                const s = new Date(a.startsAt);
                // Overlapping meetings share the column side by side.
                const overlapping = list.filter(
                  (b) => new Date(b.startsAt) < new Date(a.endsAt) && new Date(b.endsAt) > s,
                );
                const lane = overlapping.indexOf(a);
                const lanes = overlapping.length;
                return (
                  <button
                    key={a.id}
                    className={`cal-event ev-${a.status}`}
                    style={{
                      top: px(minutesOf(s)),
                      height: Math.max(22, (a.durationMinutes / 60) * HOUR_PX - 2),
                      left: `${(lane / lanes) * 100}%`,
                      width: `${100 / lanes}%`,
                      zIndex: 2 + j,
                    }}
                    onClick={() => onOpenMeeting(a.id)}
                    title={`${a.clientName} · ${a.engagementTitle}`}
                  >
                    {a.durationMinutes <= 30 ? (
                      // Too short for three lines: time and client side by side.
                      <span className="cal-event-one">
                        <b>{time(s)}</b> {a.clientName} {a.video && <VideoIcon />}
                      </span>
                    ) : (
                      <>
                        <b>
                          {time(s)} {a.video && <VideoIcon />}
                        </b>
                        <span>{a.clientName}</span>
                        <small>
                          {a.engagementTitle} · {formatLength(a.durationMinutes)}
                        </small>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
