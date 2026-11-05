import { describe, expect, it } from 'vitest';
import {
  Blouse, EngineInput, OrderPart, Priority, Settings, DEFAULT_SETTINGS,
  checkDate, confirmOrder, deliveryDateFor, latestStitchDayFor, maxByDate, quote, quoteBoth, rebuildSchedule, report,
} from '../src';

// Default: Mon–Fri, W=10 (2/day), R=3 → G=7 spread as 1,1,2,1,2.
// 2026-11-02 Mon, 03 Tue, 04 Wed, 05 Thu, 06 Fri, 07 Sat, 08 Sun, 09 Mon ...
let seq = 0;

function world(today: string, s: Partial<Settings> = {}, rest: Partial<EngineInput> = {}): EngineInput {
  return { today, settings: { ...DEFAULT_SETTINGS, ...s }, orders: [], parts: [], blouses: [], ...rest };
}
/** Add one order with one part of `count` blouses. Returns the blouses. */
function add(w: EngineInput, priority: Priority, promised: string, count = 1, b: Partial<Blouse> = {}): Blouse[] {
  seq++;
  const r = confirmOrder({ id: `o${seq}`, customerId: 'c1', createdAt: seq }, [{
    partId: `p${seq}`, priority, promisedDelivery: promised,
    blouses: Array.from({ length: count }, (_, i) => ({ id: `b${seq}_${i}`, price: 500 })),
  }]);
  const bl = r.blouses.map((x) => ({ ...x, ...b }));
  w.orders.push(r.order); w.parts.push(...r.parts); w.blouses.push(...bl);
  return bl;
}
/** Quote one part and confirm it. */
function confirm(w: EngineInput, count: number, p: Priority): { date: string | null; added: Blouse[] } {
  const [q] = quote(w, [{ count, priority: p }]);
  if (!q.dateOffered) return { date: null, added: [] };
  return { date: q.dateOffered, added: add(w, p, q.dateOffered, count) };
}
const latestOf = (w: EngineInput, b: Blouse) => {
  const part = w.parts.find((p) => p.id === b.partId)!;
  return latestStitchDayFor(w, part.promisedDelivery, part.priority)!;
};
const counts = (w: EngineInput) => rebuildSchedule(w).days.map((d) => d.blouseIds.length);

describe('date rules', () => {
  const w = world('2026-11-02', { workingWeekdays: [1, 2, 3, 4, 5, 6] });
  it('Saturday stitch: emergency → Sunday, general → Monday', () => {
    expect(deliveryDateFor(w, '2026-11-07', 'emergency')).toBe('2026-11-08');
    expect(deliveryDateFor(w, '2026-11-07', 'general')).toBe('2026-11-09');
  });
  it('Sunday not a delivery day → Monday; latest stitch walks back to Saturday', () => {
    const w2 = world('2026-11-02', { workingWeekdays: [1, 2, 3, 4, 5, 6], deliveryWeekdays: [1, 2, 3, 4, 5, 6] });
    expect(deliveryDateFor(w2, '2026-11-07', 'emergency')).toBe('2026-11-09');
    expect(latestStitchDayFor(w2, '2026-11-09', 'emergency')).toBe('2026-11-07');
  });
  it('holiday blocks stitching only, delivery on a holiday is fine', () => {
    const w3 = world('2026-11-02', { daysOff: ['2026-11-06'] });
    expect(latestStitchDayFor(w3, '2026-11-08', 'general')).toBe('2026-11-05');
    expect(deliveryDateFor(w3, '2026-11-04', 'general')).toBe('2026-11-06');
  });
  it('emergency gap is never below 1 (no same-day delivery)', () => {
    expect(deliveryDateFor(world('2026-11-02', { emergencyGap: 0 }), '2026-11-02', 'emergency')).toBe('2026-11-03');
  });
});

