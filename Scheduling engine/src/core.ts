import { DayNum, toDay, weekdayOf, weekStartOf } from './dates';
import type { EngineInput, Priority, Settings, Weekday } from './types';

export const DEFAULT_SETTINGS: Settings = {
  weeklyTarget: 10,
  emergencyReserve: 3,
  workingWeekdays: [1, 2, 3, 4, 5],
  daysOff: [],
  emergencyGap: 1,
  normalGap: 2,
  deliveryWeekdays: [0, 1, 2, 3, 4, 5, 6],
  allowNewWorkToday: true,
  weekStartsOn: 1,
};

/** Quote / search horizon: 26 weeks. */
export const HORIZON_DAYS = 26 * 7;

/** One blouse joined with its order part and order: everything the rules need. */
export interface WorkItem {
  id: string;
  partId: string;
  priority: Priority;
  promised: DayNum;
  createdAt: number;
  open: boolean;
  /** Takes a whole untouched day on its own. */
  fullDay: boolean;
}

export interface Ctx {
  today: DayNum;
  settings: Settings;
  W: number;
  G: number;
  working: Set<Weekday>;
  delivery: Set<Weekday>;
  daysOff: Set<DayNum>;
  extras: Map<DayNum, number>;
  /** Extra for one specific day (catch-up). */
  dayExtras: Map<DayNum, number>;
  /** Sum of day extras per week. */
  dayExtraByWeek: Map<DayNum, number>;
  doneByWeek: Map<DayNum, number>;
  doneToday: number;
  items: WorkItem[];
  weekCache: Map<DayNum, DayNum[]>;
}

export function normalizeSettings(s: Partial<Settings> | undefined): Settings {
  const m = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  const W = Math.max(0, Math.floor(m.weeklyTarget));
  return {
    ...m,
    weeklyTarget: W,
    emergencyReserve: Math.min(W, Math.max(0, Math.floor(m.emergencyReserve))),
    emergencyGap: Math.max(1, Math.floor(m.emergencyGap)),
    normalGap: Math.max(1, Math.floor(m.normalGap)),
    workingWeekdays: [...new Set(m.workingWeekdays)].sort() as Weekday[],
    deliveryWeekdays: [...new Set(m.deliveryWeekdays)].sort() as Weekday[],
  };
}

export function makeCtx(input: EngineInput): Ctx {
  const settings = normalizeSettings(input.settings);
  const today = toDay(input.today);
  const W = settings.weeklyTarget;
  const G = Math.max(0, W - settings.emergencyReserve);
  const ws = (d: DayNum) => weekStartOf(d, settings.weekStartsOn);

  const extras = new Map<DayNum, number>();
  for (const e of input.weekExtras ?? []) {
    const w = ws(toDay(e.weekStart));
    extras.set(w, (extras.get(w) ?? 0) + e.n);
  }

  const dayExtras = new Map<DayNum, number>();
  const dayExtraByWeek = new Map<DayNum, number>();
  for (const e of input.dayExtras ?? []) {
    const d = toDay(e.date);
    dayExtras.set(d, (dayExtras.get(d) ?? 0) + e.n);
    dayExtraByWeek.set(ws(d), (dayExtraByWeek.get(ws(d)) ?? 0) + e.n);
  }

  const orders = new Map(input.orders.map((o) => [o.id, o]));
  const parts = new Map(input.parts.map((p) => [p.id, p]));
  const ctx: Ctx = {
    today, settings, W, G,
    working: new Set(settings.workingWeekdays),
    delivery: new Set(settings.deliveryWeekdays),
    daysOff: new Set(settings.daysOff.map(toDay)),
    extras, dayExtras, dayExtraByWeek,
    doneByWeek: new Map(),
    doneToday: 0,
    items: [],
    weekCache: new Map(),
  };
  for (const b of input.blouses) {
    const part = parts.get(b.partId);
    if (!part) throw new Error(`Blouse ${b.id} refers to unknown part ${b.partId}`);
    if (b.status === 'done' && b.doneDate) {
      const d = toDay(b.doneDate);
      // A finished full-day piece used up that whole day; on a day off that is nothing.
      const slots = b.fullDay ? dayTarget(ctx, d, 'W') : 1;
      ctx.doneByWeek.set(ws(d), (ctx.doneByWeek.get(ws(d)) ?? 0) + slots);
      if (d === today) ctx.doneToday += slots;
    }
    if (b.status === 'cancelled' || part.cancelled) continue;
    ctx.items.push({
      id: b.id,
      partId: part.id,
      priority: part.priority,
      promised: toDay(part.promisedDelivery),
      createdAt: orders.get(part.orderId)?.createdAt ?? 0,
      // A handed-over part is finished even if a blouse was never ticked off.
      open: b.status === 'scheduled' && !part.deliveredOn,
      fullDay: !!b.fullDay,
    });
  }
  return ctx;
}

export const weekOf = (ctx: Ctx, d: DayNum) => weekStartOf(d, ctx.settings.weekStartsOn);

/** D1: stitching only on working weekdays that are not days off. */
export function isWorking(ctx: Ctx, d: DayNum): boolean {
  return ctx.working.has(weekdayOf(d)) && !ctx.daysOff.has(d);
}

export function isDeliveryDay(ctx: Ctx, d: DayNum): boolean {
  return ctx.delivery.has(weekdayOf(d));
}

export function gapOf(ctx: Ctx, p: Priority): number {
  return p === 'emergency' ? ctx.settings.emergencyGap : ctx.settings.normalGap;
}

