import { DayNum, fromDay, toDay } from './dates';
import {
  Ctx, HORIZON_DAYS, WorkItem, dayCap, firstViolation, isDeliveryDay, isWorking, latestStitchFor, makeCtx, weekOf,
} from './core';
import { CoreSchedule, rebuildSchedule, scheduleCore, usedByWeek } from './schedule';
import type {
  Blouse, DateCheck, DateStr, EngineInput, Order, OrderPart, Priority, QuotePart, QuotePartRequest, DayExtra, WeekUsage,
} from './types';

/** Quoting is read-only: nothing here mutates the input. */

interface Prepared {
  input: EngineInput;
  ctx: Ctx;
  base: CoreSchedule;
  /** Deadlines of existing unfinished blouses (late ones use their real catch-up day). */
  existing: DayNum[];
  /** The same deadlines by blouse id. */
  allowed: Map<string, DayNum>;
  /** Any unfinished full-day piece? Then "enough slots in total" is no longer enough. */
  hasFullDay: boolean;
  /** First day a new order may be stitched. */
  release: DayNum;
  /** Deadline given to work that does not fit in the horizon at all. */
  far: DayNum;
}

/** An already-quoted part of the same order (split orders). */
export interface PriorPart {
  count: number;
  priority: Priority;
  date: DateStr;
  /** How many of `count` take a whole day each. Default 0. */
  fullDayCount?: number;
}

function prepare(input: EngineInput): Prepared {
  const ctx = makeCtx(input);
  const base = scheduleCore(ctx, ctx.items);
  const far = ctx.today + 2 * HORIZON_DAYS;
  const existing: DayNum[] = [];
  const allowed = new Map<string, DayNum>();
  for (const [id, s] of base.stitch) {
    const l = base.latest.get(id) ?? null;
    // A late blouse keeps the day it can actually be done, so new work never pushes it further.
    const deadline = s === null ? far : l === null ? s : Math.max(l, s);
    existing.push(deadline);
    allowed.set(id, deadline);
  }
  const release = ctx.settings.allowNewWorkToday ? ctx.today : ctx.today + 1;
  const hasFullDay = ctx.items.some((it) => it.open && it.fullDay);
  return { input, ctx, base, existing, allowed, hasFullDay, release, far };
}

interface NewItem {
  deadline: DayNum;
  count: number;
  /** How many of `count` take a whole day each. */
  fullDays: number;
  priority: Priority;
  date: DayNum;
}

function expand(items: NewItem[]): DayNum[] {
  const out: DayNum[] = [];
  for (const it of items) for (let i = 0; i < it.count; i++) out.push(it.deadline);
  return out;
}

/** Work items for parts not saved yet; the first `fullDays` of each part take a whole day. */
function newWorkItems(parts: { count: number; fullDays: number; priority: Priority; date: DayNum | null }[]): WorkItem[] {
  const out: WorkItem[] = [];
  parts.forEach((pt, i) => {
    if (pt.date === null) return;
    for (let j = 0; j < pt.count; j++) {
      out.push({
        id: `__new_${i}_${j}`, partId: `__new_${i}`, priority: pt.priority, promised: pt.date,
        createdAt: Number.MAX_SAFE_INTEGER, open: true, fullDay: j < pt.fullDays,
      });
    }
  });
  return out;
}

/**
 * The delivery-date maths: existing + earlier parts + the new blouses due by their
 * deadline must all fit. General work must also fit inside G per week, spread over
 * the days, which keeps room for emergencies.
 */
