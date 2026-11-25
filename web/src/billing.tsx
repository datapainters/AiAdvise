/**
 * Admin billing: system options, the meeting time tracker, the client
 * accounting tab, payments and adjustments, invoices, reports, and the
 * printable documents (meeting summary, invoice, statement).
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Modal } from './admin-meetings';
import { HoursEditor } from './hours-editor';
import { resetBusinessHours } from './hours';
import {
  PAYMENT_METHODS,
  addAdjustment,
  addEngagementCost,
  COST_CATEGORIES,
  getCostDetail,
  getCostReport,
  syncVideoUsage,
  voidEngagementCost,
  type CostDetail,
  type CostReport,
  addTime,
  createInvoice,
  day,
  deleteTime,
  downloadCsv,
  getAccount,
  getAging,
  getInvoice,
  getMeetingSummary,
  getMyInvoice,
  getMyStatement,
  getRevenue,
  getStatement,
  getTime,
  importCallTime,
  getUnbilled,
  hours,
  listOptions,
  money,
  recordPayment,
  startTimer,
  stopTimer,
  todayIso,
  updateOption,
  voidCharge,
  voidInvoice,
  voidPayment,
  type Account,
  type AgingRow,
  type Charge,
  type Invoice,
  type InvoiceDetail,
  type MeetingSummary,
  type Payment,
  type RevenueRow,
  type Statement,
  type SystemOption,
  type TimeSheet,
} from './billing-api';
import { formatRange, statusLabel } from './scheduling';
import type { Client } from './api';

type OnError = (e: unknown) => void;

/* ================================================================ shared */

export function InvoiceStatus({ status }: { status: Invoice['status'] }) {
  const tone =
    status === 'paid' ? 'good' : status === 'overdue' ? 'bad' : status === 'void' ? 'neutral' : 'warn';
  return <span className={`pill pill-${tone}`}>{status}</span>;
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className={tone ? `kpi kpi-static kpi-${tone}` : 'kpi kpi-static'}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value kpi-value-sm">{value}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  );
}

function openPrint(path: string) {
  // Without noopener on purpose: the session token lives in sessionStorage,
  // which a same-origin tab opened this way inherits. With noopener the
  // report would open signed out.
  window.open(path, '_blank');
}

/** Ask for a reason, then run. Returns false if the person backed out. */
async function confirmVoid(what: string, run: (reason: string) => Promise<unknown>) {
  const reason = window.prompt(`Void ${what}? Enter a reason (kept on the record):`, '');
  if (reason === null) return false;
  await run(reason);
  return true;
}

/* ======================================================== system options */

export function SystemOptions({ onError, onSaved }: { onError: OnError; onSaved: (msg: string) => void }) {
  const [options, setOptions] = useState<SystemOption[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    listOptions()
      .then((o) => {
        setOptions(o);
        setDraft(Object.fromEntries(o.map((x) => [x.key, x.value])));
      })
      .catch(onError);
  }, [onError]);

  async function save(o: SystemOption) {
    setSaving(o.key);
    try {
      const updated = await updateOption(o.key, draft[o.key] ?? '');
      setOptions((prev) => prev?.map((x) => (x.key === o.key ? updated : x)) ?? null);
      setDraft((d) => ({ ...d, [o.key]: updated.value }));
      if (o.type === 'hours') resetBusinessHours();
      onSaved(`${o.label} saved`);
    } catch (e) {
      onError(e);
    } finally {
      setSaving(null);
    }
  }

  if (!options) return <p className="empty">Loading…</p>;

  return (
    <div className="options-list">
      {options.map((o) => {
        const dirty = (draft[o.key] ?? '') !== o.value;
        const unsetRate = o.key === 'hourly_rate' && Number(o.value) === 0;
        return (
          <form
            key={o.key}
            className={[
              'option-card',
              unsetRate ? 'option-warn' : '',
              o.type === 'hours' ? 'option-wide' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onSubmit={(e) => {
              e.preventDefault();
              save(o);
            }}
          >
            <div className="option-text">
              <label htmlFor={`opt-${o.key}`}>{o.label}</label>
              {o.description && <p className="muted">{o.description}</p>}
              {unsetRate && (
                <p className="hint-warn">
                  Not set. Meetings will be charged at $0 and the website will say “contact us
                  for rates” until you enter a rate.
                </p>
              )}
              <p className="fine">
                Last changed {new Date(o.updatedAt).toLocaleString()}
                {o.updatedBy ? ` by ${o.updatedBy}` : ''}
              </p>
            </div>
            <div className="option-input">
              {o.type === 'hours' ? (
                <HoursEditor
                  id={`opt-${o.key}`}
                  value={draft[o.key] ?? o.value}
                  saved={o.value}
                  onChange={(v) => setDraft((d) => ({ ...d, [o.key]: v }))}
                />
              ) : o.type === 'longtext' ? (
                <textarea
                  id={`opt-${o.key}`}
                  rows={3}
                  value={draft[o.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [o.key]: e.target.value }))}
                />
              ) : (
                <div className={o.type === 'money' || o.type === 'rate' ? 'input-affix' : undefined}>
                  {(o.type === 'money' || o.type === 'rate') && <span aria-hidden="true">$</span>}
                  <input
                    id={`opt-${o.key}`}
                    inputMode={
                    o.type === 'money' || o.type === 'rate'
                      ? 'decimal'
                      : o.type === 'integer'
                        ? 'numeric'
                        : undefined
                  }
                    type={o.type === 'email' ? 'email' : 'text'}
                    value={draft[o.key] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [o.key]: e.target.value }))}
                  />
                  {o.type === 'money' && <span className="affix-after">per hour</span>}
                  {o.type === 'rate' && <span className="affix-after">per minute</span>}
                </div>
              )}
              <button className="btn btn-primary" type="submit" disabled={!dirty || saving === o.key}>
                {saving === o.key ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        );
      })}
    </div>
  );
}

/* ========================================================== time tracker */

