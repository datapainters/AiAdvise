/**
 * The Engagement Manager and the Team screen.
 *
 * An engagement exists to meet one need. Everything that happens on the way
 * there -- the meetings, what was agreed in them, what was shown on screen,
 * the time spent and what it was billed at -- is collected in one popup so
 * progress towards the goal can be read without visiting five screens.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  getEngagementDetail,
  inviteTeamMember,
  invoiceEngagement,
  listTeam,
  resendInvite,
  updateEngagement,
  updateTeamMember,
  type CreatedUser,
  type EngagementAgendaLine,
  type EngagementDetail,
  type TeamMember,
} from './api';
import { Modal } from './admin-meetings';
import { TEAM_ROLE_LABELS, type TeamRole, type User } from './auth';
import { money } from './billing-api';
import { PeopleList } from './people';
import { formatLength, formatRange, statusLabel } from './scheduling';

type OnError = (e: unknown) => void;

function hours(minutes: number): string {
  if (minutes === 0) return '0 h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

/* -------------------------------------------------------- engagement manager */

type Tab = 'overview' | 'meetings' | 'agenda' | 'media' | 'team' | 'billing';

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  meetings: 'Meetings',
  agenda: 'Agenda & notes',
  media: 'Media',
  team: 'Team',
  billing: 'Billing',
};

const STATUS_TONE: Record<string, 'good' | 'warn' | 'neutral'> = {
  active: 'good',
  inquiry: 'warn',
  paused: 'neutral',
  closed: 'neutral',
};

