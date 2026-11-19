/**
 * API client.
 *
 * The base URL is injected at build time by the deploy workflow, which reads
 * it from the Terraform output. There is no runtime config lookup because the
 * bundle is static files on CloudFront -- changing the API URL means a
 * rebuild, which is the correct trade for a site this size.
 */
import { clearToken, getToken, setToken, type User } from './auth';

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

export interface Engagement {
  id: number;
  title: string;
  status: string;
  startedOn: string;
}

/** Thrown when the server rejects our token, so callers can send us to login. */
export class Unauthorized extends Error {
  constructor() {
    super('Not signed in');
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 200)}`);
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
  role: 'CLIENT' | 'ADMIN';
  enabled: boolean;
  lastLoginAt: string | null;
}

export interface CreatedUser {
  user: AdminUser;
  /** Shown once and never retrievable again. */
  oneTimePassword: string;
}

/** An engagement as the admin screens see it: carries its owning client. */
export interface AdminEngagement {
  id: number;
  clientId: number;
  title: string;
  status: string;
  startedOn: string;
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

export function listClients(): Promise<Client[]> {
  return request<Client[]>('/api/admin/clients');
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
}): Promise<AdminEngagement> {
  return request<AdminEngagement>('/api/admin/engagements', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listAllEngagements(): Promise<AdminEngagement[]> {
  return request<AdminEngagement[]>('/api/admin/engagements');
}

export function listUsers(): Promise<AdminUser[]> {
  return request<AdminUser[]>('/api/admin/users');
}

export function createUser(input: {
  clientId: number;
  email: string;
  displayName: string;
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

export function listAdminAppointments(): Promise<AdminAppointment[]> {
  return request<AdminAppointment[]>('/api/admin/appointments');
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
