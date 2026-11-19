/**
 * Filter bar, sortable grid and pager, shared by every admin list.
 *
 * One component rather than three copies: the three lists differ only in
 * their columns and how a cell is rendered, and a filter UI that behaves
 * differently depending on which tab you are on is a bug waiting to happen.
 *
 * The column list and the operators come from the server, so what the
 * dropdowns offer is always what the API will accept.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';

export interface GridColumn {
  field: string;
  label: string;
  /** text | number | date | datetime — decides operators and alignment. */
  type: string;
}

export interface GridFilter {
  field: string;
  op: string;
  value: string;
}

export interface GridPage<T> {
  rows: T[];
  page: number;
  size: number;
  total: number;
  totalPages: number;
}

/** Operators, narrowed per column type so the choices make sense. */
const OPERATORS: { op: string; label: string; types: string[] }[] = [
  { op: 'contains', label: 'contains', types: ['text'] },
  { op: 'notContains', label: 'does not contain', types: ['text'] },
  { op: 'startsWith', label: 'starts with', types: ['text'] },
  { op: 'endsWith', label: 'ends with', types: ['text'] },
  { op: 'eq', label: 'is', types: ['text', 'number', 'date', 'datetime'] },
  { op: 'ne', label: 'is not', types: ['text', 'number', 'date', 'datetime'] },
  { op: 'gt', label: 'greater than', types: ['number', 'date', 'datetime'] },
  { op: 'gte', label: 'at least', types: ['number', 'date', 'datetime'] },
  { op: 'lt', label: 'less than', types: ['number', 'date', 'datetime'] },
  { op: 'lte', label: 'at most', types: ['number', 'date', 'datetime'] },
  { op: 'isEmpty', label: 'is empty', types: ['text', 'number', 'date', 'datetime'] },
];

export function operatorsFor(type: string) {
  return OPERATORS.filter((o) => o.types.includes(type));
}

function operatorLabel(op: string) {
  return OPERATORS.find((o) => o.op === op)?.label ?? op;
}

/** Serialises filters and sort the way the server parses them. */
export function buildQuery(
  filters: GridFilter[],
  sort: string,
  page: number,
  size: number,
): string {
  const params = new URLSearchParams();
  for (const f of filters) {
    // field:op:value — the server splits on the first two colons only, so a
    // value containing one (a timestamp) survives the round trip.
    params.append('filter', `${f.field}:${f.op}:${f.value}`);
  }
  if (sort) params.set('sort', sort);
  params.set('page', String(page));
  params.set('size', String(size));
  return params.toString();
}

/* ------------------------------------------------------------- filter bar */

