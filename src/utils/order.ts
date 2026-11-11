// ============================================================
// Poshakh – order numbers and the bill (text + data for the image)
// ============================================================
import { STRINGS } from '../strings';
import type { Blouse, OrderWithDetails, PartWithBlouses, Priority, SmallWork } from '../types';
import type { ShopInfo } from '../db/database';
import { fmt, fmtDateTime } from './date';
import { smallWorkLabel } from './labels';

export type { ShopInfo } from '../db/database';

/** Order number shown to the tailor and the customer, e.g. "P-0042". */
export function orderNo(id: number): string {
  return `P-${String(id).padStart(4, '0')}`;
}

/** True if the search text looks like (part of) an order number: "42", "P-42", "p0042". */
export function matchesOrderNo(id: number, query: string): boolean {
  const digits = query.replace(/^p-?/i, '').trim();
  if (!/^\d+$/.test(digits)) return false;
  return String(id) === String(Number(digits)) || orderNo(id).includes(digits);
}

const liveBlouses = (p: PartWithBlouses) => (p.cancelled ? [] : p.blouses.filter(b => b.status !== 'cancelled'));
const liveSmallWork = (p: PartWithBlouses) => (p.cancelled ? [] : p.smallWork);

/** Everything the customer pays for on a delivery, stitching and small work alike. */
export function partAmounts(p: PartWithBlouses): { price: number; paid: boolean }[] {
  return [
    ...liveBlouses(p).map(b => ({ price: b.price, paid: b.paid })),
    ...liveSmallWork(p).map(w => ({ price: w.price * w.qty, paid: w.paid })),
  ];
}

/** The order's live work, noting what has been handed over. */
function billableWork(card: OrderWithDetails) {
  return card.parts.flatMap(p => partAmounts(p).map(a => ({ ...a, delivered: !!p.deliveredOn })));
}

/** One bill line: identical work is merged into one line with a quantity. */
export interface BillItem {
  label: string;
  priority: Priority;
  /** Price of one. */
  price: number;
  qty: number;
  /** price × qty */
  amount: number;
}

export interface BillDelivery {
  /** null when the order has a single delivery (no need to say which). */
  priority: Priority | null;
  date: string;
  delivered: boolean;
}

/**
 * What the customer owes for an order: work + old balance − advance − money received.
 * A delivery means the money was received, so delivered work counts as paid, and once
 * everything is delivered the order is settled (old balance included).
 */
export function orderMoney(
  order: { advance: number; previousDue: number },
  work: { price: number; paid: boolean; delivered?: boolean }[],
) {
  const subtotal = work.reduce((s, b) => s + b.price, 0);
  const total = subtotal + order.previousDue;
  const owed = Math.max(0, total - order.advance);
  const settled = work.length > 0 && work.every(b => b.delivered);
  const received = work.filter(b => b.paid || b.delivered).reduce((s, b) => s + b.price, 0);
  const paid = settled ? owed : Math.min(received, owed);
  return {
    subtotal,
    previousDue: order.previousDue,
    total,
    advance: order.advance,
    paid,
    balance: settled ? 0 : total - order.advance - paid,
  };
}

/** orderMoney for a loaded order. */
export function cardMoney(card: OrderWithDetails) {
  return orderMoney(card.order, billableWork(card));
}

/**
 * What she should take from the customer when this delivery is handed over. Delivering counts
 * as being paid, so it is whatever the delivery takes off the balance: the delivery's own unpaid
 * work, and on the last delivery everything still owed, old balance included.
 */
export function collectOnDelivery(card: OrderWithDetails, partId: number): number {
  const handed = { ...card, parts: card.parts.map(p => (p.id === partId ? { ...p, deliveredOn: p.promisedDelivery } : p)) };
  return Math.max(0, cardMoney(card).balance - cardMoney(handed).balance);
}

