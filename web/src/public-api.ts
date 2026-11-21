import type { BusinessHours } from './hours';
/**
 * Client for the unauthenticated /api/public endpoints used by the marketing
 * site: published pricing, consultation availability and booking.
 *
 * Deliberately separate from api.ts: nothing here sends a token, and nothing
 * here should ever be able to.
 */

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

export type Segment = 'corporate' | 'data' | 'dev';

export interface PublicInfo {
  /** Decimal string, e.g. "250.00". "0.00" means unpublished. */
  hourlyRate: string;
  currency: string;
  blockMinutes: number;
  consultationMinutes: number;
  /** Hours of operation, in the business's time zone. */
  businessHours?: BusinessHours;
}

export interface BusyInterval {
  startsAt: string;
  endsAt: string;
}

export interface ConsultationRequest {
  name: string;
  email: string;
  company: string;
  phone?: string;
  role?: string;
  segment: Segment;
  startsAt: string;
  topics: { title: string; detail?: string }[];
  message?: string;
  /** Honeypot. Always empty from a human. */
  website: string;
}

export interface ConsultationBooked {
  reference: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
}

/** An error whose message is safe to show to a visitor. */
export class PublicApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function problem(response: Response): Promise<PublicApiError> {
  let detail = '';
  try {
    const body = await response.json();
    detail = (body?.detail || body?.message || '').toString();
  } catch {
    // Not JSON.
  }
  const generic = /^(No message available|Invalid request content\.?|Failed to (convert|read))/i;
  if (detail && !generic.test(detail)) return new PublicApiError(detail, response.status);

  const fallback: Record<number, string> = {
    400: 'Some details were not accepted. Check the form and try again.',
    409: 'That time was just booked. Pick another slot.',
    429: 'Too many requests from your network. Please wait a few minutes and try again.',
  };
  return new PublicApiError(
    fallback[response.status] ??
      (response.status >= 500
        ? 'Something went wrong on our side. Please try again shortly.'
        : `Request failed (${response.status}).`),
    response.status,
  );
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new PublicApiError(
      'We could not reach the booking service. Check your connection and try again.',
      0,
    );
  }
  if (!response.ok) throw await problem(response);
  return (await response.json()) as T;
}

export function getPublicInfo(): Promise<PublicInfo> {
  return call<PublicInfo>('/api/public/info');
}

export function getAvailability(from: string, to: string): Promise<{ taken: BusyInterval[] }> {
  const q = new URLSearchParams({ from, to });
  return call<{ taken: BusyInterval[] }>(`/api/public/availability?${q.toString()}`);
}

export function bookConsultation(input: ConsultationRequest): Promise<ConsultationBooked> {
  return call<ConsultationBooked>('/api/public/consultations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** "$250" or "$262.50"; null when no rate is published. */
export function formatRate(info: PublicInfo | null): string | null {
  if (!info) return null;
  const n = Number(info.hourlyRate);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: info.currency || 'USD',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}