export function EngagementManager({
  engagementId,
  onClose,
  onChanged,
  onError,
  onOpenMeeting,
  onOpenInvoice,
  onToast,
}: {
  engagementId: number;
  onClose: () => void;
  /** Tells the list behind to reload after an edit. */
  onChanged: () => void;
  onError: OnError;
  onOpenMeeting: (appointmentId: number) => void;
  onOpenInvoice: (invoiceId: number) => void;
  onToast: (message: string) => void;
}) {
  const [detail, setDetail] = useState<EngagementDetail | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(
    () => getEngagementDetail(engagementId).then(setDetail).catch(onError),
    [engagementId, onError],
  );

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, [reload]);

  const tabs: Tab[] = ['overview', 'meetings', 'agenda', 'media', 'team'];
  if (detail?.billing) tabs.push('billing');

  const noted = detail?.agenda.filter((a) => a.note).length ?? 0;
  const counts: Record<Tab, number | null> = {
    overview: null,
    meetings: detail?.meetings.length ?? 0,
    agenda: detail?.agenda.length ?? 0,
    media: detail?.media.length ?? 0,
    team: detail?.team.length ?? 0,
    billing: null,
  };

  const held = detail?.meetings.filter((m) => m.status === 'completed').length ?? 0;
  const upcoming =
    detail?.meetings.filter(
      (m) => new Date(m.startsAt) > new Date() && m.status !== 'cancelled' && m.status !== 'completed',
    ).length ?? 0;

  return (
    <Modal
      title={detail?.title ?? 'Engagement'}
      badge={detail ? statusLabel(detail.status) : undefined}
      badgeTone={detail ? STATUS_TONE[detail.status] ?? 'neutral' : undefined}
      onClose={onClose}
      wide
    >
      {loading || !detail ? (
        <p>Loading...</p>
      ) : (
        <>
          <div className="statband">
            <div className="stat">
              <span className="stat-label">Client</span>
              <span className="stat-value">{detail.clientName}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Started</span>
              <span className="stat-value">{day(detail.startedOn)}</span>
            </div>
            <div className="statgroup">
              <span className="statgroup-title">Meetings</span>
              <div className="statgroup-items">
                <span>
                  <b>{held}</b>
                  <small>Held</small>
                </span>
                <span>
                  <b>{upcoming}</b>
                  <small>Upcoming</small>
                </span>
                <span>
                  <b>{hours(detail.recordedMinutes)}</b>
                  <small>Time recorded</small>
                </span>
              </div>
            </div>
            {detail.billing && (
              <div className="statgroup">
                <span className="statgroup-title">Billing</span>
                <div className="statgroup-items">
                  <span>
                    <b>{money(detail.billing.chargedCents)}</b>
                    <small>Charged</small>
                  </span>
                  <span>
                    <b>{money(detail.billing.invoicedCents)}</b>
                    <small>Invoiced</small>
                  </span>
                  <span>
                    <b>{money(detail.billing.unbilledCents)}</b>
                    <small>Unbilled</small>
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? 'tab tab-on' : 'tab'}
                onClick={() => setTab(t)}
              >
                {TAB_LABELS[t]}
                {counts[t] !== null && <span className="tab-count">{counts[t]}</span>}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <OverviewTab
              detail={detail}
              noted={noted}
              onError={onError}
              onSaved={(message) => {
                onToast(message);
                onChanged();
                reload();
              }}
            />
          )}

          {tab === 'meetings' &&
            (detail.meetings.length === 0 ? (
              <p className="empty">
                No meetings yet. The client books meetings for this engagement from their portal.
              </p>
            ) : (
              <div className="grid-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Length</th>
                      <th>Agenda</th>
                      <th>Time recorded</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.meetings.map((m) => (
                      <tr key={m.id} className="clickable" onClick={() => onOpenMeeting(m.id)}>
                        <td className="nowrap">{formatRange(m.startsAt, m.endsAt)}</td>
                        <td className="nowrap">{formatLength(m.durationMinutes)}</td>
                        <td>
                          {m.notedCount}/{m.topicCount} noted
                        </td>
                        <td className="nowrap">{hours(m.recordedMinutes)}</td>
                        <td>
                          <span className={`status status-ap-${m.status}`}>{statusLabel(m.status)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

          {tab === 'agenda' && <AgendaTab lines={detail.agenda} onOpenMeeting={onOpenMeeting} />}

          {tab === 'media' &&
            (detail.media.length === 0 ? (
              <p className="empty">
                Nothing has been shared in this engagement&rsquo;s meetings yet. Templates, videos
                and screenshots put on screen during a call are collected here.
              </p>
            ) : (
              <div className="grid-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Type</th>
                      <th>Shared by</th>
                      <th>Meeting</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {detail.media.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.title}</strong>
                        </td>
                        <td>{s.kind === 'pdf' ? 'PDF' : s.kind === 'video' ? 'Video' : 'Image'}</td>
                        <td>{s.sharedByName}</td>
                        <td className="nowrap">
                          <button className="linklike" onClick={() => onOpenMeeting(s.appointmentId)}>
                            {day(s.meetingAt)}
                          </button>
                        </td>
                        <td>
                          <a className="linklike" href={s.url} target="_blank" rel="noreferrer">
                            Open
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

          {tab === 'team' && (
            <PeopleList
              scope={{ kind: 'engagement', id: engagementId }}
              people={detail.team}
              clientName={detail.clientName}
              onError={onError}
              onChange={(team) => setDetail((d) => (d ? { ...d, team } : d))}
            />
          )}

          {tab === 'billing' && detail.billing && (
            <BillingTab
              detail={detail}
              onError={onError}
              onOpenMeeting={onOpenMeeting}
              onOpenInvoice={onOpenInvoice}
              onInvoiced={(number) => {
                onToast(`Invoice ${number} created`);
                onChanged();
                reload();
              }}
            />
          )}
        </>
      )}
    </Modal>
  );
}

function OverviewTab({
  detail,
  noted,
  onSaved,
  onError,
}: {
  detail: EngagementDetail;
  noted: number;
  onSaved: (message: string) => void;
  onError: OnError;
}) {
  const [title, setTitle] = useState(detail.title);
  const [goal, setGoal] = useState(detail.goal ?? '');
  const [status, setStatus] = useState(detail.status);
  const [busy, setBusy] = useState(false);

  const dirty = title !== detail.title || goal !== (detail.goal ?? '') || status !== detail.status;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateEngagement(detail.id, { title: title.trim(), status, goal: goal.trim() || null });
      onSaved(`Saved “${title.trim()}”`);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  const discussed = detail.agenda.filter((a) => a.status === 'discussed').length;
  const open = detail.agenda.filter((a) => a.status === 'proposed' || a.status === 'scheduled').length;

  return (
    <form onSubmit={save} className="stack-form engagement-overview">
      <label>
        Goal
        <textarea
          rows={3}
          value={goal}
          placeholder="The need this engagement exists to meet, in a sentence or two. Its meetings work towards this."
          onChange={(e) => setGoal(e.target.value)}
        />
      </label>
      <div className="field-row">
        <label>
          Title
          <input value={title} required onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="inquiry">Inquiry</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="closed">Closed</option>
          </select>
        </label>
      </div>
      <div className="button-row">
        <button className="btn btn-primary" type="submit" disabled={!dirty || busy}>
          {busy ? 'Saving...' : 'Save changes'}
        </button>
      </div>

      <dl className="detail-list">
        <dt>Topics discussed</dt>
        <dd>{discussed}</dd>
        <dt>Topics still open</dt>
        <dd>{open}</dd>
        <dt>Notes taken</dt>
        <dd>{noted}</dd>
        <dt>Items shared</dt>
        <dd>{detail.media.length}</dd>
        <dt>People</dt>
        <dd>
          {detail.team.filter((p) => p.side === 'team').length} from Data Painters,{' '}
          {detail.team.filter((p) => p.side === 'client').length} from {detail.clientName}
        </dd>
      </dl>
    </form>
  );
}

function AgendaTab({
  lines,
  onOpenMeeting,
}: {
  lines: EngagementAgendaLine[];
  onOpenMeeting: (appointmentId: number) => void;
}) {
  if (lines.length === 0) {
    return (
      <p className="empty">
        No topics yet. The client adds what they want covered from their portal, and each topic is
        put on a meeting&rsquo;s agenda when the meeting is booked.
      </p>
    );
  }

  // Lines arrive ordered: unscheduled first, then by meeting, newest first.
  const groups: { key: string; appointmentId: number | null; meetingAt: string | null; lines: EngagementAgendaLine[] }[] = [];
  for (const line of lines) {
    const key = line.appointmentId === null ? 'waiting' : String(line.appointmentId);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.lines.push(line);
    else groups.push({ key, appointmentId: line.appointmentId, meetingAt: line.meetingAt, lines: [line] });
  }

  return (
    <div className="engagement-agenda">
      {groups.map((g) => (
        <section key={g.key}>
          <h4 className="people-side-title">
            {g.appointmentId === null ? (
              'Waiting for a meeting'
            ) : (
              <button className="linklike" onClick={() => onOpenMeeting(g.appointmentId!)}>
                Meeting on {g.meetingAt ? day(g.meetingAt) : 'an unknown date'}
              </button>
            )}
            <span className="tab-count">{g.lines.length}</span>
          </h4>
          <div className="notes-list">
            {g.lines.map((l) => (
              <article key={l.topicId} className="note-entry">
                <header>
                  <strong>{l.title}</strong>
                  <span className={`status status-${l.status}`}>{l.status}</span>
                </header>
                {l.desiredOutcome && (
                  <p className="topic-outcome">
                    <strong>Wanted:</strong> {l.desiredOutcome}
                  </p>
                )}
                {l.note ? <p>{l.note}</p> : <p className="muted">No notes recorded.</p>}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function BillingTab({
  detail,
  onInvoiced,
  onOpenMeeting,
  onOpenInvoice,
  onError,
}: {
  detail: EngagementDetail;
  onInvoiced: (invoiceNumber: string) => void;
  onOpenMeeting: (appointmentId: number) => void;
  onOpenInvoice: (invoiceId: number) => void;
  onError: OnError;
}) {
  const b = detail.billing!;
  const [busy, setBusy] = useState(false);

  async function invoice() {
    if (
      !window.confirm(
        `Create an invoice to ${detail.clientName} for ${money(b.unbilledCents)} of unbilled work on this engagement?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      onInvoiced((await invoiceEngagement(detail.id)).number);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="tool-toolbar">
        <button onClick={invoice} disabled={busy || b.unbilledCents <= 0}>
          {busy ? 'Creating...' : `Invoice unbilled work (${money(b.unbilledCents)})`}
        </button>
      </div>
      <p className="hint">
        Time is recorded per meeting and becomes a charge when the meeting is marked complete, in
        30-minute blocks. {hours(detail.recordedMinutes)} recorded so far; {hours(b.billedMinutes)}{' '}
        of it charged.
      </p>
      {b.charges.length === 0 ? (
        <p className="empty">No charges yet. Complete a meeting to compile its time into a charge.</p>
      ) : (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Time</th>
                <th className="num">Amount</th>
                <th>Invoice</th>
              </tr>
            </thead>
            <tbody>
              {b.charges.map((c) => (
                <tr
                  key={c.id}
                  className={c.appointmentId ? 'clickable' : undefined}
                  onClick={c.appointmentId ? () => onOpenMeeting(c.appointmentId!) : undefined}
                >
                  <td className="nowrap">{day(c.serviceDate)}</td>
                  <td>{c.description}</td>
                  <td className="nowrap">{c.minutes ? hours(c.minutes) : <span className="muted">&mdash;</span>}</td>
                  <td className="num">
                    <strong>{money(c.amountCents)}</strong>
                  </td>
                  <td>
                    {c.invoiceId ? (
                      <button
                        className="linklike"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenInvoice(c.invoiceId!);
                        }}
                      >
                        {c.invoiceNumber}
                      </button>
                    ) : (
                      <span className="pill pill-warn">Unbilled</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------- team */

const ROLE_HELP: Record<TeamRole, string> = {
  admin: 'Everything, including team members and system options.',
  billing: 'Invoices, payments and financial reports, plus clients, engagements and meetings.',
  relations: 'Clients, engagements, meetings and client portal logins. No billing.',
  engineer: 'Engagements and meetings: agenda, notes, time and media. No billing.',
};

const ROLE_ORDER: TeamRole[] = ['admin', 'billing', 'relations', 'engineer'];

function MemberForm({
  existing,
  isSelf,
  onDone,
  onCancel,
  onError,
}: {
  existing?: TeamMember;
  isSelf: boolean;
  onDone: (result: { created?: CreatedUser; name: string }) => void;
  onCancel: () => void;
  onError: OnError;
}) {
  const [firstName, setFirstName] = useState(existing?.firstName ?? '');
  const [lastName, setLastName] = useState(existing?.lastName ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [teamRole, setTeamRole] = useState<TeamRole>(existing?.teamRole ?? 'engineer');
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const name = `${firstName.trim()} ${lastName.trim()}`.trim();
    try {
      if (existing) {
        await updateTeamMember(existing.id, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || undefined,
          teamRole,
          enabled,
        });
        onDone({ name });
      } else {
        const created = await inviteTeamMember({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          teamRole,
        });
        onDone({ created, name });
      }
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={existing ? 'Edit team member' : 'Invite a team member'} onClose={onCancel}>
      <form onSubmit={submit} className="stack-form">
        <div className="field-row">
          <label>
            First name
            <input value={firstName} required autoFocus onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label>
            Last name
            <input value={lastName} required onChange={(e) => setLastName(e.target.value)} />
          </label>
        </div>
        <div className="field-row">
          <label>
            Email address
            <input
              type="email"
              value={email}
              required
              disabled={Boolean(existing)}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Phone
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>
        <fieldset className="role-picker" disabled={isSelf}>
          <legend>Role</legend>
          {ROLE_ORDER.map((r) => (
            <label key={r} className={teamRole === r ? 'role-option on' : 'role-option'}>
              <input type="radio" name="teamRole" checked={teamRole === r} onChange={() => setTeamRole(r)} />
              <span>
                <strong>{TEAM_ROLE_LABELS[r]}</strong>
                <small>{ROLE_HELP[r]}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {existing && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={enabled}
              disabled={isSelf}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Account is active. Turn this off to lock them out straight away.
          </label>
        )}
        {isSelf && (
          <p className="hint">
            You cannot change your own role or disable your own account. Another administrator can.
          </p>
        )}
        {!existing && (
          <p className="hint">
            They are emailed a single-use link to set their own password. The link is also shown
            here so you can pass it on yourself.
          </p>
        )}
        <div className="button-row">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving...' : existing ? 'Save changes' : 'Send invitation'}
          </button>
          <button type="button" className="linklike" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function TeamAdmin({
  me,
  onError,
  onIssued,
  onToast,
}: {
  me: User | null;
  onError: OnError;
  onIssued: (created: CreatedUser) => void;
  onToast: (message: string) => void;
}) {
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [editing, setEditing] = useState<TeamMember | 'new' | null>(null);

  const reload = useCallback(() => listTeam().then(setTeam).catch(onError), [onError]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <section>
      <div className="tool-toolbar">
        <button onClick={() => setEditing('new')}>Invite a team member</button>
      </div>

      {!team ? (
        <p className="empty">Loading...</p>
      ) : (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last sign-in</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.id} className="clickable" onClick={() => setEditing(m)}>
                  <td>
                    <strong>{m.displayName}</strong>
                    {m.id === me?.id && <span className="muted"> (you)</span>}
                  </td>
                  <td>{m.email}</td>
                  <td>{TEAM_ROLE_LABELS[m.teamRole]}</td>
                  <td>
                    {!m.enabled ? (
                      <span className="pill pill-bad">Disabled</span>
                    ) : m.invitePending ? (
                      <span className="pill pill-warn">Invited</span>
                    ) : (
                      <span className="pill pill-good">Active</span>
                    )}
                  </td>
                  <td className="nowrap">
                    {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString() : 'never'}
                  </td>
                  <td className="nowrap">
                    {m.enabled && m.id !== me?.id && (
                      <button
                        className="linklike"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            onIssued(await resendInvite(m.id));
                          } catch (err) {
                            onError(err);
                          }
                        }}
                      >
                        {m.invitePending ? 'Resend invite' : 'Send reset link'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="role-key">
        {ROLE_ORDER.map((r) => (
          <p key={r}>
            <strong>{TEAM_ROLE_LABELS[r]}</strong>
            <span>{ROLE_HELP[r]}</span>
          </p>
        ))}
      </div>

      {editing && (
        <MemberForm
          existing={editing === 'new' ? undefined : editing}
          isSelf={editing !== 'new' && editing.id === me?.id}
          onCancel={() => setEditing(null)}
          onError={onError}
          onDone={({ created, name }) => {
            if (created) onIssued(created);
            onToast(created ? `Invitation sent to ${name}` : `Saved ${name}`);
            setEditing(null);
            reload();
          }}
        />
      )}
    </section>
  );
}
