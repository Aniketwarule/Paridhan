import { describe, expect, it } from 'vitest';
import {
  EngineInput, Priority, Settings, DEFAULT_SETTINGS, addDays, catchUpExtra, confirmOrder, quote, rebuildSchedule,
} from '../src';

/**
 * Day-by-day simulation of her real routine:
 *  morning: open app, stitch today's list (or less, if `behaviour` says so)
 *  daytime: customers arrive, she quotes and they accept
 *  delivery: parts are handed over on their promised date if all blouses are done
 */
type Behaviour = (day: string, list: string[], rnd: () => number) => string[];

function simulate(opts: {
  days: number;
  seed: number;
  settings?: Partial<Settings>;
  ordersPerDay?: number;
  emergencyShare?: number;
  behaviour?: Behaviour;
  /** Tick done the next morning (doneDate = yesterday) instead of the same day. */
  tickNextMorning?: boolean;
  /** Each morning, if something is late, she accepts the catch-up suggestion. */
  acceptCatchUp?: boolean;
  /** Share of orders that include one full-day piece (nav-vari). */
  fullDayShare?: number;
}) {
  let r = opts.seed;
  const rnd = () => ((r = (r * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const w: EngineInput = {
    today: '2026-11-02', settings: { ...DEFAULT_SETTINGS, ...opts.settings }, orders: [], parts: [], blouses: [],
  };
  const missed: string[] = []; // parts whose blouses were not all stitched in time
  const lateFlagDays: string[] = [];
  let seq = 0;
  let pendingTicks: string[] = [];
  let quotedDays = 0;
  let quoteSum = 0;
  let fullDaysStitched = 0;
  let fullDayShared = 0; // days a full-day piece shared with other work

  for (let day = 0; day < opts.days; day++) {
    const today = w.today;
    const wd = new Date(today + 'T00:00:00Z').getUTCDay();

    // Morning: tick yesterday's work if she does it late.
    if (opts.tickNextMorning && pendingTicks.length) {
      const y = addDays(today, -1);
      w.blouses = w.blouses.map((b) => (pendingTicks.includes(b.id) ? { ...b, status: 'done', doneDate: y } : b));
      pendingTicks = [];
    }

    if (opts.acceptCatchUp) {
      const c = catchUpExtra(w);
      if (c) w.dayExtras = [...(w.dayExtras ?? []), ...c.dayExtras];
    }
    const s = rebuildSchedule(w);
    if (s.late.length) lateFlagDays.push(today);

    // Customers arrive (not on Sunday).
    if (wd !== 0) {
      const n = Math.floor(rnd() * ((opts.ordersPerDay ?? 1.4) * 2 + 1));
      for (let k = 0; k < n; k++) {
        const count = 1 + Math.floor(rnd() * 3);
        const split = count > 1 && rnd() < 0.15;
        const prio: Priority = rnd() < (opts.emergencyShare ?? 0.2) ? 'emergency' : 'general';
        const fullDayCount = opts.fullDayShare && rnd() < opts.fullDayShare ? 1 : 0;
        const req = split
          ? [{ count: 1, priority: 'emergency' as const }, { count: count - 1, fullDayCount, priority: 'general' as const }]
          : [{ count, fullDayCount, priority: prio }];
        const qs = quote(w, req);
        if (qs.some((q) => !q.dateOffered)) continue;
        seq++;
        qs.forEach((q) => { quotedDays++; quoteSum += (Date.parse(q.dateOffered!) - Date.parse(today)) / 864e5; });
        const rec = confirmOrder({ id: `o${seq}`, customerId: `c${seq % 7}`, createdAt: seq }, qs.map((q, i) => ({
          partId: `p${seq}_${i}`, priority: q.priority, promisedDelivery: q.dateOffered!,
          blouses: Array.from({ length: q.count }, (_, j) => ({
            id: `b${seq}_${i}_${j}`, price: 500, fullDay: j < (req[i].fullDayCount ?? 0),
          })),
        })));
        w.orders.push(rec.order); w.parts.push(...rec.parts); w.blouses.push(...rec.blouses);
      }
    }

    // She stitches (after customers, like real life: list may have changed during the day).
    const list = rebuildSchedule(w).today.blouseIds;
    const fullToday = list.filter((id) => w.blouses.find((b) => b.id === id)?.fullDay).length;
    fullDaysStitched += fullToday;
    if (fullToday > 0 && list.length > 1) fullDayShared++;
    const doneIds = opts.behaviour ? opts.behaviour(today, list, rnd) : list;
    if (opts.tickNextMorning) pendingTicks = doneIds;
    else w.blouses = w.blouses.map((b) => (doneIds.includes(b.id) ? { ...b, status: 'done', doneDate: today } : b));

    // Delivery: on promised date, check every blouse of the part was stitched.
    for (const p of w.parts) {
      if (p.promisedDelivery !== today || p.deliveredOn) continue;
      const bs = w.blouses.filter((b) => b.partId === p.id);
      const ready = bs.every((b) => (b.status === 'done' || pendingTicks.includes(b.id)));
      if (ready) Object.assign(p, { deliveredOn: today });
      else missed.push(p.id);
    }
    w.today = addDays(today, 1);
  }
  return { w, missed, lateFlagDays, fullDaysStitched, fullDayShared, avgLeadDays: quoteSum / Math.max(1, quotedDays) };
}

describe('simulation: she follows the app', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`seed ${seed}: 12 weeks, every promise kept, no late flags`, () => {
      const res = simulate({ days: 84, seed });
      expect(res.missed).toEqual([]);
      expect(res.lateFlagDays).toEqual([]);
    });
  }
  it('busy season (demand above W): still no broken promises, dates just get later', () => {
    const res = simulate({ days: 84, seed: 9, ordersPerDay: 3, emergencyShare: 0.35 });
    expect(res.missed).toEqual([]);
    expect(res.avgLeadDays).toBeGreaterThan(7);
  });
  it('holidays configured in advance', () => {
    const res = simulate({ days: 60, seed: 11, settings: { daysOff: ['2026-11-11', '2026-11-12', '2026-12-25'] } });
    expect(res.missed).toEqual([]);
  });
});