function violation(P: Prepared, prior: NewItem[], me: NewItem): DayNum | null {
  const fresh = [...prior, me];
  if (P.hasFullDay || fresh.some((x) => x.fullDays > 0)) return placedViolation(P, fresh, me);

  const { ctx, existing } = P;
  const today = ctx.today;
  const freshDeadlines = expand(fresh);
  const all = [...existing, ...freshDeadlines];

  let v = firstViolation(ctx, all, { start: today, mode: 'W' });
  if (v !== null) return v;
  if (P.release > today) {
    v = firstViolation(ctx, freshDeadlines, { start: P.release, mode: 'W' });
    if (v !== null) return v;
  }
  if (me.priority === 'general') {
    const forced = new Map<DayNum, number>();
    for (const d of [...existing, ...expand(prior)]) {
      const ws = weekOf(ctx, Math.max(d, today));
      forced.set(ws, (forced.get(ws) ?? 0) + 1);
    }
    v = firstViolation(ctx, all, { start: today, mode: 'G', forced, checkFrom: me.deadline });
    if (v !== null) return v;
  }
  return null;
}

/**
 * The same question when a full-day piece is involved. A full-day piece cannot be split,
 * so enough slots in total does not prove a whole day is free: run the real scheduler
 * with the new work added and look at where everything lands.
 */
function placedViolation(P: Prepared, fresh: NewItem[], me: NewItem): DayNum | null {
  const { ctx, allowed, far } = P;
  const today = ctx.today;
  const added = newWorkItems(fresh);
  const core = scheduleCore(ctx, [...ctx.items, ...added]);
  const limit = (id: string) => allowed.get(id) ?? core.latest.get(id) ?? today;

  let first: DayNum | null = null;
  for (const [id, s] of core.stitch) {
    const l = limit(id);
    if (s === null ? l < far : s > l) first = first === null ? l : Math.min(first, l);
  }
  if (first !== null) return Math.max(first, today);

  // Same limits as above, with a full-day piece counting the slots it would use.
  const deadlines = (items: WorkItem[]) => items.flatMap((it) =>
    new Array<DayNum>(it.fullDay ? core.slots.get(it.id) ?? 1 : 1).fill(limit(it.id)));
  const mine = `__new_${fresh.length - 1}`;
  const before = deadlines([...ctx.items.filter((it) => it.open), ...added.filter((it) => it.partId !== mine)]);
  const all = [...before, ...deadlines(added.filter((it) => it.partId === mine))];

  if (P.release > today) {
    const v = firstViolation(ctx, deadlines(added), { start: P.release, mode: 'W' });
    if (v !== null) return v;
  }
  if (me.priority === 'general') {
    const forced = new Map<DayNum, number>();
    for (const d of before) {
      const ws = weekOf(ctx, Math.max(d, today));
      forced.set(ws, (forced.get(ws) ?? 0) + 1);
    }
    return firstViolation(ctx, all, { start: today, mode: 'G', forced, checkFrom: me.deadline });
  }
  return null;
}

type Classified =
  | { ok: true; L: DayNum }
  | { ok: false; reason: NonNullable<DateCheck['reason']>; at?: DayNum; L?: DayNum };

function classify(P: Prepared, prior: NewItem[], d: DayNum, n: number, p: Priority, fullDays = 0): Classified {
  const ctx = P.ctx;
  if (d <= ctx.today) return { ok: false, reason: 'too-soon' };
  if (!isDeliveryDay(ctx, d)) return { ok: false, reason: 'not-a-delivery-day' };
  const L = latestStitchFor(ctx, d, p);
  if (L === null) return { ok: false, reason: 'no-working-day' };
  if (L < P.release) return { ok: false, reason: 'too-soon', L };
  const at = violation(P, prior, { deadline: L, count: n, fullDays, priority: p, date: d });
  return at === null ? { ok: true, L } : { ok: false, reason: 'full', at, L };
}

/** First delivery date from tomorrow within 26 weeks. */
function earliest(P: Prepared, prior: NewItem[], n: number, p: Priority, fullDays = 0): { d: DayNum; L: DayNum } | null {
  const t = P.ctx.today;
  for (let d = t + 1; d <= t + HORIZON_DAYS; d++) {
    const c = classify(P, prior, d, n, p, fullDays);
    if (c.ok) return { d, L: c.L };
  }
  return null;
}

