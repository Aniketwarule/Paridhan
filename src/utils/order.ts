// ============================================================
// Poshakh – order numbers and the bill (text + data for the image)
// ============================================================
import { STRINGS } from '../strings';
import type { Blouse, OrderWithDetails, PartWithBlouses, Priority } from '../types';
import type { ShopInfo } from '../db/database';
import { fmt } from './date';

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

/** One bill line: identical blouses are merged into one line with a quantity. */
export interface BillItem {
  label: string;
  priority: Priority;
  /** Price of one blouse. */
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
 * What the customer owes for an order. Kept deliberately simple:
 * blouses + old balance − advance − blouses marked paid.
 */
export function orderMoney(order: { advance: number; previousDue: number }, blouses: { price: number; paid: boolean }[]) {
  const subtotal = blouses.reduce((s, b) => s + b.price, 0);
  const paid = blouses.filter(b => b.paid).reduce((s, b) => s + b.price, 0);
  const total = subtotal + order.previousDue;
  return {
    subtotal,
    previousDue: order.previousDue,
    total,
    advance: order.advance,
    paid,
    balance: total - order.advance - paid,
  };
}

export interface BillData {
  orderNo: string;
  orderDate: string;
  customerName: string;
  customerPhone?: string;
  items: BillItem[];
  deliveries: BillDelivery[];
  /** Total number of blouses. */
  count: number;
  /** Blouses only. */
  subtotal: number;
  previousDue: number;
  /** subtotal + previousDue */
  total: number;
  advance: number;
  paid: number;
  balance: number;
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

export function buildBill(card: OrderWithDetails, label: (b: { type: string; name?: string }) => string): BillData {
  const live = card.parts.filter(p => liveBlouses(p).length > 0);
  const all = live.flatMap(p => liveBlouses(p).map(b => ({ b, priority: p.priority })));
  const money = orderMoney(card.order, all.map(x => x.b));
  return {
    orderNo: orderNo(card.order.id),
    orderDate: fmt(card.order.createdAt.slice(0, 10)),
    customerName: card.customer.name,
    customerPhone: card.customer.phone,
    items: groupBlouses(all, label),
    deliveries: live.map(p => ({
      priority: live.length > 1 ? p.priority : null,
      date: fmt(p.deliveredOn ?? p.promisedDelivery),
      delivered: !!p.deliveredOn,
    })),
    count: all.length,
    ...money,
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
  lines.push(`${S.billOrderNo}: ${bill.orderNo}`);
  lines.push(`${S.billOrderDate}: ${bill.orderDate}`);
  lines.push(`${S.billCustomer}: ${bill.customerName}`);
  lines.push('');
  bill.items.forEach((it, i) => {
    const tag = it.priority === 'emergency' ? ` (${S.emergency})` : '';
    const each = it.qty > 1 ? ` (${S.billEach(it.price)})` : '';
    lines.push(`${i + 1}. ${itemTitle(it)}${tag} – ₹${it.amount}${each}`);
  });
  lines.push('');
  for (const d of bill.deliveries) lines.push(`${deliveryLabel(d)}: ${deliveryValue(d)}`);
  lines.push('');
  for (const [k, v] of moneyLines(bill)) lines.push(`${k}: ${v}`);
  lines.push(`*${S.billBalance}: ₹${bill.balance}*`);
  lines.push('', S.billThanks);
  return lines.join('\n');
}

/** The money lines of a bill, above the final balance: [label, value]. */
export function moneyLines(bill: BillData): [string, string][] {
  const S = STRINGS;
  const out: [string, string][] = [];
  const blousesLabel = `${S.billTotal} (${S.blouses(bill.count)})`;
  if (bill.previousDue > 0) {
    out.push([blousesLabel, `₹${bill.subtotal}`]);
    out.push([S.billPreviousDue, `+ ₹${bill.previousDue}`]);
    out.push([S.billGrandTotal, `₹${bill.total}`]);
  } else {
    out.push([blousesLabel, `₹${bill.total}`]);
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
