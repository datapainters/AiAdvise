import type { GridColumn, GridPage } from './datagrid';

/**
 * API client.
 *
 * The base URL is injected at build time by the deploy workflow, which reads
 * it from the Terraform output. There is no runtime config lookup because the
 * bundle is static files on CloudFront -- changing the API URL means a
 * rebuild, which is the correct trade for a site this size.
 */
import { clearToken, getToken, setToken, type ClientRole, type TeamRole, type User } from './auth';

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

export interface Topic {
  id: number;
  engagementId: number;
  title: string;
  detail: string | null;
  /** What the client wants to be true once this has been discussed. */
  desiredOutcome: string | null;
  priority: number;
  status: 'proposed' | 'scheduled' | 'discussed' | 'dropped';
  /** The meeting this is an agenda item for, or null while in the backlog. */
  appointmentId: number | null;
  createdAt: string;
}

/** How an engagement is run: written threads, video meetings, or both. */
export type Communication = 'message' | 'video' | 'both';

export const COMMUNICATION_LABELS: Record<Communication, string> = {
  message: 'Messages',
  video: 'Video meetings',
  both: 'Messages and video',
};

export interface Engagement {
  id: number;
  title: string;
  status: string;
  startedOn: string;
  goal: string | null;
  dueOn: string | null;
  communication: Communication;
  /** Whether this person may change which of their people are on it. */
  canManageTeam: boolean;
}

/** Thrown when the server rejects our token, so callers can send us to login. */
export class Unauthorized extends Error {
  constructor() {
    super('Not signed in');
  }
}

/**
 * Turns a failed response into a sentence a person can act on. The API's
 * default error body is Spring's {timestamp, status, error, path}, which
 * says nothing useful to a user; a `message` or `detail`, when the server
 * sends one, wins over the generic wording.
 */
