// ============================================================
// Runs the real src/db/database.ts on a real SQLite database (Node's built-in one
// behind a thin stand-in for expo-sqlite), including the upgrade of an existing
// install, because that is her real customer data.
// ============================================================
import type * as DatabaseModule from '../src/db/database';
import type { AppSettings } from '../src/types';
import { quote, rebuildSchedule, toEngineInput } from '../src/engine';
import { buildBill } from '../src/utils/order';
import { blouseLabel } from '../src/utils/labels';
import { addWork, draftParts, quoteRequests, type DraftLine } from '../src/utils/orderDraft';
import { workReport } from '../src/utils/report';
import { addItem, editChanges, editFromOrder, newEditItem, removeItem, setPart, updateItem } from '../src/utils/orderEdit';

jest.mock('expo-sqlite', () => {
  const { DatabaseSync } = (process as any).getBuiltinModule('node:sqlite');
  return {
    openDatabaseSync: () => {
      const raw = new DatabaseSync(':memory:');
      const db = {
        execSync: (sql: string) => raw.exec(sql),
        getFirstSync: (sql: string, params: any[] = []) => raw.prepare(sql).get(...params) ?? null,
        getAllSync: (sql: string, params: any[] = []) => raw.prepare(sql).all(...params),
        runSync: (sql: string, params: any[] = []) => {
          const r = raw.prepare(sql).run(...params);
          return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
        },
        withTransactionSync: (fn: () => void) => {
          raw.exec('BEGIN');
          try { fn(); raw.exec('COMMIT'); } catch (e) { raw.exec('ROLLBACK'); throw e; }
        },
      };
      return db;
    },
  };
});

/** The tables exactly as an install on schema version 4 has them. */
const V4_SCHEMA = `
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    working_days TEXT NOT NULL DEFAULT '1,2,3,4,5',
    weekly_target INTEGER NOT NULL DEFAULT 10,
    emergency_reserve INTEGER NOT NULL DEFAULT 3,
    price_astar INTEGER NOT NULL DEFAULT 300,
    price_designer INTEGER NOT NULL DEFAULT 400,
    emergency_gap INTEGER NOT NULL DEFAULT 1,
    normal_gap INTEGER NOT NULL DEFAULT 2,
    delivery_days TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',
    allow_new_work_today INTEGER NOT NULL DEFAULT 1,
    week_starts_on INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE days_off (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, label TEXT);
  CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT);
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL REFERENCES customers(id),
    created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', notes TEXT,
    advance INTEGER NOT NULL DEFAULT 0, previous_due INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE order_parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id),
    priority TEXT NOT NULL DEFAULT 'general', promised_delivery TEXT NOT NULL, delivered_on TEXT,
    cancelled INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE blouses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, part_id INTEGER NOT NULL REFERENCES order_parts(id),
    order_id INTEGER NOT NULL REFERENCES orders(id), type TEXT NOT NULL, price INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled', done_date TEXT, paid INTEGER NOT NULL DEFAULT 0, name TEXT
  );
  CREATE TABLE week_extras (id INTEGER PRIMARY KEY AUTOINCREMENT, week_start TEXT NOT NULL, n INTEGER NOT NULL);
  CREATE TABLE day_extras (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, n INTEGER NOT NULL);
  CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO settings (id, weekly_target, price_astar, price_designer) VALUES (1, 12, 350, 450);
  INSERT INTO days_off (date, label) VALUES ('2026-12-25', 'Holiday');
  INSERT INTO customers (id, name, phone) VALUES (1, 'Sunita', '9876543210'), (2, 'Rekha', NULL);
  INSERT INTO orders (id, customer_id, created_at, status, advance, previous_due) VALUES
    (1, 1, '2026-11-01T10:00:00.000Z', 'pending', 100, 50),
    (2, 2, '2026-10-01T10:00:00.000Z', 'delivered', 0, 0),
    (3, 2, '2026-10-02T10:00:00.000Z', 'cancelled', 0, 0);
  INSERT INTO order_parts (id, order_id, priority, promised_delivery, delivered_on, cancelled) VALUES
    (1, 1, 'emergency', '2026-11-20', NULL, 0),
    (2, 1, 'general', '2026-11-25', NULL, 0),
    (3, 2, 'general', '2026-10-05', '2026-10-05', 0),
    (4, 3, 'general', '2026-10-06', NULL, 1);
  INSERT INTO blouses (id, part_id, order_id, type, price, status, done_date, paid, name) VALUES
    (1, 1, 1, 'designer', 450, 'done', '2026-11-02', 1, 'Silk'),
    (2, 2, 1, 'astar', 350, 'scheduled', NULL, 0, NULL),
    (3, 3, 2, 'astar', 350, 'done', '2026-10-04', 0, NULL),
    (4, 4, 3, 'astar', 350, 'cancelled', NULL, 0, NULL);
  INSERT INTO app_state (key, value) VALUES ('language', '"mr"'), ('shop', '{"name":"Sai","tailor":"Tai","phone":"99"}');
  PRAGMA user_version = 4;
`;

