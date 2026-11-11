// ============================================================
// Poshakh – changing an order that is already saved
// She edits a copy of the order (dates, work, names, prices). On Save the
// copy is compared with the saved order and only the differences are written.
// Delivered and cancelled deliveries are shown but can't be changed.
// ============================================================
import type { Priority } from '../engine';
import type { BlouseType, OrderWithDetails, SmallWorkKind, WorkKey } from '../types';
import { isStitchWork } from './labels';

export interface EditItem {
  key: number;
  /** Saved row id; missing for work added in this edit. */
  id?: number;
  /** Which table the saved row is in (blouse and small-work ids can be the same number). */
  table?: 'blouse' | 'small';
  work: WorkKey;
  name: string;
  /** Price of one (₹). */
  price: number;
  /** Small work only; a stitching item is always one piece. */
  qty: number;
  /** Stitching only: already stitched. */
  done: boolean;
}

export interface EditPart {
  id: number;
  priority: Priority;
  date: string;
  /** Delivered: shown, not changed. */
  locked: boolean;
  deliveredOn?: string;
  items: EditItem[];
}

export interface OrderEdit {
  /** YYYY-MM-DD the order was taken. */
  orderDate: string;
  parts: EditPart[];
}

let lastKey = 0;
const newKey = () => ++lastKey;

/** The editable copy of a saved order. Cancelled deliveries and cancelled pieces are left out. */
export function editFromOrder(card: OrderWithDetails): OrderEdit {
  return {
    orderDate: card.order.createdAt.slice(0, 10),
    parts: card.parts
      .filter(p => !p.cancelled)
      .map(p => ({
        id: p.id,
        priority: p.priority,
        date: p.promisedDelivery,
        locked: !!p.deliveredOn,
        deliveredOn: p.deliveredOn,
        items: [
          ...p.blouses
            .filter(b => b.status !== 'cancelled')
            .map(b => ({ key: newKey(), id: b.id, table: 'blouse' as const, work: b.type, name: b.name ?? '', price: b.price, qty: 1, done: b.status === 'done' })),
          ...p.smallWork
            .map(w => ({ key: newKey(), id: w.id, table: 'small' as const, work: w.kind, name: w.name ?? '', price: w.price, qty: w.qty, done: false })),
        ],
      })),
  };
}

export const newEditItem = (work: WorkKey, price: number): EditItem =>
  ({ key: newKey(), work, name: '', price, qty: 1, done: false });

export const itemTotal = (i: EditItem) => i.price * i.qty;
export const editTotal = (e: OrderEdit) => e.parts.reduce((s, p) => s + p.items.reduce((t, i) => t + itemTotal(i), 0), 0);

// ── Changing the copy ──────────────────────────────────────────
const mapPart = (e: OrderEdit, partId: number, f: (p: EditPart) => EditPart): OrderEdit =>
  ({ ...e, parts: e.parts.map(p => (p.id === partId ? f(p) : p)) });

export const setPart = (e: OrderEdit, partId: number, patch: Partial<Pick<EditPart, 'date' | 'priority'>>) =>
  mapPart(e, partId, p => ({ ...p, ...patch }));

export const addItem = (e: OrderEdit, partId: number, item: EditItem) =>
  mapPart(e, partId, p => ({ ...p, items: [...p.items, item] }));

export const updateItem = (e: OrderEdit, partId: number, key: number, patch: Partial<EditItem>) =>
  mapPart(e, partId, p => ({ ...p, items: p.items.map(i => (i.key === key ? { ...i, ...patch } : i)) }));

export const removeItem = (e: OrderEdit, partId: number, key: number) =>
  mapPart(e, partId, p => ({ ...p, items: p.items.filter(i => i.key !== key) }));

/**
 * Switch an item to another kind of work. If it still had the old usual price,
 * it takes the new usual price; a price she typed herself is kept.
 */
