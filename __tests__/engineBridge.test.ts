/// <reference types="jest" />
// ============================================================
// Poshakh – app ↔ scheduling engine bridge tests
// The engine has its own suite in "Scheduling engine/tests" (vitest).
// These check that SQLite-shaped rows reach the engine correctly.
// Run with: npm test
// ============================================================
import {
  quote,
  rebuildSchedule,
  toEngineInput,
  toEngineSettings,
  weekStrip,
} from '../src/engine';
import type { EngineData } from '../src/engine';
import type { AppSettings, Blouse, OrderPart } from '../src/types';
import { monthRange, weekRange } from '../src/utils/date';

const settings: AppSettings = {
  weeklyTarget: 10,
  emergencyReserve: 3,
  workingWeekdays: [1, 2, 3, 4, 5],
  emergencyGap: 1,
  normalGap: 2,
  deliveryWeekdays: [0, 1, 2, 3, 4, 5, 6],
  allowNewWorkToday: true,
  weekStartsOn: 1,
  priceAstar: 300,
  priceDesigner: 400,
};

const MONDAY = '2026-11-02';

function data(parts: OrderPart[], blouses: Blouse[]): EngineData {
  return {
    orders: [{ id: 1, customerId: 7, createdAt: '2026-11-01T10:00:00.000Z', status: 'pending', advance: 0, previousDue: 0 }],
    parts,
    blouses,
    weekExtras: [],
    dayExtras: [],
  };
}

const part = (id: number, promisedDelivery: string, extra: Partial<OrderPart> = {}): OrderPart => ({
  id, orderId: 1, priority: 'general', promisedDelivery, cancelled: false, ...extra,
});
const blouse = (id: number, partId: number, extra: Partial<Blouse> = {}): Blouse => ({
  id, partId, orderId: 1, type: 'astar', price: 300, status: 'scheduled', paid: false, ...extra,
});

describe('toEngineInput', () => {
  it('maps integer ids to strings and keeps prices out of engine settings', () => {
    const input = toEngineInput(MONDAY, settings, ['2026-11-04'], data(
      [part(5, '2026-11-10')],
      [blouse(9, 5), blouse(10, 5, { status: 'done', doneDate: MONDAY })],
    ));
    expect(input.orders[0]).toMatchObject({ id: '1', customerId: '7', createdAt: Date.parse('2026-11-01T10:00:00.000Z') });
    expect(input.parts[0]).toMatchObject({ id: '5', orderId: '1', promisedDelivery: '2026-11-10' });
    expect(input.blouses.map(b => [b.id, b.partId, b.status])).toEqual([['9', '5', 'scheduled'], ['10', '5', 'done']]);
    expect(input.settings.daysOff).toEqual(['2026-11-04']);
    expect(input.settings).not.toHaveProperty('priceAstar');
  });

  it('drops a stale doneDate on a blouse that was un-ticked', () => {
    const input = toEngineInput(MONDAY, settings, [], data([part(5, '2026-11-10')], [blouse(9, 5, { doneDate: MONDAY })]));
    expect(input.blouses[0].doneDate).toBeUndefined();
  });

  it('normalizes settings like the engine does', () => {
    expect(toEngineSettings({ ...settings, emergencyReserve: 99 }, []).emergencyReserve).toBe(10);
  });
});

describe('schedule through the bridge', () => {
  it("puts today's share of W at the top of the queue", () => {
    const input = toEngineInput(MONDAY, settings, [], data(
      [part(5, '2026-11-20')],
      [blouse(1, 5), blouse(2, 5), blouse(3, 5)],
    ));
    const s = rebuildSchedule(input);
    expect(s.todayTarget).toBe(2);
    expect(s.today.blouseIds).toEqual(['1', '2']);
    expect(s.queue).toEqual(['1', '2', '3']);
    expect(s.willMiss).toEqual([]);
  });

  it('flags a delivered part as finished even if a tick was forgotten', () => {
    const input = toEngineInput(MONDAY, settings, [], data(
      [part(5, '2026-11-03', { deliveredOn: MONDAY })],
      [blouse(1, 5)],
    ));
    expect(rebuildSchedule(input).queue).toEqual([]);
  });

  it('quotes a date for a new order and shows it in the week strip', () => {
    const input = toEngineInput(MONDAY, settings, [], data([], []));
    const [q] = quote(input, [{ count: 3, priority: 'general' }]);
    expect(q.dateOffered).not.toBeNull();
    const strip = weekStrip(input, rebuildSchedule(input), 5, q.weekUsage);
    expect(strip).toHaveLength(5);
    expect(strip[0]).toMatchObject({ weekStart: MONDAY, capacity: 10 });
    expect(strip.reduce((n, w) => n + w.used, 0)).toBe(3);
  });

  it('counts week extras in the strip capacity', () => {
    const d = data([], []);
    d.weekExtras = [{ weekStart: MONDAY, n: 3 }];
    const input = toEngineInput(MONDAY, settings, [], d);
    expect(weekStrip(input, rebuildSchedule(input))[0].capacity).toBe(13);
  });
});

describe('date helpers', () => {
  it('week range follows weekStartsOn', () => {
    expect(weekRange('2026-11-05', 1)).toEqual(['2026-11-02', '2026-11-08']);
    expect(weekRange('2026-11-05', 0)).toEqual(['2026-11-01', '2026-11-07']);
    expect(weekRange('2026-11-05', 1, -1)).toEqual(['2026-10-26', '2026-11-01']);
  });

  it('month range', () => {
    expect(monthRange('2026-11-15')).toEqual(['2026-11-01', '2026-11-30']);
    expect(monthRange('2026-11-15', 2)).toEqual(['2027-01-01', '2027-01-31']);
  });
});

describe('language switch', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setLanguage, STRINGS } = require('../src/strings') as typeof import('../src/strings');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { fmtLong } = require('../src/utils/date') as typeof import('../src/utils/date');
  afterAll(() => setLanguage('en'));

  it('swaps every string and date label to Marathi and back', () => {
    setLanguage('mr');
    expect(STRINGS.tabToday).toBe('आज');
    expect(fmtLong('2026-11-05')).toBe('गुरु, 5 नोव्हें 2026');
    setLanguage('en');
    expect(STRINGS.tabToday).toBe('Today');
    expect(fmtLong('2026-11-05')).toBe('Thu, 5 Nov 2026');
  });
});