const CREATED = '2026-11-02T10:00:00.000Z';
const MONDAY = '2026-11-02';

let DB: typeof DatabaseModule;

function open(): void {
  jest.resetModules();
  DB = require('../src/db/database');
}

const appSettings = (): AppSettings => DB.loadSettings();
const engineInput = (today = MONDAY) => toEngineInput(today, appSettings(), [], DB.loadEngineData('2026-10-26'));

function lines(...tapped: [Parameters<typeof addWork>[1], number][]): DraftLine[] {
  let out: DraftLine[] = [];
  for (const [work, price] of tapped) out = addWork(out, work, price).lines;
  return out;
}

describe('changing small work on a saved order', () => {
  let id: number;
  let partId: number;
  beforeEach(async () => {
    open();
    await DB.initDb();
    id = DB.createOrder(DB.createCustomer('Sunita'), CREATED, draftParts(lines(['astar', 300]), { general: '2026-11-20' }, ''));
    partId = DB.loadOrderDetails(id)!.parts[0].id;
  });
  const smallOf = () => DB.loadOrderDetails(id)!.parts[0].smallWork;

  it('adds to the delivery; the bill and the money follow, the schedule does not', () => {
    const before = rebuildSchedule(engineInput()).queue;
    DB.addSmallWork(partId, { kind: 'other', qty: 2, price: 40, name: ' Buttons ' });
    expect(smallOf().map(w => [w.kind, w.name, w.qty, w.price])).toEqual([['other', 'Buttons', 2, 40]]);
    expect(buildBill(DB.loadOrderDetails(id)!, blouseLabel)).toMatchObject({ subtotal: 380, balance: 380 });
    expect(rebuildSchedule(engineInput()).queue).toEqual(before);
    expect(DB.loadOrderDetails(id)!.order.status).toBe('pending');
  });

  it('changes the quantity', () => {
    DB.addSmallWork(partId, { kind: 'piko', qty: 1, price: 50 });
    DB.updateSmallWorkQty(smallOf()[0].id, 3);
    expect(smallOf()[0].qty).toBe(3);
    expect(buildBill(DB.loadOrderDetails(id)!, blouseLabel).subtotal).toBe(450);
  });

  it('removes it and leaves the order alone', () => {
    DB.addSmallWork(partId, { kind: 'piko', qty: 1, price: 50 });
    DB.removeSmallWork(smallOf()[0].id);
    expect(smallOf()).toEqual([]);
    expect(DB.loadOrderDetails(id)!.order.status).toBe('pending');
    expect(DB.loadOrdersWithDetails('pending').map(c => c.order.id)).toEqual([id]);
  });

  it('shows small work by delivery for the Today list', () => {
    DB.addSmallWork(partId, { kind: 'piko_fall', qty: 1, price: 120 });
    expect(DB.loadSmallWorkByPart([partId]).get(partId)?.map(w => w.kind)).toEqual(['piko_fall']);
    expect(DB.loadSmallWorkByPart([]).size).toBe(0);
  });
});

