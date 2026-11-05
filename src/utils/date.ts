// ============================================================
// Poshakh – calendar helpers (local device date, never UTC)
// ============================================================
import { addDays, toDay, weekdayOf } from '../engine';
import { STRINGS } from '../strings';

/** Today's date on the device, as YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** "05/11/2026" */
export function fmt(date?: string | null): string {
  if (!date) return '—';
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

/** "Thu 05/11" */
export function fmtShort(date?: string | null): string {
  if (!date) return '—';
  const [, m, d] = date.split('-');
  return `${STRINGS.dayNamesShort[weekdayOf(toDay(date))]} ${d}/${m}`;
}

/** "Thu, 5 Nov 2026" in the current language */
export function fmtLong(date?: string | null): string {
  if (!date) return '—';
  const [y, m, d] = date.split('-').map(Number);
  return `${STRINGS.dayNamesShort[weekdayOf(toDay(date))]}, ${d} ${STRINGS.monthShort[m - 1]} ${y}`;
}

/** "Today", "Tomorrow" or "Thu 05/11" */
export function fmtRelative(date: string, today: string): string {
  if (date === today) return STRINGS.today;
  if (date === addDays(today, 1)) return STRINGS.tomorrow;
  return fmtShort(date);
}

/** Monday-based (or weekStartsOn-based) week range containing `date`, shifted by `offset` weeks. */
export function weekRange(date: string, weekStartsOn: number, offset = 0): [string, string] {
  const diff = (weekdayOf(toDay(date)) - weekStartsOn + 7) % 7;
  const start = addDays(date, -diff + offset * 7);
  return [start, addDays(start, 6)];
}

export function monthRange(date: string, offset = 0): [string, string] {
  const [y, m] = date.split('-').map(Number);
  const first = new Date(y, m - 1 + offset, 1);
  const last = new Date(y, m + offset, 0);
  const f = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return [f(first), f(last)];
}