describe('daily amount from W and the week\'s working days', () => {
  it('10/week over Mon–Fri = 2 per day', () => {
    const w = world('2026-11-02');
    add(w, 'general', '2026-11-30', 10);
    expect(counts(w)).toEqual([2, 2, 2, 2, 2]);
  });
  it('a holiday spreads the week over fewer days (3,2,3,2)', () => {
    const w = world('2026-11-02', { daysOff: ['2026-11-04'] });
    add(w, 'general', '2026-11-30', 10);
    expect(counts(w)).toEqual([3, 2, 3, 2]);
  });
  it('take extra +3: first 3 days get one more (3,3,3,2,2)', () => {
    const w = world('2026-11-02', {}, { weekExtras: [{ weekStart: '2026-11-02', n: 3 }] });
    add(w, 'general', '2026-11-30', 13);
    expect(counts(w)).toEqual([3, 3, 3, 2, 2]);
  });
});

describe('reserve for emergencies', () => {
  it('generals stop at G=7 a week and leave daily room; emergencies fill to W=10', () => {
    const w = world('2026-11-02');
    const g = Array.from({ length: 7 }, () => confirm(w, 1, 'general'));
    expect(g.map((x) => x.date)).toEqual([
      '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-08',
    ]);
    expect(confirm(w, 1, 'general').date).toBe('2026-11-11'); // 8th general → next week
    // Even after 7 generals, an emergency on Monday still gets Tuesday.
    const e1 = confirm(w, 1, 'emergency');
    expect(e1.date).toBe('2026-11-03');
    const e23 = [confirm(w, 1, 'emergency'), confirm(w, 1, 'emergency')];
    for (const x of e23) expect(latestOf(w, x.added[0]) <= '2026-11-06').toBe(true);
    const e4 = confirm(w, 1, 'emergency'); // 11th this week → next week
    expect(latestOf(w, e4.added[0]) >= '2026-11-09').toBe(true);
    const s = rebuildSchedule(w);
    expect(Object.values(s.stitchDate).filter((d) => d! < '2026-11-09').length).toBe(10);
    expect(s.late).toEqual([]);
  });
  it('emergency in a quiet week is next day', () => {
    const [q] = quote(world('2026-11-02'), [{ count: 1, priority: 'emergency' }]);
    expect(q.dateOffered).toBe('2026-11-03');
    expect(q.stitchDays).toEqual(['2026-11-02']);
    expect(q.weekUsage).toEqual([{ weekStart: '2026-11-02', used: 1, capacity: 10 }]);
  });
});

describe('partial week', () => {
  it('Thursday quote does not assume 10 fit in Thu–Fri', () => {
    const [q] = quote(world('2026-11-05'), [{ count: 10, priority: 'general' }]);
    expect(q.latestStitch).toBe('2026-11-13');
    expect(q.dateOffered).toBe('2026-11-15');
    const perDay = new Map<string, number>();
    q.stitchDays.forEach((d) => perDay.set(d, (perDay.get(d) ?? 0) + 1));
    for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(2);
  });
});

