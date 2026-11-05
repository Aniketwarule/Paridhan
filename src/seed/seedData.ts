// ============================================================
// Poshakh – Seed / Demo data
// Each demo order is quoted by the scheduling engine and saved with the
// date it offers, exactly like the New Order screen does.
// ============================================================
import * as DB from '../db/database';
import { addDays, quote, toEngineInput } from '../engine';
import type { Priority, QuotePartRequest } from '../engine';
import type { AppSettings, BlouseType } from '../types';
import { localToday, nowIso, weekRange } from '../utils/date';

interface DemoOrder {
  customer: number;
  astar: number;
  designer: number;
  /** How many of the blouses are emergency (taken from the designer ones first). */
  emergency: number;
}

export function loadSeedData(settings: AppSettings, daysOff: string[]): void {
  const today = localToday();

  const customers = [
    { name: 'Sunita Patil', phone: '9876543210' },
    { name: 'Rekha Desai', phone: '9823456780' },
    { name: 'Meena Joshi', phone: undefined },
    { name: 'Priya Kulkarni', phone: '9012345678' },
    { name: 'Savita Nair', phone: '9765432100' },
    { name: 'Anita More', phone: undefined },
  ];
  const ids = customers.map(c => DB.upsertCustomer(c.name, c.phone));
  const price = (t: BlouseType) => (t === 'astar' ? settings.priceAstar : settings.priceDesigner);

  const orders: DemoOrder[] = [
    { customer: 0, astar: 2, designer: 1, emergency: 0 },
    { customer: 1, astar: 0, designer: 2, emergency: 1 },
    { customer: 2, astar: 1, designer: 0, emergency: 0 },
    { customer: 3, astar: 3, designer: 0, emergency: 0 },
    { customer: 4, astar: 1, designer: 2, emergency: 2 },
    { customer: 5, astar: 2, designer: 2, emergency: 0 },
    { customer: 0, astar: 1, designer: 1, emergency: 1 },
  ];

  for (const o of orders) {
    const since = addDays(weekRange(today, settings.weekStartsOn)[0], -7);
    const input = toEngineInput(today, settings, daysOff, DB.loadEngineData(since));

    const blouses: { type: BlouseType; priority: Priority }[] = [];
    let e = o.emergency;
    for (let i = 0; i < o.designer; i++) blouses.push({ type: 'designer', priority: e-- > 0 ? 'emergency' : 'general' });
    for (let i = 0; i < o.astar; i++) blouses.push({ type: 'astar', priority: e-- > 0 ? 'emergency' : 'general' });

    const req: QuotePartRequest[] = (['emergency', 'general'] as Priority[])
      .map(priority => ({ priority, count: blouses.filter(b => b.priority === priority).length }))
      .filter(r => r.count > 0);
    const quoted = quote(input, req);
    if (quoted.some(q => !q.dateOffered)) continue;

    DB.createOrder(ids[o.customer], nowIso(), quoted.map(q => ({
      priority: q.priority,
      promisedDelivery: q.dateOffered!,
      blouses: blouses.filter(b => b.priority === q.priority).map(b => ({ type: b.type, price: price(b.type) })),
    })));
  }

  // One order promised for yesterday and never stitched, to show the "will miss" warning.
  DB.createOrder(ids[1], new Date(Date.now() - 3 * 86_400_000).toISOString(), [
    { priority: 'general', promisedDelivery: addDays(today, -1), blouses: [{ type: 'astar', price: settings.priceAstar }] },
  ]);
}
