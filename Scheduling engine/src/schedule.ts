import { DayNum, fromDay } from './dates';
import { Ctx, HORIZON_DAYS, WorkItem, dayCap, dayTarget, latestStitchFor, makeCtx, weekOf, weekSlots } from './core';
import type { Change, DateStr, EngineInput, ScheduleResult } from './types';

export interface CoreSchedule {
  stitch: Map<string, DayNum | null>;
  latest: Map<string, DayNum | null>;
}

/** Nearest deadline first, emergency before general, oldest order first. */
export function edfCompare(latest: Map<string, DayNum | null>) {
  return (a: WorkItem, b: WorkItem): number => {
    const da = latest.get(a.id) ?? -Infinity;
    const db = latest.get(b.id) ?? -Infinity;
    if (da !== db) return da < db ? -1 : 1;
    if (a.priority !== b.priority) return a.priority === 'emergency' ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

/**
 * Rebuilt from scratch every time: take all unfinished blouses, nearest deadline
 * first, and fill working days from today up to the daily amount and the weekly
 * total. Work is done as early as possible, so she is never idle when work exists;
 * an emergency simply pushes far-deadline work to a later day.
 */
export function scheduleCore(ctx: Ctx, items: WorkItem[]): CoreSchedule {
  const open = items.filter((i) => i.open);
  const latest = new Map<string, DayNum | null>();
  for (const it of open) latest.set(it.id, latestStitchFor(ctx, it.promised, it.priority));
  const sorted = [...open].sort(edfCompare(latest));
  const stitch = new Map<string, DayNum | null>();

  let i = 0;
  let ws = NaN;
  let slotsLeft = 0;
  const last = ctx.today + 2 * HORIZON_DAYS;
  for (let d = ctx.today; d <= last && i < sorted.length; d++) {
    const w = weekOf(ctx, d);
    if (w !== ws) {
      ws = w;
      slotsLeft = weekSlots(ctx, w, 'W');
    }
    const k = Math.min(Math.max(0, Math.min(slotsLeft, dayCap(ctx, d, 'W'))), sorted.length - i);
    for (let j = 0; j < k; j++) stitch.set(sorted[i++].id, d);
    slotsLeft -= k;
  }
  for (; i < sorted.length; i++) stitch.set(sorted[i].id, null);
  return { stitch, latest };
}

/** Public entry point: rebuild the stitch schedule. Pure and deterministic. */
export function rebuildSchedule(input: EngineInput, previous?: Record<string, DateStr | null>): ScheduleResult {
  const ctx = makeCtx(input);
  const core = scheduleCore(ctx, ctx.items);
  const partOf = new Map(ctx.items.map((it) => [it.id, it.partId]));
  const todayStr = fromDay(ctx.today);

  const promisedOf = new Map(ctx.items.map((it) => [it.id, it.promised]));
  const stitchDate: Record<string, DateStr | null> = {};
  const latestStitch: Record<string, DateStr | null> = {};
  const late: string[] = [];
  const willMiss: string[] = [];
  const byDay = new Map<DayNum, string[]>();
  for (const [id, d] of core.stitch) {
    const l = core.latest.get(id) ?? null;
    stitchDate[id] = d === null ? null : fromDay(d);
    latestStitch[id] = l === null ? null : fromDay(l);
    if (d === null || l === null || d > l) late.push(id);
    if (d === null || d >= promisedOf.get(id)!) willMiss.push(id);
    if (d !== null) {
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(id);
    }
  }
  const days = [...byDay.keys()].sort((a, b) => a - b).map((d) => ({ date: fromDay(d), blouseIds: byDay.get(d)! }));
  const today = days[0]?.date === todayStr ? days[0] : { date: todayStr, blouseIds: [] };

  const changes: Change[] = [];
  if (previous) {
    const lateSet = new Set(late);
    for (const id of Object.keys(stitchDate)) {
      const to = stitchDate[id];
      if (!(id in previous)) { changes.push({ blouseId: id, from: null, to, reason: 'added' }); continue; }
      const from = previous[id];
      if (from === to) continue;
      let reason: Change['reason'];
      if (to === null) reason = 'unscheduled';
      else if (lateSet.has(id) && (from === null || to > from)) reason = 'now-late';
      else if (from === null || to < from) reason = 'moved-earlier';
      else reason = 'moved-later';
      changes.push({ blouseId: id, from, to, reason });
    }
  }

  late.sort();
  willMiss.sort();
  const partsOf = (ids: string[]) => [...new Set(ids.map((id) => partOf.get(id)!))].sort();
  // Queue = schedule order (day, then position in the day); unschedulable ones last.
  const queue = [...days.flatMap((d) => d.blouseIds), ...Object.keys(stitchDate).filter((id) => stitchDate[id] === null)];
  return {
    today, days, stitchDate, latestStitch, queue,
    todayTarget: dayTarget(ctx, ctx.today, 'W'),
    doneTodayCount: ctx.doneToday,
    late, lateParts: partsOf(late), willMiss, willMissParts: partsOf(willMiss), changes,
  };
}