/** D2 + D3: delivery date for a blouse stitched on `stitch`. */
export function deliveryFor(ctx: Ctx, stitch: DayNum, p: Priority): DayNum | null {
  const base = stitch + gapOf(ctx, p);
  for (let k = 0; k < 7; k++) if (isDeliveryDay(ctx, base + k)) return base + k;
  return null;
}

/** D4: latest working day s with deliveryFor(s) <= promised. */
export function latestStitchFor(ctx: Ctx, promised: DayNum, p: Priority): DayNum | null {
  const gap = gapOf(ctx, p);
  for (let s = promised - gap; s > promised - gap - 60; s--) {
    if (!isWorking(ctx, s)) continue;
    const del = deliveryFor(ctx, s, p);
    if (del !== null && del <= promised) return s;
  }
  return null;
}

/** Working days of the week starting at ws (holidays excluded). */
export function weekWorkDays(ctx: Ctx, ws: DayNum): DayNum[] {
  let r = ctx.weekCache.get(ws);
  if (!r) {
    r = [];
    for (let d = ws; d < ws + 7; d++) if (isWorking(ctx, d)) r.push(d);
    ctx.weekCache.set(ws, r);
  }
  return r;
}

/**
 * Daily amount for day d. The weekly total T (W, or G for general quotes) is spread
 * evenly over that week's working days: W rounded up toward the start of the week,
 * G rounded down (so general work leaves some emergency room every day).
 * A week's extra +n is added as +1 per day from the first day ("3,3,3,2,2"); in the
 * current week it is spread from today, so an extra taken mid-week is never lost
 * on days already gone. (The weekly total still caps it.)
 * Today is reduced by what is already done today.
 */
export function dayCap(ctx: Ctx, d: DayNum, mode: 'W' | 'G'): number {
  const c = dayTarget(ctx, d, mode);
  return d === ctx.today ? Math.max(0, c - ctx.doneToday) : c;
}

/** Daily amount before subtracting today's done work. */
export function dayTarget(ctx: Ctx, d: DayNum, mode: 'W' | 'G'): number {
  const ws = weekOf(ctx, d);
  const days = weekWorkDays(ctx, ws);
  const k = days.indexOf(d) + 1;
  if (k === 0) return 0;
  const n = days.length;
  const T = mode === 'W' ? ctx.W : ctx.G;
  const round = mode === 'W' ? Math.ceil : Math.floor;
  const base = round((T * k) / n) - round((T * (k - 1)) / n) + (ctx.dayExtras.get(d) ?? 0);
  const e = ctx.extras.get(ws) ?? 0;
  if (e === 0) return base;
  const exDays = days.filter((x) => x >= ctx.today);
  const j = exDays.indexOf(d) + 1;
  if (j === 0) return base;
  const per = Math.ceil(e / exDays.length);
  return base + Math.min(e, j * per) - Math.min(e, (j - 1) * per);
}

/** Weekly total still available (target + extra - already done that week). */
export function weekSlots(ctx: Ctx, ws: DayNum, mode: 'W' | 'G', forced?: Map<DayNum, number>): number {
  const extra = (ctx.extras.get(ws) ?? 0) + (ctx.dayExtraByWeek.get(ws) ?? 0);
  const done = ctx.doneByWeek.get(ws) ?? 0;
  const w = Math.max(0, ctx.W + extra - done);
  if (mode === 'W') return w;
  const g = Math.max(0, ctx.G + extra - done);
  return Math.min(w, Math.max(g, forced?.get(ws) ?? 0));
}

export interface CapOpts {
  start: DayNum;
  end: DayNum;
  mode: 'W' | 'G';
  /** G mode: existing work already due in a week keeps its place. */
  forced?: Map<DayNum, number>;
}

/** Cumulative capacity from `start` through each day up to `end`. */
export function cumCapacity(ctx: Ctx, o: CapOpts): number[] {
  const out: number[] = [];
  let prevWeeks = 0;
  let curWs = NaN;
  let sum = 0;
  let slots = 0;
  let mode: 'W' | 'G' = o.mode;
  for (let d = o.start; d <= o.end; d++) {
    const ws = weekOf(ctx, d);
    if (ws !== curWs) {
      prevWeeks = out.length ? out[out.length - 1] : 0;
      curWs = ws;
      sum = 0;
      slots = weekSlots(ctx, ws, o.mode, o.forced);
      // If existing work already needs more than G this week, use the full daily pace.
      mode = o.mode === 'G' && (o.forced?.get(ws) ?? 0) > weekSlots(ctx, ws, 'G') ? 'W' : o.mode;
    }
    sum += dayCap(ctx, d, mode);
    out.push(prevWeeks + Math.min(slots, sum));
  }
  return out;
}

/**
 * Feasibility test (earliest-deadline-first): for every t in [checkFrom, end]:
 *   #(deadline <= t) <= capacity(start..t).
 * Deadlines before `start` count at `start`. Returns the first violating day, or null.
 */
export function firstViolation(
  ctx: Ctx,
  deadlines: DayNum[],
  o: Omit<CapOpts, 'end'> & { checkFrom?: DayNum },
): DayNum | null {
  if (deadlines.length === 0) return null;
  let end = o.start;
  for (const d of deadlines) if (d > end) end = d;
  const counts = new Array<number>(end - o.start + 1).fill(0);
  for (const d of deadlines) counts[Math.max(0, d - o.start)]++;
  const cap = cumCapacity(ctx, { ...o, end });
  const from = Math.max(0, (o.checkFrom ?? o.start) - o.start);
  let acc = 0;
  for (let i = 0; i < counts.length; i++) {
    acc += counts[i];
    if (i >= from && acc > cap[i]) return o.start + i;
  }
  return null;
}
