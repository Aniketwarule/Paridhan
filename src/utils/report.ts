// ============================================================
// Poshakh – the numbers on the Reports screen for one period
// ============================================================
import { addDays, report, toDay, weekdayOf } from '../engine';
import { STRINGS } from '../strings';
import type { Blouse, OrderPart, SmallWork } from '../types';
import { STITCH_TYPES } from './labels';

export function workReport(
  { parts, blouses, smallWork }: { parts: OrderPart[]; blouses: Blouse[]; smallWork: SmallWork[] },
  from: string,
  to: string,
) {
  const r = report(
    parts.map(p => ({ ...p, id: String(p.id), orderId: String(p.orderId) })),
    blouses.map(b => ({ ...b, id: String(b.id), partId: String(b.partId) })),
    from,
    to,
  );
  const between = (d?: string) => !!d && d >= from && d <= to;
  const partById = new Map(parts.map(p => [p.id, p]));

  // Breakdown of what was handed over in the period.
  const delivered = blouses.filter(b => {
    const p = partById.get(b.partId);
    return b.status !== 'cancelled' && p && !p.cancelled && between(p.deliveredOn);
  });
  const count = (f: (b: Blouse) => boolean) => delivered.filter(f).length;

  // Small work is not stitched, so it only adds to what was delivered and what is due.
  const smallValue = (inRange: (p: OrderPart) => boolean) => smallWork.reduce((s, w) => {
    const p = partById.get(w.partId);
    return p && !p.cancelled && inRange(p) ? s + w.price * w.qty : s;
  }, 0);
  const smallDelivered = smallValue(p => between(p.deliveredOn));

  // How many pieces were stitched on each day of the period.
  const stitchedByDay: Record<string, number> = {};
  for (const b of blouses) {
    const p = partById.get(b.partId);
    if (b.status === 'done' && between(b.doneDate) && p && !p.cancelled) {
      stitchedByDay[b.doneDate!] = (stitchedByDay[b.doneDate!] ?? 0) + 1;
    }
  }

  return {
    ...r,
    stitchedByDay,
    income: r.deliveredValue + smallDelivered,
    dueValue: r.dueValue + smallValue(p => between(p.promisedDelivery)),
    smallDelivered,
    byType: STITCH_TYPES.map(t => ({ type: t, n: count(b => b.type === t) })).filter(x => x.n > 0),
    emergency: count(b => partById.get(b.partId)?.priority === 'emergency'),
    general: count(b => partById.get(b.partId)?.priority === 'general'),
    // A nav-vari is a whole day, so a plain count can't be set against the week's target.
    anyNavvariStitched: blouses.some(b => b.type === 'navvari' && b.status === 'done' && between(b.doneDate)),
  };
}

export interface ChartBar {
  key: string;
  label: string;
  /** Long name for the caption, e.g. "Thu 05/11" or "Wk 2 (09/11–15/11)". */
  title: string;
  n: number;
}

const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/**
 * Bars for the "stitched" chart: one per day for a week, one per week for a month
 * (30 thin bars are hard to read on a phone).
 */
export function stitchedBars(
  byDay: Record<string, number>, from: string, to: string, period: 'weekly' | 'monthly', weekStartsOn: number,
): ChartBar[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  if (period === 'weekly') {
    return days.map(d => {
      const name = STRINGS.dayNamesShort[weekdayOf(toDay(d))];
      return { key: d, label: name, title: `${name} ${dm(d)}`, n: byDay[d] ?? 0 };
    });
  }
  const bars: ChartBar[] = [];
  let week: string[] = [];
  const flush = () => {
    if (week.length === 0) return;
    const i = bars.length + 1;
    bars.push({
      key: week[0],
      label: STRINGS.reportsWeekNo(i),
      title: `${STRINGS.reportsWeekNo(i)} (${dm(week[0])}–${dm(week[week.length - 1])})`,
      n: week.reduce((s, d) => s + (byDay[d] ?? 0), 0),
    });
    week = [];
  };
  for (const d of days) {
    if (week.length > 0 && weekdayOf(toDay(d)) === weekStartsOn) flush();
    week.push(d);
  }
  flush();
  return bars;
}
