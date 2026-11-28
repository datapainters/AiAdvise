/**
 * Joining a meeting's Daily video call.
 *
 * The link is requested on click, not stored: it carries a token naming the
 * person, and the server decides whether the room is open yet.
 */
import { useEffect, useState } from 'react';
import {
  createVideoRoom,
  getVideoStatus,
  JOIN_EARLY_MINUTES,
  ROOM_GRACE_MINUTES,
  type Appointment,
} from './api';

type Joinable = Pick<Appointment, 'id' | 'startsAt' | 'endsAt' | 'status' | 'video'>;

/** Re-renders every 30 seconds so the button enables itself on time. */
function useClock(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export function videoWindow(a: Joinable) {
  const opens = new Date(a.startsAt).getTime() - JOIN_EARLY_MINUTES * 60_000;
  const closes = new Date(a.endsAt).getTime() + ROOM_GRACE_MINUTES * 60_000;
  return { opens, closes };
}

export function JoinCallButton({
  appointment: a,
  admin = false,
  onError,
  size,
}: {
  appointment: Joinable;
  admin?: boolean;
  onError: (e: unknown) => void;
  size?: 'sm';
}) {
  const now = useClock();
  const [busy, setBusy] = useState(false);

  if (!a.video || a.status === 'cancelled') return null;
  const { opens, closes } = videoWindow(a);
  if (now > closes) return null;
  if (!admin && a.status !== 'confirmed') return null;

  const early = !admin && now < opens;
  const live = now >= opens && now <= new Date(a.endsAt).getTime();
  const cls = ['btn', live || admin ? 'btn-video' : '', size === 'sm' ? 'btn-sm' : '']
    .filter(Boolean)
    .join(' ');

  // Our meeting page (with the sharing toolbar), in a new tab. Opened
  // without noopener on purpose: the tab inherits this one's sign-in.
  function join() {
    setBusy(true);
    const w = window.open(`/meet/${a.id}`, '_blank');
    if (!w) {
      onError(new Error('Your browser blocked the meeting window. Allow pop-ups for this site.'));
    }
    window.setTimeout(() => setBusy(false), 800);
  }

  if (early) {
    return (
      <button className={cls} disabled title={`The room opens ${JOIN_EARLY_MINUTES} minutes before the start`}>
        <VideoIcon /> Opens{' '}
        {new Date(opens).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
      </button>
    );
  }

  return (
    <button className={cls} onClick={join} disabled={busy}>
      <VideoIcon /> {busy ? 'Opening…' : admin ? 'Join as host' : 'Join video call'}
    </button>
  );
}

export function VideoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="video-icon"
    >
      <rect x="2.5" y="6" width="13" height="12" rx="2" />
      <path d="m15.5 10.5 6-3.5v10l-6-3.5z" />
    </svg>
  );
}

/** The Meeting Manager's video strip: room state, host join, create a missing room. */
export function VideoPanel({
  appointment: a,
  onError,
  onChanged,
}: {
  appointment: Joinable & { clientName?: string };
  onError: (e: unknown) => void;
  onChanged: () => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getVideoStatus(a.id)
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false));
  }, [a.id]);

  if (a.status === 'cancelled' || a.status === 'completed') return null;

  const { opens } = videoWindow(a);

  return (
    <section className="video-panel">
      <span className="video-badge">
        <VideoIcon />
      </span>
      <div className="video-text">
        {a.video ? (
          <>
            <strong>Video room ready</strong>
            <span className="muted">
              Private Daily room. The client can join from{' '}
              {new Date(opens).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}; you can
              join any time.
            </span>
          </>
        ) : a.status === 'requested' ? (
          <>
            <strong>No video room yet</strong>
            <span className="muted">A private room is created automatically when you confirm the meeting.</span>
          </>
        ) : enabled === false ? (
          <>
            <strong>Video is not configured</strong>
            <span className="muted">Add the Daily API key to Secrets Manager to turn on video meetings.</span>
          </>
        ) : (
          <>
            <strong>No video room</strong>
            <span className="muted">The room could not be created when the meeting was confirmed.</span>
          </>
        )}
      </div>
      <div className="video-actions">
        {a.video && <JoinCallButton appointment={a} admin onError={onError} />}
        {!a.video && a.status === 'confirmed' && enabled && (
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await createVideoRoom(a.id);
                onChanged();
              } catch (e) {
                onError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Creating…' : 'Create video room'}
          </button>
        )}
      </div>
    </section>
  );
}