/** New small work goes with the last delivery not handed over yet; null if there is none. */
export function smallWorkPartId(card: OrderWithDetails): number | null {
  const open = card.parts.filter(p => !p.cancelled && !p.deliveredOn && partAmounts(p).length > 0);
  if (open.length === 0) return null;
  return open.reduce((a, b) => (b.promisedDelivery >= a.promisedDelivery ? b : a)).id;
}

/** One order's lines on a bill. */
export interface BillOrder {
  orderNo: string;
  orderDate: string;
  items: BillItem[];
  deliveries: BillDelivery[];
}

/** A bill for one order, or several orders of one customer added together. */
export interface BillData {
  /** "P-0042", or "P-0042, P-0043" for several orders. */
  orderNo: string;
  customerName: string;
  customerPhone?: string;
  orders: BillOrder[];
  /** All the work, before old balance. */
  subtotal: number;
  previousDue: number;
  /** subtotal + previousDue */
  total: number;
  advance: number;
  paid: number;
  balance: number;
  /** When this bill was made: "05/11/2026, 3:45 PM". */
  generatedAt: string;
}

/**
 * Blouses with the same type, name (or no name), price and urgency are the same
 * line on a bill ("Astar × 12"). Anything that tells them apart keeps its own line.
 */
export function groupBlouses(
  blouses: { b: Blouse; priority: Priority }[],
  label: (b: { type: string; name?: string }) => string,
): BillItem[] {
  const lines = new Map<string, BillItem>();
  for (const { b, priority } of blouses) {
    const name = b.name?.trim() ?? '';
    const key = [b.type, name.toLowerCase(), b.price, priority].join('|');
    const line = lines.get(key);
    if (line) {
      line.qty += 1;
      line.amount += b.price;
    } else {
      lines.set(key, { label: label({ type: b.type, name: name || undefined }), priority, price: b.price, qty: 1, amount: b.price });
    }
  }
  return [...lines.values()];
}

/** Small work with the same kind, name and price is one line; it never carries an urgent tag. */
export function groupSmallWork(work: SmallWork[]): BillItem[] {
  const lines = new Map<string, BillItem>();
  for (const w of work) {
    const name = w.name?.trim() ?? '';
    const key = [w.kind, name.toLowerCase(), w.price].join('|');
    const line = lines.get(key);
    if (line) {
      line.qty += w.qty;
      line.amount += w.price * w.qty;
    } else {
      lines.set(key, {
        label: smallWorkLabel({ kind: w.kind, name: name || undefined }),
        priority: 'general', price: w.price, qty: w.qty, amount: w.price * w.qty,
      });
    }
  }
  return [...lines.values()];
}

function buildBillOrder(card: OrderWithDetails, label: (b: { type: string; name?: string }) => string): BillOrder {
  const live = card.parts.filter(p => partAmounts(p).length > 0);
  return {
    orderNo: orderNo(card.order.id),
    orderDate: fmt(card.order.createdAt.slice(0, 10)),
    items: [
      ...groupBlouses(live.flatMap(p => liveBlouses(p).map(b => ({ b, priority: p.priority }))), label),
      ...groupSmallWork(live.flatMap(liveSmallWork)),
    ],
    deliveries: live.map(p => ({
      priority: live.length > 1 ? p.priority : null,
      date: fmt(p.deliveredOn ?? p.promisedDelivery),
      delivered: !!p.deliveredOn,
    })),
  };
}

/** One bill for one or more orders of the same customer; the money is added up across them. */
export function buildBill(
  cards: OrderWithDetails | OrderWithDetails[],
  label: (b: { type: string; name?: string }) => string,
  now: Date = new Date(),
): BillData {
  const list = Array.isArray(cards) ? cards : [cards];
  const moneys = list.map(cardMoney);
  const sum = (pick: (m: ReturnType<typeof cardMoney>) => number) => moneys.reduce((s, m) => s + pick(m), 0);
  return {
    orderNo: list.map(c => orderNo(c.order.id)).join(', '),
    customerName: list[0].customer.name,
    customerPhone: list[0].customer.phone,
    orders: list.map(c => buildBillOrder(c, label)),
    subtotal: sum(m => m.subtotal),
    previousDue: sum(m => m.previousDue),
    total: sum(m => m.total),
    advance: sum(m => m.advance),
    paid: sum(m => m.paid),
    balance: sum(m => m.balance),
    generatedAt: fmtDateTime(now),
  };
}