function elapsed(fromIso: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function TimeTracker({
  appointmentId,
  refreshKey,
  onError,
  hasVideo = false,
}: {
  appointmentId: number;
  /** Bumped by the parent after a status change, which may compile a charge. */
  refreshKey: number;
  onError: OnError;
  /** Offers importing the Daily call's measured length. */
  hasVideo?: boolean;
}) {
  const [sheet, setSheet] = useState<TimeSheet | null>(null);
  const [now, setNow] = useState(Date.now());
  const [minutes, setMinutes] = useState('30');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getTime(appointmentId).then(setSheet).catch(onError);
  }, [appointmentId, refreshKey, onError]);

  const running = sheet?.entries.find((e) => e.running);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  async function act(fn: () => Promise<TimeSheet>) {
    setBusy(true);
    try {
      setSheet(await fn());
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!sheet) return <section className="tracker"><p className="muted">Loading time…</p></section>;

  const done = sheet.appointmentStatus === 'completed';
  const cancelled = sheet.appointmentStatus === 'cancelled';
  const disabled = busy || sheet.locked || cancelled;

  return (
    <section className="tracker" aria-label="Time tracker">
      <header className="tracker-head">
        <div>
          <h3>Time tracker</h3>
          <p className="muted">
            Billed in 30-minute blocks
            {sheet.billable ? ` at ${money(sheet.rateCents)}/hour` : ' · complimentary, no charge'}.
            {done ? '' : ' Charges are compiled when the meeting is marked complete.'}
          </p>
        </div>
        <div className="tracker-clock">
          {running ? (
            <>
              <span className="clock live" aria-live="off">
                {elapsed(running.startedAt, now)}
              </span>
              <button className="btn btn-danger" disabled={busy} onClick={() => act(() => stopTimer(appointmentId))}>
                ■ Stop
              </button>
            </>
          ) : (
            <button
              className="btn btn-primary"
              disabled={disabled}
              onClick={() => act(() => startTimer(appointmentId))}
            >
              ▶ Start timer
            </button>
          )}
        </div>
      </header>

      <div className="tracker-totals">
        <div>
          <span className="kpi-label">Recorded</span>
          <b>{sheet.totalMinutes} min</b>
        </div>
        <div>
          <span className="kpi-label">Billable blocks</span>
          <b>{sheet.blocks} × 30 min</b>
        </div>
        <div>
          <span className="kpi-label">{sheet.charge ? 'Charged' : 'Estimated charge'}</span>
          <b>{money(sheet.charge ? sheet.charge.amountCents : sheet.estimatedCents)}</b>
        </div>
        <div>
          <span className="kpi-label">Billing</span>
          <b>
            {sheet.charge
              ? sheet.charge.invoiceNumber
                ? `On ${sheet.charge.invoiceNumber}`
                : 'Unbilled charge'
              : done
                ? 'No time, no charge'
                : 'Not yet compiled'}
          </b>
        </div>
      </div>

      {sheet.locked && (
        <p className="hint hint-warn">
          This time is on invoice {sheet.charge?.invoiceNumber}. Void the invoice to change it.
        </p>
      )}

      {sheet.entries.length > 0 && (
        <table className="grid tracker-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Minutes</th>
              <th>Note</th>
              <th>By</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sheet.entries.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">
                  {e.source === 'video'
                    ? 'Video call'
                    : e.manual
                    ? 'Manual entry'
                    : `${new Date(e.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${
                        e.endedAt
                          ? ` – ${new Date(e.endedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                          : ' – running'
                      }`}
                </td>
                <td className="num">{e.running ? elapsed(e.startedAt, now) : e.minutes}</td>
                <td>{e.note ?? <span className="muted">—</span>}</td>
                <td className="muted">{e.userName ?? '—'}</td>
                <td>
                  {!e.running && !sheet.locked && (
                    <button
                      className="linklike"
                      onClick={() => {
                        if (window.confirm('Delete this time entry?')) act(() => deleteTime(e.id));
                      }}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form
        className="tracker-add"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(minutes);
          if (!Number.isInteger(n) || n < 1) {
            onError(new Error('Enter whole minutes, 1 or more'));
            return;
          }
          act(() => addTime(appointmentId, n, note)).then(() => setNote(''));
        }}
      >
        <label>
          Add time
          <div className="input-affix">
            <input
              inputMode="numeric"
              value={minutes}
              aria-label="Minutes"
              onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))}
              disabled={disabled}
            />
            <span className="affix-after">min</span>
          </div>
        </label>
        <div className="chip-row" role="group" aria-label="Quick minutes">
          {[15, 30, 45, 60, 90].map((m) => (
            <button type="button" key={m} className="chip" disabled={disabled} onClick={() => setMinutes(String(m))}>
              {m}
            </button>
          ))}
        </div>
        <label className="grow">
          Note
          <input
            value={note}
            placeholder="Prep, follow-up, the call itself…"
            onChange={(e) => setNote(e.target.value)}
            disabled={disabled}
          />
        </label>
        <button className="btn" type="submit" disabled={disabled}>
          Add
        </button>
        {hasVideo && (
          <button
            type="button"
            className="btn"
            disabled={disabled}
            title="Replace the video entry with the call's measured length (sessions with two or more people)"
            onClick={() => act(() => importCallTime(appointmentId))}
          >
            {sheet.entries.some((e) => e.source === 'video') ? 'Re-import call time' : 'Import call time'}
          </button>
        )}
      </form>
    </section>
  );
}

/* ====================================================== payment / adjust */

export function RecordPaymentModal({
  clients,
  clientId: fixedClient,
  invoiceId: fixedInvoice,
  onDone,
  onCancel,
  onError,
}: {
  clients?: Client[];
  clientId?: number;
  invoiceId?: number;
  onDone: (p: Payment) => void;
  onCancel: () => void;
  onError: OnError;
}) {
  const [clientId, setClientId] = useState<string>(fixedClient ? String(fixedClient) : '');
  const [openInvoices, setOpenInvoices] = useState<Invoice[]>([]);
  const [invoiceId, setInvoiceId] = useState<string>(fixedInvoice ? String(fixedInvoice) : '');
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const [method, setMethod] = useState('ach');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!clientId) {
      setOpenInvoices([]);
      return;
    }
    getAccount(Number(clientId))
      .then((a) => {
        const open = a.invoices.filter((i) => i.voidedAt === null && i.balanceCents > 0);
        setOpenInvoices(open);
        const pick = fixedInvoice ? open.find((i) => i.id === fixedInvoice) : open[open.length - 1];
        if (pick) {
          setInvoiceId(String(pick.id));
          setAmount((pick.balanceCents / 100).toFixed(2));
        } else {
          setInvoiceId('');
        }
      })
      .catch(onError);
  }, [clientId, fixedInvoice, onError]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onDone(
        await recordPayment({
          clientId: Number(clientId),
          invoiceId: invoiceId ? Number(invoiceId) : null,
          receivedOn,
          amount,
          method,
          reference: reference || undefined,
          note: note || undefined,
        }),
      );
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Record payment" onClose={onCancel}>
      <form className="stack-form" onSubmit={submit}>
        {!fixedClient && (
          <label>
            Client
            <select value={clientId} required onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select…</option>
              {(clients ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Apply to
          <select
            value={invoiceId}
            onChange={(e) => {
              setInvoiceId(e.target.value);
              const inv = openInvoices.find((i) => String(i.id) === e.target.value);
              if (inv) setAmount((inv.balanceCents / 100).toFixed(2));
            }}
          >
            <option value="">On account (not applied to an invoice)</option>
            {openInvoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number} · balance {money(i.balanceCents)} · due {day(i.dueOn)}
              </option>
            ))}
          </select>
        </label>
        <div className="field-row">
          <label>
            Amount
            <div className="input-affix">
              <span aria-hidden="true">$</span>
              <input inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </label>
          <label>
            Received
            <input type="date" required value={receivedOn} max={todayIso()} onChange={(e) => setReceivedOn(e.target.value)} />
          </label>
        </div>
        <div className="field-row">
          <label>
            Method
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reference
            <input value={reference} placeholder="Check no., transaction ID" onChange={(e) => setReference(e.target.value)} />
          </label>
        </div>
        <label>
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="button-row">
          <button className="btn btn-primary" type="submit" disabled={busy || !clientId}>
            {busy ? 'Saving…' : 'Record payment'}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AdjustmentModal({
  clientId,
  onDone,
  onCancel,
  onError,
}: {
  clientId: number;
  onDone: () => void;
  onCancel: () => void;
  onError: OnError;
}) {
  const [kind, setKind] = useState<'charge' | 'credit'>('charge');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [serviceDate, setServiceDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const clean = amount.replace(/[^0-9.]/g, '');
      await addAdjustment(clientId, {
        description,
        amount: kind === 'credit' ? `-${clean}` : clean,
        serviceDate,
      });
      onDone();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add charge or credit" onClose={onCancel}>
      <form className="stack-form" onSubmit={submit}>
        <div className="segmented" role="radiogroup" aria-label="Type">
          {(['charge', 'credit'] as const).map((k) => (
            <button
              type="button"
              key={k}
              role="radio"
              aria-checked={kind === k}
              className={kind === k ? 'on' : undefined}
              onClick={() => setKind(k)}
            >
              {k === 'charge' ? 'Charge' : 'Credit'}
            </button>
          ))}
        </div>
        <label>
          Description
          <input
            required
            value={description}
            placeholder={kind === 'charge' ? 'Document review, 2 hours' : 'Courtesy credit'}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="field-row">
          <label>
            Amount
            <div className="input-affix">
              <span aria-hidden="true">{kind === 'credit' ? '−$' : '$'}</span>
              <input inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </label>
          <label>
            Date
            <input type="date" required value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
          </label>
        </div>
        <p className="hint">Adjustments are unbilled until you include them on an invoice.</p>
        <div className="button-row">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : kind === 'charge' ? 'Add charge' : 'Add credit'}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ======================================================= accounting tab */

export function AccountingTab({
  clientId,
  onError,
  onToast,
  onOpenMeeting,
}: {
  clientId: number;
  onError: OnError;
  onToast: (msg: string) => void;
  onOpenMeeting: (id: number) => void;
}) {
  const [acc, setAcc] = useState<Account | null>(null);
  const [paying, setPaying] = useState<number | 'any' | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [showVoid, setShowVoid] = useState(false);

  const reload = useCallback(() => getAccount(clientId).then(setAcc).catch(onError), [clientId, onError]);
  useEffect(() => {
    reload();
  }, [reload]);

  if (!acc) return <p className="empty">Loading account…</p>;

  const s = acc.summary;
  const unbilled = acc.charges.filter((c) => !c.voidedAt && c.invoiceId === null);
  const billed = acc.charges.filter((c) => !c.voidedAt && c.invoiceId !== null);
  const voided = [
    ...acc.charges.filter((c) => c.voidedAt),
    ...acc.payments.filter((p) => p.voidedAt),
    ...acc.invoices.filter((i) => i.voidedAt),
  ];

  async function invoiceUnbilled() {
    if (unbilled.length === 0) return;
    const total = unbilled.reduce((t, c) => t + c.amountCents, 0);
    if (!window.confirm(`Create an invoice for ${unbilled.length} unbilled item(s), ${money(total)}?`)) return;
    try {
      const inv = await createInvoice(clientId, {});
      onToast(`Invoice ${inv.number} created for ${money(inv.totalCents)}`);
      await reload();
    } catch (e) {
      onError(e);
    }
  }

  return (
    <div className="accounting">
      <div className="kpis kpis-compact">
        <Stat
          label="Balance"
          value={money(s.balanceCents)}
          tone={s.overdueCents > 0 ? 'bad' : s.balanceCents > 0 ? 'warn' : undefined}
          hint={s.balanceCents < 0 ? 'In credit' : s.overdueCents > 0 ? `${money(s.overdueCents)} overdue` : 'Charges less payments'}
        />
        <Stat label="Unbilled" value={money(s.unbilledCents)} hint="Not yet invoiced" />
        <Stat label="Invoiced, unpaid" value={money(s.invoicedOutstandingCents)} hint={`${acc.invoices.filter((i) => i.balanceCents > 0).length} open invoice(s)`} />
        <Stat label="Paid to date" value={money(s.paidCents)} hint={s.lastPaymentOn ? `Last ${day(s.lastPaymentOn)}` : 'No payments yet'} />
      </div>

      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => setPaying('any')}>
          Record payment
        </button>
        <button className="btn" onClick={invoiceUnbilled} disabled={unbilled.length === 0}>
          Invoice unbilled ({unbilled.length})
        </button>
        <button className="btn" onClick={() => setAdjusting(true)}>
          Add charge / credit
        </button>
        <button className="btn" onClick={() => openPrint(`/admin/print/statement/${clientId}`)}>
          Print statement
        </button>
      </div>

      <h4 className="subhead">Unbilled charges</h4>
      {unbilled.length === 0 ? (
        <p className="empty">Nothing waiting to be invoiced.</p>
      ) : (
        <ChargeTable
          charges={unbilled}
          onOpenMeeting={onOpenMeeting}
          onVoid={async (c) => {
            try {
              if (await confirmVoid('this charge', (r) => voidCharge(c.id, r))) {
                onToast('Charge voided');
                reload();
              }
            } catch (e) {
              onError(e);
            }
          }}
        />
      )}

      <h4 className="subhead">Invoices</h4>
      {acc.invoices.filter((i) => !i.voidedAt).length === 0 ? (
        <p className="empty">No invoices yet.</p>
      ) : (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Issued</th>
                <th>Due</th>
                <th className="num">Total</th>
                <th className="num">Paid</th>
                <th className="num">Balance</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {acc.invoices
                .filter((i) => !i.voidedAt)
                .map((i) => (
                  <tr key={i.id}>
                    <td>
                      <strong>{i.number}</strong>
                    </td>
                    <td className="nowrap">{day(i.issuedOn)}</td>
                    <td className="nowrap">{day(i.dueOn)}</td>
                    <td className="num">{money(i.totalCents)}</td>
                    <td className="num">{money(i.paidCents)}</td>
                    <td className="num">
                      <strong>{money(i.balanceCents)}</strong>
                    </td>
                    <td>
                      <InvoiceStatus status={i.status} />
                    </td>
                    <td className="row-actions">
                      <button className="linklike" onClick={() => openPrint(`/admin/print/invoice/${i.id}`)}>
                        View
                      </button>
                      {i.balanceCents > 0 && (
                        <button className="linklike" onClick={() => setPaying(i.id)}>
                          Pay
                        </button>
                      )}
                      {i.paidCents === 0 && (
                        <button
                          className="linklike danger"
                          onClick={async () => {
                            try {
                              if (await confirmVoid(`invoice ${i.number}`, (r) => voidInvoice(i.id, r))) {
                                onToast(`${i.number} voided; its charges are unbilled again`);
                                reload();
                              }
                            } catch (e) {
                              onError(e);
                            }
                          }}
                        >
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {billed.length > 0 && (
        <details className="disclosure">
          <summary>Invoiced charges ({billed.length})</summary>
          <ChargeTable charges={billed} onOpenMeeting={onOpenMeeting} />
        </details>
      )}

      <h4 className="subhead">Payments</h4>
      {acc.payments.filter((p) => !p.voidedAt).length === 0 ? (
        <p className="empty">No payments recorded.</p>
      ) : (
        <PaymentTable
          payments={acc.payments.filter((p) => !p.voidedAt)}
          onVoid={async (p) => {
            try {
              if (await confirmVoid('this payment', (r) => voidPayment(p.id, r))) {
                onToast('Payment voided');
                reload();
              }
            } catch (e) {
              onError(e);
            }
          }}
        />
      )}

      {voided.length > 0 && (
        <p>
          <button className="linklike" onClick={() => setShowVoid((v) => !v)}>
            {showVoid ? 'Hide' : 'Show'} {voided.length} voided item(s)
          </button>
        </p>
      )}
      {showVoid && (
        <ul className="void-list">
          {acc.charges
            .filter((c) => c.voidedAt)
            .map((c) => (
              <li key={`c${c.id}`}>
                Charge · {c.description} · {money(c.amountCents)} — {c.voidReason ?? 'no reason given'}
              </li>
            ))}
          {acc.invoices
            .filter((i) => i.voidedAt)
            .map((i) => (
              <li key={`i${i.id}`}>
                Invoice {i.number} · {money(i.totalCents)} — {i.voidReason ?? 'no reason given'}
              </li>
            ))}
          {acc.payments
            .filter((p) => p.voidedAt)
            .map((p) => (
              <li key={`p${p.id}`}>
                Payment {day(p.receivedOn)} · {money(p.amountCents)} — {p.voidReason ?? 'no reason given'}
              </li>
            ))}
        </ul>
      )}

      {paying !== null && (
        <RecordPaymentModal
          clientId={clientId}
          invoiceId={paying === 'any' ? undefined : paying}
          onCancel={() => setPaying(null)}
          onError={onError}
          onDone={(p) => {
            setPaying(null);
            onToast(`Payment of ${money(p.amountCents)} recorded`);
            reload();
          }}
        />
      )}
      {adjusting && (
        <AdjustmentModal
          clientId={clientId}
          onCancel={() => setAdjusting(false)}
          onError={onError}
          onDone={() => {
            setAdjusting(false);
            onToast('Adjustment added');
            reload();
          }}
        />
      )}
    </div>
  );
}

function ChargeTable({
  charges,
  onVoid,
  onOpenMeeting,
}: {
  charges: Charge[];
  onVoid?: (c: Charge) => void;
  onOpenMeeting?: (id: number) => void;
}) {
  return (
    <div className="grid-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th className="num">Time</th>
            <th className="num">Rate</th>
            <th className="num">Amount</th>
            <th>Invoice</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {charges.map((c) => (
            <tr key={c.id}>
              <td className="nowrap">{day(c.serviceDate)}</td>
              <td>
                {c.description}
                {c.appointmentId && onOpenMeeting && (
                  <>
                    {' '}
                    <button className="linklike" onClick={() => onOpenMeeting(c.appointmentId!)}>
                      Meeting
                    </button>
                  </>
                )}
              </td>
              <td className="num nowrap">{c.minutes ? `${c.minutes} min → ${c.blocks}×30` : '—'}</td>
              <td className="num">{c.rateCents !== null ? `${money(c.rateCents)}/h` : '—'}</td>
              <td className="num">
                <strong>{money(c.amountCents)}</strong>
              </td>
              <td>{c.invoiceNumber ?? <span className="muted">Unbilled</span>}</td>
              <td>
                {onVoid && !c.invoiceId && (
                  <button className="linklike danger" onClick={() => onVoid(c)}>
                    Void
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaymentTable({ payments, onVoid, showClient }: { payments: Payment[]; onVoid?: (p: Payment) => void; showClient?: boolean }) {
  return (
    <div className="grid-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th>Received</th>
            {showClient && <th>Client</th>}
            <th>Applied to</th>
            <th>Method</th>
            <th>Reference</th>
            <th className="num">Amount</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id}>
              <td className="nowrap">{day(p.receivedOn)}</td>
              {showClient && <td>{p.clientName}</td>}
              <td>{p.invoiceNumber ?? <span className="muted">On account</span>}</td>
              <td>{PAYMENT_METHODS.find((m) => m.value === p.method)?.label ?? p.method}</td>
              <td>{p.reference ?? <span className="muted">—</span>}</td>
              <td className="num">
                <strong>{money(p.amountCents)}</strong>
              </td>
              <td>
                {onVoid && (
                  <button className="linklike danger" onClick={() => onVoid(p)}>
                    Void
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ================================================================ invoice */

/** Invoice detail over the invoices list: lines, payments, pay, print, void. */
export function InvoiceModal({
  invoiceId,
  onClose,
  onChanged,
  onError,
  onToast,
}: {
  invoiceId: number;
  onClose: () => void;
  onChanged: () => void;
  onError: OnError;
  onToast: (m: string) => void;
}) {
  const [d, setD] = useState<InvoiceDetail | null>(null);
  const [paying, setPaying] = useState(false);
  const reload = useCallback(() => getInvoice(invoiceId).then(setD).catch(onError), [invoiceId, onError]);
  useEffect(() => {
    reload();
  }, [reload]);

  const inv = d?.invoice;
  return (
    <Modal
      title={inv ? `Invoice ${inv.number}` : 'Invoice'}
      badge={inv?.status}
      badgeTone={inv?.status === 'paid' ? 'good' : inv?.status === 'overdue' ? 'bad' : inv?.status === 'void' ? 'neutral' : 'warn'}
      onClose={onClose}
      wide
      toolbar={
        inv && (
          <>
            {inv.balanceCents > 0 && (
              <button className="btn btn-primary" onClick={() => setPaying(true)}>
                Record payment
              </button>
            )}
            <button className="btn" onClick={() => openPrint(`/admin/print/invoice/${inv.id}`)}>
              Print / PDF
            </button>
            {!inv.voidedAt && inv.paidCents === 0 && (
              <button
                className="btn"
                onClick={async () => {
                  try {
                    if (await confirmVoid(`invoice ${inv.number}`, (r) => voidInvoice(inv.id, r))) {
                      onToast(`${inv.number} voided`);
                      onChanged();
                      reload();
                    }
                  } catch (e) {
                    onError(e);
                  }
                }}
              >
                Void
              </button>
            )}
          </>
        )
      }
    >
      {!d || !inv ? (
        <p>Loading…</p>
      ) : (
        <>
          <div className="kpis kpis-compact">
            <Stat label="Client" value={d.client.name} />
            <Stat label="Issued / due" value={`${day(inv.issuedOn)}`} hint={`Due ${day(inv.dueOn)}${inv.daysOverdue ? ` · ${inv.daysOverdue} days overdue` : ''}`} />
            <Stat label="Total" value={money(inv.totalCents)} hint={`Paid ${money(inv.paidCents)}`} />
            <Stat label="Balance" value={money(inv.balanceCents)} tone={inv.status === 'overdue' ? 'bad' : inv.balanceCents > 0 ? 'warn' : undefined} />
          </div>
          <h4 className="subhead">Lines</h4>
          {d.lines.length === 0 ? <p className="empty">This invoice is void; its charges were released.</p> : <ChargeTable charges={d.lines} />}
          <h4 className="subhead">Payments</h4>
          {d.payments.length === 0 ? <p className="empty">No payments applied.</p> : <PaymentTable payments={d.payments} />}
        </>
      )}
      {paying && inv && (
        <RecordPaymentModal
          clientId={inv.clientId}
          invoiceId={inv.id}
          onCancel={() => setPaying(false)}
          onError={onError}
          onDone={(p) => {
            setPaying(false);
            onToast(`Payment of ${money(p.amountCents)} recorded`);
            onChanged();
            reload();
          }}
        />
      )}
    </Modal>
  );
}

/* ================================================================ reports */

function ReportActions({ onCsv }: { onCsv: () => void }) {
  return (
    <div className="report-actions">
      <button className="btn" onClick={onCsv}>
        Export CSV
      </button>
      <button className="btn" onClick={() => window.print()}>
        Print
      </button>
    </div>
  );
}

export function AgingReport({ onError, onOpenClient }: { onError: OnError; onOpenClient: (id: number) => void }) {
  const [r, setR] = useState<{ asOf: string; rows: AgingRow[]; totals: AgingRow } | null>(null);
  useEffect(() => {
    getAging().then(setR).catch(onError);
  }, [onError]);
  if (!r) return <p className="empty">Loading…</p>;

  const cols: [keyof AgingRow, string][] = [
    ['unbilledCents', 'Unbilled'],
    ['currentCents', 'Current'],
    ['days1to30Cents', '1–30'],
    ['days31to60Cents', '31–60'],
    ['days61to90Cents', '61–90'],
    ['days90PlusCents', '90+'],
    ['creditCents', 'Credits'],
    ['balanceCents', 'Balance'],
  ];

  return (
    <section className="report">
      <div className="report-head">
        <p className="muted">
          As of {day(r.asOf)}. Invoiced balances are aged by days past due. Unbilled charges and
          unapplied payments are shown beside them, so Balance equals charges less payments.
        </p>
        <ReportActions
          onCsv={() =>
            downloadCsv(
              `accounts-receivable-${r.asOf}.csv`,
              ['Client', ...cols.map((c) => c[1]), 'Last payment'],
              [...r.rows, r.totals].map((x) => [
                x.clientName,
                ...cols.map((c) => ((x[c[0]] as number) / 100).toFixed(2)),
                x.lastPaymentOn ?? '',
              ]),
            )
          }
        />
      </div>
      <div className="kpis kpis-compact">
        <Stat label="Total receivable" value={money(r.totals.balanceCents)} />
        <Stat label="Current" value={money(r.totals.currentCents)} hint="Invoiced, not yet due" />
        <Stat
          label="Past due"
          value={money(r.totals.days1to30Cents + r.totals.days31to60Cents + r.totals.days61to90Cents + r.totals.days90PlusCents)}
          tone={r.totals.days1to30Cents + r.totals.days31to60Cents + r.totals.days61to90Cents + r.totals.days90PlusCents > 0 ? 'bad' : undefined}
        />
        <Stat label="Unbilled" value={money(r.totals.unbilledCents)} hint="Not yet invoiced" />
      </div>
      {r.rows.length === 0 ? (
        <div className="empty-state">
          <p>
            <strong>Nothing outstanding.</strong>
          </p>
          <p className="muted">Every client is paid up.</p>
        </div>
      ) : (
        <div className="grid-wrap">
          <table className="grid report-table">
            <thead>
              <tr>
                <th>Client</th>
                {cols.map(([, l]) => (
                  <th key={l} className="num">
                    {l}
                  </th>
                ))}
                <th>Last payment</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.clientId} className="clickable" onClick={() => x.clientId && onOpenClient(x.clientId)}>
                  <td>
                    <strong>{x.clientName}</strong>
                  </td>
                  {cols.map(([k]) => (
                    <td key={k} className={`num${k.startsWith('days') && (x[k] as number) > 0 ? ' neg' : ''}`}>
                      {(x[k] as number) === 0 ? <span className="muted">—</span> : money(x[k] as number)}
                    </td>
                  ))}
                  <td className="nowrap">{day(x.lastPaymentOn)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Total</th>
                {cols.map(([k]) => (
                  <th key={k} className="num">
                    {money(r.totals[k] as number)}
                  </th>
                ))}
                <th />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

export function RevenueReport({ onError }: { onError: OnError }) {
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [r, setR] = useState<Awaited<ReturnType<typeof getRevenue>> | null>(null);

  useEffect(() => {
    getRevenue(from, to).then(setR).catch(onError);
  }, [from, to, onError]);

  const maxBilled = useMemo(() => Math.max(1, ...(r?.months ?? []).map((m) => Math.max(m.billedCents, m.collectedCents))), [r]);

  const monthLabel = (m: string) => {
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  };

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
          <ReportActions
            onCsv={() =>
              downloadCsv(
                `revenue-${r.from}-to-${r.to}.csv`,
                ['Month', 'Meetings', 'Hours billed', 'Billed', 'Collected'],
                [...r.months, r.totals].map((m) => [
                  m.month ?? '',
                  m.meetings,
                  ((m.blocks * 30) / 60).toFixed(1),
                  (m.billedCents / 100).toFixed(2),
                  (m.collectedCents / 100).toFixed(2),
                ]),
              )
            }
          />
        )}
      </div>
      {!r ? (
        <p className="empty">Loading…</p>
      ) : (
        <>
          <div className="kpis kpis-compact">
            <Stat label="Billed" value={money(r.totals.billedCents)} hint={`${r.totals.meetings} meeting(s)`} />
            <Stat label="Collected" value={money(r.totals.collectedCents)} />
            <Stat label="Hours billed" value={hours(r.totals.blocks * 30)} hint={`${r.totals.blocks} × 30-min blocks`} />
            <Stat label="Hours recorded" value={hours(r.totals.minutes)} hint="Before rounding to blocks" />
          </div>

          <h4 className="subhead">By month</h4>
          {r.months.length === 0 ? (
            <p className="empty">No billing or payments in this range.</p>
          ) : (
            <div className="grid-wrap">
              <table className="grid report-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">Meetings</th>
                    <th className="num">Hours billed</th>
                    <th className="num">Billed</th>
                    <th className="num">Collected</th>
                    <th className="bar-col">Billed vs collected</th>
                  </tr>
                </thead>
                <tbody>
                  {r.months.map((m) => (
                    <tr key={m.month}>
                      <td>{monthLabel(m.month!)}</td>
                      <td className="num">{m.meetings}</td>
                      <td className="num">{hours(m.blocks * 30)}</td>
                      <td className="num">{money(m.billedCents)}</td>
                      <td className="num">{money(m.collectedCents)}</td>
                      <td className="bar-col">
                        <span className="bar bar-billed" style={{ width: `${(Math.max(0, m.billedCents) / maxBilled) * 100}%` }} />
                        <span className="bar bar-collected" style={{ width: `${(m.collectedCents / maxBilled) * 100}%` }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    <th className="num">{r.totals.meetings}</th>
                    <th className="num">{hours(r.totals.blocks * 30)}</th>
                    <th className="num">{money(r.totals.billedCents)}</th>
                    <th className="num">{money(r.totals.collectedCents)}</th>
                    <th className="bar-col legend">
                      <span className="bar-key billed" /> Billed <span className="bar-key collected" /> Collected
                    </th>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <h4 className="subhead">By client</h4>
          {r.clients.length === 0 ? (
            <p className="empty">No client activity in this range.</p>
          ) : (
            <div className="grid-wrap">
              <table className="grid report-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th className="num">Meetings</th>
                    <th className="num">Hours billed</th>
                    <th className="num">Billed</th>
                    <th className="num">Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {r.clients.map((c: RevenueRow) => (
                    <tr key={c.clientId}>
                      <td>
                        <strong>{c.clientName}</strong>
                      </td>
                      <td className="num">{c.meetings}</td>
                      <td className="num">{hours(c.blocks * 30)}</td>
                      <td className="num">{money(c.billedCents)}</td>
                      <td className="num">{money(c.collectedCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function UnbilledReport({
  onError,
  onOpenMeeting,
  onOpenClient,
}: {
  onError: OnError;
  onOpenMeeting: (id: number) => void;
  onOpenClient: (id: number) => void;
}) {
  const [r, setR] = useState<Awaited<ReturnType<typeof getUnbilled>> | null>(null);
  useEffect(() => {
    getUnbilled().then(setR).catch(onError);
  }, [onError]);
  if (!r) return <p className="empty">Loading…</p>;

  const byClient = new Map<number, Charge[]>();
  r.charges.forEach((c) => byClient.set(c.clientId, [...(byClient.get(c.clientId) ?? []), c]));

  return (
    <section className="report">
      <div className="report-head">
        <p className="muted">Charges not yet on an invoice, and past meetings whose billing needs a look.</p>
        <ReportActions
          onCsv={() =>
            downloadCsv(
              'unbilled-charges.csv',
              ['Client', 'Date', 'Description', 'Minutes', 'Blocks', 'Amount'],
              r.charges.map((c) => [c.clientName, c.serviceDate, c.description, c.minutes ?? '', c.blocks ?? '', (c.amountCents / 100).toFixed(2)]),
            )
          }
        />
      </div>
      <div className="kpis kpis-compact">
        <Stat label="Unbilled total" value={money(r.totalCents)} hint={`${r.charges.length} charge(s), ${byClient.size} client(s)`} />
        <Stat label="Meetings needing attention" value={String(r.attention.length)} tone={r.attention.length ? 'warn' : undefined} />
      </div>

      <h4 className="subhead">Needs attention</h4>
      {r.attention.length === 0 ? (
        <p className="empty">Every past meeting is completed and billed.</p>
      ) : (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Meeting</th>
                <th>Client</th>
                <th>Status</th>
                <th className="num">Recorded</th>
                <th>Issue</th>
              </tr>
            </thead>
            <tbody>
              {r.attention.map((a) => (
                <tr key={a.appointmentId} className="clickable" onClick={() => onOpenMeeting(a.appointmentId)}>
                  <td className="nowrap">{new Date(a.startsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td>
                    <strong>{a.clientName}</strong>
                    <div className="muted small">{a.engagementTitle}</div>
                  </td>
                  <td>
                    <span className={`status status-ap-${a.status}`}>{statusLabel(a.status)}</span>
                  </td>
                  <td className="num">{a.recordedMinutes} min</td>
                  <td className="hint-warn">{a.issue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4 className="subhead">Unbilled charges by client</h4>
      {byClient.size === 0 ? (
        <p className="empty">Nothing unbilled.</p>
      ) : (
        [...byClient.entries()].map(([cid, list]) => (
          <div key={cid} className="client-block">
            <div className="client-block-head">
              <strong>{list[0].clientName}</strong>
              <span>
                {money(list.reduce((t, c) => t + c.amountCents, 0))}{' '}
                <button className="linklike" onClick={() => onOpenClient(cid)}>
                  Open account →
                </button>
              </span>
            </div>
            <ChargeTable charges={list} />
          </div>
        ))
      )}
    </section>
  );
}

/* ======================================================= printable pages */

function PrintShell({
  title,
  children,
  loading,
  back = { to: '/admin', label: 'Admin console' },
}: {
  title: string;
  children: ReactNode;
  loading: boolean;
  back?: { to: string; label: string };
}) {
  useEffect(() => {
    document.title = `${title} · Data Painters`;
  }, [title]);
  return (
    <div className="print-page">
      <div className="print-bar no-print">
        <Link to={back.to} className="linklike">
          ← {back.label}
        </Link>
        <button className="btn btn-primary" onClick={() => window.print()} disabled={loading}>
          Print / Save as PDF
        </button>
      </div>
      <article className="doc">
        <header className="doc-head">
          <div>
            <div className="doc-brand">Data Painters</div>
            <div className="doc-sub">Enterprise AI consulting</div>
          </div>
          <div className="doc-title">{title}</div>
        </header>
        {loading ? <p>Loading…</p> : children}
      </article>
    </div>
  );
}

function useDoc<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    load()
      .then(setData)
      .catch((e) => setError((e as Error).message || 'Could not load'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { data, error };
}

export function PrintMeeting() {
  const id = Number(useParams().id);
  const { data: m, error } = useDoc<MeetingSummary>(() => getMeetingSummary(id));
  return (
    <PrintShell title="Meeting Summary" loading={!m && !error}>
      {error && <p className="error">{error}</p>}
      {m && (
        <>
          <dl className="doc-meta">
            <div>
              <dt>Client</dt>
              <dd>
                {m.client.name}
                {m.client.contactName && <div className="muted">{m.client.contactName}</div>}
              </dd>
            </div>
            <div>
              <dt>Engagement</dt>
              <dd>{m.engagementTitle}</dd>
            </div>
            <div>
              <dt>Meeting</dt>
              <dd>
                {formatRange(m.startsAt, m.endsAt)}
                <div className="muted">Status: {statusLabel(m.status)}</div>
              </dd>
            </div>
            <div>
              <dt>Reference</dt>
              <dd>M-{String(m.appointmentId).padStart(6, '0')}</dd>
            </div>
          </dl>

          <h2 className="doc-h">Agenda and outcomes</h2>
          {m.agenda.length === 0 ? (
            <p className="muted">No agenda items were recorded for this meeting.</p>
          ) : (
            <ol className="doc-agenda">
              {m.agenda.map((t, i) => (
                <li key={i}>
                  <div className="doc-agenda-head">
                    <strong>{t.title}</strong>
                    <span className="doc-tag">{t.status}</span>
                  </div>
                  {t.detail && <p className="muted">{t.detail}</p>}
                  {t.desiredOutcome && (
                    <p>
                      <em>Desired outcome:</em> {t.desiredOutcome}
                    </p>
                  )}
                  <div className="doc-note">
                    <span>Notes</span>
                    <p>{t.note ?? '—'}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <h2 className="doc-h">Time</h2>
          {m.time.length === 0 ? (
            <p className="muted">No time recorded.</p>
          ) : (
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>Note</th>
                  <th className="num">Minutes</th>
                </tr>
              </thead>
              <tbody>
                {m.time.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.source === 'video'
                        ? 'Video call'
                        : t.manual
                        ? 'Manual entry'
                        : `${new Date(t.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${
                            t.endedAt ? new Date(t.endedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'running'
                          }`}
                    </td>
                    <td>{t.note ?? ''}</td>
                    <td className="num">{t.minutes}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Total recorded</td>
                  <td className="num">{m.recordedMinutes}</td>
                </tr>
                <tr>
                  <td colSpan={2}>Billable 30-minute blocks</td>
                  <td className="num">{m.blocks}</td>
                </tr>
                <tr className="doc-total">
                  <td colSpan={2}>
                    {m.charge ? 'Charged' : 'Estimated charge'}
                    {m.billable ? ` at ${money(m.charge?.rateCents ?? m.rateCents)}/hour` : ' (complimentary)'}
                    {m.charge?.invoiceNumber ? ` · invoice ${m.charge.invoiceNumber}` : ''}
                  </td>
                  <td className="num">{money(m.charge ? m.charge.amountCents : m.estimatedCents)}</td>
                </tr>
              </tfoot>
            </table>
          )}
          <p className="doc-foot">Generated {new Date(m.generatedAt).toLocaleString()}.</p>
        </>
      )}
    </PrintShell>
  );
}

/** Admin and client share these documents; only the loader and way back differ. */
type DocSource = 'admin' | 'client';
const CLIENT_BACK = { to: '/portal?view=billing', label: 'Back to billing' };

export function PrintInvoice({ source = 'admin' }: { source?: DocSource }) {
  const id = Number(useParams().id);
  const { data: d, error } = useDoc<InvoiceDetail>(() =>
    source === 'client' ? getMyInvoice(id) : getInvoice(id),
  );
  const inv = d?.invoice;
  return (
    <PrintShell
      title={inv ? `Invoice ${inv.number}` : 'Invoice'}
      loading={!d && !error}
      back={source === 'client' ? CLIENT_BACK : undefined}
    >
      {error && <p className="error">{error}</p>}
      {d && inv && (
        <>
          {inv.voidedAt && <p className="doc-void">VOID — {inv.voidReason ?? 'voided'}</p>}
          <dl className="doc-meta">
            <div>
              <dt>Bill to</dt>
              <dd>
                {d.client.name}
                {d.client.contactName && <div>Attn: {d.client.contactName}</div>}
                <div className="muted">{d.client.primaryEmail}</div>
              </dd>
            </div>
            <div>
              <dt>Invoice</dt>
              <dd>{inv.number}</dd>
            </div>
            <div>
              <dt>Issued</dt>
              <dd>{day(inv.issuedOn)}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>{day(inv.dueOn)}</dd>
            </div>
          </dl>
          <table className="doc-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="num">Hours</th>
                <th className="num">Rate</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">{day(l.serviceDate)}</td>
                  <td>{l.description}</td>
                  <td className="num">{l.blocks ? ((l.blocks * 30) / 60).toFixed(1) : ''}</td>
                  <td className="num">{l.rateCents !== null ? money(l.rateCents) : ''}</td>
                  <td className="num">{money(l.amountCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Total</td>
                <td className="num">{money(inv.totalCents)}</td>
              </tr>
              {inv.paidCents > 0 && (
                <tr>
                  <td colSpan={4}>Payments received</td>
                  <td className="num">−{money(inv.paidCents)}</td>
                </tr>
              )}
              <tr className="doc-total">
                <td colSpan={4}>Balance due</td>
                <td className="num">{money(inv.balanceCents)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="doc-terms">
            Time is billed in 30-minute increments. Payment due by {day(inv.dueOn)}.
          </p>
          {inv.notes && <p>{inv.notes}</p>}
          {d.footer && <p className="doc-foot">{d.footer}</p>}
        </>
      )}
    </PrintShell>
  );
}

export function PrintStatement({ source = 'admin' }: { source?: DocSource }) {
  const id = Number(useParams().id);
  const { data: s, error } = useDoc<Statement>(() =>
    source === 'client' ? getMyStatement() : getStatement(id),
  );
  return (
    <PrintShell
      title="Statement of Account"
      loading={!s && !error}
      back={source === 'client' ? CLIENT_BACK : undefined}
    >
      {error && <p className="error">{error}</p>}
      {s && (
        <>
          <dl className="doc-meta">
            <div>
              <dt>Client</dt>
              <dd>
                {s.client.name}
                {s.client.contactName && <div>Attn: {s.client.contactName}</div>}
                <div className="muted">{s.client.primaryEmail}</div>
              </dd>
            </div>
            <div>
              <dt>Statement date</dt>
              <dd>{day(s.asOf)}</dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd>
                <strong>{money(s.summary.balanceCents)}</strong>
              </dd>
            </div>
            <div>
              <dt>Overdue</dt>
              <dd>{money(s.summary.overdueCents)}</dd>
            </div>
          </dl>
          <table className="doc-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Reference</th>
                <th>Description</th>
                <th className="num">Charges</th>
                <th className="num">Credits</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {s.lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No activity.
                  </td>
                </tr>
              )}
              {s.lines.map((l, i) => (
                <tr key={i}>
                  <td className="nowrap">{day(l.date)}</td>
                  <td>{l.type}</td>
                  <td>{l.reference}</td>
                  <td>{l.description}</td>
                  <td className="num">{l.debitCents ? money(l.debitCents) : ''}</td>
                  <td className="num">{l.creditCents ? money(l.creditCents) : ''}</td>
                  <td className="num">{money(l.balanceCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="doc-total">
                <td colSpan={6}>Balance</td>
                <td className="num">{money(s.summary.balanceCents)}</td>
              </tr>
            </tfoot>
          </table>
          {s.openInvoices.length > 0 && (
            <>
              <h2 className="doc-h">Open invoices</h2>
              <table className="doc-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Issued</th>
                    <th>Due</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {s.openInvoices.map((i) => (
                    <tr key={i.id}>
                      <td>{i.number}</td>
                      <td>{day(i.issuedOn)}</td>
                      <td>
                        {day(i.dueOn)}
                        {i.daysOverdue > 0 && <span className="doc-overdue"> · {i.daysOverdue} days overdue</span>}
                      </td>
                      <td className="num">{money(i.balanceCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {s.footer && <p className="doc-foot">{s.footer}</p>}
        </>
      )}
    </PrintShell>
  );
}

/* ======================================================= engagement costs */

export function EngagementCostsReport({ onError, onToast }: { onError: OnError; onToast: (m: string) => void }) {
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [r, setR] = useState<CostReport | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [key, setKey] = useState(0);

  useEffect(() => {
    getCostReport(from, to).then(setR).catch(onError);
  }, [from, to, key, onError]);

  async function sync() {
    setSyncing(true);
    try {
      const s = await syncVideoUsage();
      onToast(
        s.enabled
          ? `Video usage synced: ${s.sessions} call(s) from ${s.rooms} room(s)${s.failed ? `, ${s.failed} failed` : ''}`
          : 'Video is not configured, so there is no usage to sync',
      );
      setKey((k) => k + 1);
    } catch (e) {
      onError(e);
    } finally {
      setSyncing(false);
    }
  }

  const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`);

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
        <div className="report-actions">
          <button className="btn" onClick={sync} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync video usage'}
          </button>
          {r && (
            <button
              className="btn"
              onClick={() =>
                downloadCsv(
                  `engagement-costs-${r.from}-to-${r.to}.csv`,
                  ['Client', 'Engagement', 'Status', 'Meetings', 'Hours billed', 'Billed', 'Video calls', 'Participant minutes', 'Video cost', 'Other costs', 'Total cost', 'Margin', 'Margin %'],
                  [...r.rows, r.totals].map((x) => [
                    x.clientName ?? '',
                    x.engagementTitle,
                    x.engagementStatus ?? '',
                    x.meetings,
                    (x.billedMinutes / 60).toFixed(2),
                    (x.billedCents / 100).toFixed(2),
                    x.videoSessions,
                    x.participantMinutes,
                    (x.videoCostCents / 100).toFixed(2),
                    (x.otherCostCents / 100).toFixed(2),
                    (x.totalCostCents / 100).toFixed(2),
                    (x.marginCents / 100).toFixed(2),
                    x.marginPercent ?? '',
                  ]),
                )
              }
            >
              Export CSV
            </button>
          )}
          <button className="btn" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>

      {!r ? (
        <p className="empty">Loading…</p>
      ) : (
        <>
          <div className="kpis kpis-compact">
            <Stat label="Billed" value={money(r.totals.billedCents)} hint={`${r.totals.meetings} completed meeting(s)`} />
            <Stat
              label="Video cost"
              value={money(r.totals.videoCostCents)}
              hint={`${r.totals.participantMinutes.toLocaleString()} participant-min at $${r.videoRatePerMinute}`}
            />
            <Stat label="Other costs" value={money(r.totals.otherCostCents)} hint="Entered by hand" />
            <Stat
              label="Margin"
              value={money(r.totals.marginCents)}
              tone={r.totals.marginCents < 0 ? 'bad' : undefined}
              hint={r.totals.marginPercent === null ? 'No billing in range' : `${pct(r.totals.marginPercent)} of billed`}
            />
          </div>
          <p className="muted small report-note">
            Video cost is Daily usage (every participant's minutes in each call) at the rate in System
            options. Revenue is billed charges on the engagement. Click an engagement for its calls
            and to add costs such as software, subcontractors or travel.
          </p>
          {r.rows.length === 0 ? (
            <div className="empty-state">
              <p>
                <strong>No engagement activity in this range.</strong>
              </p>
            </div>
          ) : (
            <div className="grid-wrap">
              <table className="grid report-table">
                <thead>
                  <tr>
                    <th>Engagement</th>
                    <th className="num">Meetings</th>
                    <th className="num">Billed</th>
                    <th className="num">Video calls</th>
                    <th className="num">Video cost</th>
                    <th className="num">Other costs</th>
                    <th className="num">Total cost</th>
                    <th className="num">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((x) => (
                    <tr key={x.engagementId} className="clickable" onClick={() => setOpen(x.engagementId)}>
                      <td>
                        <strong>{x.engagementTitle}</strong>
                        <div className="muted small">
                          {x.clientName} · {x.engagementStatus}
                        </div>
                      </td>
                      <td className="num">{x.meetings}</td>
                      <td className="num">{money(x.billedCents)}</td>
                      <td className="num">
                        {x.videoSessions}
                        {x.participantMinutes > 0 && <div className="muted small">{x.participantMinutes} p-min</div>}
                      </td>
                      <td className="num">{money(x.videoCostCents)}</td>
                      <td className="num">{money(x.otherCostCents)}</td>
                      <td className="num">
                        <strong>{money(x.totalCostCents)}</strong>
                      </td>
                      <td className={`num${x.marginCents < 0 ? ' neg' : ''}`}>
                        {money(x.marginCents)}
                        <div className="muted small">{pct(x.marginPercent)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    <th className="num">{r.totals.meetings}</th>
                    <th className="num">{money(r.totals.billedCents)}</th>
                    <th className="num">{r.totals.videoSessions}</th>
                    <th className="num">{money(r.totals.videoCostCents)}</th>
                    <th className="num">{money(r.totals.otherCostCents)}</th>
                    <th className="num">{money(r.totals.totalCostCents)}</th>
                    <th className="num">{money(r.totals.marginCents)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {open !== null && (
        <CostDetailModal
          engagementId={open}
          onClose={() => {
            setOpen(null);
            setKey((k) => k + 1);
          }}
          onError={onError}
          onToast={onToast}
        />
      )}
    </section>
  );
}

function CostDetailModal({
  engagementId,
  onClose,
  onError,
  onToast,
}: {
  engagementId: number;
  onClose: () => void;
  onError: OnError;
  onToast: (m: string) => void;
}) {
  const [d, setD] = useState<CostDetail | null>(null);
  const [category, setCategory] = useState('software');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [incurredOn, setIncurredOn] = useState(todayIso());
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => getCostDetail(engagementId).then(setD).catch(onError), [engagementId, onError]);
  useEffect(() => {
    reload();
  }, [reload]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await addEngagementCost(engagementId, { category, description, amount, incurredOn });
      onToast('Cost added');
      setDescription('');
      setAmount('');
      reload();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  const live = d?.costs.filter((c) => !c.voidedAt) ?? [];
  const videoTotal = d?.video.reduce((t, v) => t + v.costCents, 0) ?? 0;

  return (
    <Modal title={d ? d.engagementTitle : 'Engagement costs'} badge={d?.clientName} badgeTone="neutral" onClose={onClose} wide>
      {!d ? (
        <p>Loading…</p>
      ) : (
        <>
          <h4 className="subhead">Video calls</h4>
          {d.video.length === 0 ? (
            <p className="empty">No video calls recorded. Use “Sync video usage” on the report to pull them from Daily.</p>
          ) : (
            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Call</th>
                    <th className="num">Length</th>
                    <th className="num">People</th>
                    <th className="num">Participant-min</th>
                    <th className="num">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {d.video.map((v) => (
                    <tr key={v.sessionId}>
                      <td className="nowrap">{new Date(v.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
                      <td className="num">{Math.ceil(v.durationSeconds / 60)} min</td>
                      <td className="num">{v.maxParticipants}</td>
                      <td className="num">{v.participantMinutes}</td>
                      <td className="num">{money(v.costCents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={4}>Video total at ${d.videoRatePerMinute}/participant-minute</th>
                    <th className="num">{money(videoTotal)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <h4 className="subhead">Other costs</h4>
          {live.length === 0 ? (
            <p className="empty">None recorded.</p>
          ) : (
            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th className="num">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {live.map((c) => (
                    <tr key={c.id}>
                      <td className="nowrap">{day(c.incurredOn)}</td>
                      <td>{COST_CATEGORIES.find((k) => k.value === c.category)?.label ?? c.category}</td>
                      <td>{c.description}</td>
                      <td className="num">{money(c.amountCents)}</td>
                      <td>
                        <button
                          className="linklike danger"
                          onClick={async () => {
                            if (!window.confirm('Void this cost?')) return;
                            try {
                              await voidEngagementCost(c.id);
                              onToast('Cost voided');
                              reload();
                            } catch (e) {
                              onError(e);
                            }
                          }}
                        >
                          Void
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form className="cost-form" onSubmit={add}>
            <label>
              Category
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {COST_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grow">
              Description
              <input required value={description} placeholder="Vector database, December" onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label>
              Amount
              <div className="input-affix">
                <span aria-hidden="true">$</span>
                <input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            </label>
            <label>
              Date
              <input type="date" value={incurredOn} onChange={(e) => setIncurredOn(e.target.value)} />
            </label>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              Add cost
            </button>
          </form>
        </>
      )}
    </Modal>
  );
}