async function friendlyError(response: Response): Promise<string> {
  let detail = '';
  try {
    const body = await response.json();
    // `detail` is a ProblemDetail reason from the API. `error` is the API's
    // own {error} body -- but Spring's default body also has an `error`
    // (just "Conflict"), so only take it when there is no `status` beside it.
    detail = (
      body?.detail ||
      body?.message ||
      (typeof body?.status === 'undefined' ? body?.error : '') ||
      ''
    ).toString();
  } catch {
    // Not JSON; fall back to the status wording.
  }
  // Framework boilerplate says less than the status wording below.
  const generic = /^(No message available|Invalid request content\.?|Failed to (convert|read))/i;
  if (detail && !generic.test(detail)) return detail;

  switch (response.status) {
    case 400:
      return 'Some of the details were not accepted. Check the fields and try again.';
    case 404:
      return 'That record no longer exists. Refresh and try again.';
    case 409:
      return 'That conflicts with an existing record. Refresh and check before trying again.';
    case 413:
      return 'That is too large to save.';
    case 429:
      return 'Too many attempts. Wait a minute and try again.';
    default:
      return response.status >= 500
        ? 'Something went wrong on our side. Try again in a moment.'
        : `Request failed (${response.status}).`;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 401 || response.status === 403) {
    // A stale token is worse than none: drop it so the UI stops retrying.
    clearToken();
    throw new Unauthorized();
  }

  if (!response.ok) {
    throw new Error(await friendlyError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

interface LoginResponse {
  token: string;
  expiresAt: string;
  user: User;
}

export async function login(email: string, password: string): Promise<User> {
  // Deliberately not using request(): a failed login is a normal outcome, not
  // an expired session, and must not clear state or redirect.
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (response.status === 401) {
    throw new Error('Invalid email or password.');
  }
  if (!response.ok) {
    throw new Error(`Sign-in failed (${response.status}). Please try again.`);
  }

  const body = (await response.json()) as LoginResponse;
  setToken(body.token);
  return body.user;
}

export function me(): Promise<User> {
  return request<User>('/api/auth/me');
}

export function listEngagements(): Promise<Engagement[]> {
  return request<Engagement[]>('/api/engagements');
}

/** Opens an engagement from the client portal. */
export function openEngagement(input: {
  title: string;
  goal?: string;
  communication: Communication;
}): Promise<Engagement> {
  return request<Engagement>('/api/engagements', { method: 'POST', body: JSON.stringify(input) });
}

export function listEngagementTeam(engagementId: number): Promise<Person[]> {
  return request<Person[]>(`/api/engagements/${engagementId}/team`);
}

export function addEngagementTeamMember(
  engagementId: number,
  input: { userId: number; role: string },
): Promise<Person[]> {
  return request<Person[]>(`/api/engagements/${engagementId}/team`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function removeEngagementTeamMember(engagementId: number, memberId: number): Promise<Person[]> {
  return request<Person[]>(`/api/engagements/${engagementId}/team/${memberId}`, { method: 'DELETE' });
}

/* ------------------------------------------------ a client's own team members */

export interface ClientTeamMember {
  id: number;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  clientRole: ClientRole;
  enabled: boolean;
  invitePending: boolean;
  lastLoginAt: string | null;
}

export interface ClientTeam {
  /** True for the account owner, who is the only one who can change this list. */
  canManage: boolean;
  members: ClientTeamMember[];
}

export function getClientTeam(): Promise<ClientTeam> {
  return request<ClientTeam>('/api/team');
}

export function addClientTeamMember(input: {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  clientRole: ClientRole;
}): Promise<ClientTeamMember> {
  return request<ClientTeamMember>('/api/team', { method: 'POST', body: JSON.stringify(input) });
}

export function updateClientTeamMember(
  id: number,
  input: { clientRole: ClientRole; enabled: boolean },
): Promise<ClientTeamMember> {
  return request<ClientTeamMember>(`/api/team/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function reinviteClientTeamMember(id: number): Promise<ClientTeamMember> {
  return request<ClientTeamMember>(`/api/team/${id}/invite`, { method: 'POST' });
}

/* ------------------------------------------------------------ topic threads */

export interface ThreadSummary {
  topicId: number;
  title: string;
  status: string;
  engagementId: number;
  engagementTitle: string;
  clientId: number;
  clientName: string;
  raisedBy: string | null;
  messageCount: number;
  lastActivityAt: string;
  lastAuthor: string | null;
  lastSide: 'team' | 'client' | null;
  lastSnippet: string | null;
  /** False once the engagement is closed or no longer takes messages. */
  open: boolean;
}

export interface ThreadAttachment {
  title: string;
  kind: 'image' | 'pdf' | 'video';
  url: string;
}

export interface ThreadMessage {
  id: number;
  authorName: string;
  side: 'team' | 'client';
  body: string;
  createdAt: string;
  /** Time the reply took. Only ever present for Data Painters readers. */
  minutes: number | null;
  charged: boolean;
  attachments: ThreadAttachment[];
}

export interface Thread {
  topicId: number;
  title: string;
  detail: string | null;
  desiredOutcome: string | null;
  status: string;
  engagementId: number;
  engagementTitle: string;
  communication: Communication;
  clientId: number;
  clientName: string;
  raisedBy: string | null;
  raisedAt: string;
  canPost: boolean;
  /** Why nobody can post, when canPost is false. */
  closedReason: string | null;
  messages: ThreadMessage[];
}

export function listThreads(scope: { engagementId?: number; clientId?: number } = {}): Promise<ThreadSummary[]> {
  const q = new URLSearchParams();
  if (scope.engagementId) q.set('engagementId', String(scope.engagementId));
  if (scope.clientId) q.set('clientId', String(scope.clientId));
  const qs = q.toString();
  return request<ThreadSummary[]>(`/api/threads${qs ? `?${qs}` : ''}`);
}

export function getThread(topicId: number): Promise<Thread> {
  return request<Thread>(`/api/threads/${topicId}`);
}

export function postThreadMessage(
  topicId: number,
  input: { body: string; minutes?: number; mediaItemIds?: number[] },
): Promise<Thread> {
  return request<Thread>(`/api/threads/${topicId}/messages`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listTopics(engagementId: number): Promise<Topic[]> {
  return request<Topic[]>(`/api/topics?engagementId=${engagementId}`);
}

export function createTopic(input: {
  engagementId: number;
  title: string;
  detail?: string;
  desiredOutcome?: string;
  priority?: number;
}): Promise<Topic> {
  return request<Topic>('/api/topics', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateTopicStatus(id: number, status: Topic['status']): Promise<Topic> {
  return request<Topic>(`/api/topics/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

/**
 * Changes the signed-in user's password and swaps in the token that comes
 * back. The old token may carry only PASSWORD_RESET, so storing the new one is
 * what actually unlocks the rest of the portal.
 *
 * Like login(), this bypasses request(): a wrong current password is a 401
 * that must not clear the session and bounce the user to the sign-in page --
 * they are already signed in, they just mistyped.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<User> {
  const token = getToken();

  const response = await fetch(`${BASE_URL}/api/auth/password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });

  if (response.status === 401) {
    throw new Error('Current password is not correct.');
  }
  if (response.status === 400) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'That password was rejected.');
  }
  if (!response.ok) {
    throw new Error(`Could not change password (${response.status}).`);
  }

  const body = (await response.json()) as LoginResponse;
  setToken(body.token);
  return body.user;
}

/* ------------------------------------------------------------------ admin */

export interface Client {
  id: number;
  name: string;
  primaryEmail: string;
  createdAt: string;
}

export interface AdminUser {
  id: number;
  clientId: number | null;
  email: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  /** The contact's employer, which is not necessarily the client. */
  companyName: string | null;
  role: 'CLIENT' | 'ADMIN';
  enabled: boolean;
  lastLoginAt: string | null;
}

export interface CreatedUser {
  user: AdminUser;
  /**
   * Single-use link, shown once. Still surfaced to the admin rather than
   * only emailed, because SES is sandboxed and mail goes missing.
   */
  inviteUrl: string;
  inviteExpiresAt: string;
  /** Whether the invitation actually reached the mail provider. */
  emailed: boolean;
}

/** An engagement as the admin screens see it: carries its owning client. */
export interface AdminEngagement {
  id: number;
  clientId: number;
  title: string;
  status: string;
  startedOn: string;
  /** The need this engagement exists to meet. */
  goal: string | null;
  /** When it is meant to reach that goal; null if open-ended. */
  dueOn: string | null;
  communication: Communication;
}

export interface LoginEvent {
  id: number;
  /** Null when the attempt matched no account. */
  userId: number | null;
  emailTried: string;
  outcome: 'success' | 'failure' | 'password_change';
  ipAddress: string | null;
  userAgent: string | null;
  at: string;
}

export function listLoginEvents(limit = 100): Promise<LoginEvent[]> {
  return request<LoginEvent[]>(`/api/admin/login-events?limit=${limit}`);
}

export function listClients(query = ''): Promise<GridPage<Client>> {
  return request<GridPage<Client>>(`/api/admin/clients${query ? `?${query}` : ''}`);
}

export function clientColumns(): Promise<GridColumn[]> {
  return request<GridColumn[]>('/api/admin/clients/columns');
}

export function updateClient(
  id: number,
  input: { name: string; primaryEmail: string },
): Promise<Client> {
  return request<Client>(`/api/admin/clients/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function createClient(input: { name: string; primaryEmail: string }): Promise<Client> {
  return request<Client>('/api/admin/clients', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createEngagement(input: {
  clientId: number;
  title: string;
  goal?: string;
  startedOn?: string;
  dueOn?: string | null;
  communication?: Communication;
}): Promise<AdminEngagement> {
  return request<AdminEngagement>('/api/admin/engagements', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listAllEngagements(query = ''): Promise<GridPage<AdminEngagement>> {
  return request<GridPage<AdminEngagement>>(
    `/api/admin/engagements${query ? `?${query}` : ''}`,
  );
}

export function engagementColumns(): Promise<GridColumn[]> {
  return request<GridColumn[]>('/api/admin/engagements/columns');
}

export function updateEngagement(
  id: number,
  input: {
    title: string;
    status: string;
    goal?: string | null;
    startedOn?: string;
    /** Sent on every save: null clears the target date. */
    dueOn: string | null;
    communication?: Communication;
  },
): Promise<AdminEngagement> {
  return request<AdminEngagement>(`/api/admin/engagements/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function listUsers(): Promise<AdminUser[]> {
  return request<AdminUser[]>('/api/admin/users');
}

export function createUser(input: {
  clientId: number;
  firstName: string;
  lastName: string;
  email: string;
  companyName?: string;
  phone?: string;
}): Promise<CreatedUser> {
  return request<CreatedUser>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/* ------------------------------------------------------- scheduling (portal) */

export interface Appointment {
  id: number;
  clientId: number;
  engagementId: number;
  engagementTitle: string;
  /** ISO instant. */
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: 'requested' | 'confirmed' | 'completed' | 'cancelled';
  topicCount: number;
  /** True once the meeting has a Daily video room. */
  video: boolean;
}

export function listAppointments(): Promise<Appointment[]> {
  return request<Appointment[]>('/api/appointments');
}

export function bookAppointment(input: {
  engagementId: number;
  startsAt: string;
  durationMinutes: number;
  topicIds: number[];
}): Promise<Appointment> {
  return request<Appointment>('/api/appointments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function cancelAppointment(id: number): Promise<Appointment> {
  return request<Appointment>(`/api/appointments/${id}/cancel`, { method: 'POST' });
}

/* ------------------------------------------------- appointments (admin side) */

export interface AdminAppointment extends Appointment {
  clientName: string;
  /** Set on meetings the firm created; client-booked meetings have none. */
  title: string | null;
  /** How many agenda items already have a note written against them. */
  notedCount: number;
}

export interface AgendaItem {
  topicId: number;
  title: string;
  detail: string | null;
  desiredOutcome: string | null;
  priority: number;
  status: string;
  note: string | null;
  noteUpdatedAt: string | null;
}

export interface MeetingDetail {
  appointment: AdminAppointment;
  agenda: AgendaItem[];
}

export function listAdminAppointments(query = ''): Promise<GridPage<AdminAppointment>> {
  return request<GridPage<AdminAppointment>>(
    `/api/admin/appointments${query ? `?${query}` : ''}`,
  );
}

export function appointmentColumns(): Promise<GridColumn[]> {
  return request<GridColumn[]>('/api/admin/appointments/columns');
}

export function updateAppointment(
  id: number,
  input: { startsAt: string; durationMinutes: number; status: string; title?: string },
): Promise<AdminAppointment> {
  return request<AdminAppointment>(`/api/admin/appointments/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/** A meeting the firm sets up itself, on a chosen engagement. */
export function createAdminAppointment(input: {
  engagementId: number;
  title: string;
  startsAt: string;
  durationMinutes: number;
  status: 'requested' | 'confirmed';
  billable: boolean;
}): Promise<AdminAppointment> {
  return request<AdminAppointment>('/api/admin/appointments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function addAgendaItem(
  appointmentId: number,
  input: { title: string; desiredOutcome?: string },
): Promise<AgendaItem> {
  return request<AgendaItem>(`/api/admin/appointments/${appointmentId}/topics`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listCompanies(): Promise<string[]> {
  return request<string[]>('/api/admin/companies');
}

export function getMeeting(id: number): Promise<MeetingDetail> {
  return request<MeetingDetail>(`/api/admin/appointments/${id}`);
}

export function saveMeetingNote(
  appointmentId: number,
  topicId: number,
  body: string,
): Promise<AgendaItem> {
  return request<AgendaItem>(
    `/api/admin/appointments/${appointmentId}/topics/${topicId}/note`,
    { method: 'PUT', body: JSON.stringify({ body }) },
  );
}

export function setAgendaItemStatus(
  appointmentId: number,
  topicId: number,
  status: string,
): Promise<AgendaItem> {
  return request<AgendaItem>(
    `/api/admin/appointments/${appointmentId}/topics/${topicId}/status`,
    { method: 'PUT', body: JSON.stringify({ status }) },
  );
}

export function setAppointmentStatus(
  id: number,
  status: string,
): Promise<AdminAppointment> {
  return request<AdminAppointment>(`/api/admin/appointments/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

/* ------------------------------------------------------------ client detail */

export interface ClientUser {
  id: number;
  email: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  companyName: string | null;
  role: string;
  enabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

export interface ClientEngagement {
  id: number;
  title: string;
  status: string;
  startedOn: string;
  openTopics: number;
}

export interface ClientNote {
  appointmentId: number;
  meetingAt: string;
  topicTitle: string;
  body: string;
  updatedAt: string;
}

export interface ClientDetail {
  id: number;
  name: string;
  primaryEmail: string;
  createdAt: string;
  engagements: ClientEngagement[];
  appointments: AdminAppointment[];
  users: ClientUser[];
  notes: ClientNote[];
}

export function getClientDetail(id: number): Promise<ClientDetail> {
  return request<ClientDetail>(`/api/admin/clients/${id}`);
}

/** Issues a fresh invite, superseding any link the user already holds. */
export function resendInvite(userId: number): Promise<CreatedUser> {
  return request<CreatedUser>(`/api/admin/users/${userId}/invite`, { method: 'POST' });
}

/* ---------------------------------------------------------------- invites */

export interface InviteView {
  email: string;
  displayName: string;
  clientName: string | null;
}

/**
 * Both invite calls bypass request(): they are the one pair of endpoints
 * used by someone with no session at all, so attaching a stale token or
 * clearing one on 401 would both be wrong.
 */
export async function peekInvite(token: string): Promise<InviteView> {
  const response = await fetch(`${BASE_URL}/api/invites/${encodeURIComponent(token)}`);
  if (response.status === 404) {
    throw new Error('That invitation link is not valid. It may have expired or already been used.');
  }
  if (!response.ok) {
    throw new Error(`Could not load the invitation (${response.status}).`);
  }
  return (await response.json()) as InviteView;
}

export async function acceptInvite(token: string, password: string): Promise<User> {
  const response = await fetch(
    `${BASE_URL}/api/invites/${encodeURIComponent(token)}/accept`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    },
  );

  if (response.status === 404) {
    throw new Error('That invitation link is not valid. It may have expired or already been used.');
  }
  if (response.status === 400) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'That password was rejected.');
  }
  if (!response.ok) {
    throw new Error(`Could not set your password (${response.status}).`);
  }

  const body = (await response.json()) as LoginResponse;
  setToken(body.token);
  return body.user;
}

/* ----------------------------------------------------------------- video */

export interface JoinLink {
  url: string;
  opensAt: string;
  closesAt: string;
}

export interface VideoStatus {
  enabled: boolean;
  hasRoom: boolean;
  opensAt: string;
  closesAt: string;
}

/** A personal, short-lived link into the meeting's video room. */
export const joinMeeting = (id: number) =>
  request<JoinLink>(`/api/appointments/${id}/join`, { method: 'POST' });

export const adminJoinMeeting = (id: number) =>
  request<JoinLink>(`/api/admin/appointments/${id}/join`, { method: 'POST' });

export const getVideoStatus = (id: number) =>
  request<VideoStatus>(`/api/admin/appointments/${id}/video`);

export const createVideoRoom = (id: number) =>
  request<VideoStatus>(`/api/admin/appointments/${id}/video`, { method: 'POST' });

/** Minutes before the start that clients may enter the room. */
export const JOIN_EARLY_MINUTES = 15;
/** Minutes after the scheduled end that the room stays open. */
export const ROOM_GRACE_MINUTES = 120;

/** Every meeting starting in [from, to), for the admin calendar. */
export const listCalendar = (from: Date, to: Date) =>
  request<AdminAppointment[]>(
    `/api/admin/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
  );

/* ------------------------------------------------------------- team members */


export interface TeamMember {
  id: number;
  email: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  teamRole: TeamRole;
  enabled: boolean;
  /** Invited but has not yet set a password. */
  invitePending: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export function listTeam(): Promise<TeamMember[]> {
  return request<TeamMember[]>('/api/admin/team');
}

export function inviteTeamMember(input: {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  teamRole: TeamRole;
}): Promise<CreatedUser> {
  return request<CreatedUser>('/api/admin/team', { method: 'POST', body: JSON.stringify(input) });
}

export function updateTeamMember(
  id: number,
  input: { firstName: string; lastName: string; phone?: string; teamRole: TeamRole; enabled: boolean },
): Promise<TeamMember> {
  return request<TeamMember>(`/api/admin/team/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

/* --------------------------------------------- engagement and meeting people */

export type PersonSide = 'team' | 'client';

/** Someone who can be added: a Data Painters account, or a login at this client. */
export interface PersonCandidate {
  userId: number;
  name: string;
  email: string;
  side: PersonSide;
  teamRole: TeamRole | null;
}

export interface Person {
  id: number;
  userId: number;
  name: string;
  email: string;
  side: PersonSide;
  role: string;
  /** Meetings only: will be on the call. */
  attending: boolean;
  /** Meetings only: is emailed the write-up when the meeting is completed. */
  sendSummary: boolean;
  enabled: boolean;
}

/** The part someone plays on an engagement or in a meeting, by side. */
export const PERSON_ROLES: Record<PersonSide, { value: string; label: string }[]> = {
  team: [
    { value: 'lead', label: 'Engagement lead' },
    { value: 'engineer', label: 'Engineer' },
    { value: 'account_manager', label: 'Account manager' },
    { value: 'billing', label: 'Billing' },
  ],
  client: [
    { value: 'sponsor', label: 'Executive sponsor' },
    { value: 'project_owner', label: 'Project owner' },
    { value: 'technical', label: 'Technical contact' },
    { value: 'billing_contact', label: 'Billing contact' },
    { value: 'stakeholder', label: 'Stakeholder' },
  ],
};

export function personRoleLabel(role: string): string {
  return (
    [...PERSON_ROLES.team, ...PERSON_ROLES.client].find((r) => r.value === role)?.label ?? role
  );
}

type PeopleScope = { kind: 'engagement' | 'meeting'; id: number };

function peopleBase(scope: PeopleScope) {
  return scope.kind === 'engagement'
    ? { root: `/api/admin/engagements/${scope.id}`, list: 'team' }
    : { root: `/api/admin/appointments/${scope.id}`, list: 'participants' };
}

export function listPeopleCandidates(scope: PeopleScope): Promise<PersonCandidate[]> {
  return request<PersonCandidate[]>(`${peopleBase(scope).root}/people`);
}

export function listMeetingParticipants(appointmentId: number): Promise<Person[]> {
  return request<Person[]>(`/api/admin/appointments/${appointmentId}/participants`);
}

export function addPerson(
  scope: PeopleScope,
  input: { userId: number; role: string; attending?: boolean; sendSummary?: boolean },
): Promise<Person[]> {
  const b = peopleBase(scope);
  return request<Person[]>(`${b.root}/${b.list}`, { method: 'POST', body: JSON.stringify(input) });
}

export function updatePerson(
  scope: PeopleScope,
  personId: number,
  input: { role: string; attending?: boolean; sendSummary?: boolean },
): Promise<Person[]> {
  const b = peopleBase(scope);
  return request<Person[]>(`${b.root}/${b.list}/${personId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function removePerson(scope: PeopleScope, personId: number): Promise<Person[]> {
  const b = peopleBase(scope);
  return request<Person[]>(`${b.root}/${b.list}/${personId}`, { method: 'DELETE' });
}

/** Copies the engagement's team onto the meeting; people already there are kept. */
export function addEngagementTeamToMeeting(appointmentId: number): Promise<Person[]> {
  return request<Person[]>(`/api/admin/appointments/${appointmentId}/participants/from-engagement`, {
    method: 'POST',
  });
}

/* ------------------------------------------------------- engagement manager */

export interface EngagementMeeting {
  id: number;
  title: string | null;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: 'requested' | 'confirmed' | 'completed' | 'cancelled';
  video: boolean;
  topicCount: number;
  notedCount: number;
  recordedMinutes: number;
}

export interface EngagementAgendaLine {
  topicId: number;
  title: string;
  detail: string | null;
  desiredOutcome: string | null;
  priority: number;
  status: string;
  /** Null while the topic is still waiting to be put on a meeting. */
  appointmentId: number | null;
  meetingAt: string | null;
  note: string | null;
  noteUpdatedAt: string | null;
}

export interface SharedItem {
  id: number;
  appointmentId: number;
  meetingAt: string;
  title: string;
  kind: 'image' | 'pdf' | 'video';
  url: string;
  sharedByRole: string;
  sharedByName: string;
  sharedAt: string;
}

export interface EngagementCharge {
  id: number;
  appointmentId: number | null;
  kind: string;
  description: string;
  serviceDate: string;
  minutes: number | null;
  blocks: number | null;
  amountCents: number;
  invoiceId: number | null;
  invoiceNumber: string | null;
}

export interface EngagementBilling {
  chargedCents: number;
  invoicedCents: number;
  unbilledCents: number;
  billedMinutes: number;
  /** Time recorded on written replies that is not yet a charge. */
  unchargedMessageMinutes: number;
  charges: EngagementCharge[];
}

export interface EngagementDetail {
  id: number;
  clientId: number;
  clientName: string;
  title: string;
  goal: string | null;
  status: string;
  startedOn: string;
  dueOn: string | null;
  recordedMinutes: number;
  meetings: EngagementMeeting[];
  /** Notes about the engagement as a whole, newest first. */
  notes: EngagementNote[];
  agenda: EngagementAgendaLine[];
  /** Files attached to the engagement directly. */
  files: EngagementFile[];
  /** Things put on screen during its meetings. */
  media: SharedItem[];
  team: Person[];
  /** Null for roles that do not handle billing. */
  billing: EngagementBilling | null;
  communication: Communication;
  /** When and why it was closed; null if it never has been. */
  closure: { closedOn: string | null; notes: string | null; closedBy: string | null } | null;
}

export function closeEngagement(id: number, notes: string): Promise<EngagementDetail> {
  return request<EngagementDetail>(`/api/admin/engagements/${id}/close`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

/** Compiles uncharged reply time on the engagement's threads into a charge. */
export function chargeMessageTime(id: number): Promise<EngagementDetail> {
  return request<EngagementDetail>(`/api/admin/engagements/${id}/message-time/charge`, {
    method: 'POST',
  });
}

export interface EngagementNote {
  id: number;
  body: string;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EngagementFile {
  id: number;
  title: string;
  kind: 'image' | 'pdf' | 'video';
  url: string;
  fromLibrary: boolean;
  addedBy: string | null;
  addedAt: string;
}

export function addEngagementNote(id: number, body: string): Promise<EngagementNote[]> {
  return request(`/api/admin/engagements/${id}/notes`, { method: 'POST', body: JSON.stringify({ body }) });
}

export function editEngagementNote(id: number, noteId: number, body: string): Promise<EngagementNote[]> {
  return request(`/api/admin/engagements/${id}/notes/${noteId}`, {
    method: 'PUT',
    body: JSON.stringify({ body }),
  });
}

export function deleteEngagementNote(id: number, noteId: number): Promise<EngagementNote[]> {
  return request(`/api/admin/engagements/${id}/notes/${noteId}`, { method: 'DELETE' });
}

export function attachLibraryItem(id: number, mediaItemId: number): Promise<EngagementFile[]> {
  return request(`/api/admin/engagements/${id}/files`, {
    method: 'POST',
    body: JSON.stringify({ mediaItemId }),
  });
}

/** Uploads a file straight to storage, then attaches it to the engagement. */
export async function uploadEngagementFile(id: number, file: File, title: string): Promise<EngagementFile[]> {
  const slot = await request<{ uploadUrl: string; contentType: string; uploadKey: string }>(
    `/api/admin/engagements/${id}/files/uploads`,
    {
      method: 'POST',
      body: JSON.stringify({ fileName: file.name, contentType: file.type, sizeBytes: file.size }),
    },
  );
  const put = await fetch(slot.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': slot.contentType },
    body: file,
  });
  if (!put.ok) throw new Error(`The upload failed (${put.status}). Try again.`);
  return request(`/api/admin/engagements/${id}/files`, {
    method: 'POST',
    body: JSON.stringify({ uploadKey: slot.uploadKey, title }),
  });
}

export function removeEngagementFile(id: number, fileId: number): Promise<EngagementFile[]> {
  return request(`/api/admin/engagements/${id}/files/${fileId}`, { method: 'DELETE' });
}

export function getEngagementDetail(id: number): Promise<EngagementDetail> {
  return request<EngagementDetail>(`/api/admin/engagements/${id}`);
}

export function invoiceEngagement(id: number): Promise<{ id: number; number: string; totalCents: number }> {
  return request(`/api/admin/engagements/${id}/invoice`, { method: 'POST' });
}

export function listMeetingShares(appointmentId: number): Promise<SharedItem[]> {
  return request<SharedItem[]>(`/api/admin/appointments/${appointmentId}/shares`);
}