function priorItems(P: Prepared, prior: PriorPart[]): NewItem[] {
  return prior.map((x) => ({
    count: x.count,
    fullDays: x.fullDayCount ?? 0,
    priority: x.priority,
    date: toDay(x.date),
    deadline: latestStitchFor(P.ctx, toDay(x.date), x.priority) ?? P.ctx.today,
  }));
}

/** Schedule with the new parts added, for stitch days and week usage. */
function preview(P: Prepared, parts: { count: number; fullDays: number; priority: Priority; date: DayNum | null }[]) {
  const core = scheduleCore(P.ctx, [...P.ctx.items, ...newWorkItems(parts)]);
  const used = usedByWeek(P.ctx, core);
  const usage = (ws: DayNum): WeekUsage => ({
    weekStart: fromDay(ws),
    used: used.get(ws) ?? 0,
    capacity: P.ctx.W + (P.ctx.extras.get(ws) ?? 0),
  });
  return parts.map((_, i) => {
    const days: DayNum[] = [];
    for (const [id, s] of core.stitch) if (id.startsWith(`__new_${i}_`) && s !== null) days.push(s);
    days.sort((a, b) => a - b);
    const weeks = [...new Set(days.map((d) => weekOf(P.ctx, d)))];
    return { stitchDays: days.map(fromDay), weekUsage: weeks.map(usage) };
  });
}

/**
 * Quote one or more parts of an order. Emergency parts are quoted first, then
 * general parts against that set. Results come back in the request order.
 */
export function quote(input: EngineInput, parts: QuotePartRequest[]): QuotePart[] {
  const P = prepare(input);
  const order = parts.map((_, i) => i).sort((a, b) =>
    parts[a].priority === parts[b].priority ? a - b : parts[a].priority === 'emergency' ? -1 : 1);
  const prior: NewItem[] = [];
  const found: { d: DayNum | null; L: DayNum | null }[] = parts.map(() => ({ d: null, L: null }));
  for (const i of order) {
    const { count, priority, fullDayCount: fullDays = 0 } = parts[i];
    if (count <= 0) continue;
    const r = earliest(P, prior, count, priority, fullDays);
    if (r) {
      found[i] = { d: r.d, L: r.L };
      prior.push({ deadline: r.L, count, fullDays, priority, date: r.d });
    }
  }
  const pv = preview(P, parts.map((p, i) => ({ ...p, fullDays: p.fullDayCount ?? 0, date: found[i].d })));
  return parts.map((p, i) => ({
    priority: p.priority,
    count: p.count,
    dateOffered: found[i].d === null ? null : fromDay(found[i].d!),
    latestStitch: found[i].L === null ? null : fromDay(found[i].L!),
    stitchDays: pv[i].stitchDays,
    weekUsage: pv[i].weekUsage,
  }));
}

/** General and emergency quotes side by side for the same number of blouses. */
export function quoteBoth(input: EngineInput, count: number, fullDayCount = 0): { general: QuotePart; emergency: QuotePart } {
  const [general] = quote(input, [{ count, fullDayCount, priority: 'general' }]);
  const [emergency] = quote(input, [{ count, fullDayCount, priority: 'emergency' }]);
  if (general.dateOffered && (!emergency.dateOffered || emergency.dateOffered > general.dateOffered)) {
    return { general, emergency: { ...general, priority: 'emergency' } };
  }
  return { general, emergency };
}

/** The largest number of blouses that can be delivered by `date` with this priority. */
export function maxByDate(input: EngineInput, date: DateStr, priority: Priority, prior: PriorPart[] = []): number {
  const P = prepare(input);
  const pr = priorItems(P, prior);
  const d = toDay(date);
  if (!classify(P, pr, d, 1, priority).ok) return 0;
  let lo = 1, hi = 2;
  while (hi < 10_000 && classify(P, pr, d, hi, priority).ok) { lo = hi; hi *= 2; }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (classify(P, pr, d, mid, priority).ok) lo = mid; else hi = mid;
  }
  return lo;
}

