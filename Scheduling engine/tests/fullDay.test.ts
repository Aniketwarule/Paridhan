import { describe, expect, it } from 'vitest';
import {
  Blouse, EngineInput, Priority, DEFAULT_SETTINGS, addDays, catchUpExtra, checkDate, checkPartDateChange, confirmOrder,
  quote, quoteBoth, rebuildSchedule,
} from '../src';

// Full-day pieces (nav-vari saree). Mon–Fri, W=10 → 2/day. 2026-11-02 is a Monday.
const MON = '2026-11-02';
const TUE = '2026-11-03';
const WED = '2026-11-04';
const THU = '2026-11-05';
const FRI = '2026-11-06';
const FAR = '2026-11-30';

let seq = 0;
const world = (today = MON, rest: Partial<EngineInput> = {}): EngineInput =>
  ({ today, settings: { ...DEFAULT_SETTINGS }, orders: [], parts: [], blouses: [], ...rest });

function add(w: EngineInput, p: Priority, date: string, n = 1, fullDays = 0): Blouse[] {
  seq++;
  const r = confirmOrder({ id: `o${seq}`, customerId: 'c', createdAt: seq }, [{
    partId: `p${seq}`, priority: p, promisedDelivery: date,
    blouses: Array.from({ length: n }, (_, i) => ({ id: `b${seq}_${i}`, price: 500, fullDay: i < fullDays })),
  }]);
  w.orders.push(r.order); w.parts.push(...r.parts); w.blouses.push(...r.blouses);
  return r.blouses;
}
const navvari = (w: EngineInput, p: Priority, date: string) => add(w, p, date, 1, 1)[0];
const tick = (w: EngineInput, ids: string[], date: string) => {
  w.blouses = w.blouses.map((b) => (ids.includes(b.id) ? { ...b, status: 'done', doneDate: date } : b));
};
const perDay = (w: EngineInput) => rebuildSchedule(w).days.map((d) => [d.date, d.blouseIds.length]);

describe('the schedule gives a full-day piece its own day', () => {
  it('nothing else is planned on that day', () => {
    const w = world();
    const n = navvari(w, 'general', FAR);
    add(w, 'general', FAR, 3);
    const s = rebuildSchedule(w);
    expect(s.today.blouseIds).toEqual([n.id]);
    expect(perDay(w)).toEqual([[MON, 1], [TUE, 2], [WED, 1]]);
  });

  it('two full-day pieces take two days', () => {
    const w = world();
    const a = navvari(w, 'general', FAR);
    const b = navvari(w, 'general', FAR);
    const s = rebuildSchedule(w);
    expect(s.stitchDate[a.id]).toBe(MON);
    expect(s.stitchDate[b.id]).toBe(TUE);
  });

  it('waits for a fresh day when a closer deadline starts the day, and later work uses the room left', () => {
    const w = world();
    const [first] = add(w, 'general', WED); // latest stitch Mon
    const n = navvari(w, 'general', THU); // latest stitch Tue
    const [later] = add(w, 'general', FAR);
    const s = rebuildSchedule(w);
    expect(s.days[0]).toEqual({ date: MON, blouseIds: [first.id, later.id] });
    expect(s.stitchDate[n.id]).toBe(TUE);
    expect(s.late).toEqual([]);
  });

  it('moves to tomorrow once she has ticked something today', () => {
    const w = world();
    const [done] = add(w, 'general', FAR);
    const n = navvari(w, 'general', FAR);
    const [other] = add(w, 'general', FAR);
    tick(w, [done.id], MON);
    const s = rebuildSchedule(w);
    expect(s.today.blouseIds).toEqual([other.id]);
    expect(s.stitchDate[n.id]).toBe(TUE);
  });

  it('uses that day\'s own amount in a holiday week (3,2,3,2)', () => {
    const w = world(MON);
    w.settings.daysOff = [WED];
    navvari(w, 'general', FAR); // Monday: 3 slots
    add(w, 'general', FAR, 5);
    const s = rebuildSchedule(w);
    expect(s.days.map((d) => d.blouseIds.length).slice(0, 3)).toEqual([1, 2, 3]);
    expect(s.days[2].date).toBe(THU);
    expect(s.weekLoad[MON]).toBe(8);
  });

  it('flags a promise it cannot keep instead of squeezing it in', () => {
    const w = world();
    add(w, 'emergency', TUE); // must be stitched today, starts the day
    const n = navvari(w, 'emergency', TUE); // also today, but today is no longer free
    const s = rebuildSchedule(w);
    expect(s.stitchDate[n.id]).toBe(TUE);
    expect(s.willMiss).toEqual([n.id]);
  });
});

