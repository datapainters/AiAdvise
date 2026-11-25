/**
 * Hours of operation, shared by every booking form and the admin calendar.
 *
 * Hours are stored in the business's own time zone and published at
 * /api/public/info. A visitor anywhere picks a day in their own calendar;
 * the slots offered are the half-hours of that local day that fall inside
 * the business's hours, shown in the visitor's local time.
 */

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export interface DayWindow {
  open: string; // "08:00"
  close: string; // "18:00"
}

export interface BusinessHours {
  timezone: string;
  days: Record<DayKey, DayWindow | null>;
}

export const DEFAULT_HOURS: BusinessHours = {
  timezone: 'America/Chicago',
  days: {
    mon: { open: '08:00', close: '18:00' },
    tue: { open: '08:00', close: '18:00' },
    wed: { open: '08:00', close: '18:00' },
    thu: { open: '08:00', close: '18:00' },
    fri: { open: '08:00', close: '18:00' },
    sat: null,
    sun: null,
  },
};

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';
let cache: Promise<BusinessHours> | null = null;

/** Fetched once per page load; falls back to the defaults if unreachable. */
export function loadBusinessHours(): Promise<BusinessHours> {
  if (!cache) {
    cache = fetch(`${BASE_URL}/api/public/info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => (info?.businessHours as BusinessHours) ?? DEFAULT_HOURS)
      .catch(() => DEFAULT_HOURS);
  }
  return cache;
}

/** Forget the cached hours, after an admin edits them. */
export function resetBusinessHours() {
  cache = null;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Weekday, date and minute-of-day of an instant in a time zone. */
export function zoned(date: Date, timezone: string): { day: DayKey; ymd: string; minutes: number } {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timezone, f);
  }
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    day: String(p.weekday).toLowerCase().slice(0, 3) as DayKey,
    ymd: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** True when [start, start + minutes) is inside one day's opening window. */
export function withinHours(start: Date, minutes: number, hours: BusinessHours): boolean {
  const s = zoned(start, hours.timezone);
  const e = zoned(new Date(start.getTime() + minutes * 60_000), hours.timezone);
  const w = hours.days[s.day];
  if (!w || s.ymd !== e.ymd) return false;
  return s.minutes >= toMinutes(w.open) && e.minutes <= toMinutes(w.close);
}

/**
 * Half-hour starts on a local calendar day (yyyy-mm-dd) that fit a meeting
 * of the given length inside business hours.
 */
export function openSlots(dayIso: string, minutes: number, hours: BusinessHours): Date[] {
  const [y, m, d] = dayIso.split('-').map(Number);
  const out: Date[] = [];
  const cursor = new Date(y, m - 1, d, 0, 0, 0, 0);
  while (cursor.getDate() === d) {
    // The server only accepts starts on a UTC :00/:30 boundary.
    if (cursor.getUTCMinutes() % 30 === 0 && withinHours(cursor, minutes, hours)) {
      out.push(new Date(cursor));
    }
    cursor.setMinutes(cursor.getMinutes() + 30);
  }
  return out;
}

function fmt(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Mon–Fri 8 AM – 6 PM", grouping consecutive days with the same hours. */
export function describeHours(hours: BusinessHours): string {
  const groups: { from: DayKey; to: DayKey; w: DayWindow }[] = [];
  for (const k of DAY_KEYS) {
    const w = hours.days[k];
    if (!w) continue;
    const last = groups[groups.length - 1];
    const prevIdx = last ? DAY_KEYS.indexOf(last.to) : -2;
    if (last && prevIdx === DAY_KEYS.indexOf(k) - 1 && last.w.open === w.open && last.w.close === w.close) {
      last.to = k;
    } else {
      groups.push({ from: k, to: k, w });
    }
  }
  const short = (k: DayKey) => DAY_LABELS[k].slice(0, 3);
  return groups
    .map((g) => `${short(g.from)}${g.from !== g.to ? `–${short(g.to)}` : ''} ${fmt(g.w.open)} – ${fmt(g.w.close)}`)
    .join(', ');
}

export function timezoneLabel(tz: string): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    return name ? `${name} (${tz})` : tz;
  } catch {
    return tz;
  }
}
