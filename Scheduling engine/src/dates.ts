import type { DateStr, Weekday } from './types';

/**
 * Dates are handled internally as integer day numbers (days since 1970-01-01, UTC
 * calendar arithmetic). This avoids time zones and DST entirely: we never touch
 * the device clock, only calendar labels.
 */
export type DayNum = number;

const MS_PER_DAY = 86_400_000;
const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function toDay(s: DateStr): DayNum {
  const m = RE.exec(s);
  if (!m) throw new Error(`Invalid date "${s}", expected YYYY-MM-DD`);
  const y = +m[1], mo = +m[2], d = +m[3];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new Error(`Invalid calendar date "${s}"`);
  }
  return Math.round(ms / MS_PER_DAY);
}

export function fromDay(n: DayNum): DateStr {
  const d = new Date(n * MS_PER_DAY);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function weekdayOf(n: DayNum): Weekday {
  // 1970-01-01 was a Thursday (4).
  return (((n + 4) % 7) + 7) % 7 as Weekday;
}

export function addDays(s: DateStr, k: number): DateStr {
  return fromDay(toDay(s) + k);
}

/** Start (day number) of the week containing n. */
export function weekStartOf(n: DayNum, weekStartsOn: Weekday): DayNum {
  const diff = (weekdayOf(n) - weekStartsOn + 7) % 7;
  return n - diff;
}