describe('quoting', () => {
  it('general and emergency side by side, emergency <= general', () => {
    const { general, emergency } = quoteBoth(world('2026-11-02'), 3);
    expect(emergency.dateOffered! <= general.dateOffered!).toBe(true);
  });
  it('split order: emergency part first, general against that set (any request order)', () => {
    for (const reqs of [
      [{ count: 2, priority: 'emergency' as const }, { count: 5, priority: 'general' as const }],
      [{ count: 5, priority: 'general' as const }, { count: 2, priority: 'emergency' as const }],
    ]) {
      const qs = quote(world('2026-11-02'), reqs);
      const e = qs.find((q) => q.priority === 'emergency')!;
      const g = qs.find((q) => q.priority === 'general')!;
      expect(e.dateOffered).toBe('2026-11-03');
      expect(g.dateOffered).toBe('2026-11-08');
    }
  });
  it('maxByDate', () => {
    const w = world('2026-11-02');
    expect(maxByDate(w, '2026-11-05', 'emergency')).toBe(6); // stitch Mon–Wed
    expect(maxByDate(w, '2026-11-05', 'general')).toBe(2); // Mon–Tue, general share only
    expect(maxByDate(w, '2026-11-02', 'emergency')).toBe(0); // same day never
  });
  it('custom date: invalid → nearest valid date and take-extra', () => {
    const w = world('2026-11-02');
    for (let i = 0; i < 7; i++) confirm(w, 1, 'general');
    const c = checkDate(w, { count: 1, priority: 'general' }, '2026-11-07');
    expect(c).toMatchObject({ ok: false, reason: 'full', fullWeek: '2026-11-02', nearestValid: '2026-11-11' });
    expect(c.extraNeeded).toEqual({ weekStart: '2026-11-02', n: 1 });
    const withExtra = { ...w, weekExtras: [c.extraNeeded!] };
    expect(checkDate(withExtra, { count: 1, priority: 'general' }, '2026-11-07').ok).toBe(true);
    expect(checkDate(w, { count: 1, priority: 'general' }, '2026-11-02').reason).toBe('too-soon');
    const noSun = world('2026-11-02', { deliveryWeekdays: [1, 2, 3, 4, 5, 6] });
    expect(checkDate(noSun, { count: 1, priority: 'general' }, '2026-11-08').reason).toBe('not-a-delivery-day');
  });
  it('quoting never writes anything', () => {
    const w = world('2026-11-02');
    add(w, 'general', '2026-11-10');
    const snap = JSON.stringify(w);
    quote(w, [{ count: 3, priority: 'general' }]);
    checkDate(w, { count: 30, priority: 'general' }, '2026-11-04');
    maxByDate(w, '2026-11-20', 'general');
    expect(JSON.stringify(w)).toBe(snap);
  });
  it('existing work with far deadlines moves aside for an emergency', () => {
    const w = world('2026-11-02');
    add(w, 'general', '2026-11-20', 2);
    const [q] = quote(w, [{ count: 2, priority: 'emergency' }]);
    expect(q.dateOffered).toBe('2026-11-03');
    expect(q.stitchDays).toEqual(['2026-11-02', '2026-11-02']);
  });
});

describe('schedule', () => {
  it('carry-over: unfinished overdue work is first today and flagged late', () => {
    const w = world('2026-11-03');
    const [later] = add(w, 'general', '2026-11-12');
    const [overdue] = add(w, 'general', '2026-11-04'); // latest stitch Mon 11-02
    const s = rebuildSchedule(w);
    expect(s.today.blouseIds).toEqual([overdue.id, later.id]);
    expect(s.late).toEqual([overdue.id]);
    expect(s.lateParts).toEqual([overdue.partId]);
  });
  it('fills early: idle days are used for far-deadline work', () => {
    const w = world('2026-11-02');
    add(w, 'general', '2026-11-20', 5);
    expect(counts(w)).toEqual([2, 2, 1]);
  });
  it('an emergency today pushes far work to a later day', () => {
    const w = world('2026-11-02');
    const far = add(w, 'general', '2026-11-20', 2);
    const prev = rebuildSchedule(w).stitchDate;
    const [e] = add(w, 'emergency', '2026-11-03');
    const s = rebuildSchedule(w, prev);
    expect(s.today.blouseIds).toEqual([e.id, far[0].id]);
    expect(s.changes).toContainEqual({ blouseId: far[1].id, from: '2026-11-02', to: '2026-11-03', reason: 'moved-later' });
    expect(s.changes).toContainEqual({ blouseId: e.id, from: null, to: '2026-11-02', reason: 'added' });
  });
  it('done today uses up today; undo puts it back', () => {
    const w = world('2026-11-02');
    const bs = add(w, 'general', '2026-11-20', 3);
    w.blouses[0] = { ...bs[0], status: 'done', doneDate: '2026-11-02' };
    expect(rebuildSchedule(w).today.blouseIds).toEqual([bs[1].id]);
    w.blouses[0] = bs[0];
    expect(rebuildSchedule(w).today.blouseIds).toEqual([bs[0].id, bs[1].id]);
  });
  it('delivered or cancelled parts leave the schedule', () => {
    const w = world('2026-11-02');
    add(w, 'general', '2026-11-20', 2);
    add(w, 'general', '2026-11-20', 2);
    w.parts[0] = { ...w.parts[0], deliveredOn: '2026-11-02' };
    w.parts[1] = { ...w.parts[1], cancelled: true };
    expect(rebuildSchedule(w).days).toEqual([]);
  });
  it('a new holiday flags late blouses, and it clears when removed', () => {
    const w = world('2026-11-02');
    add(w, 'general', '2026-11-06', 6); // latest stitch Wed
    expect(rebuildSchedule(w).late).toEqual([]);
    const h = rebuildSchedule({ ...w, settings: { ...w.settings, daysOff: ['2026-11-03'] } });
    expect(h.late.length).toBe(1); // Mon 3 + Wed 2 = 5 of 6
    expect(Object.values(h.stitchDate)).not.toContain('2026-11-03');
    expect(rebuildSchedule(w).late).toEqual([]);
  });
  it('deterministic and idempotent', () => {
    const w = world('2026-11-02');
    add(w, 'general', '2026-11-12'); add(w, 'emergency', '2026-11-06'); add(w, 'general', '2026-11-09');
    const a = rebuildSchedule(w);
    const rev = { ...w, blouses: [...w.blouses].reverse() };
    expect(rebuildSchedule(rev).stitchDate).toEqual(a.stitchDate);
    expect(rebuildSchedule(w, a.stitchDate).changes).toEqual([]);
  });
  it('never on a weekend, a holiday or in the past', () => {
    const w = world('2026-11-04', { daysOff: ['2026-11-10'] });
    add(w, 'general', '2026-11-30', 30);
    for (const d of Object.values(rebuildSchedule(w).stitchDate)) {
      expect(d! >= '2026-11-04').toBe(true);
      expect(d).not.toBe('2026-11-10');
      expect([0, 6]).not.toContain(new Date(d + 'T00:00:00Z').getUTCDay());
    }
  });
});

