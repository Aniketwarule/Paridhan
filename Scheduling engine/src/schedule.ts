import { DayNum, fromDay } from './dates';
import { Ctx, HORIZON_DAYS, WorkItem, dayCap, dayTarget, latestStitchFor, makeCtx, weekOf, weekSlots } from './core';
import type { Change, DateStr, EngineInput, ScheduleResult } from './types';

export interface CoreSchedule {
  stitch: Map<string, DayNum | null>;
  latest: Map<string, DayNum | null>;
  /** Slots each placed piece uses: 1, or what was left of the day for a full-day piece. */
  slots: Map<string, number>;
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
 *
 * A full-day piece goes only on a day with nothing done or planned, and closes that day.
 * If the day has already been started, it waits and the next pieces use up the room left.
 */
export function scheduleCore(ctx: Ctx, items: WorkItem[]): CoreSchedule {
  const open = items.filter((i) => i.open);
  const latest = new Map<string, DayNum | null>();
  for (const it of open) latest.set(it.id, latestStitchFor(ctx, it.promised, it.priority));
  const sorted = [...open].sort(edfCompare(latest));
  const stitch = new Map<string, DayNum | null>();
  const slots = new Map<string, number>();

  let next = 0;
  /** Full-day pieces passed over so far; they stay ahead of everything still in `sorted`. */
  let waiting: WorkItem[] = [];
  let ws = NaN;
  let slotsLeft = 0;
  const last = ctx.today + 2 * HORIZON_DAYS;
  for (let d = ctx.today; d <= last && (next < sorted.length || waiting.length > 0); d++) {
    const w = weekOf(ctx, d);
    if (w !== ws) {
      ws = w;
      slotsLeft = weekSlots(ctx, w, 'W');
    }
    const room = Math.max(0, Math.min(slotsLeft, dayCap(ctx, d, 'W')));
    if (room === 0) continue;

    let used = 0;
    const startedAlready = d === ctx.today && ctx.doneToday > 0;
    const place = (it: WorkItem, take: number) => {
      stitch.set(it.id, d);
      slots.set(it.id, take);
      used += take;
    };
    const stillWaiting: WorkItem[] = [];
    const tryFullDay = (it: WorkItem) => {
      if (used === 0 && !startedAlready) place(it, room);
      else stillWaiting.push(it);
    };
    waiting.forEach(tryFullDay);
    while (used < room && next < sorted.length) {
      const it = sorted[next++];
      if (it.fullDay) tryFullDay(it);
      else place(it, 1);
    }
    slotsLeft -= used;
    waiting = stillWaiting;
  }
  for (const it of [...waiting, ...sorted.slice(next)]) stitch.set(it.id, null);
  return { stitch, latest, slots };
}

/** Slots used per week: what is done plus what the schedule plans. */
export function usedByWeek(ctx: Ctx, core: CoreSchedule): Map<DayNum, number> {
  const used = new Map<DayNum, number>(ctx.doneByWeek);
  for (const [id, d] of core.stitch) {
    if (d === null) continue;
    const w = weekOf(ctx, d);
    used.set(w, (used.get(w) ?? 0) + (core.slots.get(id) ?? 1));
  }
  return used;
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
    weekLoad: Object.fromEntries([...usedByWeek(ctx, core)].map(([w, n]) => [fromDay(w), n])),
  };
}
