/**
 * Admin: the media library hosts share in meetings, and the System
 * reporting section's Video conference billing report.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Paged } from './datagrid';
import { Modal } from './admin-meetings';
import {
  archiveMedia,
  completeMedia,
  createMedia,
  downloadCsv,
  getVideoBilling,
  listMedia,
  mediaUrl,
  money,
  type MediaItem,
  type VideoBillingReport,
} from './billing-api';

type OnError = (e: unknown) => void;

const KINDS: { id: MediaItem['kind']; label: string; accept: string; hint: string }[] = [
  { id: 'template', label: 'Templates', accept: 'application/pdf,image/png,image/jpeg,image/webp', hint: 'PDF or image, up to 50 MB' },
  { id: 'video', label: 'Pre-recorded videos', accept: 'video/mp4,video/webm', hint: 'MP4 or WebM, up to 500 MB' },
  { id: 'image', label: 'Images', accept: 'image/png,image/jpeg,image/gif,image/webp', hint: 'PNG, JPEG, GIF or WebP, up to 15 MB' },
];

function size(bytes: number | null) {
  if (!bytes) return '—';
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

export function MediaLibrary({ onError, onToast }: { onError: OnError; onToast: (m: string) => void }) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [adding, setAdding] = useState<MediaItem['kind'] | null>(null);
  const [preview, setPreview] = useState<{ item: MediaItem; url: string } | null>(null);

  const reload = useCallback(() => listMedia().then(setItems).catch(onError), [onError]);
  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <section>
      <p className="muted report-note">
        Hosts share these from the toolbar during a video meeting. Everyone in the call sees them on the
        shared stage; a host playing a video controls playback for everyone.
      </p>
      {KINDS.map((k) => {
        const list = (items ?? []).filter((i) => i.kind === k.id);
        return (
          <div className="panel-card spaced" key={k.id}>
            <header>
              <h2>
                {k.label} <span className="tab-count">{list.length}</span>
              </h2>
              <button className="btn btn-sm btn-primary" onClick={() => setAdding(k.id)}>
                + Add
              </button>
            </header>
            {items === null ? (
              <p className="panel-empty">Loading…</p>
            ) : list.length === 0 ? (
              <p className="panel-empty">None yet. {k.hint}.</p>
            ) : (
<Paged rows={list}>{(pageRows) => (
              <ul className="media-list">
                {pageRows.map((i) => (
                  <li key={i.id}>
                    <div>
                      <strong>{i.title}</strong>
                      <span className="muted small">
                        {i.contentType} · {size(i.sizeBytes)} · added {new Date(i.createdAt).toLocaleDateString()}
                        {i.createdBy ? ` by ${i.createdBy}` : ''}
                      </span>
                      {i.description && <span className="muted small">{i.description}</span>}
                    </div>
                    <div className="row-actions">
                      {i.status === 'pending' ? (
                        <span className="pill pill-warn">Upload incomplete</span>
                      ) : (
                        <button
                          className="linklike"
                          onClick={async () => {
                            try {
                              setPreview({ item: i, url: (await mediaUrl(i.id)).url });
                            } catch (e) {
                              onError(e);
                            }
                          }}
                        >
                          Preview
                        </button>
                      )}
                      <button
                        className="linklike danger"
                        onClick={async () => {
                          if (!window.confirm(`Remove “${i.title}” from the library?`)) return;
                          try {
                            await archiveMedia(i.id);
                            onToast('Removed from the library');
                            reload();
                          } catch (e) {
                            onError(e);
                          }
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
)}</Paged>
            )}
          </div>
        );
      })}

      {adding && (
        <AddMediaModal
          kind={adding}
          onCancel={() => setAdding(null)}
          onError={onError}
          onDone={(title) => {
            setAdding(null);
            onToast(`“${title}” added to the library`);
            reload();
          }}
        />
      )}

      {preview && (
        <Modal title={preview.item.title} onClose={() => setPreview(null)} wide>
          <div className="media-preview">
            {preview.item.contentType.startsWith('video/') ? (
              <video src={preview.url} controls />
            ) : preview.item.contentType === 'application/pdf' ? (
              <iframe src={preview.url} title={preview.item.title} />
            ) : (
              <img src={preview.url} alt={preview.item.title} />
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}

function AddMediaModal({
  kind,
  onCancel,
  onDone,
  onError,
}: {
  kind: MediaItem['kind'];
  onCancel: () => void;
  onDone: (title: string) => void;
  onError: OnError;
}) {
  const k = KINDS.find((x) => x.id === kind)!;
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [progress, setProgress] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    try {
      setProgress('Preparing…');
      const created = await createMedia({
        kind,
        title: title.trim() || file.name,
        description: description.trim() || undefined,
        contentType: file.type,
        sizeBytes: file.size,
      });
      setProgress('Uploading…');
      const put = await fetch(created.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': created.contentType },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      setProgress('Finishing…');
      await completeMedia(created.item.id);
      onDone(created.item.title);
    } catch (err) {
      setProgress(null);
      onError(err);
    }
  }

  return (
    <Modal title={`Add to ${k.label.toLowerCase()}`} onClose={onCancel}>
      <form className="stack-form" onSubmit={submit}>
        <label>
          File
          <input
            type="file"
            accept={k.accept}
            required
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
        </label>
        <p className="hint">{k.hint}.</p>
        <label>
          Title
          <input value={title} required maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Description
          <input value={description} placeholder="Optional: when to use it" onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="button-row">
          <button className="btn btn-primary" type="submit" disabled={!file || progress !== null}>
            {progress ?? 'Upload'}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------- video conference billing */

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
};