describe('editing a saved order', () => {
  let id: number;
  beforeEach(async () => {
    open();
    await DB.initDb();
    id = DB.createOrder(
      DB.createCustomer('Sunita'), CREATED,
      draftParts(lines(['astar', 300], ['astar', 300], ['piko', 50]), { general: '2026-11-20' }, ''),
    );
  });
  const card = () => DB.loadOrderDetails(id)!;

  it('writes dates, kinds, prices, added and removed work in one go', () => {
    let e = editFromOrder(card());
    const partId = e.parts[0].id;
    const [first, second] = e.parts[0].items;
    e = { ...e, orderDate: '2026-11-01' };
    e = setPart(e, partId, { date: '2026-11-22', priority: 'emergency' });
    e = updateItem(e, partId, first.key, { work: 'designer', price: 450, name: 'Silk' });
    e = removeItem(e, partId, second.key);
    e = addItem(e, partId, { ...newEditItem('blouse_alter', 80), qty: 2 });
    DB.saveOrderEdit(editChanges(card(), e));

    const after = card();
    expect(after.order.createdAt).toBe('2026-11-01T10:00:00.000Z');
    expect(after.parts.map(p => [p.priority, p.promisedDelivery])).toEqual([['emergency', '2026-11-22']]);
    expect(after.parts[0].blouses.map(b => [b.type, b.name, b.price])).toEqual([['designer', 'Silk', 450]]);
    expect(after.parts[0].smallWork.map(w => [w.kind, w.qty, w.price])).toEqual([['piko', 1, 50], ['blouse_alter', 2, 80]]);
    expect(buildBill(after, blouseLabel).subtotal).toBe(450 + 50 + 160);
  });

  it('taking out all the stitching makes the order ready', () => {
    let e = editFromOrder(card());
    const partId = e.parts[0].id;
    for (const i of e.parts[0].items.filter(x => x.work === 'astar')) e = removeItem(e, partId, i.key);
    DB.saveOrderEdit(editChanges(card(), e));
    expect(card().order.status).toBe('ready');
  });

  it('a trial run measures the change and then leaves the order as it was', () => {
    let e = editFromOrder(card());
    const partId = e.parts[0].id;
    e = addItem(e, partId, newEditItem('astar', 300));
    const before = JSON.stringify(card());
    const queued = DB.tryOrderEdit(editChanges(card(), e), () => rebuildSchedule(engineInput()).queue.length);
    expect(queued).toBe(3);
    expect(JSON.stringify(card())).toBe(before);
    expect(rebuildSchedule(engineInput()).queue.length).toBe(2);
  });
});

describe('backup reminder data', () => {
  beforeEach(async () => {
    open();
    await DB.initDb();
  });
  it('knows if there are orders and when the last backup was', () => {
    expect(DB.hasOrders()).toBe(false);
    expect(DB.getLastBackup()).toBeNull();
    DB.createOrder(DB.createCustomer('Rekha'), CREATED, draftParts(lines(['piko', 50]), {}, '2026-11-09'));
    expect(DB.hasOrders()).toBe(true);
    DB.setLastBackup('2026-11-07');
    expect(DB.getLastBackup()).toBe('2026-11-07');
  });
});