export function changeWork(item: EditItem, work: WorkKey, rate: (w: WorkKey) => number): Partial<EditItem> {
  const newRate = rate(work);
  const keepPrice = item.price !== rate(item.work) || newRate <= 0;
  return { work, price: keepPrice ? item.price : newRate, qty: isStitchWork(work) ? 1 : item.qty };
}

// ── Checks ─────────────────────────────────────────────────────
export type EditProblem = 'empty' | 'name' | null;

export function editProblem(e: OrderEdit): EditProblem {
  const items = e.parts.flatMap(p => p.items);
  if (items.length === 0) return 'empty';
  if (items.some(i => i.work === 'other' && !i.name.trim())) return 'name';
  return null;
}

// ── What to write ──────────────────────────────────────────────
export interface EditChanges {
  orderId: number;
  /** New created_at, or undefined if the date did not change. */
  createdAt?: string;
  parts: { id: number; date: string; priority: Priority }[];
  blouseUpdates: { id: number; type: BlouseType; name: string; price: number }[];
  smallUpdates: { id: number; kind: SmallWorkKind; name: string; price: number; qty: number }[];
  blouseAdds: { partId: number; type: BlouseType; name: string; price: number }[];
  smallAdds: { partId: number; kind: SmallWorkKind; name: string; price: number; qty: number }[];
  blouseRemoves: number[];
  smallRemoves: number[];
  /** Open deliveries with nothing left in them: they go away. */
  emptyParts: number[];
}

export function editChanges(card: OrderWithDetails, e: OrderEdit): EditChanges {
  const was = editFromOrder(card);
  const createdAt = e.orderDate !== was.orderDate ? e.orderDate + card.order.createdAt.slice(10) : undefined;
  const out: EditChanges = {
    orderId: card.order.id, createdAt, parts: [], blouseUpdates: [], smallUpdates: [],
    blouseAdds: [], smallAdds: [], blouseRemoves: [], smallRemoves: [], emptyParts: [],
  };

  for (const p of e.parts) {
    const old = was.parts.find(x => x.id === p.id);
    if (!old || p.locked) continue;
    if (p.date !== old.date || p.priority !== old.priority) out.parts.push({ id: p.id, date: p.date, priority: p.priority });
    if (p.items.length === 0) out.emptyParts.push(p.id);

    const tableOf = (w: WorkKey) => (isStitchWork(w) ? 'blouse' : 'small');
    const kept = (o: EditItem) => p.items.some(i => i.id === o.id && i.table === o.table && tableOf(i.work) === o.table);
    for (const o of old.items) {
      if (!kept(o)) (o.table === 'blouse' ? out.blouseRemoves : out.smallRemoves).push(o.id!);
    }
    for (const i of p.items) {
      const name = i.name.trim();
      const o = old.items.find(x => x.id === i.id && x.table === i.table);
      // Stitching that became small work (or the other way round) lives in another table: remove and add.
      if (o && tableOf(i.work) === o.table) {
        const same = o.work === i.work && o.name.trim() === name && o.price === i.price && o.qty === i.qty;
        if (same) continue;
        if (isStitchWork(i.work)) out.blouseUpdates.push({ id: o.id!, type: i.work, name, price: i.price });
        else out.smallUpdates.push({ id: o.id!, kind: i.work as SmallWorkKind, name, price: i.price, qty: i.qty });
        continue;
      }
      if (isStitchWork(i.work)) out.blouseAdds.push({ partId: p.id, type: i.work, name, price: i.price });
      else out.smallAdds.push({ partId: p.id, kind: i.work as SmallWorkKind, name, price: i.price, qty: i.qty });
    }
  }
  return out;
}

export const hasChanges = (c: EditChanges) =>
  !!c.createdAt || c.parts.length > 0 || c.blouseUpdates.length > 0 || c.smallUpdates.length > 0
  || c.blouseAdds.length > 0 || c.smallAdds.length > 0 || c.blouseRemoves.length > 0 || c.smallRemoves.length > 0;