/**
 * Is a customer's own date possible? If not: why, the nearest valid date and,
 * when capacity is the problem, the "Take extra anyway" amount.
 */
export function checkDate(input: EngineInput, part: QuotePartRequest, date: DateStr, prior: PriorPart[] = []): DateCheck {
  const P = prepare(input);
  const pr = priorItems(P, prior);
  const d = toDay(date);
  const fullDays = part.fullDayCount ?? 0;
  const c = classify(P, pr, d, part.count, part.priority, fullDays);
  if (c.ok) return { ok: true };
  const e = earliest(P, pr, part.count, part.priority, fullDays);
  const out: DateCheck = { ok: false, reason: c.reason, nearestValid: e ? fromDay(e.d) : null };
  if (c.reason === 'full' && c.at !== undefined && c.L !== undefined) {
    out.fullDay = fromDay(c.at);
    out.fullWeek = fromDay(weekOf(P.ctx, c.at));
    out.extraNeeded = extraNeeded(input, part, d, c.L, prior);
  }
  return out;
}

/** Smallest +n in the week of the latest stitch day that makes the date valid. */
function extraNeeded(
  input: EngineInput, part: QuotePartRequest, d: DayNum, L: DayNum, prior: PriorPart[],
): { weekStart: DateStr; n: number } | null {
  const ctx = makeCtx(input);
  const weekStart = fromDay(weekOf(ctx, L));
  const limit = Math.max(part.count + 1, ctx.W) * 3;
  for (let n = 1; n <= limit; n++) {
    const trial: EngineInput = { ...input, weekExtras: [...(input.weekExtras ?? []), { weekStart, n }] };
    const P = prepare(trial);
    if (classify(P, priorItems(P, prior), d, part.count, part.priority, part.fullDayCount ?? 0).ok) return { weekStart, n };
  }
  return null;
}

// ---------- Helpers for the app ----------

export interface ConfirmPart {
  partId: string;
  priority: Priority;
  promisedDelivery: DateStr;
  blouses: { id: string; type?: string; price: number; fullDay?: boolean }[];
}

/** Build the records to save when the customer agrees. IDs come from the app. */
export function confirmOrder(order: Order, parts: ConfirmPart[]): { order: Order; parts: OrderPart[]; blouses: Blouse[] } {
  return {
    order,
    parts: parts.map((p) => ({ id: p.partId, orderId: order.id, priority: p.priority, promisedDelivery: p.promisedDelivery })),
    blouses: parts.flatMap((p) =>
      p.blouses.map((b) => ({
        id: b.id, partId: p.partId, type: b.type, price: b.price, status: 'scheduled' as const, fullDay: b.fullDay,
      }))),
  };
}

/** Work and money report for a date range (inclusive). */
export function report(parts: OrderPart[], blouses: Blouse[], from: DateStr, to: DateStr) {
  const inRange = (s?: string) => !!s && s >= from && s <= to;
  const partById = new Map(parts.map((p) => [p.id, p]));
  const live = blouses.filter((b) => b.status !== 'cancelled' && !partById.get(b.partId)?.cancelled);
  const stitched = live.filter((b) => b.status === 'done' && inRange(b.doneDate));
  const delivered = live.filter((b) => inRange(partById.get(b.partId)?.deliveredOn));
  const due = live.filter((b) => inRange(partById.get(b.partId)?.promisedDelivery));
  const sum = (xs: Blouse[]) => xs.reduce((a, b) => a + (b.price || 0), 0);
  return {
    stitchedCount: stitched.length,
    stitchedValue: sum(stitched),
    deliveredCount: delivered.length,
    deliveredValue: sum(delivered),
    dueCount: due.length,
    dueValue: sum(due),
    pendingDueCount: due.filter((b) => b.status === 'scheduled' && !partById.get(b.partId)?.deliveredOn).length,
  };
}

/**
 * Customer asks to move an existing delivery ("can I get it 2 days earlier?").
 * The part's own unfinished blouses are taken out first, so it is not counted twice.
 * Optionally change its priority too (e.g. general → emergency).
 */
