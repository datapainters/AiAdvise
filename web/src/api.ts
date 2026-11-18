/**
 * API client.
 *
 * The base URL is injected at build time by the deploy workflow, which reads
 * it from the Terraform output. There is no runtime config lookup because the
 * bundle is static files on CloudFront -- changing the API URL means a
 * rebuild, which is the correct trade for a site this size.
 */
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 200)}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
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