describe('orders with two parts', () => {
  it('a split order is one order with an emergency and a general delivery', () => {
    const w = world('2026-11-02');
    const [e, g] = quote(w, [{ count: 1, priority: 'emergency' }, { count: 2, priority: 'general' }]);
    const r = confirmOrder({ id: 'o-split', customerId: 'c-tai', createdAt: 1 }, [
      { partId: 'pe', priority: 'emergency', promisedDelivery: e.dateOffered!, blouses: [{ id: 'x1', price: 800 }] },
      { partId: 'pg', priority: 'general', promisedDelivery: g.dateOffered!, blouses: [{ id: 'x2', price: 400 }, { id: 'x3', price: 400 }] },
    ]);
    expect(r.parts.map((p) => p.orderId)).toEqual(['o-split', 'o-split']);
    w.orders.push(r.order); w.parts.push(...r.parts); w.blouses.push(...r.blouses);
    const s = rebuildSchedule(w);
    expect(s.today.blouseIds[0]).toBe('x1');
    expect(s.late).toEqual([]);
  });
});

describe('edge cases', () => {
  it('R >= W: no general orders, emergencies still work', () => {
    const w = world('2026-11-02', { emergencyReserve: 12 });
    expect(quote(w, [{ count: 1, priority: 'general' }])[0].dateOffered).toBeNull();
    expect(quote(w, [{ count: 1, priority: 'emergency' }])[0].dateOffered).toBe('2026-11-03');
  });
  it('zero working days: nothing can be quoted or scheduled', () => {
    const w = world('2026-11-02', { workingWeekdays: [] });
    add(w, 'general', '2026-11-10');
    expect(quote(w, [{ count: 1, priority: 'emergency' }])[0].dateOffered).toBeNull();
    const s = rebuildSchedule(w);
    expect(s.days).toEqual([]);
    expect(s.late.length).toBe(1);
  });
  it('order larger than a week spreads over weeks without exceeding W', () => {
    const w = world('2026-11-02');
    const { date, added } = confirm(w, 25, 'general');
    expect(date).not.toBeNull();
    const s = rebuildSchedule(w);
    const perWeek = new Map<number, number>();
    for (const b of added) {
      const d = s.stitchDate[b.id]!;
      const wk = d < '2026-11-09' ? 1 : d < '2026-11-16' ? 2 : d < '2026-11-23' ? 3 : 4;
      perWeek.set(wk, (perWeek.get(wk) ?? 0) + 1);
    }
    for (const n of perWeek.values()) expect(n).toBeLessThanOrEqual(10);
    expect(s.late).toEqual([]);
  });
  it('month and year boundary', () => {
    expect(quote(world('2026-12-31'), [{ count: 1, priority: 'general' }])[0].dateOffered).toBe('2027-01-02');
    expect(deliveryDateFor(world('2026-11-30'), '2026-11-30', 'general')).toBe('2026-12-02');
  });
  it('Sunday-to-Monday week change resets the weekly count', () => {
    const w = world('2026-11-07'); // Saturday, week already full
    for (let i = 0; i < 10; i++) add(w, 'general', '2026-11-12', 1, { status: 'done', doneDate: `2026-11-0${2 + (i % 5)}` });
    const [q] = quote(w, [{ count: 1, priority: 'emergency' }]);
    expect(q.stitchDays).toEqual(['2026-11-09']);
    expect(q.dateOffered).toBe('2026-11-10');
  });
  it('done early counts in the week it was done', () => {
    const w = world('2026-11-02');
    add(w, 'general', '2026-11-25', 1, { status: 'done', doneDate: '2026-11-02' });
    const [q] = quote(w, [{ count: 1, priority: 'emergency' }]);
    expect(q.weekUsage[0]).toEqual({ weekStart: '2026-11-02', used: 2, capacity: 10 });
  });
  it('extra week capacity raises that week only', () => {
    const w = world('2026-11-02', {}, { weekExtras: [{ weekStart: '2026-11-04', n: 2 }] });
    for (let i = 0; i < 12; i++) confirm(w, 1, 'emergency');
    const s = rebuildSchedule(w);
    expect(Object.values(s.stitchDate).filter((d) => d! < '2026-11-09').length).toBe(12);
    expect(s.late).toEqual([]);
  });
  it('allowNewWorkToday=false: quote assumes tomorrow, schedule still starts early', () => {
    const [q] = quote(world('2026-11-02', { allowNewWorkToday: false }), [{ count: 1, priority: 'emergency' }]);
    expect(q.dateOffered).toBe('2026-11-04');
    expect(q.stitchDays).toEqual(['2026-11-02']);
  });
  it('confirmed quotes never make anyone late (random stress)', () => {
    let r = 7;
    const rnd = () => ((r = (r * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const w = world('2026-11-02', { daysOff: ['2026-11-18'] });
    for (let i = 0; i < 60; i++) {
      confirm(w, 1 + Math.floor(rnd() * 4), rnd() < 0.3 ? 'emergency' : 'general');
      expect(rebuildSchedule(w).late).toEqual([]);
    }
  });
});

describe('report', () => {
  it('sums stitched, delivered and due work in a range', () => {
    const parts: OrderPart[] = [
      { id: 'p1', orderId: 'o1', priority: 'general', promisedDelivery: '2026-11-05', deliveredOn: '2026-11-05' },
      { id: 'p2', orderId: 'o2', priority: 'general', promisedDelivery: '2026-11-06' },
      { id: 'p3', orderId: 'o3', priority: 'general', promisedDelivery: '2026-11-06', cancelled: true },
    ];
    const blouses: Blouse[] = [
      { id: 'a', partId: 'p1', price: 400, status: 'done', doneDate: '2026-11-03' },
      { id: 'b', partId: 'p2', price: 600, status: 'scheduled' },
      { id: 'c', partId: 'p3', price: 900, status: 'scheduled' },
    ];
    expect(report(parts, blouses, '2026-11-02', '2026-11-08')).toEqual({
      stitchedCount: 1, stitchedValue: 400, deliveredCount: 1, deliveredValue: 400,
      dueCount: 2, dueValue: 1000, pendingDueCount: 1,
    });
  });
});
