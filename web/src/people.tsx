/**
 * The list of people on an engagement (its Team tab) or in a meeting (its
 * Users tab). One component for both, because they are the same idea at two
 * sizes: people from Data Painters and people from the client, each with the
 * part they play.
 *
 * A meeting adds two switches per person -- whether they are on the call and
 * whether they are sent the write-up afterwards -- because those are
 * separate questions: a sponsor often wants the summary without attending.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  addEngagementTeamToMeeting,
  addPerson,
  listPeopleCandidates,
  PERSON_ROLES,
  personRoleLabel,
  removePerson,
  updatePerson,
  type Person,
  type PersonCandidate,
  type PersonSide,
} from './api';

type Scope = { kind: 'engagement' | 'meeting'; id: number };

const SIDE_TITLE: Record<PersonSide, string> = {
  team: 'Data Painters',
  client: 'Client',
};

export function PeopleList({
  scope,
  people,
  clientName,
  onChange,
  onError,
}: {
  scope: Scope;
  people: Person[];
  clientName: string;
  onChange: (next: Person[]) => void;
  onError: (e: unknown) => void;
}) {
  const isMeeting = scope.kind === 'meeting';
  const [candidates, setCandidates] = useState<PersonCandidate[]>([]);
  const [adding, setAdding] = useState(false);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listPeopleCandidates(scope).then(setCandidates).catch(onError);
    // The scope object is rebuilt each render; its two fields are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.kind, scope.id, onError]);

  const available = useMemo(
    () => candidates.filter((c) => !people.some((p) => p.userId === c.userId)),
    [candidates, people],
  );
  const picked = available.find((c) => String(c.userId) === userId);

  const run = useCallback(
    async (work: () => Promise<Person[]>) => {
      setBusy(true);
      try {
        onChange(await work());
      } catch (err) {
        onError(err);
      } finally {
        setBusy(false);
      }
    },
    [onChange, onError],
  );

  function pick(id: string) {
    setUserId(id);
    const c = available.find((x) => String(x.userId) === id);
    // Start from the role that matches what the person's account is for.
    setRole(
      !c
        ? ''
        : c.side === 'client'
          ? 'stakeholder'
          : c.teamRole === 'billing'
            ? 'billing'
            : c.teamRole === 'relations'
              ? 'account_manager'
              : 'engineer',
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!picked || !role) return;
    await run(() => addPerson(scope, { userId: picked.userId, role }));
    setUserId('');
    setRole('');
    setAdding(false);
  }

  const sides: PersonSide[] = ['team', 'client'];

  return (
    <div className="people">
      <div className="tool-toolbar">
        <button onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel' : 'Add person'}</button>
        {isMeeting && (
          <button disabled={busy} onClick={() => run(() => addEngagementTeamToMeeting(scope.id))}>
            Add the engagement team
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={submit} className="stack-form inset">
          <div className="field-row">
            <label>
              Person
              <select value={userId} required autoFocus onChange={(e) => pick(e.target.value)}>
                <option value="">Select...</option>
                {sides.map((side) => {
                  const options = available.filter((c) => c.side === side);
                  return options.length === 0 ? null : (
                    <optgroup key={side} label={side === 'team' ? 'Data Painters' : clientName}>
                      {options.map((c) => (
                        <option key={c.userId} value={c.userId}>
                          {c.name} ({c.email})
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </label>
            <label>
              Role
              <select value={role} required disabled={!picked} onChange={(e) => setRole(e.target.value)}>
                {!picked && <option value="">Pick a person first</option>}
                {picked &&
                  PERSON_ROLES[picked.side].map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {available.length === 0 && (
            <p className="hint">
              Everyone who can be added is already here. To add someone new from {clientName}, give
              them a portal login from the client&rsquo;s Users tab first.
            </p>
          )}
          <div className="button-row">
            <button className="btn btn-primary" type="submit" disabled={busy || !picked}>
              Add person
            </button>
          </div>
        </form>
      )}

      {people.length === 0 ? (
        <p className="empty">
          {isMeeting
            ? 'Nobody is listed for this meeting yet. Add the engagement team, or add people one at a time.'
            : 'Nobody is on this engagement yet. Add the Data Painters people working on it and the client contacts involved.'}
        </p>
      ) : (
        sides.map((side) => {
          const rows = people.filter((p) => p.side === side);
          if (rows.length === 0) return null;
          return (
            <section key={side} className="people-side">
              <h4 className="people-side-title">
                {side === 'team' ? SIDE_TITLE.team : clientName}
                <span className="tab-count">{rows.length}</span>
              </h4>
              <div className="grid-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      {isMeeting && <th>On the call</th>}
                      {isMeeting && <th>Sent the summary</th>}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id} className={p.enabled ? undefined : 'row-bad'}>
                        <td>
                          <strong>{p.name}</strong>
                          {!p.enabled && <span className="muted"> (account disabled)</span>}
                        </td>
                        <td>{p.email}</td>
                        <td>
                          <select
                            className="inline-select"
                            aria-label={`Role for ${p.name}`}
                            value={p.role}
                            disabled={busy}
                            onChange={(e) =>
                              run(() =>
                                updatePerson(scope, p.id, {
                                  role: e.target.value,
                                  attending: p.attending,
                                  sendSummary: p.sendSummary,
                                }),
                              )
                            }
                          >
                            {PERSON_ROLES[p.side].map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                            {!PERSON_ROLES[p.side].some((r) => r.value === p.role) && (
                              <option value={p.role}>{personRoleLabel(p.role)}</option>
                            )}
                          </select>
                        </td>
                        {isMeeting && (
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`${p.name} is on the call`}
                              checked={p.attending}
                              disabled={busy}
                              onChange={(e) =>
                                run(() =>
                                  updatePerson(scope, p.id, {
                                    role: p.role,
                                    attending: e.target.checked,
                                    sendSummary: p.sendSummary,
                                  }),
                                )
                              }
                            />
                          </td>
                        )}
                        {isMeeting && (
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`${p.name} is sent the summary`}
                              checked={p.sendSummary}
                              disabled={busy}
                              onChange={(e) =>
                                run(() =>
                                  updatePerson(scope, p.id, {
                                    role: p.role,
                                    attending: p.attending,
                                    sendSummary: e.target.checked,
                                  }),
                                )
                              }
                            />
                          </td>
                        )}
                        <td>
                          <button
                            className="linklike"
                            disabled={busy}
                            onClick={() => run(() => removePerson(scope, p.id))}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}

      {isMeeting && people.length > 0 && (
        <p className="hint">
          People marked &ldquo;Sent the summary&rdquo; are emailed the agenda, the notes and the
          time recorded when the meeting is marked complete.
        </p>
      )}
    </div>
  );
}
