/**
 * The parts of the client portal that are about the client's own
 * organisation: its engagements and who is on each, and the people who have
 * a login on its account.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Paged } from './datagrid';
import {
  addClientTeamMember,
  addEngagementTeamMember,
  COMMUNICATION_LABELS,
  getClientTeam,
  listEngagementTeam,
  openEngagement,
  PERSON_ROLES,
  personRoleLabel,
  reinviteClientTeamMember,
  removeEngagementTeamMember,
  updateClientTeamMember,
  type ClientTeam,
  type ClientTeamMember,
  type Communication,
  type Engagement,
  type Person,
} from './api';
import { Modal } from './admin-meetings';
import { CLIENT_ROLE_LABELS, type ClientRole, type User } from './auth';

type OnError = (e: unknown) => void;

function day(iso: string): string {
  const value = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00` : iso;
  return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const COMMUNICATION_HELP: Record<Communication, string> = {
  both: 'Post on topics and get written answers, and book video meetings when a call is better.',
  message: 'Work through topics in writing. No meetings to schedule.',
  video: 'Work through topics on scheduled video calls.',
};

/* ------------------------------------------------------------- engagements */

export function NewEngagementModal({
  onDone,
  onCancel,
  onError,
}: {
  onDone: (created: Engagement) => void;
  onCancel: () => void;
  onError: OnError;
}) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [communication, setCommunication] = useState<Communication>('both');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onDone(await openEngagement({ title: title.trim(), goal: goal.trim() || undefined, communication }));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New engagement" onClose={onCancel}>
      <form className="stack-form" onSubmit={submit}>
        <label>
          What is it for?
          <input
            value={title}
            required
            autoFocus
            maxLength={200}
            placeholder="A short name, such as “Contract review” or “Data platform choice”"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Goal
          <textarea
            rows={3}
            value={goal}
            placeholder="What should be true when this is done?"
            onChange={(e) => setGoal(e.target.value)}
          />
        </label>
        <fieldset className="role-picker">
          <legend>How would you like to work?</legend>
          {(['both', 'message', 'video'] as Communication[]).map((c) => (
            <label key={c} className={communication === c ? 'role-option on' : 'role-option'}>
              <input type="radio" name="communication" checked={communication === c} onChange={() => setCommunication(c)} />
              <span>
                <strong>{COMMUNICATION_LABELS[c]}</strong>
                <small>{COMMUNICATION_HELP[c]}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="hint">
          Work on an engagement is billed hourly in 30-minute blocks, whether it is time in a meeting
          or time spent on a written answer.
        </p>
        <div className="button-row">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Opening…' : 'Open engagement'}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** One engagement's people, with add and remove for those allowed. */
function EngagementTeam({
  engagement,
  roster,
  onError,
}: {
  engagement: Engagement;
  /** Everyone on the client's account, to choose from. Null for an admin preview. */
  roster: ClientTeamMember[] | null;
  onError: OnError;
}) {
  const [team, setTeam] = useState<Person[] | null>(null);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('stakeholder');
  const [busy, setBusy] = useState(false);
  const canEdit = engagement.canManageTeam && engagement.status !== 'closed' && roster !== null;

  useEffect(() => {
    listEngagementTeam(engagement.id).then(setTeam).catch(onError);
  }, [engagement.id, onError]);

  async function run(work: () => Promise<Person[]>) {
    setBusy(true);
    try {
      setTeam(await work());
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!team) return <p className="muted">Loading…</p>;

  const available = (roster ?? []).filter((m) => m.enabled && !team.some((p) => p.userId === m.id));
  const ours = team.filter((p) => p.side === 'team');
  const theirs = team.filter((p) => p.side === 'client');

  return (
    <div className="eng-team">
      <div className="eng-team-cols">
        <div>
          <h4>Your team</h4>
          {theirs.length === 0 ? (
            <p className="muted">Nobody yet.</p>
          ) : (
            <ul>
              {theirs.map((p) => (
                <li key={p.id}>
                  <span>
                    <strong>{p.name}</strong>
                    <small className="muted"> {personRoleLabel(p.role)}</small>
                  </span>
                  {canEdit && (
                    <button
                      className="linklike danger"
                      disabled={busy}
                      onClick={() => run(() => removeEngagementTeamMember(engagement.id, p.id))}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4>DataPainters</h4>
          {ours.length === 0 ? (
            <p className="muted">We will assign your team shortly.</p>
          ) : (
            <ul>
              {ours.map((p) => (
                <li key={p.id}>
                  <span>
                    <strong>{p.name}</strong>
                    <small className="muted"> {personRoleLabel(p.role)}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {canEdit &&
        (available.length === 0 ? (
          <p className="hint">Everyone on your account is already on this engagement.</p>
        ) : (
          <form
            className="eng-team-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (!userId) return;
              run(() => addEngagementTeamMember(engagement.id, { userId: Number(userId), role })).then(() =>
                setUserId(''),
              );
            }}
          >
            <label>
              Add someone from your team
              <select value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Select…</option>
                {available.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Their part
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {PERSON_ROLES.client.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" type="submit" disabled={busy || !userId}>
              Add
            </button>
          </form>
        ))}
      <p className="hint">
        People on an engagement see all of its topics and conversations and are emailed when someone
        posts.
      </p>
    </div>
  );
}

export function EngagementsView({
  engagements,
  roster,
  canOpen,
  onNew,
  onOpenTopics,
  onError,
}: {
  engagements: Engagement[];
  roster: ClientTeamMember[] | null;
  /** Whether this person may open a new engagement. */
  canOpen: boolean;
  onNew: () => void;
  onOpenTopics: (engagementId: number) => void;
  onError: OnError;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (engagements.length === 0) {
    return (
      <div className="empty-state">
        <p>
          <strong>No engagements yet.</strong>
        </p>
        <p className="muted">
          An engagement is one piece of work with a goal. Its topics, meetings and messages are kept
          together under it.
        </p>
        {canOpen ? (
          <p>
            <button className="btn btn-primary" onClick={onNew}>
              New engagement
            </button>
          </p>
        ) : (
          <p className="muted">Your account&rsquo;s owner or a manager can open one.</p>
        )}
      </div>
    );
  }

  return (
<Paged rows={engagements}>{(pageRows) => (
    <div className="eng-list">
      {pageRows.map((e) => (
        <article key={e.id} className="eng-card">
          <header>
            <div>
              <h3>{e.title}</h3>
              <p className="muted">
                {COMMUNICATION_LABELS[e.communication]} &middot; started {day(e.startedOn)}
                {e.dueOn && <> &middot; target {day(e.dueOn)}</>}
              </p>
            </div>
            <span className={`status status-${e.status}`}>{e.status === 'inquiry' ? 'consultation' : e.status}</span>
          </header>
          {e.goal && (
            <p className="topic-outcome">
              <strong>Goal:</strong> {e.goal}
            </p>
          )}
          <footer>
            <button className="btn btn-sm" onClick={() => onOpenTopics(e.id)}>
              Topics
            </button>
            <button className="btn btn-sm" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
              {expanded === e.id ? 'Hide team' : 'Team'}
            </button>
          </footer>
          {expanded === e.id && <EngagementTeam engagement={e} roster={roster} onError={onError} />}
        </article>
      ))}
    </div>
)}</Paged>
  );
}

/* ------------------------------------------------------------ team members */

const ROLE_HELP: Record<ClientRole, string> = {
  owner: 'Manages the people on this account. There is one owner.',
  manager: 'Can open engagements and choose who is on them.',
  member: 'Takes part in the engagements they are added to.',
};

export function TeamMembersView({
  user,
  onLoaded,
  onError,
  onToast,
}: {
  user: User;
  /** Hands the roster up, so the Engagements view can offer people to add. */
  onLoaded: (members: ClientTeamMember[]) => void;
  onError: OnError;
  onToast: (message: string) => void;
}) {
  const [team, setTeam] = useState<ClientTeam | null>(null);
  const [adding, setAdding] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [clientRole, setClientRole] = useState<ClientRole>('member');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    () =>
      getClientTeam()
        .then((t) => {
          setTeam(t);
          onLoaded(t.members);
        })
        .catch(onError),
    [onError, onLoaded],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await addClientTeamMember({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        clientRole,
      });
      onToast(`Invitation sent to ${created.displayName}`);
      setFirstName('');
      setLastName('');
      setEmail('');
      setPhone('');
      setClientRole('member');
      setAdding(false);
      await reload();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function change(m: ClientTeamMember, next: { clientRole: ClientRole; enabled: boolean }) {
    setBusy(true);
    try {
      await updateClientTeamMember(m.id, next);
      await reload();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!team) return <p className="empty">Loading…</p>;

  return (
    <section>
      {team.canManage ? (
        <div className="tool-toolbar">
          <button onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel' : 'Add a team member'}</button>
        </div>
      ) : (
        <p className="hint">Your account&rsquo;s owner can add people and change roles.</p>
      )}

      {adding && (
        <form onSubmit={add} className="stack-form inset">
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
              <input type="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              Phone
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
          </div>
          <fieldset className="role-picker">
            <legend>Role</legend>
            {(['member', 'manager'] as ClientRole[]).map((r) => (
              <label key={r} className={clientRole === r ? 'role-option on' : 'role-option'}>
                <input type="radio" name="clientRole" checked={clientRole === r} onChange={() => setClientRole(r)} />
                <span>
                  <strong>{CLIENT_ROLE_LABELS[r]}</strong>
                  <small>{ROLE_HELP[r]}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="hint">They are emailed a single-use link to set their own password.</p>
          <div className="button-row">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send invitation'}
            </button>
          </div>
        </form>
      )}

      <Paged rows={team.members} size={15}>{(pageRows) => (
<div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              {team.canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((m) => {
              const self = m.id === user.id;
              const fixed = m.clientRole === 'owner' || self || !team.canManage;
              return (
                <tr key={m.id} className={m.enabled ? undefined : 'row-bad'}>
                  <td>
                    <strong>{m.displayName}</strong>
                    {self && <span className="muted"> (you)</span>}
                  </td>
                  <td>{m.email}</td>
                  <td>
                    {fixed ? (
                      CLIENT_ROLE_LABELS[m.clientRole]
                    ) : (
                      <select
                        className="inline-select"
                        aria-label={`Role for ${m.displayName}`}
                        value={m.clientRole}
                        disabled={busy}
                        onChange={(e) => change(m, { clientRole: e.target.value as ClientRole, enabled: m.enabled })}
                      >
                        <option value="member">Member</option>
                        <option value="manager">Manager</option>
                      </select>
                    )}
                  </td>
                  <td>
                    {!m.enabled ? (
                      <span className="pill pill-bad">Disabled</span>
                    ) : m.invitePending ? (
                      <span className="pill pill-warn">Invited</span>
                    ) : (
                      <span className="pill pill-good">Active</span>
                    )}
                  </td>
                  {team.canManage && (
                    <td className="nowrap">
                      {!fixed && m.enabled && (
                        <button
                          className="linklike"
                          disabled={busy}
                          onClick={async () => {
                            try {
                              await reinviteClientTeamMember(m.id);
                              onToast(`A new link was emailed to ${m.displayName}`);
                            } catch (err) {
                              onError(err);
                            }
                          }}
                        >
                          {m.invitePending ? 'Resend invite' : 'Send reset link'}
                        </button>
                      )}{' '}
                      {!fixed && (
                        <button
                          className="linklike"
                          disabled={busy}
                          onClick={() => change(m, { clientRole: m.clientRole, enabled: !m.enabled })}
                        >
                          {m.enabled ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
)}</Paged>

      <div className="role-key">
        {(['owner', 'manager', 'member'] as ClientRole[]).map((r) => (
          <p key={r}>
            <strong>{CLIENT_ROLE_LABELS[r]}</strong>
            <span>{ROLE_HELP[r]}</span>
          </p>
        ))}
      </div>
    </section>
  );
}
