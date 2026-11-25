/**
 * The meeting room: the Daily call embedded in our own page, with a
 * Data Painters toolbar beside Daily's controls.
 *
 * - Hosts put templates (PDF), pre-recorded videos and images from the media
 *   library on a shared stage, and can share their screen.
 * - Clients and guests share their screen, capture a screenshot of a window
 *   or upload an image, so the host can see what they are describing.
 *
 * The stage is kept in step with Daily app messages: whoever shares
 * broadcasts the item (a short-lived viewing URL from our API), and the host
 * replays the current item to anyone who joins late. A host playing a video
 * also broadcasts play, pause and seek.
 */
import DailyIframe, { type DailyCall } from '@daily-co/daily-js';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getToken } from './auth';

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

interface Session {
  dailyUrl: string;
  meetToken: string;
  role: 'host' | 'client' | 'guest';
  name: string;
  meeting: {
    id: number;
    clientName: string;
    engagementTitle: string;
    startsAt: string;
    endsAt: string;
    status: string;
  };
}

interface Share {
  id: number;
  title: string;
  contentType: string;
  kind: 'image' | 'pdf' | 'video';
  url: string;
  sharedByRole: string;
  sharedByName: string;
  createdAt: string;
}

interface LibraryItem {
  id: number;
  kind: 'template' | 'video' | 'image';
  title: string;
  description: string | null;
  contentType: string;
}

/** One agenda line as the host sees it in the call window. */
interface AgendaItem {
  topicId: number;
  title: string;
  detail: string | null;
  desiredOutcome: string | null;
  priority: number;
  status: string;
  note: string | null;
  noteUpdatedAt: string | null;
}

/** The meeting clock. Minutes only: no rates or amounts reach the call window. */
interface Timer {
  running: boolean;
  runningSince: string | null;
  totalMinutes: number;
  /** The meeting's time is already on an invoice and cannot change. */
  locked: boolean;
}

type StageMessage = { type: 'dp-stage'; share: Share | null };
type VideoMessage = { type: 'dp-video'; action: 'play' | 'pause' | 'seek'; time: number };