describe('reports', () => {
  beforeEach(async () => {
    open();
    await DB.initDb();
  });
  const WEEK: [string, string] = ['2026-11-09', '2026-11-15'];
  const reportFor = () => workReport(DB.loadReportRows(...WEEK), ...WEEK);

  it('income counts stitching and small work once delivered, each kind on its own line', () => {
    const c = DB.createCustomer('Sunita');
    const mixed = DB.createOrder(c, CREATED, draftParts(lines(['navvari', 900], ['dress', 500], ['sadha', 250], ['piko', 50], ['piko', 50]), { general: '2026-11-10' }, ''));
    const only = DB.createOrder(c, CREATED, draftParts(lines(['piko_fall', 120]), {}, '2026-11-11'));

    expect(reportFor()).toMatchObject({ income: 0, smallDelivered: 0, deliveredCount: 0, dueCount: 3, dueValue: 1870 });

    DB.setPartDelivered(DB.loadOrderDetails(mixed)!.parts[0].id, '2026-11-10');
    expect(reportFor()).toMatchObject({ income: 1750, smallDelivered: 100, deliveredCount: 3 });
    expect(reportFor().byType).toEqual([{ type: 'sadha', n: 1 }, { type: 'dress', n: 1 }, { type: 'navvari', n: 1 }]);

    DB.setPartDelivered(DB.loadOrderDetails(only)!.parts[0].id, '2026-11-11');
    expect(reportFor()).toMatchObject({ income: 1870, smallDelivered: 220, deliveredCount: 3 });
  });

  it('a cancelled order adds no income and is not due', () => {
    const id = DB.createOrder(DB.createCustomer('Rekha'), CREATED, draftParts(lines(['piko', 50]), {}, '2026-11-11'));
    DB.cancelOrder(id);
    expect(reportFor()).toMatchObject({ income: 0, dueValue: 0 });
  });

  it('work outside the period does not count', () => {
    const id = DB.createOrder(DB.createCustomer('Rekha'), CREATED, draftParts(lines(['piko', 50]), {}, '2026-11-20'));
    DB.setPartDelivered(DB.loadOrderDetails(id)!.parts[0].id, '2026-11-20');
    expect(reportFor()).toMatchObject({ income: 0, dueValue: 0 });
  });

  it('says when a nav-vari was stitched in the period', () => {
    const id = DB.createOrder(DB.createCustomer('Rekha'), CREATED, draftParts(lines(['navvari', 900]), { general: '2026-11-13' }, ''));
    expect(reportFor().anyNavvariStitched).toBe(false);
    DB.markBlousesDone(DB.loadOrderDetails(id)!.parts[0].blouses.map(b => b.id), '2026-11-10');
    expect(reportFor().anyNavvariStitched).toBe(true);
  });
});