describe('a finished full-day piece', () => {
  it('closes today and counts its whole day toward the week', () => {
    const w = world();
    const n = navvari(w, 'general', FAR);
    add(w, 'general', FAR, 2);
    tick(w, [n.id], MON);
    const s = rebuildSchedule(w);
    expect(s.doneTodayCount).toBe(2);
    expect(s.todayTarget).toBe(2);
    expect(s.today.blouseIds).toEqual([]);
    expect(s.days[0].date).toBe(TUE);
    expect(s.weekLoad[MON]).toBe(4);
  });

  it('counts the amount of the day it was stitched on', () => {
    const w = world(TUE);
    w.settings.daysOff = [WED]; // Monday's amount is 3
    const n = navvari(w, 'general', FAR);
    tick(w, [n.id], MON);
    expect(rebuildSchedule(w).weekLoad[MON]).toBe(3);
  });

  it('stitched on a day off does not use up the week', () => {
    const w = world('2026-11-09');
    const n = navvari(w, 'general', FAR);
    tick(w, [n.id], '2026-11-08'); // Sunday
    expect(rebuildSchedule(w).weekLoad[MON]).toBe(0);
  });
});

describe('quoting with a full-day piece', () => {
  it('emergency on an empty schedule: stitched today, delivered tomorrow', () => {
    const [q] = quote(world(), [{ count: 1, fullDayCount: 1, priority: 'emergency' }]);
    expect(q.dateOffered).toBe(TUE);
    expect(q.stitchDays).toEqual([MON]);
    expect(q.weekUsage).toEqual([{ weekStart: MON, used: 2, capacity: 10 }]);
  });

  it('general keeps the emergency room, like the two blouses it replaces', () => {
    const w = world();
    const [full] = quote(w, [{ count: 1, fullDayCount: 1, priority: 'general' }]);
    const [two] = quote(w, [{ count: 2, priority: 'general' }]);
    expect(full.dateOffered).toBe(THU);
    expect(full.dateOffered).toBe(two.dateOffered);
  });

  it('cannot count on a day that has already started', () => {
    const w = world();
    tick(w, add(w, 'general', FAR).map((b) => b.id), MON);
    expect(quote(w, [{ count: 1, priority: 'emergency' }])[0].dateOffered).toBe(TUE);
    const [q] = quote(w, [{ count: 1, fullDayCount: 1, priority: 'emergency' }]);
    expect(q.dateOffered).toBe(WED);
    expect(q.stitchDays).toEqual([TUE]);
  });

  it('a mixed order gets a separate day for the full-day piece', () => {
    const w = world();
    add(w, 'emergency', THU, 6); // Mon, Tue, Wed are full
    const [q] = quote(w, [{ count: 2, fullDayCount: 1, priority: 'emergency' }]);
    expect(q.stitchDays).toEqual([THU, FRI]);
    expect(q.dateOffered).toBe('2026-11-07');
  });

  it('a blouse can still be urgent: it goes first and the open full-day piece moves over', () => {
    const w = world();
    const n = navvari(w, 'general', FAR);
    const [q] = quote(w, [{ count: 1, priority: 'emergency' }]);
    expect(q.dateOffered).toBe(TUE);
    expect(q.stitchDays).toEqual([MON]);
    const [b] = add(w, 'emergency', TUE);
    const s = rebuildSchedule(w);
    expect(s.days[0].blouseIds).toEqual([b.id]);
    expect(s.stitchDate[n.id]).toBe(TUE);
    expect(s.late).toEqual([]);
  });

  it('never quotes a blouse into a day an open full-day piece needs', () => {
    const w = world();
    navvari(w, 'emergency', TUE); // must be stitched today
    const [q] = quote(w, [{ count: 1, priority: 'emergency' }]);
    expect(q.dateOffered).toBe(WED);
    expect(q.stitchDays).toEqual([TUE]);
  });

  it('every quoted date is kept once the order is saved', () => {
    const w = world();
    add(w, 'general', '2026-11-10', 5);
    navvari(w, 'general', '2026-11-11');
    const req = [
      { count: 1, priority: 'emergency' as const },
      { count: 2, fullDayCount: 1, priority: 'general' as const },
    ];
    const qs = quote(w, req);
    qs.forEach((q, i) => add(w, q.priority, q.dateOffered!, q.count, req[i].fullDayCount ?? 0));
    const s = rebuildSchedule(w);
    expect(s.late).toEqual([]);
    expect(s.willMiss).toEqual([]);
  });

  it('side by side quotes pass the full-day count on', () => {
    const { general, emergency } = quoteBoth(world(), 1, 1);
    expect(emergency.dateOffered).toBe(TUE);
    expect(general.dateOffered).toBe(THU);
  });
});

describe('asking for a specific date', () => {
  it('explains a full week, offers the nearest date and an extra that really works', () => {
    const w = world();
    add(w, 'emergency', FRI, 8); // Mon to Thu are full
    const part = { count: 1, fullDayCount: 1, priority: 'emergency' as const };
    const c = checkDate(w, part, FRI);
    expect(c).toMatchObject({ ok: false, reason: 'full', nearestValid: '2026-11-07' });
    expect(checkDate(w, part, '2026-11-07').ok).toBe(true);

    const extra = c.extraNeeded!;
    expect(extra.weekStart).toBe(MON);
    w.weekExtras = [extra];
    expect(checkDate(w, part, FRI).ok).toBe(true);
    const n = navvari(w, 'emergency', FRI);
    const s = rebuildSchedule(w);
    expect(s.willMiss).toEqual([]);
    expect(s.late).toEqual([]);
    expect(s.days.find((d) => d.blouseIds.includes(n.id))!.blouseIds).toEqual([n.id]);
  });

  it('moving an existing delivery does not count it twice and keeps it a full-day piece', () => {
    const w = world();
    const n = navvari(w, 'general', FAR);
    expect(checkPartDateChange(w, n.partId, TUE, 'emergency').ok).toBe(true);

    add(w, 'emergency', TUE); // today now starts with something that must be done today
    expect(checkPartDateChange(w, n.partId, TUE, 'emergency')).toMatchObject({ ok: false, reason: 'full', nearestValid: WED });
  });
});