export function FilterBar({
  columns,
  filters,
  onChange,
  addLabel,
  onAdd,
}: {
  columns: GridColumn[];
  filters: GridFilter[];
  onChange: (next: GridFilter[]) => void;
  /** Label for the primary action sitting to the right of Add Filter. */
  addLabel: string;
  onAdd: () => void;
}) {
  const [field, setField] = useState('');
  const [op, setOp] = useState('');
  const [value, setValue] = useState('');

  const column = columns.find((c) => c.field === field);
  const available = useMemo(
    () => (column ? operatorsFor(column.type) : []),
    [column],
  );

  // Default to the first column, and reset the operator whenever the column
  // type changes so an operator that no longer applies cannot be submitted.
  useEffect(() => {
    if (!field && columns.length > 0) setField(columns[0].field);
  }, [columns, field]);

  useEffect(() => {
    if (available.length > 0 && !available.some((o) => o.op === op)) {
      setOp(available[0].op);
    }
  }, [available, op]);

  const needsValue = op !== 'isEmpty';
  const canAdd = Boolean(field && op && (!needsValue || value.trim()));

  function add() {
    if (!canAdd) return;
    onChange([...filters, { field, op, value: needsValue ? value.trim() : '' }]);
    setValue('');
  }

  return (
    <div className="filterbar">
      <div className="filterbar-row">
        <select
          value={field}
          onChange={(e) => setField(e.target.value)}
          aria-label="Column"
        >
          {columns.map((c) => (
            <option key={c.field} value={c.field}>
              {c.label}
            </option>
          ))}
        </select>

        <select value={op} onChange={(e) => setOp(e.target.value)} aria-label="Operator">
          {available.map((o) => (
            <option key={o.op} value={o.op}>
              {o.label}
            </option>
          ))}
        </select>

        <input
          className="filter-value"
          value={value}
          disabled={!needsValue}
          placeholder={needsValue ? 'Value' : 'No value needed'}
          aria-label="Value"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds the filter. Typing a value then reaching for the
            // mouse is the slow path and nobody does it twice.
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />

        <button className="btn" onClick={add} disabled={!canAdd}>
          Add Filter
        </button>
        <button className="btn btn-primary" onClick={onAdd}>
          {addLabel}
        </button>
      </div>

      {filters.length > 0 && (
        <div className="filter-tags">
          {filters.map((f, i) => (
            <span className="filter-tag" key={`${f.field}-${f.op}-${f.value}-${i}`}>
              <strong>{columns.find((c) => c.field === f.field)?.label ?? f.field}</strong>
              <span className="filter-op">{operatorLabel(f.op)}</span>
              {f.op !== 'isEmpty' && <span className="filter-val">{f.value}</span>}
              <button
                aria-label="Remove filter"
                onClick={() => onChange(filters.filter((_, j) => j !== i))}
              >
                &times;
              </button>
            </span>
          ))}
          <button className="linklike" onClick={() => onChange([])}>
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- data grid */

export interface GridColumnDef<T> {
  field: string;
  label: string;
  type?: string;
  render?: (row: T) => ReactNode;
  /** Suppresses the sort affordance for a column the server cannot order. */
  sortable?: boolean;
}

export function DataGrid<T>({
  columns,
  rows,
  sort,
  onSort,
  onRowClick,
  rowClassName,
  empty,
}: {
  columns: GridColumnDef<T>[];
  rows: T[];
  sort: string;
  onSort: (next: string) => void;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  empty: string;
}) {
  const [sortField, sortDir] = sort.split(':');

  function toggle(field: string) {
    // First click sorts ascending; clicking the active column flips it.
    onSort(sortField === field && sortDir === 'asc' ? `${field}:desc` : `${field}:asc`);
  }

  if (rows.length === 0) {
    return <p className="empty">{empty}</p>;
  }

  return (
    <div className="grid-wrap">
      <table className="grid grid-rich">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sortField === c.field;
              const sortable = c.sortable !== false;
              return (
                <th
                  key={c.field}
                  className={[
                    c.type === 'number' ? 'num' : '',
                    sortable ? 'sortable' : '',
                    active ? 'sorted' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-sort={active ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
                  onClick={sortable ? () => toggle(c.field) : undefined}
                >
                  {c.label}
                  {sortable && (
                    <span className="sort-caret" aria-hidden="true">
                      {active ? (sortDir === 'desc' ? '▼' : '▲') : '↕'}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={[rowClassName?.(row), onRowClick ? 'clickable' : '']
                .filter(Boolean)
                .join(' ')}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.field} className={c.type === 'number' ? 'num' : undefined}>
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.field] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ pager */

export function Pager({
  page,
  totalPages,
  total,
  size,
  onPage,
  onSize,
}: {
  page: number;
  totalPages: number;
  total: number;
  size: number;
  onPage: (next: number) => void;
  onSize: (next: number) => void;
}) {
  const first = total === 0 ? 0 : page * size + 1;
  const last = Math.min((page + 1) * size, total);

  return (
    <div className="pager">
      <span className="muted">
        {total === 0 ? 'No rows' : `${first}–${last} of ${total}`}
      </span>

      <div className="pager-controls">
        <button className="btn" disabled={page === 0} onClick={() => onPage(0)}>
          &laquo;
        </button>
        <button className="btn" disabled={page === 0} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <span className="muted">
          Page {page + 1} of {totalPages}
        </span>
        <button
          className="btn"
          disabled={page >= totalPages - 1}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
        <button
          className="btn"
          disabled={page >= totalPages - 1}
          onClick={() => onPage(totalPages - 1)}
        >
          &raquo;
        </button>

        <select
          value={size}
          aria-label="Rows per page"
          onChange={(e) => onSize(Number(e.target.value))}
        >
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