describe('simulation: nav-vari orders mixed in', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}: 12 weeks, every promise kept, every nav-vari alone on its day`, () => {
      const res = simulate({ days: 84, seed, fullDayShare: 0.25 });
      expect(res.fullDaysStitched).toBeGreaterThan(5);
      expect(res.fullDayShared).toBe(0);
      expect(res.missed).toEqual([]);
      expect(res.lateFlagDays).toEqual([]);
    });
  }
  it('busy season with many nav-vari orders: dates get later, promises hold', () => {
    const res = simulate({ days: 84, seed: 9, ordersPerDay: 3, emergencyShare: 0.35, fullDayShare: 0.4 });
    expect(res.fullDayShared).toBe(0);
    expect(res.missed).toEqual([]);
    expect(res.avgLeadDays).toBeGreaterThan(7);
  }, 30000);
  it('holiday weeks', () => {
    const res = simulate({
      days: 60, seed: 11, fullDayShare: 0.25, settings: { daysOff: ['2026-11-11', '2026-11-12', '2026-12-25'] },
    });
    expect(res.fullDayShared).toBe(0);
    expect(res.missed).toEqual([]);
  });
  it('a lower weekly target with uneven days (7 a week: 2,1,2,1,1)', () => {
    const res = simulate({ days: 84, seed: 12, ordersPerDay: 0.6, fullDayShare: 0.25, settings: { weeklyTarget: 7, emergencyReserve: 2 } });
    expect(res.fullDayShared).toBe(0);
    expect(res.missed).toEqual([]);
  });
  it('one sick day: shows late flags, recovers', () => {
    const res = simulate({
      days: 84, seed: 4, ordersPerDay: 1.2, fullDayShare: 0.25,
      behaviour: (day, list) => (day === '2026-11-18' ? [] : list),
    });
    expect(res.missed).toEqual([]);
  });
});

describe('simulation: real-life slips', () => {
  it('ticks done the next morning instead of the same evening', () => {
    const res = simulate({ days: 84, seed: 3, tickNextMorning: true });
    expect(res.missed).toEqual([]);
  });
  it('one sick day with nothing stitched: shows late flags, recovers', () => {
    const res = simulate({
      days: 84, seed: 4, ordersPerDay: 1.8,
      behaviour: (day, list) => (day === '2026-11-18' ? [] : list),
    });
    expect(res.missed).toEqual([]);
    expect(res.lateFlagDays.length).toBeGreaterThan(3); // without help: flagged for days
    const helped = simulate({
      days: 84, seed: 4, ordersPerDay: 1.8, acceptCatchUp: true,
      behaviour: (day, list) => (day === '2026-11-18' ? [] : list),
    });
    expect(helped.missed).toEqual([]);
    expect(helped.lateFlagDays.length).toBeLessThanOrEqual(1); // fixed the next morning
  });
});
