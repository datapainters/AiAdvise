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
  priority: number;
  status: 'proposed' | 'scheduled' | 'discussed' | 'dropped';
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
