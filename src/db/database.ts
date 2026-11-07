// ============================================================
// Poshakh – Database layer (expo-sqlite)
//
// Customer ──< Order ──< OrderPart ──< Blouse
// Stitch dates are never stored: the scheduling engine works them out
// from the parts' promised dates every time (see src/engine).
// ============================================================
import * as SQLite from 'expo-sqlite';
import { DEFAULT_SETTINGS, type DayExtra, type EngineData, type Priority, type WeekExtra, type Weekday } from '../engine';
import type {
  AppSettings,
  Blouse,
  BlouseStatus,
  BlouseType,
  BlouseView,
  Customer,
  CustomerSummary,
  DayOff,
  Order,
  OrderPart,
  OrderStatus,
  OrderWithDetails,
  PartWithBlouses,
} from '../types';

const SCHEMA_VERSION = 4;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  weeklyTarget: DEFAULT_SETTINGS.weeklyTarget,
  emergencyReserve: DEFAULT_SETTINGS.emergencyReserve,
  workingWeekdays: DEFAULT_SETTINGS.workingWeekdays,
  emergencyGap: DEFAULT_SETTINGS.emergencyGap,
  normalGap: DEFAULT_SETTINGS.normalGap,
  deliveryWeekdays: DEFAULT_SETTINGS.deliveryWeekdays,
  allowNewWorkToday: DEFAULT_SETTINGS.allowNewWorkToday,
  weekStartsOn: DEFAULT_SETTINGS.weekStartsOn,
  priceAstar: 300,
  priceDesigner: 400,
};

// ── Open database ────────────────────────────────────────────
let _db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!_db) _db = SQLite.openDatabaseSync('poshakh.db');
  return _db;
}

// ── Schema ───────────────────────────────────────────────────
const weekdays = (s: string): Weekday[] =>
  s.split(',').filter(x => x !== '').map(Number) as Weekday[];