describe('upgrading an existing install', () => {
  beforeEach(async () => {
    open();
    DB.getDb().execSync(V4_SCHEMA);
    await DB.initDb();
  });

  it('moves to the new version and adds the small work table', () => {
    const db = DB.getDb();
    expect(db.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(5);
    const cols = db.getAllSync<{ name: string }>('PRAGMA table_info(small_work)').map(c => c.name);
    expect(cols).toEqual(['id', 'part_id', 'order_id', 'kind', 'name', 'qty', 'price', 'paid']);
  });

  it('keeps every order, payment and stitched piece as it was', () => {
    const pending = DB.loadOrdersWithDetails('pending');
    expect(pending).toHaveLength(1);
    const o = pending[0];
    expect(o.customer).toEqual({ id: 1, name: 'Sunita', phone: '9876543210' });
    expect(o.order).toMatchObject({ id: 1, status: 'pending', advance: 100, previousDue: 50, createdAt: '2026-11-01T10:00:00.000Z' });
    expect(o.parts.map(p => [p.id, p.priority, p.promisedDelivery, p.blouses.length, p.smallWork.length])).toEqual([
      [1, 'emergency', '2026-11-20', 1, 0],
      [2, 'general', '2026-11-25', 1, 0],
    ]);
    expect(o.parts[0].blouses[0]).toMatchObject({ type: 'designer', name: 'Silk', price: 450, status: 'done', doneDate: '2026-11-02', paid: true });

    expect(DB.loadOrdersWithDetails('delivered').map(c => c.order.id)).toEqual([2]);
    expect(DB.loadOrdersWithDetails('cancelled').map(c => c.order.id)).toEqual([3]);
  });

  it('keeps settings, holidays, language and shop details', () => {
    expect(appSettings()).toMatchObject({ weeklyTarget: 12, priceAstar: 350, priceDesigner: 450, rates: {} });
    expect(DB.loadDaysOff().map(d => d.date)).toEqual(['2026-12-25']);
    expect(DB.getState('language')).toBe('mr');
    // A backup from before the UPI ID existed has none.
    expect(DB.getShopInfo()).toEqual({ name: 'Sai', tailor: 'Tai', phone: '99', upi: '' });
  });

  it('the old orders keep the same balance', () => {
    const bill = buildBill(DB.loadOrderDetails(1)!, blouseLabel);
    // 450 + 350 + old balance 50, advance 100, one paid 450
    expect(bill).toMatchObject({ subtotal: 800, total: 850, advance: 100, paid: 450, balance: 300 });
  });

  it('old orders still derive the same status', () => {
    for (const id of [1, 2, 3]) DB.syncOrderStatus(id);
    expect(DB.loadOrderDetails(1)!.order.status).toBe('pending');
    expect(DB.loadOrderDetails(2)!.order.status).toBe('delivered');
    expect(DB.loadOrderDetails(3)!.order.status).toBe('cancelled');
  });

  it('running the upgrade again changes nothing', async () => {
    await DB.initDb();
    DB.getDb().execSync('PRAGMA user_version = 4'); // an older backup restored over it
    await DB.initDb();
    expect(DB.getDb().getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(5);
    expect(DB.loadOrdersWithDetails('pending')).toHaveLength(1);
  });

  it('an order saved after the upgrade works next to the old ones', () => {
    const id = DB.createOrder(1, CREATED, draftParts(lines(['piko', 50]), {}, '2026-11-09'));
    expect(DB.loadOrderDetails(id)!.order.status).toBe('ready');
    expect(DB.loadOrdersWithDetails('pending').map(c => c.order.id)).toEqual([1]);
  });
});

describe('a new install', () => {
  beforeEach(async () => {
    open();
    await DB.initDb();
  });

  it('starts on the new version with default prices', () => {
    expect(DB.getDb().getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(5);
    expect(appSettings()).toMatchObject({ priceAstar: 300, priceDesigner: 400, rates: {} });
  });

  it('saves rates for the new work', () => {
    DB.saveSettings({ ...appSettings(), priceAstar: 320, rates: { sadha: 250, piko: 40 } });
    expect(appSettings()).toMatchObject({ priceAstar: 320, rates: { sadha: 250, piko: 40 } });
  });

  it('saves the UPI ID with the shop details', () => {
    DB.setShopInfo({ name: 'Sai', tailor: 'Tai', phone: '99', upi: ' sunita@okaxis ' });
    expect(DB.getShopInfo().upi).toBe('sunita@okaxis');
  });

  describe('an order of only small work', () => {
    let id: number;
    beforeEach(() => {
      const customer = DB.createCustomer('Rekha');
      id = DB.createOrder(customer, CREATED, draftParts(lines(['piko_fall', 120], ['piko', 50], ['piko', 50]), {}, '2026-11-09'), undefined, { advance: 20, previousDue: 0 });
    });

    it('is not lost or cancelled, and is ready to hand over', () => {
      const card = DB.loadOrderDetails(id)!;
      expect(card.order.status).toBe('ready');
      expect(card.parts).toHaveLength(1);
      expect(card.parts[0].promisedDelivery).toBe('2026-11-09');
      expect(card.parts[0].smallWork.map(w => [w.kind, w.qty, w.price])).toEqual([['piko_fall', 1, 120], ['piko', 2, 50]]);

      const ready = DB.loadReadyParts();
      expect(ready.map(p => p.customerName)).toEqual(['Rekha']);
      expect(ready[0].smallWork).toHaveLength(2);
    });

    it('never reaches the schedule', () => {
      const data = DB.loadEngineData('2026-10-26');
      expect(data.parts).toEqual([]);
      expect(data.blouses).toEqual([]);
      expect(rebuildSchedule(engineInput()).queue).toEqual([]);
      expect(DB.countOpenBlouses()).toBe(0);
    });

    it('goes on the bill, and delivering it settles the money', () => {
      expect(buildBill(DB.loadOrderDetails(id)!, blouseLabel)).toMatchObject({ total: 220, advance: 20, balance: 200 });
      DB.setPartDelivered(DB.loadOrderDetails(id)!.parts[0].id, '2026-11-09');
      const card = DB.loadOrderDetails(id)!;
      expect(card.order.status).toBe('delivered');
      expect(buildBill(card, blouseLabel).balance).toBe(0);
      expect(DB.loadReadyParts()).toEqual([]);
    });

    it('undoing the delivery brings it back', () => {
      const partId = DB.loadOrderDetails(id)!.parts[0].id;
      DB.setPartDelivered(partId, '2026-11-09');
      DB.setPartDelivered(partId, null);
      expect(DB.loadOrderDetails(id)!.order.status).toBe('ready');
    });

    it('can be cancelled', () => {
      DB.cancelOrder(id);
      expect(DB.loadOrderDetails(id)!.order.status).toBe('cancelled');
      expect(DB.loadReadyParts()).toEqual([]);
      expect(buildBill(DB.loadOrderDetails(id)!, blouseLabel).total).toBe(0);
    });

    it('marks paid and changes the price', () => {
      const card = DB.loadOrderDetails(id)!;
      DB.setPartPaid(card.parts[0].id, true);
      DB.updateSmallWorkPrice(card.parts[0].smallWork[1].id, 60);
      const after = DB.loadOrderDetails(id)!;
      expect(after.parts[0].smallWork.every(w => w.paid)).toBe(true);
      expect(after.parts[0].smallWork[1].price).toBe(60);
    });

    it('shows in the delivered income of its report', () => {
      DB.setPartDelivered(DB.loadOrderDetails(id)!.parts[0].id, '2026-11-09');
      const rows = DB.loadReportRows('2026-11-09', '2026-11-15');
      expect(rows.parts).toHaveLength(1);
      expect(rows.smallWork.reduce((s, w) => s + w.price * w.qty, 0)).toBe(220);
    });
  });

  describe('an order mixing stitching and small work', () => {
    let id: number;
    beforeEach(() => {
      const customer = DB.createCustomer('Sunita');
      const draft = lines(['navvari', 900], ['dress', 500], ['blouse_alter', 100]);
      id = DB.createOrder(customer, CREATED, draftParts(draft, { general: '2026-11-20' }, ''));
    });

    it('only the stitching is scheduled, and the nav-vari has its day alone', () => {
      const s = rebuildSchedule(engineInput());
      const card = DB.loadOrderDetails(id)!;
      const [navvari, dress] = card.parts[0].blouses;
      expect(navvari.type).toBe('navvari');
      expect(s.queue).toEqual([String(navvari.id), String(dress.id)]);
      expect(s.today.blouseIds).toEqual([String(navvari.id)]);
      expect(s.stitchDate[String(dress.id)]).toBe('2026-11-03');
    });

    it('after saving, the schedule uses the same days the quote showed', () => {
      const draft = lines(['astar', 300], ['astar', 300], ['astar', 300], ['navvari', 900]);
      const input = engineInput();
      const [q] = quote(input, quoteRequests(draft));
      const customer = DB.createCustomer('Meena');
      const saved = DB.createOrder(customer, CREATED, draftParts(draft, { general: q.dateOffered! }, ''));
      const s = rebuildSchedule(engineInput());
      const days = DB.loadOrderDetails(saved)!.parts[0].blouses.map(b => s.stitchDate[String(b.id)]).sort();
      expect(days).toEqual(q.stitchDays);
      expect(s.late).toEqual([]);
    });

    it('stays pending until the stitching is done; small work does not hold it back', () => {
      const card = DB.loadOrderDetails(id)!;
      expect(card.order.status).toBe('pending');
      expect(DB.loadReadyParts()).toEqual([]);

      DB.markBlousesDone(card.parts[0].blouses.map(b => b.id), MONDAY);
      expect(DB.loadOrderDetails(id)!.order.status).toBe('ready');
      expect(DB.loadReadyParts()[0].smallWork.map(w => w.kind)).toEqual(['blouse_alter']);
    });

    it('a finished nav-vari counts its whole day', () => {
      const [navvari] = DB.loadOrderDetails(id)!.parts[0].blouses;
      DB.markBlousesDone([navvari.id], MONDAY);
      const s = rebuildSchedule(engineInput());
      expect(s.doneTodayCount).toBe(2);
      expect(s.today.blouseIds).toEqual([]);
    });

    it('everything is on the bill', () => {
      expect(buildBill(DB.loadOrderDetails(id)!, blouseLabel)).toMatchObject({ subtotal: 1500, balance: 1500 });
    });

    it('cancelling takes the small work with it', () => {
      DB.cancelOrder(id);
      const card = DB.loadOrderDetails(id)!;
      expect(card.order.status).toBe('cancelled');
      expect(buildBill(card, blouseLabel).subtotal).toBe(0);
    });
  });
});