describe('holds for any mix of settings and work', () => {
  function randomWorld(seed: number): EngineInput {
    let r = seed * 7919 + 13;
    const rnd = () => ((r = (r * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const int = (n: number) => Math.floor(rnd() * n);
    const today = addDays(MON, int(7));
    const weekly = [5, 7, 10, 10, 10, 12, 14][int(7)];
    const w = world(today, {
      settings: {
        ...DEFAULT_SETTINGS,
        weeklyTarget: weekly,
        emergencyReserve: int(5),
        workingWeekdays: rnd() < 0.3 ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5],
        daysOff: rnd() < 0.3 ? [addDays(today, int(10))] : [],
        emergencyGap: 1 + int(2),
        normalGap: 1 + int(3),
        allowNewWorkToday: rnd() < 0.8,
      },
    });
    const orders = int(14);
    for (let i = 0; i < orders; i++) {
      const pieces = 1 + int(3);
      const made = add(w, rnd() < 0.25 ? 'emergency' : 'general', addDays(today, 2 + int(40)), pieces, rnd() < 0.3 ? 1 : 0);
      if (rnd() < 0.15) tick(w, [made[made.length - 1].id], addDays(today, -int(3)));
    }
    if (rnd() < 0.2) w.weekExtras = [{ weekStart: today, n: 1 + int(3) }];
    if (rnd() < 0.2) w.dayExtras = [{ date: addDays(today, int(6)), n: 1 }];
    return w;
  }

  const checkDays = (w: EngineInput, seed: number) => {
    const s = rebuildSchedule(w);
    const isFull = new Set(w.blouses.filter((b) => b.fullDay).map((b) => b.id));
    for (const day of s.days) {
      if (!day.blouseIds.some((id) => isFull.has(id))) continue;
      expect(day.blouseIds.length, `seed ${seed}: nav-vari shares ${day.date}`).toBe(1);
      if (day.date === w.today) expect(s.doneTodayCount, `seed ${seed}: nav-vari on a started day`).toBe(0);
    }
    return s;
  };

  it('a nav-vari is alone on its day, and a saved quote breaks no promise', () => {
    let saved = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const w = randomWorld(seed);
      const before = checkDays(w, seed);
      const n = 1 + (seed % 3);
      const req = seed % 2
        ? [{ count: n, fullDayCount: 1, priority: (seed % 4 === 1 ? 'emergency' : 'general') as Priority }]
        : [{ count: 1, priority: 'emergency' as Priority }, { count: n, fullDayCount: 1, priority: 'general' as Priority }];
      const qs = quote(w, req);
      if (qs.some((q) => !q.dateOffered)) continue;

      const newIds = qs.flatMap((q, i) => add(w, q.priority, q.dateOffered!, q.count, req[i].fullDayCount ?? 0).map((b) => b.id));
      saved++;
      const after = checkDays(w, seed);
      for (const id of newIds) {
        expect(after.late, `seed ${seed}: new piece ${id} is late`).not.toContain(id);
        expect(after.willMiss, `seed ${seed}: new piece ${id} will miss`).not.toContain(id);
      }
      for (const id of after.late) {
        expect(before.late, `seed ${seed}: quote made ${id} late`).toContain(id);
      }
    }
    expect(saved).toBeGreaterThan(300);
  });

  it('the plan never goes over a week\'s capacity', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const w = randomWorld(seed);
      const s = rebuildSchedule(w);
      const extra = (w.weekExtras ?? []).reduce((t, e) => t + e.n, 0) + (w.dayExtras ?? []).reduce((t, e) => t + e.n, 0);
      for (const [week, used] of Object.entries(s.weekLoad)) {
        // Work already done in the past may have gone over; only future weeks are pure plan.
        if (week > addDays(w.today, 0)) expect(used, `seed ${seed}: week ${week}`).toBeLessThanOrEqual(w.settings.weeklyTarget + extra);
      }
    }
  });
});

describe('catch up', () => {
  it('asks for extra on other days, never on a day given to a full-day piece', () => {
    const w = world(THU);
    navvari(w, 'general', '2026-11-07'); // latest stitch Thu, takes Thursday
    add(w, 'general', '2026-11-08', 4); // latest stitch Fri: only Friday left, 2 short
    expect(rebuildSchedule(w).late.length).toBe(2);
    const c = catchUpExtra(w)!;
    expect(c.dayExtras).toEqual([{ date: FRI, n: 2 }]);
    expect(c.lateAfter).toBe(0);
  });
});
