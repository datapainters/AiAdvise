/**
 * Editor for the hours-of-operation option: one row per weekday, an open
 * switch and opening/closing times in half-hour steps, plus the time zone
 * the hours are kept in. Shows the result in plain words and whether the
 * business is open right now.
 */
import { useEffect, useState } from 'react';
import {
  DAY_KEYS,
  DAY_LABELS,
  DEFAULT_HOURS,
  describeHours,
  timezoneLabel,
  withinHours,
  type BusinessHours,
} from './hours';

const TIMES: string[] = Array.from({ length: 48 }, (_, i) =>
  `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
);

const ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Australia/Sydney',
  'UTC',
];

function label(t: string) {
  const [h, m] = t.split(':').map(Number);
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function parseHours(value: string): BusinessHours {
  try {
    const v = JSON.parse(value) as BusinessHours;
    return v && v.days ? v : DEFAULT_HOURS;
  } catch {
    return DEFAULT_HOURS;
  }
}

/** Serialised in the same shape and key order the server stores. */
export function serializeHours(h: BusinessHours): string {
  const days: Record<string, unknown> = {};
  for (const k of DAY_KEYS) {
    const w = h.days[k];
    days[k] = w ? { open: w.open, close: w.close } : null;
  }
  return JSON.stringify({ timezone: h.timezone, days });
}

export function HoursEditor({
  id,
  value,
  saved,
  onChange,
}: {
  id: string;
  value: string;
  /** The stored value, for the "as it stands today" summary. */
  saved: string;
  onChange: (v: string) => void;
}) {
  const h = parseHours(value);
  const current = parseHours(saved);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const openNow = withinHours(now, 1, current);
  const zones = ZONES.includes(h.timezone) ? ZONES : [h.timezone, ...ZONES];

  const set = (next: BusinessHours) => onChange(serializeHours(next));

  return (
    <div className="hours-editor" id={id}>
      <div className="hours-now">
        <span className={openNow ? 'pill pill-good' : 'pill pill-neutral'}>
          {openNow ? 'Open now' : 'Closed now'}
        </span>
        <span>
          <strong>Current hours:</strong> {describeHours(current)}
          <span className="muted"> · {timezoneLabel(current.timezone)}</span>
        </span>
      </div>

      <label className="hours-zone">
        Time zone
        <select value={h.timezone} onChange={(e) => set({ ...h, timezone: e.target.value })}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {timezoneLabel(z)}
            </option>
          ))}
        </select>
      </label>

      <table className="hours-table">
        <tbody>
          {DAY_KEYS.map((k) => {
            const w = h.days[k];
            return (
              <tr key={k} className={w ? undefined : 'closed'}>
                <th scope="row">{DAY_LABELS[k]}</th>
                <td>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={Boolean(w)}
                      onChange={(e) =>
                        set({
                          ...h,
                          days: {
                            ...h.days,
                            [k]: e.target.checked ? { open: '08:00', close: '18:00' } : null,
                          },
                        })
                      }
                    />
                    <span>{w ? 'Open' : 'Closed'}</span>
                  </label>
                </td>
                <td>
                  {w && (
                    <span className="hours-range">
                      <select
                        aria-label={`${DAY_LABELS[k]} opens`}
                        value={w.open}
                        onChange={(e) =>
                          set({ ...h, days: { ...h.days, [k]: { ...w, open: e.target.value } } })
                        }
                      >
                        {TIMES.map((t) => (
                          <option key={t} value={t}>
                            {label(t)}
                          </option>
                        ))}
                      </select>
                      <span className="muted">to</span>
                      <select
                        aria-label={`${DAY_LABELS[k]} closes`}
                        value={w.close}
                        onChange={(e) =>
                          set({ ...h, days: { ...h.days, [k]: { ...w, close: e.target.value } } })
                        }
                      >
                        {TIMES.slice(1).map((t) => (
                          <option key={t} value={t}>
                            {label(t)}
                          </option>
                        ))}
                      </select>
                      {w.close <= w.open && <span className="hint-warn small">Closes before it opens</span>}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="fine">
        Clients and website visitors see these hours converted to their own time zone. A meeting
        must start and finish inside them.
      </p>
    </div>
  );
}