export function checkPartDateChange(
  input: EngineInput, partId: string, newDate: DateStr, newPriority?: Priority,
): DateCheck {
  const part = input.parts.find((p) => p.id === partId);
  if (!part) throw new Error(`Unknown part ${partId}`);
  const isMine = (b: Blouse) => b.partId === partId && b.status === 'scheduled';
  const mine = input.blouses.filter(isMine);
  const count = mine.length;
  const fullDayCount = mine.filter((b) => b.fullDay).length;
  const rest: EngineInput = { ...input, blouses: input.blouses.filter((b) => !isMine(b)) };
  if (count === 0) return toDay(newDate) > toDay(input.today) ? { ok: true } : { ok: false, reason: 'too-soon' };
  return checkDate(rest, { count, fullDayCount, priority: newPriority ?? part.priority }, newDate);
}

export interface CatchUp {
  /** Save these as DayExtras if she agrees ("Do +1 on Thu and Fri"). */
  dayExtras: DayExtra[];
  lateBefore: number;
  lateAfter: number;
  willMissAfter: number;
}

/**
 * After a missed day: the smallest set of "+1 on day X" that clears the late flags.
 * Extra goes on the lightest day before each late blouse's deadline, at most
 * doubling a normal day. Blouses already past their latest stitch day cannot be
 * helped by extra work and stay flagged. Returns null if nothing can be improved.
 */
export function catchUpExtra(input: EngineInput): CatchUp | null {
  const base = rebuildSchedule(input);
  if (base.late.length === 0) return null;
  const ctx = makeCtx(input);
  const fullDayIds = ctx.items.filter((it) => it.open && it.fullDay).map((it) => it.id);
  const added = new Map<DayNum, number>();
  const stuck = new Set<string>();
  const build = (): EngineInput => ({
    ...input,
    dayExtras: [...(input.dayExtras ?? []), ...[...added].map(([d, n]) => ({ date: fromDay(d), n }))],
  });
  let s = base;
  for (let iter = 0; iter < 200; iter++) {
    const target = s.late.find((id) => !stuck.has(id) && s.latestStitch[id] !== null && s.latestStitch[id]! >= input.today);
    if (!target) break;
    const L = toDay(s.latestStitch[target]!);
    // A day given to a full-day piece stays closed: nothing extra is asked of it.
    const closed = new Set(fullDayIds.map((id) => s.stitchDate[id]));
    let pick: DayNum | null = null;
    let pickLoad = Infinity;
    for (let d = ctx.today; d <= L; d++) {
      if (!isWorking(ctx, d) || closed.has(fromDay(d))) continue;
      const normal = dayCap(ctx, d, 'W');
      const a = added.get(d) ?? 0;
      if (a >= Math.max(1, normal)) continue; // at most double a normal day
      if (normal + a < pickLoad) { pick = d; pickLoad = normal + a; }
    }
    if (pick === null) { stuck.add(target); continue; }
    added.set(pick, (added.get(pick) ?? 0) + 1);
    const next = rebuildSchedule(build());
    if (next.late.length >= s.late.length) {
      // Did not help: undo and give up on this blouse.
      added.set(pick, added.get(pick)! - 1);
      stuck.add(target);
      continue;
    }
    s = next;
  }
  // Drop extras that turned out unnecessary (keeps the suggestion minimal).
  for (const d of [...added.keys()].sort((a, b) => b - a)) {
    while ((added.get(d) ?? 0) > 0) {
      added.set(d, added.get(d)! - 1);
      const t = rebuildSchedule(build());
      if (t.late.length > s.late.length) { added.set(d, added.get(d)! + 1); break; }
      s = t;
    }
  }
  const dayExtras = [...added].filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]).map(([d, n]) => ({ date: fromDay(d), n }));
  if (!dayExtras.length || s.late.length >= base.late.length) return null;
  return { dayExtras, lateBefore: base.late.length, lateAfter: s.late.length, willMissAfter: s.willMiss.length };
}