/** Our API, with problem-detail errors turned into messages. Never signs anyone out. */
async function meetApi<T>(path: string, init: RequestInit & { meetToken?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.meetToken) headers['X-Meet-Token'] = init.meetToken;
  const login = getToken();
  if (login && path.endsWith('/session')) headers.Authorization = `Bearer ${login}`;
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.detail ?? '';
    } catch {
      /* not JSON */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** Uploads an image to storage and puts it on the stage. */
async function shareImage(meetingId: number, token: string, blob: Blob, title: string): Promise<Share> {
  const slot = await meetApi<{ uploadUrl: string; contentType: string; uploadKey: string }>(
    `/api/meet/${meetingId}/uploads`,
    {
      method: 'POST',
      meetToken: token,
      body: JSON.stringify({ fileName: title, contentType: blob.type, sizeBytes: blob.size }),
    },
  );
  const put = await fetch(slot.uploadUrl, { method: 'PUT', headers: { 'Content-Type': slot.contentType }, body: blob });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return meetApi<Share>(`/api/meet/${meetingId}/shares`, {
    method: 'POST',
    meetToken: token,
    body: JSON.stringify({ uploadKey: slot.uploadKey, title }),
  });
}

/** One frame of a window, tab or screen the person picks, as a PNG. */
async function captureScreenshot(): Promise<Blob> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // Give the first real frame a moment to arrive.
    await new Promise((r) => setTimeout(r, 250));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not capture'))), 'image/png'),
    );
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export function MeetingRoom() {
  const id = Number(useParams().id);
  const [params] = useSearchParams();
  const guestKey = params.get('k');

  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stage, setStage] = useState<Share | null>(null);
  const [history, setHistory] = useState<Share[]>([]);
  const [library, setLibrary] = useState<LibraryItem[] | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [left, setLeft] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [agenda, setAgenda] = useState<AgendaItem[] | null>(null);
  const [timer, setTimer] = useState<Timer | null>(null);
  const [notesOpen, setNotesOpen] = useState(true);

  const frameHost = useRef<HTMLDivElement>(null);
  const call = useRef<DailyCall | null>(null);
  const stageRef = useRef<Share | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const applyingRemote = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Whether another Data Painters host is in the call. The clock follows
  // the hosts as a group: it stops when the last one leaves, not the first.
  const otherHost = useRef(false);
  const meetToken = useRef<string | null>(null);

  const isHost = session?.role === 'host';

  /** Starts or stops the meeting clock. Failures are shown, never thrown. */
  const clock = useCallback(
    async (action: 'start' | 'stop') => {
      if (!meetToken.current) return;
      try {
        setTimer(
          await meetApi<Timer>(`/api/meet/${id}/timer/${action}`, {
            method: 'POST',
            meetToken: meetToken.current,
          }),
        );
      } catch (e) {
        setError(`The meeting timer did not ${action}: ${(e as Error).message}`);
      }
    },
    [id],
  );

  useEffect(() => {
    document.title = 'Meeting · Data Painters';
  }, []);

  // 1. Open a session: login for clients and admins, the email key for guests.
  useEffect(() => {
    meetApi<Session>(`/api/meet/${id}/session`, {
      method: 'POST',
      body: JSON.stringify(guestKey ? { guestKey } : {}),
    })
      .then(setSession)
      .catch((e) => setError((e as Error).message));
  }, [id, guestKey]);

  const broadcastStage = useCallback((share: Share | null, to?: string) => {
    const msg: StageMessage = { type: 'dp-stage', share };
    call.current?.sendAppMessage(msg, to ?? '*');
  }, []);

  const showOnStage = useCallback(
    (share: Share | null, broadcast: boolean) => {
      stageRef.current = share;
      setStage(share);
      if (share) setHistory((h) => (h.some((x) => x.id === share.id) ? h : [...h, share]));
      if (broadcast) broadcastStage(share);
    },
    [broadcastStage],
  );

  // 2. Join the call inside our page. Daily allows one frame per page and
  // its teardown is asynchronous, so any previous frame (a remount, a
  // development double-mount) is destroyed and awaited before a new one.
  useEffect(() => {
    if (!session || !frameHost.current) return;
    let cancelled = false;
    let frame: DailyCall | null = null;

    (async () => {
      const existing = DailyIframe.getCallInstance();
      if (existing) await existing.destroy();
      if (cancelled || !frameHost.current) return;

      const url = new URL(session.dailyUrl);
      const token = url.searchParams.get('t') ?? undefined;
      url.search = '';
      try {
        frame = DailyIframe.createFrame(frameHost.current, {
          iframeStyle: { width: '100%', height: '100%', border: '0', borderRadius: '10px' },
          showLeaveButton: false,
          showFullscreenButton: true,
        });
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      call.current = frame;

      const trackHosts = () => {
        otherHost.current = Object.values(frame?.participants() ?? {}).some(
          (p) => !p.local && p.owner,
        );
      };
      frame.on('joined-meeting', () => {
        setJoined(true);
        trackHosts();
        // The clock runs for as long as a host is in the call.
        if (session.role === 'host') clock('start');
      });
      frame.on('left-meeting', () => {
        setLeft(true);
        if (session.role === 'host' && !otherHost.current) clock('stop');
      });
      frame.on('participant-left', trackHosts);
      frame.on('error', (e) => setError(e?.errorMsg ?? 'The video call reported an error'));
      frame.on('participant-updated', (e) => {
        if (e?.participant?.local) {
          setScreenSharing(Boolean(e.participant.tracks?.screenVideo?.state === 'playable'));
        }
      });
      frame.on('participant-joined', (e) => {
        trackHosts();
        // The host brings late joiners up to date with what is on the stage.
        if (session.role === 'host' && stageRef.current && e?.participant?.session_id) {
          broadcastStage(stageRef.current, e.participant.session_id);
        }
      });
      frame.on('app-message', (e) => {
        const data = e?.data as StageMessage | VideoMessage | undefined;
        if (!data) return;
        if (data.type === 'dp-stage') {
          showOnStage(data.share, false);
        } else if (data.type === 'dp-video' && videoRef.current) {
          const v = videoRef.current;
          applyingRemote.current = true;
          if (Math.abs(v.currentTime - data.time) > 1) v.currentTime = data.time;
          if (data.action === 'play') v.play().catch(() => undefined);
          if (data.action === 'pause') v.pause();
          window.setTimeout(() => (applyingRemote.current = false), 300);
        }
      });

      frame
        .join({ url: url.toString(), token, userName: session.name })
        .catch((e) => !cancelled && setError(`Could not join the video call: ${e?.errorMsg ?? e?.message ?? e}`));
    })();

    meetToken.current = session.meetToken;
    if (session.role === 'host') {
      meetApi<AgendaItem[]>(`/api/meet/${id}/agenda`, { meetToken: session.meetToken })
        .then(setAgenda)
        .catch((e) => setError((e as Error).message));
      meetApi<Timer>(`/api/meet/${id}/timer`, { meetToken: session.meetToken })
        .then(setTimer)
        .catch(() => undefined);
    }

    // Closing the tab ends the call without a "left" event reaching this
    // page, so stop the clock on the way out. keepalive lets the request
    // finish after the page has gone.
    const onPageHide = () => {
      if (session.role !== 'host' || otherHost.current) return;
      fetch(`${BASE_URL}/api/meet/${id}/timer/stop`, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-Meet-Token': session.meetToken },
      }).catch(() => undefined);
    };
    window.addEventListener('pagehide', onPageHide);

    // Earlier shares, so the history drawer is complete after a rejoin.
    meetApi<Share[]>(`/api/meet/${id}/shares`, { meetToken: session.meetToken })
      .then(setHistory)
      .catch(() => undefined);

    return () => {
      window.removeEventListener('pagehide', onPageHide);
      cancelled = true;
      frame?.destroy();
      call.current = null;
    };
    // The handlers read the latest stage through refs; re-joining on every
    // render would drop the call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, id]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const msg = (e as Error).message;
      // Cancelling the browser's screen picker is not an error worth showing.
      if (!/Permission denied|NotAllowedError|AbortError/i.test(msg)) setError(msg);
    } finally {
      setBusy(null);
    }
  }

  const openLibrary = () =>
    run('library', async () => {
      if (!library) setLibrary(await meetApi<LibraryItem[]>(`/api/meet/${id}/library`, { meetToken: session!.meetToken }));
      setLibraryOpen(true);
    });

  const shareItem = (item: LibraryItem) =>
    run('share', async () => {
      const share = await meetApi<Share>(`/api/meet/${id}/shares`, {
        method: 'POST',
        meetToken: session!.meetToken,
        body: JSON.stringify({ mediaItemId: item.id }),
      });
      showOnStage(share, true);
      setLibraryOpen(false);
      setNotice(`Sharing “${share.title}”`);
    });

  const screenshot = () =>
    run('screenshot', async () => {
      const blob = await captureScreenshot();
      const share = await shareImage(id, session!.meetToken, blob, `Screenshot from ${session!.name}`);
      showOnStage(share, true);
      setNotice('Screenshot shared with everyone in the call');
    });

  const uploadImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    run('upload', async () => {
      const share = await shareImage(id, session!.meetToken, file, file.name);
      showOnStage(share, true);
      setNotice(`Shared “${file.name}”`);
    });
  };

  const toggleScreen = () => {
    const f = call.current;
    if (!f) return;
    if (screenSharing) f.stopScreenShare();
    else f.startScreenShare();
  };

  const stopStage = () => showOnStage(null, true);

  const onVideoEvent = (action: VideoMessage['action']) => {
    if (!isHost || applyingRemote.current || !videoRef.current) return;
    const msg: VideoMessage = { type: 'dp-video', action, time: videoRef.current.currentTime };
    call.current?.sendAppMessage(msg, '*');
  };

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(t);
  }, [notice]);

  if (error && !session) {
    return (
      <div className="meet-gate">
        <div className="meet-gate-card">
          <div className="doc-brand">Data Painters</div>
          <h1>We could not open this meeting</h1>
          <p className="muted">{error}</p>
          <p>
            <Link to={guestKey ? '/' : '/portal?view=meetings'} className="btn">
              {guestKey ? 'Go to the website' : 'Back to your meetings'}
            </Link>
          </p>
        </div>
      </div>
    );
  }

  if (left) {
    return (
      <div className="meet-gate">
        <div className="meet-gate-card">
          <div className="doc-brand">Data Painters</div>
          <h1>You have left the meeting</h1>
          <p className="muted">Thank you. You can rejoin while the room is open.</p>
          <p className="button-row">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Rejoin
            </button>
            {!guestKey && (
              <Link to={isHost ? '/admin?view=appointments' : '/portal?view=meetings'} className="btn">
                Close
              </Link>
            )}
          </p>
        </div>
      </div>
    );
  }

  const m = session?.meeting;
  const grouped = (kind: LibraryItem['kind']) => (library ?? []).filter((i) => i.kind === kind);

  return (
    <div
      className={['meet', stage && 'with-stage', isHost && notesOpen && 'with-notes']
        .filter(Boolean)
        .join(' ')}
    >
      <header className="meet-bar">
        <div className="meet-title">
          <span className="portal-mark" aria-hidden="true" />
          <div>
            <strong>{m ? m.engagementTitle : 'Meeting'}</strong>
            <span className="muted">
              {m
                ? `${m.clientName} · ${new Date(m.startsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
                : 'Connecting…'}
            </span>
          </div>
        </div>
        <div className="meet-who">
          {session && (
            <span className={isHost ? 'pill pill-good' : 'pill pill-neutral'}>
              {isHost ? 'Host' : session.role === 'guest' ? 'Guest' : 'Client'} · {session.name}
            </span>
          )}
          <button className="btn btn-danger" onClick={() => call.current?.leave()} disabled={!joined}>
            Leave
          </button>
        </div>
      </header>

      <main className="meet-body">
        <section className="meet-call" aria-label="Video call">
          <div ref={frameHost} className="meet-frame" />
          {!joined && <div className="meet-connecting">Connecting to the video call…</div>}
        </section>

        {stage && (
          <section className="meet-stage" aria-label="Shared on screen">
            <header>
              <div>
                <strong>{stage.title}</strong>
                <span className="muted small">Shared by {stage.sharedByName}</span>
              </div>
              <div className="button-row">
                <a className="btn btn-sm" href={stage.url} target="_blank" rel="noreferrer">
                  Open
                </a>
                {(isHost || stage.sharedByName === session?.name) && (
                  <button className="btn btn-sm" onClick={stopStage}>
                    Stop sharing
                  </button>
                )}
              </div>
            </header>
            <div className="meet-stage-body">
              {stage.kind === 'image' && <img src={stage.url} alt={stage.title} />}
              {stage.kind === 'pdf' && <iframe src={stage.url} title={stage.title} />}
              {stage.kind === 'video' && (
                <video
                  ref={videoRef}
                  src={stage.url}
                  controls={isHost}
                  playsInline
                  onPlay={() => onVideoEvent('play')}
                  onPause={() => onVideoEvent('pause')}
                  onSeeked={() => onVideoEvent('seek')}
                />
              )}
            </div>
            {stage.kind === 'video' && !isHost && <p className="muted small meet-stage-note">The host controls playback.</p>}
          </section>
        )}

        {isHost && notesOpen && session && (
          <HostPanel
            meetingId={id}
            meetToken={session.meetToken}
            agenda={agenda}
            timer={timer}
            onAgenda={setAgenda}
            onClock={clock}
            onError={setError}
          />
        )}
      </main>

      <footer className="meet-toolbar" aria-label="Sharing">
        <div className="meet-tools">
          {isHost && (
            <button className={notesOpen ? 'tool on' : 'tool'} onClick={() => setNotesOpen((v) => !v)}>
              <ToolIcon d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7" />
              <span>Agenda and notes</span>
            </button>
          )}
          {isHost && (
            <button className="tool" onClick={openLibrary} disabled={!joined || busy !== null}>
              <ToolIcon d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z" />
              <span>Share from library</span>
            </button>
          )}
          <button className={screenSharing ? 'tool on' : 'tool'} onClick={toggleScreen} disabled={!joined}>
            <ToolIcon d="M3 4h18v12H3zM8 20h8M12 16v4" />
            <span>{screenSharing ? 'Stop screen share' : 'Share screen'}</span>
          </button>
          <button className="tool" onClick={screenshot} disabled={!joined || busy !== null}>
            <ToolIcon d="M4 7h3l2-3h6l2 3h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
            <span>{busy === 'screenshot' ? 'Capturing…' : 'Share a screenshot'}</span>
          </button>
          <button className="tool" onClick={() => fileInput.current?.click()} disabled={!joined || busy !== null}>
            <ToolIcon d="M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01" />
            <span>{busy === 'upload' ? 'Uploading…' : 'Share an image'}</span>
          </button>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={uploadImage} />
          <button className="tool" onClick={() => setHistoryOpen((v) => !v)} disabled={history.length === 0}>
            <ToolIcon d="M12 7v5l3 2M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
            <span>Shared items{history.length ? ` (${history.length})` : ''}</span>
          </button>
          {stage && (isHost || stage.sharedByName === session?.name) && (
            <button className="tool" onClick={stopStage}>
              <ToolIcon d="M6 6l12 12M18 6L6 18" />
              <span>Clear stage</span>
            </button>
          )}
        </div>
        {error && <div className="meet-error">{error}</div>}
        {notice && <div className="meet-notice">{notice}</div>}
      </footer>

      {libraryOpen && (
        <aside className="meet-drawer" aria-label="Media library">
          <header>
            <strong>Share from library</strong>
            <button className="modal-close" aria-label="Close" onClick={() => setLibraryOpen(false)}>
              &times;
            </button>
          </header>
          {library && library.length === 0 && (
            <p className="muted">The library is empty. Add templates, videos and images in Admin → Media library.</p>
          )}
          {(['template', 'video', 'image'] as const).map((k) =>
            grouped(k).length === 0 ? null : (
              <section key={k}>
                <h4>{k === 'template' ? 'Templates' : k === 'video' ? 'Pre-recorded videos' : 'Images'}</h4>
                <ul>
                  {grouped(k).map((i) => (
                    <li key={i.id}>
                      <div>
                        <strong>{i.title}</strong>
                        {i.description && <span className="muted small">{i.description}</span>}
                      </div>
                      <button className="btn btn-sm btn-primary" disabled={busy !== null} onClick={() => shareItem(i)}>
                        Share
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}
        </aside>
      )}

      {historyOpen && (
        <aside className="meet-drawer" aria-label="Shared items">
          <header>
            <strong>Shared in this meeting</strong>
            <button className="modal-close" aria-label="Close" onClick={() => setHistoryOpen(false)}>
              &times;
            </button>
          </header>
          <ul>
            {history.map((s) => (
              <li key={s.id}>
                <div>
                  <strong>{s.title}</strong>
                  <span className="muted small">
                    {s.sharedByName} · {new Date(s.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <div className="button-row">
                  <a className="btn btn-sm" href={s.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                  {isHost && (
                    <button className="btn btn-sm" onClick={() => showOnStage(s, true)}>
                      Show again
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}

function ToolIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/* ------------------------------------------------------------- host panel */

function clockText(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const sec = totalSeconds % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/**
 * What the Data Painters host runs the meeting from, beside the video: the
 * clock that bills the meeting, and the agenda with a note field per topic.
 * Only the host sees it; clients and guests never receive this data.
 */
function HostPanel({
  meetingId,
  meetToken,
  agenda,
  timer,
  onAgenda,
  onClock,
  onError,
}: {
  meetingId: number;
  meetToken: string;
  agenda: AgendaItem[] | null;
  timer: Timer | null;
  onAgenda: (next: AgendaItem[]) => void;
  onClock: (action: 'start' | 'stop') => void;
  onError: (message: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timer?.running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [timer?.running]);

  const runningSeconds =
    timer?.running && timer.runningSince
      ? Math.max(0, Math.floor((now - new Date(timer.runningSince).getTime()) / 1000))
      : 0;

  const replace = (updated: AgendaItem) =>
    onAgenda((agenda ?? []).map((a) => (a.topicId === updated.topicId ? updated : a)));

  return (
    <aside className="meet-notes" aria-label="Agenda, notes and meeting timer">
      <section className="meet-timer">
        <div>
          <span className="meet-timer-label">
            {timer?.running ? 'Timer running' : timer?.locked ? 'Time is invoiced' : 'Timer stopped'}
          </span>
          <strong className={timer?.running ? 'meet-timer-clock on' : 'meet-timer-clock'}>
            {timer?.running ? clockText(runningSeconds) : '0:00'}
          </strong>
          <span className="muted small">
            {timer ? `${timer.totalMinutes} min recorded for this meeting` : 'Loading…'}
          </span>
        </div>
        {timer?.running ? (
          <button className="btn btn-sm" onClick={() => onClock('stop')}>
            Stop timer
          </button>
        ) : (
          <button className="btn btn-sm btn-primary" disabled={!timer || timer.locked} onClick={() => onClock('start')}>
            Start timer
          </button>
        )}
      </section>
      <p className="muted small meet-timer-note">
        The timer starts when you join the call and stops when you leave.
      </p>

      <h3>Agenda</h3>
      {agenda === null ? (
        <p className="muted small">Loading…</p>
      ) : agenda.length === 0 ? (
        <p className="muted small">The client booked this meeting without choosing topics.</p>
      ) : (
        <div className="meet-agenda">
          {agenda.map((item) => (
            <HostAgendaItem
              key={item.topicId}
              meetingId={meetingId}
              meetToken={meetToken}
              item={item}
              onChanged={replace}
              onError={onError}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

function HostAgendaItem({
  meetingId,
  meetToken,
  item,
  onChanged,
  onError,
}: {
  meetingId: number;
  meetToken: string;
  item: AgendaItem;
  onChanged: (updated: AgendaItem) => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(item.note ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const lastSaved = useRef(item.note ?? '');
  const dirty = draft !== lastSaved.current;

  // Saved when the field loses focus, not per keystroke: someone typing
  // through a live call should not be sending a request per character.
  async function save() {
    if (!dirty || state === 'saving') return;
    setState('saving');
    try {
      const updated = await meetApi<AgendaItem>(`/api/meet/${meetingId}/agenda/${item.topicId}/note`, {
        method: 'PUT',
        meetToken,
        body: JSON.stringify({ body: draft }),
      });
      lastSaved.current = updated.note ?? '';
      onChanged(updated);
      setState('saved');
      window.setTimeout(() => setState('idle'), 2000);
    } catch (e) {
      setState('idle');
      onError(`Note not saved: ${(e as Error).message}`);
    }
  }

  async function mark(status: string) {
    try {
      onChanged(
        await meetApi<AgendaItem>(`/api/meet/${meetingId}/agenda/${item.topicId}/status`, {
          method: 'PUT',
          meetToken,
          body: JSON.stringify({ status }),
        }),
      );
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <article className={`meet-agenda-item is-${item.status}`}>
      <header>
        <strong>{item.title}</strong>
        <span className="meet-agenda-status">{item.status}</span>
      </header>
      {item.desiredOutcome && <p className="muted small">Wanted: {item.desiredOutcome}</p>}
      <textarea
        rows={3}
        value={draft}
        aria-label={`Notes for ${item.title}`}
        placeholder="What was discussed, decided, and what happens next."
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
      />
      <div className="meet-agenda-actions">
        <span className="muted small">
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : dirty ? 'Not saved yet' : ''}
        </span>
        {item.status !== 'discussed' && (
          <button className="btn btn-sm" onClick={() => mark('discussed')}>
            Mark discussed
          </button>
        )}
        {item.status === 'discussed' && (
          <button className="btn btn-sm" onClick={() => mark('scheduled')}>
            Reopen
          </button>
        )}
      </div>
    </article>
  );
}
