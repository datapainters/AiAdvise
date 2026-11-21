/**
 * Admin client for system options, meeting time, billing and reports.
 *
 * Responses carry money as integer cents; requests send a dollar string
 * ("150.00"), which the server parses. Nothing in the browser does cents
 * arithmetic on what a person typed.
 */
import type { GridColumn, GridPage } from './datagrid';
import { request } from './api';

/* ----------------------------------------------------------------- money */

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return USD.format(cents / 100);
}

export function hours(minutes: number): string {
  const h = minutes / 60;
  return `${h.toFixed(h % 1 === 0 ? 0 : 2)} h`;
}

/** "Nov 20, 2026" from yyyy-mm-dd, read as a calendar day. */
export function day(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function todayIso(): string {
  const n = new Date();
  return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/* --------------------------------------------------------------- options */

export interface SystemOption {
  key: string;
  value: string;
  type: 'money' | 'integer' | 'text' | 'longtext' | 'email' | 'hours' | 'rate';
  label: string;
  description: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export const listOptions = () => request<SystemOption[]>('/api/admin/options');

export const updateOption = (key: string, value: string) =>
  request<SystemOption>(`/api/admin/options/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });

/* ------------------------------------------------------------------ time */

export interface TimeEntry {
  id: number;
  startedAt: string;
  endedAt: string | null;
  minutes: number;
  running: boolean;
  manual: boolean;
  note: string | null;
  userName: string | null;
  source: 'timer' | 'manual' | 'video';
}

export interface Charge {
  id: number;
  clientId: number;
  clientName: string;
  engagementId: number | null;
  appointmentId: number | null;
  kind: 'meeting' | 'adjustment';
  description: string;
  serviceDate: string;
  minutes: number | null;
  blocks: number | null;
  rateCents: number | null;
  amountCents: number;
  invoiceId: number | null;
  invoiceNumber: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface TimeSheet {
  appointmentId: number;
  entries: TimeEntry[];
  totalMinutes: number;
  blocks: number;
  rateCents: number;
  estimatedCents: number;
  billable: boolean;
  locked: boolean;
  appointmentStatus: string;
  charge: Charge | null;
}

export const getTime = (id: number) => request<TimeSheet>(`/api/admin/appointments/${id}/time`);
export const startTimer = (id: number) =>
  request<TimeSheet>(`/api/admin/appointments/${id}/time/start`, { method: 'POST' });
export const stopTimer = (id: number) =>
  request<TimeSheet>(`/api/admin/appointments/${id}/time/stop`, { method: 'POST' });
export const addTime = (id: number, minutes: number, note: string) =>
  request<TimeSheet>(`/api/admin/appointments/${id}/time`, {
    method: 'POST',
    body: JSON.stringify({ minutes, note }),
  });
export const importCallTime = (id: number) =>
  request<TimeSheet>(`/api/admin/appointments/${id}/time/import-video`, { method: 'POST' });
export const deleteTime = (entryId: number) =>
  request<TimeSheet>(`/api/admin/time/${entryId}`, { method: 'DELETE' });

/* ------------------------------------------------------- meeting summary */

export interface ClientInfo {
  id: number;
  name: string;
  primaryEmail: string;
  contactName: string | null;
  phone: string | null;
}

export interface MeetingSummary {
  appointmentId: number;
  client: ClientInfo;
  engagementTitle: string;
  engagementStatus: string;
  startsAt: string;
  endsAt: string;
  scheduledMinutes: number;
  status: string;
  billable: boolean;
  agenda: {
    title: string;
    detail: string | null;
    desiredOutcome: string | null;
    priority: number;
    status: string;
    note: string | null;
  }[];
  time: TimeEntry[];
  recordedMinutes: number;
  blocks: number;
  charge: Charge | null;
  rateCents: number;
  estimatedCents: number;
  generatedAt: string;
}

export const getMeetingSummary = (id: number) =>
  request<MeetingSummary>(`/api/admin/appointments/${id}/summary`);

/* --------------------------------------------------------------- account */

export interface Invoice {
  id: number;
  number: string;
  clientId: number;
  clientName: string;
  issuedOn: string;
  dueOn: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  status: 'open' | 'partial' | 'paid' | 'overdue' | 'void';
  daysOverdue: number;
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface Payment {
  id: number;
  clientId: number;
  clientName: string;
  invoiceId: number | null;
  invoiceNumber: string | null;
  receivedOn: string;
  amountCents: number;
  method: string;
  reference: string | null;
  note: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface AccountSummary {
  chargedCents: number;
  paidCents: number;
  balanceCents: number;
  unbilledCents: number;
  invoicedOutstandingCents: number;
  creditCents: number;
  overdueCents: number;
  lastPaymentOn: string | null;
}

export interface Account {
  client: ClientInfo;
  summary: AccountSummary;
  charges: Charge[];
  invoices: Invoice[];
  payments: Payment[];
  hourlyRateCents: number;
}

export const getAccount = (clientId: number) =>
  request<Account>(`/api/admin/clients/${clientId}/account`);

export const addAdjustment = (
  clientId: number,
  body: { description: string; amount: string; serviceDate?: string },
) =>
  request<Charge>(`/api/admin/clients/${clientId}/charges`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const voidCharge = (id: number, reason: string) =>
  request<void>(`/api/admin/charges/${id}/void`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export const createInvoice = (
  clientId: number,
  body: { chargeIds?: number[]; issuedOn?: string; notes?: string },
) =>
  request<Invoice>(`/api/admin/clients/${clientId}/invoices`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const voidInvoice = (id: number, reason: string) =>
  request<Invoice>(`/api/admin/invoices/${id}/void`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export interface InvoiceDetail {
  invoice: Invoice;
  client: ClientInfo;
  lines: Charge[];
  payments: Payment[];
  footer: string;
}

export const getInvoice = (id: number) => request<InvoiceDetail>(`/api/admin/invoices/${id}`);
export const listInvoices = (q = '') =>
  request<GridPage<Invoice>>(`/api/admin/invoices${q ? `?${q}` : ''}`);
export const invoiceColumns = () => request<GridColumn[]>('/api/admin/invoices/columns');

export const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'ach', label: 'ACH / bank transfer' },
  { value: 'wire', label: 'Wire' },
  { value: 'check', label: 'Check' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
];

export const recordPayment = (body: {
  clientId: number;
  invoiceId?: number | null;
  receivedOn?: string;
  amount: string;
  method: string;
  reference?: string;
  note?: string;
}) => request<Payment>('/api/admin/payments', { method: 'POST', body: JSON.stringify(body) });

export const voidPayment = (id: number, reason: string) =>
  request<void>(`/api/admin/payments/${id}/void`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export const listPayments = (q = '') =>
  request<GridPage<Payment>>(`/api/admin/payments${q ? `?${q}` : ''}`);
export const paymentColumns = () => request<GridColumn[]>('/api/admin/payments/columns');

export interface LedgerLine {
  date: string;
  type: string;
  reference: string;
  description: string;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
}

export interface Statement {
  client: ClientInfo;
  asOf: string;
  summary: AccountSummary;
  lines: LedgerLine[];
  openInvoices: Invoice[];
  footer: string;
}

export const getStatement = (clientId: number) =>
  request<Statement>(`/api/admin/clients/${clientId}/statement`);

/* --------------------------------------------------------------- reports */

export interface AgingRow {
  clientId: number | null;
  clientName: string;
  unbilledCents: number;
  currentCents: number;
  days1to30Cents: number;
  days31to60Cents: number;
  days61to90Cents: number;
  days90PlusCents: number;
  creditCents: number;
  balanceCents: number;
  lastPaymentOn: string | null;
}

export const getAging = () =>
  request<{ asOf: string; rows: AgingRow[]; totals: AgingRow }>('/api/admin/reports/aging');

export interface RevenueRow {
  month?: string;
  clientId?: number;
  clientName?: string;
  minutes: number;
  blocks: number;
  billedCents: number;
  collectedCents: number;
  meetings: number;
}

export const getRevenue = (from?: string, to?: string) => {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  return request<{
    from: string;
    to: string;
    months: RevenueRow[];
    clients: RevenueRow[];
    totals: RevenueRow;
  }>(`/api/admin/reports/revenue?${p}`);
};

export interface AttentionMeeting {
  appointmentId: number;
  clientId: number;
  clientName: string;
  engagementTitle: string;
  startsAt: string;
  status: string;
  recordedMinutes: number;
  issue: string;
}

export const getUnbilled = () =>
  request<{ charges: Charge[]; totalCents: number; attention: AttentionMeeting[] }>(
    '/api/admin/reports/unbilled',
  );

export interface Snapshot {
  receivableCents: number;
  overdueCents: number;
  unbilledCents: number;
  collectedThisMonthCents: number;
  billedThisMonthCents: number;
  openInquiries: number;
  hourlyRateCents: number;
}

export const getSnapshot = () => request<Snapshot>('/api/admin/billing/snapshot');

/* ------------------------------------------------------------------- csv */

/** Downloads rows as CSV. Values are quoted; formulas are neutralised. */
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const cell = (v: string | number) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s) && typeof v === 'string') s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------- client portal */

export interface ClientInvoice {
  id: number;
  number: string;
  issuedOn: string;
  dueOn: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  status: Invoice['status'];
  daysOverdue: number;
}

export interface ClientPayment {
  id: number;
  receivedOn: string;
  amountCents: number;
  method: string;
  reference: string | null;
  invoiceId: number | null;
  invoiceNumber: string | null;
}

export interface BilledItem {
  id: number;
  serviceDate: string;
  description: string;
  minutes: number | null;
  blocks: number | null;
  rateCents: number | null;
  amountCents: number;
  invoiceId: number | null;
  invoiceNumber: string | null;
  appointmentId: number | null;
}

export interface ClientBilling {
  summary: {
    amountDueCents: number;
    overdueCents: number;
    creditCents: number;
    paidCents: number;
    invoicedCents: number;
    notYetInvoicedCents: number;
    nextDueOn: string | null;
    lastPaymentOn: string | null;
    billedMinutes: number;
    billedBlocks: number;
  };
  invoices: ClientInvoice[];
  payments: ClientPayment[];
  billed: BilledItem[];
  hourlyRateCents: number;
  paymentInstructions: string;
  paymentTermsDays: number;
}

export const getMyBilling = () => request<ClientBilling>('/api/billing');
export const getMyInvoice = (id: number) => request<InvoiceDetail>(`/api/billing/invoices/${id}`);
export const getMyStatement = () => request<Statement>('/api/billing/statement');

/* ------------------------------------------------------- engagement costs */

export interface CostRow {
  engagementId: number | null;
  engagementTitle: string;
  engagementStatus: string | null;
  clientId: number | null;
  clientName: string | null;
  meetings: number;
  billedMinutes: number;
  billedCents: number;
  videoSessions: number;
  participantMinutes: number;
  videoCostCents: number;
  otherCostCents: number;
  totalCostCents: number;
  marginCents: number;
  marginPercent: number | null;
}

export interface CostReport {
  from: string;
  to: string;
  videoRatePerMinute: string;
  rows: CostRow[];
  totals: CostRow;
}

export const getCostReport = (from?: string, to?: string) => {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  return request<CostReport>(`/api/admin/reports/engagement-costs?${p}`);
};

export const syncVideoUsage = () =>
  request<{ enabled: boolean; rooms: number; sessions: number; failed: number }>(
    '/api/admin/reports/engagement-costs/sync',
    { method: 'POST' },
  );

export interface CostDetail {
  engagementId: number;
  engagementTitle: string;
  clientName: string;
  videoRatePerMinute: string;
  video: {
    sessionId: string;
    appointmentId: number;
    startedAt: string;
    durationSeconds: number;
    maxParticipants: number;
    participantMinutes: number;
    costCents: number;
  }[];
  costs: {
    id: number;
    incurredOn: string;
    category: string;
    description: string;
    amountCents: number;
    voidedAt: string | null;
    createdBy: string | null;
  }[];
}

export const getCostDetail = (engagementId: number) =>
  request<CostDetail>(`/api/admin/engagements/${engagementId}/costs`);

export const addEngagementCost = (
  engagementId: number,
  body: { incurredOn?: string; category: string; description: string; amount: string },
) =>
  request<unknown>(`/api/admin/engagements/${engagementId}/costs`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const voidEngagementCost = (id: number) =>
  request<void>(`/api/admin/engagement-costs/${id}/void`, { method: 'POST' });

export const COST_CATEGORIES = [
  { value: 'software', label: 'Software' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'travel', label: 'Travel' },
  { value: 'video', label: 'Video (other)' },
  { value: 'other', label: 'Other' },
];