export async function initDb(): Promise<void> {
  const db = getDb();
  db.execSync(`PRAGMA journal_mode = WAL;`);

  const version = db.getFirstSync<{ user_version: number }>(`PRAGMA user_version`)?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;

  db.withTransactionSync(() => {
    if (version < 2) createV2(db);
    // v3: blouses get an optional name.
    const blouseCols = new Set(db.getAllSync<{ name: string }>(`PRAGMA table_info(blouses)`).map(c => c.name));
    if (!blouseCols.has('name')) db.execSync(`ALTER TABLE blouses ADD COLUMN name TEXT`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)`);
    // v4: advance received and old balance carried into an order.
    const orderCols = new Set(db.getAllSync<{ name: string }>(`PRAGMA table_info(orders)`).map(c => c.name));
    if (!orderCols.has('advance')) db.execSync(`ALTER TABLE orders ADD COLUMN advance INTEGER NOT NULL DEFAULT 0`);
    if (!orderCols.has('previous_due')) db.execSync(`ALTER TABLE orders ADD COLUMN previous_due INTEGER NOT NULL DEFAULT 0`);
    db.execSync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}

function createV2(db: SQLite.SQLiteDatabase): void {
  {
    db.execSync(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        working_days TEXT NOT NULL DEFAULT '1,2,3,4,5',
        weekly_target INTEGER NOT NULL DEFAULT 10,
        emergency_reserve INTEGER NOT NULL DEFAULT 3,
        price_astar INTEGER NOT NULL DEFAULT 300,
        price_designer INTEGER NOT NULL DEFAULT 400
      );

      CREATE TABLE IF NOT EXISTS days_off (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        label TEXT
      );

      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT
      );

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS order_parts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        priority TEXT NOT NULL DEFAULT 'general',
        promised_delivery TEXT NOT NULL,
        delivered_on TEXT,
        cancelled INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS blouses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        part_id INTEGER NOT NULL REFERENCES order_parts(id),
        order_id INTEGER NOT NULL REFERENCES orders(id),
        type TEXT NOT NULL,
        price INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled',
        done_date TEXT,
        paid INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS week_extras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_start TEXT NOT NULL,
        n INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS day_extras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        n INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_parts_order ON order_parts(order_id);
      CREATE INDEX IF NOT EXISTS idx_blouses_part ON blouses(part_id);
      CREATE INDEX IF NOT EXISTS idx_blouses_order ON blouses(order_id);
    `);

    // New engine settings columns (older installs only have the base columns).
    const cols = new Set(db.getAllSync<{ name: string }>(`PRAGMA table_info(settings)`).map(c => c.name));
    const add = (name: string, def: string) => {
      if (!cols.has(name)) db.execSync(`ALTER TABLE settings ADD COLUMN ${name} ${def}`);
    };
    add('emergency_gap', `INTEGER NOT NULL DEFAULT ${DEFAULT_SETTINGS.emergencyGap}`);
    add('normal_gap', `INTEGER NOT NULL DEFAULT ${DEFAULT_SETTINGS.normalGap}`);
    add('delivery_days', `TEXT NOT NULL DEFAULT '${DEFAULT_SETTINGS.deliveryWeekdays.join(',')}'`);
    add('allow_new_work_today', `INTEGER NOT NULL DEFAULT ${DEFAULT_SETTINGS.allowNewWorkToday ? 1 : 0}`);
    add('week_starts_on', `INTEGER NOT NULL DEFAULT ${DEFAULT_SETTINGS.weekStartsOn}`);

    db.runSync(
      `INSERT OR IGNORE INTO settings (id, working_days, weekly_target, emergency_reserve, price_astar, price_designer)
       VALUES (1, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_APP_SETTINGS.workingWeekdays.join(','),
        DEFAULT_APP_SETTINGS.weeklyTarget,
        DEFAULT_APP_SETTINGS.emergencyReserve,
        DEFAULT_APP_SETTINGS.priceAstar,
        DEFAULT_APP_SETTINGS.priceDesigner,
      ],
    );

    migrateOldBlouseItems(db);
  }
}

/**
 * v1 stored one row per blouse with its own stitch date and delivery date.
 * Group each order's blouses into parts (same priority + promised date + delivery state).
 */
function migrateOldBlouseItems(db: SQLite.SQLiteDatabase): void {
  const exists = db.getFirstSync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'blouse_items'`,
  );
  if (!exists) return;

  const rows = db.getAllSync<any>(`SELECT * FROM blouse_items ORDER BY order_id, id`);
  const partIds = new Map<string, number>();
  const touched = new Set<number>();
  for (const r of rows) {
    const delivered = r.status === 'delivered' ? String(r.delivered_at ?? '').slice(0, 10) : '';
    const cancelled = r.status === 'cancelled' ? 1 : 0;
    const key = `${r.order_id}|${r.priority}|${r.promised_delivery_date}|${delivered}|${cancelled}`;
    let partId = partIds.get(key);
    if (partId === undefined) {
      partId = db.runSync(
        `INSERT INTO order_parts (order_id, priority, promised_delivery, delivered_on, cancelled) VALUES (?, ?, ?, ?, ?)`,
        [r.order_id, r.priority, r.promised_delivery_date, delivered || null, cancelled],
      ).lastInsertRowId;
      partIds.set(key, partId);
    }
    const status: BlouseStatus = r.status === 'cancelled' ? 'cancelled'
      : r.status === 'done' || r.status === 'delivered' ? 'done' : 'scheduled';
    const doneDate = status === 'done' ? String(r.done_at ?? r.delivered_at ?? '').slice(0, 10) || null : null;
    db.runSync(
      `INSERT INTO blouses (part_id, order_id, type, price, status, done_date, paid) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [partId, r.order_id, r.type, r.price, status, doneDate, r.paid ? 1 : 0],
    );
    touched.add(r.order_id);
  }
  db.execSync(`DROP TABLE blouse_items`);
  for (const id of touched) syncOrderStatus(id);
}

// ── Settings ─────────────────────────────────────────────────
export function loadSettings(): AppSettings {
  const row = getDb().getFirstSync<any>(`SELECT * FROM settings WHERE id = 1`);
  if (!row) return DEFAULT_APP_SETTINGS;
  return {
    workingWeekdays: weekdays(row.working_days),
    weeklyTarget: row.weekly_target,
    emergencyReserve: row.emergency_reserve,
    emergencyGap: row.emergency_gap,
    normalGap: row.normal_gap,
    // Delivery is possible on any day; the old per-weekday setting is no longer used.
    deliveryWeekdays: [0, 1, 2, 3, 4, 5, 6],
    allowNewWorkToday: row.allow_new_work_today === 1,
    weekStartsOn: row.week_starts_on as Weekday,
    priceAstar: row.price_astar,
    priceDesigner: row.price_designer,
  };
}

export function saveSettings(s: AppSettings): void {
  getDb().runSync(
    `UPDATE settings SET working_days = ?, weekly_target = ?, emergency_reserve = ?, emergency_gap = ?,
       normal_gap = ?, delivery_days = ?, allow_new_work_today = ?, week_starts_on = ?, price_astar = ?,
       price_designer = ?
     WHERE id = 1`,
    [
      s.workingWeekdays.join(','),
      s.weeklyTarget,
      s.emergencyReserve,
      s.emergencyGap,
      s.normalGap,
      s.deliveryWeekdays.join(','),
      s.allowNewWorkToday ? 1 : 0,
      s.weekStartsOn,
      s.priceAstar,
      s.priceDesigner,
    ],
  );
}

// ── Days off ─────────────────────────────────────────────────
export function loadDaysOff(): DayOff[] {
  return getDb()
    .getAllSync<{ id: number; date: string; label: string | null }>(`SELECT id, date, label FROM days_off ORDER BY date`)
    .map(r => ({ id: r.id, date: r.date, label: r.label ?? undefined }));
}

export function addDayOff(date: string, label?: string): void {
  getDb().runSync(`INSERT OR IGNORE INTO days_off (date, label) VALUES (?, ?)`, [date, label ?? null]);
}

export function removeDayOff(id: number): void {
  getDb().runSync(`DELETE FROM days_off WHERE id = ?`, [id]);
}

// ── Extra capacity ("Take extra anyway" / catch-up) ──────────
export function loadWeekExtras(): WeekExtra[] {
  return getDb().getAllSync<{ week_start: string; n: number }>(`SELECT week_start, n FROM week_extras`)
    .map(r => ({ weekStart: r.week_start, n: r.n }));
}

export function addWeekExtra(e: WeekExtra): void {
  getDb().runSync(`INSERT INTO week_extras (week_start, n) VALUES (?, ?)`, [e.weekStart, e.n]);
}

export function loadDayExtras(): DayExtra[] {
  return getDb().getAllSync<{ date: string; n: number }>(`SELECT date, n FROM day_extras`)
    .map(r => ({ date: r.date, n: r.n }));
}

export function addDayExtras(extras: DayExtra[]): void {
  const db = getDb();
  db.withTransactionSync(() => {
    for (const e of extras) db.runSync(`INSERT INTO day_extras (date, n) VALUES (?, ?)`, [e.date, e.n]);
  });
}

// ── Small key/value store ─────────────────────────────────────
export function getState<T>(key: string): T | null {
  const r = getDb().getFirstSync<{ value: string }>(`SELECT value FROM app_state WHERE key = ?`, [key]);
  if (!r) return null;
  try { return JSON.parse(r.value) as T; } catch { return null; }
}

export function setState(key: string, value: unknown): void {
  getDb().runSync(`INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)`, [key, JSON.stringify(value)]);
}

// ── Shop details (printed on the bill) ────────────────────────
export interface ShopInfo {
  name: string;
  tailor: string;
  phone: string;
}

export function getShopInfo(): ShopInfo {
  const s = getState<Partial<ShopInfo>>('shop');
  return { name: s?.name ?? '', tailor: s?.tailor ?? '', phone: s?.phone ?? '' };
}

export function setShopInfo(info: ShopInfo): void {
  setState('shop', { name: info.name.trim(), tailor: info.tailor.trim(), phone: info.phone.trim() });
}

// ── Customers ─────────────────────────────────────────────────
export function upsertCustomer(name: string, phone?: string): number {
  const db = getDb();
  const existing = db.getFirstSync<{ id: number }>(`SELECT id FROM customers WHERE name = ? LIMIT 1`, [name]);
  if (existing) {
    if (phone) db.runSync(`UPDATE customers SET phone = ? WHERE id = ?`, [phone, existing.id]);
    return existing.id;
  }
  return db.runSync(`INSERT INTO customers (name, phone) VALUES (?, ?)`, [name, phone ?? null]).lastInsertRowId;
}

export function createCustomer(name: string, phone?: string): number {
  return getDb().runSync(`INSERT INTO customers (name, phone) VALUES (?, ?)`, [name, phone || null]).lastInsertRowId;
}

/** Customers matching name or phone, most recent first. Empty query = recent customers. */
export function searchCustomers(query: string, limit = 30): CustomerSummary[] {
  const q = `%${query.trim()}%`;
  return getDb().getAllSync<any>(
    `SELECT c.id, c.name, c.phone, MAX(o.created_at) AS last_order, COUNT(o.id) AS order_count
     FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND o.status != 'cancelled'
     WHERE c.name LIKE ? OR IFNULL(c.phone, '') LIKE ?
     GROUP BY c.id
     ORDER BY last_order IS NULL, last_order DESC, c.name
     LIMIT ?`,
    [q, q, limit],
  ).map(r => ({
    id: r.id,
    name: r.name,
    phone: r.phone ?? undefined,
    lastOrderAt: r.last_order ?? undefined,
    orderCount: r.order_count,
  }));
}

/** Exact (case-insensitive) name match, to warn about saving a duplicate. */
export function findCustomerByName(name: string): Customer | null {
  const r = getDb().getFirstSync<any>(`SELECT id, name, phone FROM customers WHERE name = ? COLLATE NOCASE LIMIT 1`, [name.trim()]);
  return r ? { id: r.id, name: r.name, phone: r.phone ?? undefined } : null;
}

export function loadCustomer(id: number): Customer | null {
  const r = getDb().getFirstSync<{ id: number; name: string; phone: string | null }>(
    `SELECT id, name, phone FROM customers WHERE id = ?`, [id],
  );
  return r ? { id: r.id, name: r.name, phone: r.phone ?? undefined } : null;
}

// ── Row mappers ───────────────────────────────────────────────
function rowToOrder(r: any): Order {
  return {
    id: r.id,
    customerId: r.customer_id,
    createdAt: r.created_at,
    status: r.status as OrderStatus,
    notes: r.notes ?? undefined,
    advance: r.advance ?? 0,
    previousDue: r.previous_due ?? 0,
  };
}

function rowToPart(r: any): OrderPart {
  return {
    id: r.id,
    orderId: r.order_id,
    priority: r.priority as Priority,
    promisedDelivery: r.promised_delivery,
    deliveredOn: r.delivered_on ?? undefined,
    cancelled: r.cancelled === 1,
  };
}

function rowToBlouse(r: any): Blouse {
  return {
    id: r.id,
    partId: r.part_id,
    orderId: r.order_id,
    type: r.type as BlouseType,
    name: r.name ?? undefined,
    price: r.price,
    status: r.status as BlouseStatus,
    doneDate: r.done_date ?? undefined,
    paid: r.paid === 1,
  };
}

// ── Orders ────────────────────────────────────────────────────
export interface NewPart {
  priority: Priority;
  promisedDelivery: string;
  blouses: { type: BlouseType; price: number; name?: string }[];
}

/** Save a confirmed order with its parts and blouses in one transaction. */
export interface OrderMoney {
  advance: number;
  previousDue: number;
}

export function createOrder(
  customerId: number, createdAt: string, parts: NewPart[], notes?: string, money?: OrderMoney,
): number {
  const db = getDb();
  let orderId = 0;
  db.withTransactionSync(() => {
    orderId = db.runSync(
      `INSERT INTO orders (customer_id, created_at, status, notes, advance, previous_due) VALUES (?, ?, 'pending', ?, ?, ?)`,
      [customerId, createdAt, notes ?? null, money?.advance ?? 0, money?.previousDue ?? 0],
    ).lastInsertRowId;
    for (const p of parts) {
      if (p.blouses.length === 0) continue;
      const partId = db.runSync(
        `INSERT INTO order_parts (order_id, priority, promised_delivery) VALUES (?, ?, ?)`,
        [orderId, p.priority, p.promisedDelivery],
      ).lastInsertRowId;
      for (const b of p.blouses) {
        db.runSync(
          `INSERT INTO blouses (part_id, order_id, type, name, price, status) VALUES (?, ?, ?, ?, ?, 'scheduled')`,
          [partId, orderId, b.type, b.name?.trim() || null, b.price],
        );
      }
    }
  });
  return orderId;
}

function detailsFor(orders: Order[]): OrderWithDetails[] {
  if (orders.length === 0) return [];
  const db = getDb();
  const ids = orders.map(o => o.id).join(',');
  const parts = db.getAllSync<any>(
    `SELECT * FROM order_parts WHERE order_id IN (${ids}) ORDER BY promised_delivery, id`,
  ).map(rowToPart);
  const blouses = db.getAllSync<any>(`SELECT * FROM blouses WHERE order_id IN (${ids}) ORDER BY id`).map(rowToBlouse);
  const customers = new Map<number, Customer>();
  for (const r of db.getAllSync<any>(
    `SELECT id, name, phone FROM customers WHERE id IN (${orders.map(o => o.customerId).join(',')})`,
  )) customers.set(r.id, { id: r.id, name: r.name, phone: r.phone ?? undefined });

  return orders.map(order => ({
    order,
    customer: customers.get(order.customerId) ?? { id: order.customerId, name: '—' },
    parts: parts
      .filter(p => p.orderId === order.id)
      .map(p => ({ ...p, blouses: blouses.filter(b => b.partId === p.id) })),
  }));
}

export function loadOrdersWithDetails(status: OrderStatus): OrderWithDetails[] {
  const rows = getDb().getAllSync<any>(`SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC`, [status]);
  return detailsFor(rows.map(rowToOrder));
}

/** A customer's orders not yet fully delivered, oldest first. */
export function loadUndeliveredOrders(customerId: number): OrderWithDetails[] {
  const rows = getDb().getAllSync<any>(
    `SELECT * FROM orders WHERE customer_id = ? AND status IN ('pending', 'ready') ORDER BY created_at, id`,
    [customerId],
  );
  return detailsFor(rows.map(rowToOrder));
}

export function loadOrderDetails(orderId: number): OrderWithDetails | null {
  const r = getDb().getFirstSync<any>(`SELECT * FROM orders WHERE id = ?`, [orderId]);
  return r ? detailsFor([rowToOrder(r)])[0] : null;
}

export function updateOrderMoney(orderId: number, money: OrderMoney): void {
  getDb().runSync(`UPDATE orders SET advance = ?, previous_due = ? WHERE id = ?`, [money.advance, money.previousDue, orderId]);
}

export function cancelOrder(orderId: number): void {
  const db = getDb();
  db.withTransactionSync(() => {
    db.runSync(`UPDATE order_parts SET cancelled = 1 WHERE order_id = ? AND delivered_on IS NULL`, [orderId]);
    db.runSync(
      `UPDATE blouses SET status = 'cancelled'
       WHERE order_id = ? AND status = 'scheduled'`,
      [orderId],
    );
    syncOrderStatus(orderId);
  });
}

/** Order status is derived: delivered when every live part is handed over, ready when every blouse is stitched. */
export function syncOrderStatus(orderId: number): void {
  const db = getDb();
  const parts = db.getAllSync<any>(`SELECT * FROM order_parts WHERE order_id = ?`, [orderId]).map(rowToPart);
  const blouses = db.getAllSync<any>(`SELECT * FROM blouses WHERE order_id = ?`, [orderId]).map(rowToBlouse);
  const live = parts.filter(p => !p.cancelled && blouses.some(b => b.partId === p.id && b.status !== 'cancelled'));
  let status: OrderStatus;
  if (live.length === 0) status = 'cancelled';
  else if (live.every(p => p.deliveredOn)) status = 'delivered';
  else if (live.every(p => p.deliveredOn || blouses.every(b => b.partId !== p.id || b.status !== 'scheduled'))) {
    status = 'ready';
  } else status = 'pending';
  db.runSync(`UPDATE orders SET status = ? WHERE id = ?`, [status, orderId]);
}

// ── Parts ─────────────────────────────────────────────────────
function orderOfPart(partId: number): number | null {
  return getDb().getFirstSync<{ order_id: number }>(`SELECT order_id FROM order_parts WHERE id = ?`, [partId])?.order_id ?? null;
}

/** Hand-over closes a part: its blouses leave the schedule even if a tick was forgotten. */
export function setPartDelivered(partId: number, date: string | null): void {
  getDb().runSync(`UPDATE order_parts SET delivered_on = ? WHERE id = ?`, [date, partId]);
  const o = orderOfPart(partId);
  if (o !== null) syncOrderStatus(o);
}

export function updatePartDate(partId: number, date: string, priority?: Priority): void {
  const db = getDb();
  if (priority) db.runSync(`UPDATE order_parts SET promised_delivery = ?, priority = ? WHERE id = ?`, [date, priority, partId]);
  else db.runSync(`UPDATE order_parts SET promised_delivery = ? WHERE id = ?`, [date, partId]);
}

export function setPartPaid(partId: number, paid: boolean): void {
  getDb().runSync(`UPDATE blouses SET paid = ? WHERE part_id = ? AND status != 'cancelled'`, [paid ? 1 : 0, partId]);
}

// ── Blouses ───────────────────────────────────────────────────
export function markBlousesDone(ids: number[], doneDate: string): void {
  if (ids.length === 0) return;
  const db = getDb();
  db.withTransactionSync(() => {
    for (const id of ids) {
      db.runSync(`UPDATE blouses SET status = 'done', done_date = ? WHERE id = ? AND status = 'scheduled'`, [doneDate, id]);
    }
    const orders = db.getAllSync<{ order_id: number }>(
      `SELECT DISTINCT order_id FROM blouses WHERE id IN (${ids.join(',')})`,
    );
    for (const o of orders) syncOrderStatus(o.order_id);
  });
}

/** Undo a tick: back to the schedule. */
export function markBlouseUndone(id: number): void {
  const db = getDb();
  db.runSync(`UPDATE blouses SET status = 'scheduled', done_date = NULL WHERE id = ? AND status = 'done'`, [id]);
  const r = db.getFirstSync<{ order_id: number }>(`SELECT order_id FROM blouses WHERE id = ?`, [id]);
  if (r) syncOrderStatus(r.order_id);
}

export function updateBlousePrice(id: number, price: number): void {
  getDb().runSync(`UPDATE blouses SET price = ? WHERE id = ?`, [price, id]);
}

/** Blouses joined with part, order and customer, keyed by id. */
export function loadBlouseViews(ids: number[]): Map<number, BlouseView> {
  const out = new Map<number, BlouseView>();
  if (ids.length === 0) return out;
  const rows = getDb().getAllSync<any>(
    `SELECT b.*, p.priority, p.promised_delivery, p.delivered_on, c.name AS customer_name, c.phone AS customer_phone
     FROM blouses b
     JOIN order_parts p ON p.id = b.part_id
     JOIN orders o ON o.id = b.order_id
     JOIN customers c ON c.id = o.customer_id
     WHERE b.id IN (${ids.join(',')})`,
  );
  for (const r of rows) {
    out.set(r.id, {
      ...rowToBlouse(r),
      priority: r.priority as Priority,
      promisedDelivery: r.promised_delivery,
      partDeliveredOn: r.delivered_on ?? undefined,
      customerName: r.customer_name,
      customerPhone: r.customer_phone ?? undefined,
    });
  }
  return out;
}

/** Blouses still to stitch whose customer or blouse name matches. */
export function searchOpenBlouseIds(query: string, limit = 40): number[] {
  const q = `%${query.trim()}%`;
  return getDb().getAllSync<{ id: number }>(
    `SELECT b.id FROM blouses b
     JOIN order_parts p ON p.id = b.part_id
     JOIN orders o ON o.id = b.order_id
     JOIN customers c ON c.id = o.customer_id
     WHERE b.status = 'scheduled' AND p.delivered_on IS NULL AND p.cancelled = 0
       AND (c.name LIKE ? OR IFNULL(b.name, '') LIKE ? OR IFNULL(c.phone, '') LIKE ?)
     ORDER BY p.promised_delivery, b.id
     LIMIT ?`,
    [q, q, q, limit],
  ).map(r => r.id);
}

/** Blouses ticked done on one day (for the Today screen's "done" list). */
export function loadBlouseIdsDoneOn(date: string): number[] {
  return getDb().getAllSync<{ id: number }>(
    `SELECT id FROM blouses WHERE status = 'done' AND done_date = ? ORDER BY id`, [date],
  ).map(r => r.id);
}

export interface ReadyPart extends PartWithBlouses {
  customerName: string;
  customerPhone?: string;
}

/** Parts whose blouses are all stitched but not yet handed over. */
export function loadReadyParts(): ReadyPart[] {
  const db = getDb();
  const rows = db.getAllSync<any>(
    `SELECT p.*, c.name AS customer_name, c.phone AS customer_phone
     FROM order_parts p
     JOIN orders o ON o.id = p.order_id
     JOIN customers c ON c.id = o.customer_id
     WHERE p.delivered_on IS NULL AND p.cancelled = 0
       AND EXISTS (SELECT 1 FROM blouses b WHERE b.part_id = p.id AND b.status = 'done')
       AND NOT EXISTS (SELECT 1 FROM blouses b WHERE b.part_id = p.id AND b.status = 'scheduled')
     ORDER BY p.promised_delivery`,
  );
  if (rows.length === 0) return [];
  const blouses = db.getAllSync<any>(
    `SELECT * FROM blouses WHERE part_id IN (${rows.map(r => r.id).join(',')}) AND status != 'cancelled'`,
  ).map(rowToBlouse);
  return rows.map(r => ({
    ...rowToPart(r),
    customerName: r.customer_name,
    customerPhone: r.customer_phone ?? undefined,
    blouses: blouses.filter(b => b.partId === r.id),
  }));
}

// ── Engine input ──────────────────────────────────────────────
/**
 * Everything the engine needs: open work plus anything stitched since `doneSince`
 * (so this week's done count is right). Delivered history is left out.
 */
export function loadEngineData(doneSince: string): EngineData {
  const db = getDb();
  const blouses = db.getAllSync<any>(
    `SELECT b.* FROM blouses b JOIN order_parts p ON p.id = b.part_id
     WHERE (b.status = 'scheduled' AND p.delivered_on IS NULL AND p.cancelled = 0)
        OR (b.status = 'done' AND b.done_date >= ?)`,
    [doneSince],
  ).map(rowToBlouse);
  const partIds = [...new Set(blouses.map(b => b.partId))];
  const parts = partIds.length
    ? db.getAllSync<any>(`SELECT * FROM order_parts WHERE id IN (${partIds.join(',')})`).map(rowToPart)
    : [];
  const orderIds = [...new Set(parts.map(p => p.orderId))];
  const orders = orderIds.length
    ? db.getAllSync<any>(`SELECT * FROM orders WHERE id IN (${orderIds.join(',')})`).map(rowToOrder)
    : [];
  return { orders, parts, blouses, weekExtras: loadWeekExtras(), dayExtras: loadDayExtras() };
}

// ── Reports ───────────────────────────────────────────────────
/** Parts and blouses touching [from, to]: stitched, delivered or due in the range. */
export function loadReportRows(from: string, to: string): { parts: OrderPart[]; blouses: Blouse[] } {
  const db = getDb();
  const parts = db.getAllSync<any>(
    `SELECT DISTINCT p.* FROM order_parts p LEFT JOIN blouses b ON b.part_id = p.id
     WHERE (p.delivered_on BETWEEN ? AND ?) OR (p.promised_delivery BETWEEN ? AND ?) OR (b.done_date BETWEEN ? AND ?)`,
    [from, to, from, to, from, to],
  ).map(rowToPart);
  if (parts.length === 0) return { parts, blouses: [] };
  const blouses = db.getAllSync<any>(
    `SELECT * FROM blouses WHERE part_id IN (${parts.map(p => p.id).join(',')})`,
  ).map(rowToBlouse);
  return { parts, blouses };
}

export function countOpenBlouses(): number {
  return getDb().getFirstSync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM blouses b JOIN order_parts p ON p.id = b.part_id
     WHERE b.status = 'scheduled' AND p.delivered_on IS NULL AND p.cancelled = 0`,
  )?.n ?? 0;
}