/** "Delivery date" for a single delivery, "Emergency delivery" / "General delivery" for a split one. */
export function deliveryLabel(d: BillDelivery): string {
  if (d.priority === 'emergency') return STRINGS.emergencyDelivery;
  if (d.priority === 'general') return STRINGS.generalDelivery;
  return STRINGS.billDeliveryDate;
}

export function deliveryValue(d: BillDelivery): string {
  return d.delivered ? `${d.date} ${STRINGS.billDeliveredTag}` : d.date;
}

/** "Astar × 12" or just "Astar". */
export function itemTitle(it: BillItem): string {
  return it.qty > 1 ? `${it.label} × ${it.qty}` : it.label;
}

/** "Shop owner · 98765 43210" line under the shop name. */
export function shopContactLine(shop: ShopInfo): string {
  return [shop.tailor, shop.phone && `📞 ${shop.phone}`].filter(Boolean).join('  ·  ');
}

/** Plain-text bill for a WhatsApp message. */
export function billText(bill: BillData, shop: ShopInfo): string {
  const S = STRINGS;
  const lines: string[] = [];
  lines.push(`*${shop.name || S.appName}*`);
  const contact = shopContactLine(shop);
  if (contact) lines.push(contact);
  lines.push(`*${S.billTitle}*`, '');
  const several = bill.orders.length > 1;
  if (!several) {
    lines.push(`${S.billOrderNo}: ${bill.orders[0].orderNo}`);
    lines.push(`${S.billOrderDate}: ${bill.orders[0].orderDate}`);
  }
  lines.push(`${S.billCustomer}: ${bill.customerName}`);
  lines.push('');
  for (const o of bill.orders) {
    if (several) lines.push(`*${o.orderNo} · ${o.orderDate}*`);
    o.items.forEach((it, i) => {
      const tag = it.priority === 'emergency' ? ` (${S.emergency})` : '';
      const each = it.qty > 1 ? ` (${S.billEach(it.price)})` : '';
      lines.push(`${i + 1}. ${itemTitle(it)}${tag} – ₹${it.amount}${each}`);
    });
    lines.push('');
    for (const d of o.deliveries) lines.push(`${deliveryLabel(d)}: ${deliveryValue(d)}`);
    lines.push('');
  }
  for (const [k, v] of moneyLines(bill)) lines.push(`${k}: ${v}`);
  lines.push(`*${S.billBalance}: ₹${bill.balance}*`);
  lines.push('', S.billThanks, bill.generatedAt);
  return lines.join('\n');
}

/** The money lines of a bill, above the final balance: [label, value]. */
export function moneyLines(bill: BillData): [string, string][] {
  const S = STRINGS;
  const out: [string, string][] = [];
  if (bill.previousDue > 0) {
    out.push([S.billTotal, `₹${bill.subtotal}`]);
    out.push([S.billPreviousDue, `+ ₹${bill.previousDue}`]);
    out.push([S.billGrandTotal, `₹${bill.total}`]);
  } else {
    out.push([S.billTotal, `₹${bill.total}`]);
  }
  if (bill.advance > 0) out.push([S.billAdvance, `− ₹${bill.advance}`]);
  if (bill.paid > 0) out.push([S.billPaid, `− ₹${bill.paid}`]);
  return out;
}

/** WhatsApp link to the customer's chat (Indian numbers get +91), or a contact picker without a number. */
export function whatsappUrl(phone: string | undefined, text: string): string {
  let digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