export function VideoBillingReportView({ onError }: { onError: OnError }) {
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [r, setR] = useState<VideoBillingReport | null>(null);

  useEffect(() => {
    getVideoBilling(from, to).then(setR).catch(onError);
  }, [from, to, onError]);

  // Client × month pivot of the billed amount.
  const pivot = useMemo(() => {
    const m = new Map<string, number>();
    r?.rows.forEach((x) => m.set(`${x.clientId}|${x.month}`, x.billedCents));
    return m;
  }, [r]);

  return (
    <section className="report">
      <div className="report-head">
        <div className="field-row report-range">
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        {r && (
          <div className="report-actions">
            <button
              className="btn"
              onClick={() =>
                downloadCsv(
                  `video-conference-billing-${r.from}-to-${r.to}.csv`,
                  ['Customer', 'Month', 'Video meetings', 'Calls', 'Call minutes', 'Participant minutes', 'Billed', 'Video cost'],
                  r.rows.map((x) => [
                    x.clientName ?? '',
                    x.month ?? '',
                    x.meetings,
                    x.sessions,
                    x.callMinutes,
                    x.participantMinutes,
                    (x.billedCents / 100).toFixed(2),
                    (x.videoCostCents / 100).toFixed(2),
                  ]),
                )
              }
            >
              Export CSV
            </button>
            <button className="btn" onClick={() => window.print()}>
              Print
            </button>
          </div>
        )}
      </div>

      {!r ? (
        <p className="empty">Loading…</p>
      ) : (
        <>
          <div className="kpis kpis-compact">
            <div className="kpi kpi-static">
              <span className="kpi-label">Billed for video meetings</span>
              <span className="kpi-value kpi-value-sm">{money(r.total.billedCents)}</span>
              <span className="kpi-hint">{r.total.meetings} meeting(s)</span>
            </div>
            <div className="kpi kpi-static">
              <span className="kpi-label">Call time</span>
              <span className="kpi-value kpi-value-sm">{(r.total.callMinutes / 60).toFixed(1)} h</span>
              <span className="kpi-hint">{r.total.sessions} call(s)</span>
            </div>
            <div className="kpi kpi-static">
              <span className="kpi-label">Video cost</span>
              <span className="kpi-value kpi-value-sm">{money(r.total.videoCostCents)}</span>
              <span className="kpi-hint">
                {r.total.participantMinutes.toLocaleString()} participant-min at ${r.videoRatePerMinute}
              </span>
            </div>
            <div className="kpi kpi-static">
              <span className="kpi-label">Customers</span>
              <span className="kpi-value kpi-value-sm">{r.clientTotals.length}</span>
              <span className="kpi-hint">Met over video in this range</span>
            </div>
          </div>
          <p className="muted small report-note">
            A meeting counts once its video room recorded a call; the month is the meeting's month.
            Billed is the charge compiled for that meeting. Use “Sync video usage” on the Engagement
            costs report to pull calls not yet recorded.
          </p>

          {r.rows.length === 0 ? (
            <div className="empty-state">
              <p>
                <strong>No video meetings in this range.</strong>
              </p>
            </div>
          ) : (
            <>
              <h4 className="subhead">Billed per customer per month</h4>
              <Paged rows={r.clientTotals} size={25}>{(pageRows) => (
<div className="grid-wrap">
                <table className="grid report-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      {r.months.map((m) => (
                        <th key={m} className="num">
                          {monthLabel(m)}
                        </th>
                      ))}
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((c) => (
                      <tr key={c.clientId}>
                        <td>
                          <strong>{c.clientName}</strong>
                        </td>
                        {r.months.map((m) => {
                          const v = pivot.get(`${c.clientId}|${m}`);
                          return (
                            <td key={m} className="num">
                              {v === undefined ? <span className="muted">—</span> : money(v)}
                            </td>
                          );
                        })}
                        <td className="num">
                          <strong>{money(c.billedCents)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Total</th>
                      {r.months.map((m) => (
                        <th key={m} className="num">
                          {money(r.monthTotals.find((x) => x.month === m)?.billedCents ?? 0)}
                        </th>
                      ))}
                      <th className="num">{money(r.total.billedCents)}</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
)}</Paged>

              <h4 className="subhead">Detail</h4>
              <Paged rows={r.rows} size={25}>{(pageRows) => (
<div className="grid-wrap">
                <table className="grid report-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Month</th>
                      <th className="num">Meetings</th>
                      <th className="num">Calls</th>
                      <th className="num">Call minutes</th>
                      <th className="num">Participant-min</th>
                      <th className="num">Billed</th>
                      <th className="num">Video cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((x) => (
                      <tr key={`${x.clientId}-${x.month}`}>
                        <td>{x.clientName}</td>
                        <td className="nowrap">{x.month && monthLabel(x.month)}</td>
                        <td className="num">{x.meetings}</td>
                        <td className="num">{x.sessions}</td>
                        <td className="num">{x.callMinutes}</td>
                        <td className="num">{x.participantMinutes}</td>
                        <td className="num">{money(x.billedCents)}</td>
                        <td className="num">{money(x.videoCostCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
)}</Paged>
            </>
          )}
        </>
      )}
    </section>
  );
}
