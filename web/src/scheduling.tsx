/**
 * Shared scheduling helpers and the client-side booking form.
 *
 * Time handling is the fiddly part here. Appointments are stored as UTC
 * instants that must land exactly on a 30-minute boundary; the browser shows
 * and collects local time. Everything that converts between the two lives in
 * this file so there is one place to be wrong.
 */

import { useMemo, useState, type FormEvent } from 'react';
import {
  bookAppointment,
  type Appointment,
  type Engagement,
  type Topic,
} from './api';

export const BLOCK_MINUTES = 30;

/**
 * Bookable hours, in the client's local time. Start times run from the
 * opening hour up to the last half hour before close; weekends are closed.
 * The server still accepts any 30-minute boundary, so an admin editing a
 * meeting can place it outside these hours deliberately.
 */
export const OPEN_HOUR = 8;
export const CLOSE_HOUR = 18;

export function isWeekend(dayIso: string): boolean {
  const [y, m, d] = dayIso.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6;
}

/** Offered meeting lengths. Whole blocks, up to half a day. */
export const LENGTH_OPTIONS = [30, 60, 90, 120, 150, 180, 240];

export function formatLength(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatRange(startIso: string, endIso: string): string {
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return formatWhen(startIso);
  return `${formatWhen(startIso)} – ${end.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

/**
 * The half-hour options for one day, as local wall-clock labels paired with
 * the UTC instant they mean.
 *
 * Built by stepping 30 minutes from local midnight rather than by formatting
 * 48 fixed strings, so a day containing a daylight-saving transition yields
 * the slots that actually exist on that day rather than two that collide or
 * one that does not.
 */
export function slotsForDay(dayIso: string): { label: string; value: string }[] {
  const [y, m, d] = dayIso.split('-').map(Number);
  if (!y || !m || !d) return [];

  const out: { label: string; value: string }[] = [];
  const cursor = new Date(y, m - 1, d, 0, 0, 0, 0);

  while (cursor.getDate() === d) {
    // Only offer boundaries the server will accept. A zone at a :45 offset
    // would produce none, which is the honest outcome: we cannot schedule
    // there without changing the storage rule.
    if (cursor.getUTCMinutes() % BLOCK_MINUTES === 0 && cursor.getUTCSeconds() === 0) {
      out.push({
        label: cursor.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
        value: cursor.toISOString(),
      });
    }
    cursor.setMinutes(cursor.getMinutes() + BLOCK_MINUTES);
  }
  return out;
}

/** Today in the browser's zone, as yyyy-mm-dd for a date input. */
export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/** "1 topic", "3 topics". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function statusLabel(status: string): string {
  return status === 'requested' ? 'awaiting confirmation' : status;
}

/**
 * Book open topics into a meeting.
 *
 * Topics come first deliberately: the agenda is the reason for the meeting,
 * and choosing a time before knowing what is on it tends to produce a
 * half-hour that needed ninety minutes.
 */
export function BookingForm({
  engagements,
  openTopics,
  onBooked,
  onError,
  onCancel,
  initialEngagementId,
}: {
  initialEngagementId?: number | null;
  engagements: Engagement[];
  openTopics: Topic[];
  onBooked: (a: Appointment) => void;
  onError: (e: unknown) => void;
  onCancel: () => void;
}) {
  const [engagementId, setEngagementId] = useState<string>(() => {
    if (engagements.length === 1) return String(engagements[0].id);
    if (initialEngagementId && engagements.some((e) => e.id === initialEngagementId)) {
      return String(initialEngagementId);
    }
    return '';
  });
  const [selected, setSelected] = useState<number[]>([]);
  const [day, setDay] = useState(todayIso());
  const [slot, setSlot] = useState('');
  const [length, setLength] = useState(60);
  const [busy, setBusy] = useState(false);

  // Only topics on the chosen engagement can share an agenda.
  const available = useMemo(
    () =>
      engagementId
        ? openTopics.filter((t) => t.engagementId === Number(engagementId))
        : [],
    [engagementId, openTopics],
  );

  const closed = isWeekend(day);
  const slots = useMemo(() => {
    if (isWeekend(day)) return [];
    const all = slotsForDay(day).filter((s) => {
      const h = new Date(s.value).getHours();
      return h >= OPEN_HOUR && h < CLOSE_HOUR;
    });
    // Hide times already gone, so today behaves like every other day.
    return day === todayIso() ? all.filter((s) => new Date(s.value) > new Date()) : all;
  }, [day]);

  // A sensible default length: half an hour per topic, rounded into the
  // offered options. Easy to override, but closer than a fixed 30 minutes.
  const suggested = useMemo(() => {
    if (selected.length === 0) return 60;
    const want = selected.length * BLOCK_MINUTES;
    return LENGTH_OPTIONS.find((o) => o >= want) ?? LENGTH_OPTIONS[LENGTH_OPTIONS.length - 1];
  }, [selected]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      setLength((cur) => {
        const want = next.length * BLOCK_MINUTES;
        const fit =
          LENGTH_OPTIONS.find((o) => o >= want) ?? LENGTH_OPTIONS[LENGTH_OPTIONS.length - 1];
        // Only nudge the length while the user has not set it themselves.
        return cur === suggested ? fit : cur;
      });
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onBooked(
        await bookAppointment({
          engagementId: Number(engagementId),
          startsAt: slot,
          durationMinutes: length,
          topicIds: selected,
        }),
      );
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="stack-form panel">
      <label>
        Engagement
        <select
          value={engagementId}
          required
          onChange={(e) => {
            setEngagementId(e.target.value);
            setSelected([]);
          }}
        >
          <option value="">Select...</option>
          {engagements.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
      </label>

      {engagementId && (
        <fieldset className="topic-picker">
          <legend>Agenda &mdash; {selected.length} selected</legend>
          {available.length === 0 ? (
            <p className="empty">
              No open topics on this engagement. Add one first and it can go on a
              meeting.
            </p>
          ) : (
            available.map((t) => (
              <label key={t.id} className="checkbox pick">
                <input
                  type="checkbox"
                  checked={selected.includes(t.id)}
                  onChange={() => toggle(t.id)}
                />
                <span>
                  <span className="pick-title">{t.title}</span>
                  <span className="muted"> &middot; priority {t.priority}</span>
                </span>
              </label>
            ))
          )}
        </fieldset>
      )}

      <div className="field-row">
        <label>
          Date
          <input
            type="date"
            value={day}
            min={todayIso()}
            required
            onChange={(e) => {
              setDay(e.target.value);
              setSlot('');
            }}
          />
        </label>
        <label>
          Start
          <select value={slot} required onChange={(e) => setSlot(e.target.value)}>
            <option value="">Select...</option>
            {slots.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Length
          <select value={length} onChange={(e) => setLength(Number(e.target.value))}>
            {LENGTH_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {formatLength(o)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {closed ? (
        <p className="hint hint-warn">We meet Monday to Friday. Pick a weekday.</p>
      ) : (
        slots.length === 0 && (
          <p className="hint hint-warn">No remaining start times today. Pick another date.</p>
        )
      )}

      <p className="hint">
        Start times are offered on weekdays from {OPEN_HOUR}:00 AM to{' '}
        {CLOSE_HOUR - 13}:30 PM your time, in {BLOCK_MINUTES}-minute blocks. We will confirm the time; you will see the status
        change here.
      </p>

      <div className="button-row">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !slot || !engagementId}
        >
          {busy ? 'Requesting...' : 'Request meeting'}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
