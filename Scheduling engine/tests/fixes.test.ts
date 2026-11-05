import { describe, expect, it } from 'vitest';
import {
  Blouse, EngineInput, Priority, DEFAULT_SETTINGS, catchUpExtra, checkPartDateChange, confirmOrder, rebuildSchedule,
} from '../src';

// Mon–Fri, W=10 → 2/day. 2026-11-02 is a Monday.
let seq = 0;
const world = (today: string, rest: Partial<EngineInput> = {}): EngineInput =>
  ({ today, settings: { ...DEFAULT_SETTINGS }, orders: [], parts: [], blouses: [], ...rest });
function add(w: EngineInput, p: Priority, date: string, n = 1): Blouse[] {
  seq++;
  const r = confirmOrder({ id: `o${seq}`, customerId: 'c', createdAt: seq }, [{
    partId: `p${seq}`, priority: p, promisedDelivery: date,
    blouses: Array.from({ length: n }, (_, i) => ({ id: `b${seq}_${i}`, price: 500 })),
  }]);
  w.orders.push(r.order); w.parts.push(...r.parts); w.blouses.push(...r.blouses);
  return r.blouses;
}
const tick = (w: EngineInput, ids: string[], date: string) => {
  w.blouses = w.blouses.map((b) => (ids.includes(b.id) ? { ...b, status: 'done', doneDate: date } : b));
};

describe('work queue (more energy than the daily amount)', () => {
  it('today is the top of the queue; after the daily 2 she can keep going down the queue', () => {
    const w = world('2026-11-02');
    add(w, 'general', '2026-11-30', 10);
    const s0 = rebuildSchedule(w);
    expect(s0.queue.length).toBe(10);
    expect(s0.today.blouseIds).toEqual(s0.queue.slice(0, 2));
    expect(s0.todayTarget).toBe(2);

    tick(w, s0.queue.slice(0, 2), '2026-11-02');
    const s1 = rebuildSchedule(w);
    expect(s1.doneTodayCount).toBe(2);
    expect(s1.today.blouseIds).toEqual([]); // daily amount reached
    expect(s1.queue[0]).toBe(s0.queue[2]); // next one to pick if she wants more

    tick(w, [s1.queue[0]], '2026-11-02'); // a 3rd one today
    const s2 = rebuildSchedule(w);
    // Extra work today makes the rest of the week lighter (weekly total stays 10).
    expect(s2.days.filter((d) => d.date < '2026-11-09').map((d) => d.blouseIds.length)).toEqual([2, 2, 2, 1]);
  });
  it('ticking yesterday\'s work with yesterday\'s date keeps today\'s list intact', () => {
    const w = world('2026-11-02');
    add(w, 'general', '2026-11-30', 10);
    const mon = rebuildSchedule(w).today.blouseIds;
    w.today = '2026-11-03';
    tick(w, mon, '2026-11-02');
    expect(rebuildSchedule(w).today.blouseIds.length).toBe(2);
  });
});

describe('late vs will-miss', () => {
  it('spare day used → late only; cannot be stitched before delivery → willMiss', () => {
    const w = world('2026-11-03');
    const [tight] = add(w, 'general', '2026-11-04'); // latest stitch Mon, stitched Tue: spare day used
    const [missed] = add(w, 'general', '2026-11-03'); // due today, not stitched yet
    const s = rebuildSchedule(w);
    expect(s.late.sort()).toEqual([missed.id, tight.id].sort());
    expect(s.willMiss).toEqual([missed.id]);
    expect(s.willMissParts).toEqual([missed.partId]);
  });
});

describe('changing a promised date', () => {
  it('the part is not counted twice', () => {
    const w = world('2026-11-02');
    for (let i = 0; i < 5; i++) add(w, 'emergency', '2026-11-07', 2); // 10 due this week: full
    expect(checkPartDateChange(w, w.parts[0].id, '2026-11-07').ok).toBe(true);
    expect(checkPartDateChange(w, w.parts[0].id, '2026-11-03').ok).toBe(true); // move earlier: Mon has room
    expect(checkPartDateChange(w, w.parts[0].id, '2026-11-12').ok).toBe(true); // later is fine
  });
  it('explains when the new date is impossible', () => {
    const w = world('2026-11-02');
    add(w, 'emergency', '2026-11-03', 2); // Monday full
    add(w, 'general', '2026-11-20', 2);
    const c = checkPartDateChange(w, w.parts[1].id, '2026-11-03', 'emergency');
    expect(c).toMatchObject({ ok: false, reason: 'full', nearestValid: '2026-11-04' });
    expect(checkPartDateChange(w, w.parts[1].id, '2026-11-03').reason).toBe('too-soon'); // general needs 2 days
  });
});

describe('catch up after a missed day', () => {
  it('suggests the smallest extra that clears the late flags', () => {
    const w = world('2026-11-05'); // Thursday; she was off sick Wednesday
    add(w, 'general', '2026-11-08', 6); // latest stitch Fri: Thu+Fri = 4, 2 short
    expect(rebuildSchedule(w).late.length).toBe(2);
    const c = catchUpExtra(w)!;
    expect(c).toEqual({
      dayExtras: [{ date: '2026-11-05', n: 1 }, { date: '2026-11-06', n: 1 }],
      lateBefore: 2, lateAfter: 0, willMissAfter: 0,
    });
    const fixed = rebuildSchedule({ ...w, dayExtras: c.dayExtras });
    expect(fixed.days.map((d) => d.blouseIds.length)).toEqual([3, 3]); // +1 on Thu and Fri
  });
  it('nothing late → nothing to suggest', () => {
    const w = world('2026-11-02');
    add(w, 'general', '2026-11-20', 3);
    expect(catchUpExtra(w)).toBeNull();
  });
  it('never more than double a day; honest about what stays late', () => {
    const w = world('2026-11-07'); // Saturday
    add(w, 'general', '2026-11-11', 6); // all must be stitched Monday (normal 2)
    expect(catchUpExtra(w)).toEqual({
      dayExtras: [{ date: '2026-11-09', n: 2 }], lateBefore: 4, lateAfter: 2, willMissAfter: 0,
    });
  });
  it('already-overdue work cannot be fixed by extra', () => {
    const w = world('2026-11-04');
    add(w, 'general', '2026-11-04', 2); // latest stitch was Mon
    expect(catchUpExtra(w)).toBeNull();
  });
  it('day extra also opens room for new quotes that day', () => {
    const w = world('2026-11-02', { dayExtras: [{ date: '2026-11-02', n: 2 }] });
    expect(rebuildSchedule({ ...w, blouses: w.blouses }).todayTarget).toBe(4);
  });
});
