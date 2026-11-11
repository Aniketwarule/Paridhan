// ============================================================
// Poshakh – maps SQLite rows to the engine's input (pure, no DB access).
// SQLite ids are integers; the engine uses strings. Engine ids are String(row.id).
// ============================================================
import {
  addDays,
  fromDay,
  normalizeSettings,
  toDay,
  weekdayOf,
} from '../../Scheduling engine/src';
import type {
  DayExtra,
  EngineInput,
  ScheduleResult,
  Settings,
  WeekExtra,
  WeekUsage,
} from '../../Scheduling engine/src';
import type { AppSettings, Blouse, Order, OrderPart } from '../types';

export interface EngineData {
  orders: Order[];
  parts: OrderPart[];
  blouses: Blouse[];
  weekExtras: WeekExtra[];
  dayExtras: DayExtra[];
}

export function toEngineSettings(s: AppSettings, daysOff: string[]): Settings {
  const { priceAstar: _a, priceDesigner: _d, rates: _r, ...engine } = s;
  return normalizeSettings({ ...engine, daysOff });
}

export function toEngineInput(
  today: string,
  settings: AppSettings,
  daysOff: string[],
  data: EngineData,
): EngineInput {
  return {
    today,
    settings: toEngineSettings(settings, daysOff),
    orders: data.orders.map(o => ({
      id: String(o.id),
      customerId: String(o.customerId),
      createdAt: Date.parse(o.createdAt) || 0,
      note: o.notes,
    })),
    parts: data.parts.map(p => ({
      id: String(p.id),
      orderId: String(p.orderId),
      priority: p.priority,
      promisedDelivery: p.promisedDelivery,
      deliveredOn: p.deliveredOn,
      cancelled: p.cancelled,
    })),
    blouses: data.blouses.map(b => ({
      id: String(b.id),
      partId: String(b.partId),
      type: b.type,
      price: b.price,
      status: b.status,
      doneDate: b.status === 'done' ? b.doneDate : undefined,
      fullDay: b.type === 'navvari',
    })),
    weekExtras: data.weekExtras,
    dayExtras: data.dayExtras,
  };
}

export interface WeekBar {
  weekStart: string;
  /** Done that week + planned for that week. */
  used: number;
  /** W + any extra taken for that week. */
  capacity: number;
}

function weekStartOf(date: string, weekStartsOn: number): string {
  const d = toDay(date);
  return fromDay(d - ((weekdayOf(d) - weekStartsOn + 7) % 7));
}

/**
 * Load per week for `weeks` weeks starting with the current one.
 * `override` (a quote's weekUsage) replaces the used count of those weeks, so the
 * strip shows what the week would look like with the new order added.
 */
export function weekStrip(
  input: EngineInput,
  schedule: ScheduleResult,
  weeks = 5,
  override: WeekUsage[] = [],
): WeekBar[] {
  const s = input.settings;
  const first = weekStartOf(input.today, s.weekStartsOn);
  const bars = new Map<string, WeekBar>();
  for (let i = 0; i < weeks; i++) {
    const ws = addDays(first, i * 7);
    bars.set(ws, { weekStart: ws, used: 0, capacity: s.weeklyTarget });
  }
  for (const [weekStart, used] of Object.entries(schedule.weekLoad)) {
    const bar = bars.get(weekStart);
    if (bar) bar.used = used;
  }
  const addCapacity = (date: string, n: number) => {
    const bar = bars.get(weekStartOf(date, s.weekStartsOn));
    if (bar) bar.capacity += n;
  };
  for (const e of input.weekExtras ?? []) addCapacity(e.weekStart, e.n);
  for (const e of input.dayExtras ?? []) addCapacity(e.date, e.n);
  for (const u of override) {
    const bar = bars.get(u.weekStart);
    if (bar) bar.used = u.used;
  }
  return [...bars.values()];
}
