import {
  billText, buildBill, cardMoney, collectOnDelivery, groupBlouses, groupSmallWork, itemTitle, matchesOrderNo, moneyLines,
  orderNo, smallWorkPartId, whatsappUrl,
} from '../src/utils/order';
import { blouseLabel, smallWorkLabel, workLabel, workSummary } from '../src/utils/labels';
import type { Blouse, OrderWithDetails, SmallWork } from '../src/types';
import { setLanguage, STRINGS } from '../src/strings';

const card: OrderWithDetails = {
  order: { id: 42, customerId: 1, createdAt: '2026-11-05T10:00:00.000Z', status: 'pending', advance: 0, previousDue: 0 },
  customer: { id: 1, name: 'Sunita', phone: '98765 43210' },
  parts: [
    {
      id: 1, orderId: 42, priority: 'emergency', promisedDelivery: '2026-11-08', cancelled: false, smallWork: [],
      blouses: [{ id: 1, partId: 1, orderId: 42, type: 'designer', price: 400, status: 'scheduled', paid: true }],
    },
    {
      id: 2, orderId: 42, priority: 'general', promisedDelivery: '2026-11-15', cancelled: false, smallWork: [],
      blouses: [
        { id: 2, partId: 2, orderId: 42, type: 'astar', name: 'Green silk', price: 300, status: 'done', paid: false },
        { id: 3, partId: 2, orderId: 42, type: 'astar', price: 300, status: 'cancelled', paid: false },
      ],
    },
  ],
};

describe('order numbers', () => {
  it('pads the id', () => {
    expect(orderNo(42)).toBe('P-0042');
    expect(orderNo(12345)).toBe('P-12345');
  });
  it('matches typed order numbers', () => {
    expect(matchesOrderNo(42, '42')).toBe(true);
    expect(matchesOrderNo(42, 'p-0042')).toBe(true);
    expect(matchesOrderNo(42, 'P42')).toBe(true);
    expect(matchesOrderNo(42, 'sunita')).toBe(false);
    expect(matchesOrderNo(43, '42')).toBe(false);
  });
});

describe('bill', () => {
  const bill = buildBill(card, b => b.name ?? b.type);
  it('leaves out cancelled blouses and adds up paid and balance', () => {
    expect(bill.orders[0].items.map(i => i.label)).toEqual(['designer', 'Green silk']);
    expect(bill).toMatchObject({ orderNo: 'P-0042', total: 700, paid: 400, balance: 300 });
    expect(bill.orders[0].orderDate).toBe('05/11/2026');
    expect(bill.orders[0].deliveries).toEqual([
      { priority: 'emergency', date: '08/11/2026', delivered: false },
      { priority: 'general', date: '15/11/2026', delivered: false },
    ]);
  });
  it('writes a text bill with the order number and total', () => {
    const text = billText(bill, { name: 'Sai Tailors', tailor: 'Sunita', phone: '99', upi: '' });
    expect(text).toContain('Sai Tailors');
    expect(text).toContain('Sunita  ·  📞 99');
    expect(text).toContain('P-0042');
    expect(text).toContain('₹700');
  });
  it('stamps the bill with the local date and time it was made', () => {
    const at = (h: number, m: number) => buildBill(card, b => b.type, new Date(2026, 10, 7, h, m)).generatedAt;
    expect(at(15, 5)).toBe('07/11/2026, 3:05 PM');
    expect(at(0, 30)).toBe('07/11/2026, 12:30 AM');
    expect(at(12, 0)).toBe('07/11/2026, 12:00 PM');
    const stamped = buildBill(card, b => b.type, new Date(2026, 10, 7, 15, 5));
    expect(billText(stamped, { name: '', tailor: '', phone: '', upi: '' })).toContain('07/11/2026, 3:05 PM');
  });
  it('builds a WhatsApp link with +91 for 10-digit numbers', () => {
    expect(whatsappUrl('98765 43210', 'hi')).toBe('https://wa.me/919876543210?text=hi');
    expect(whatsappUrl('09876543210', 'hi')).toBe('https://wa.me/919876543210?text=hi');
    expect(whatsappUrl(undefined, 'a b')).toBe('https://wa.me/?text=a%20b');
  });
});

describe('grouping blouses on the bill', () => {
  let id = 0;
  const b = (type: 'astar' | 'designer', price: number, name?: string): Blouse =>
    ({ id: ++id, partId: 1, orderId: 1, type, name, price, status: 'scheduled', paid: false });
  const label = (x: { type: string; name?: string }) => x.name ?? x.type;

  it('merges identical blouses and keeps distinct ones apart', () => {
    const items = groupBlouses([
      ...Array.from({ length: 12 }, () => ({ b: b('astar', 300), priority: 'general' as const })),
      { b: b('astar', 300, 'Wedding'), priority: 'general' },
      { b: b('astar', 300, ' wedding '), priority: 'general' },
      { b: b('astar', 350), priority: 'general' },
      { b: b('astar', 300), priority: 'emergency' },
      { b: b('designer', 300), priority: 'general' },
    ], label);
    expect(items.map(i => [itemTitle(i), i.amount])).toEqual([
      ['astar × 12', 3600],
      ['Wedding × 2', 600],
      ['astar', 350],
      ['astar', 300],
      ['designer', 300],
    ]);
    expect(items[3].priority).toBe('emergency');
  });

  it('labels a single delivery without urgency', () => {
    const one: OrderWithDetails = { ...card, parts: [card.parts[1]] };
    expect(buildBill(one, label).orders[0].deliveries).toEqual([{ priority: null, date: '15/11/2026', delivered: false }]);
  });
});

describe('delivered means the money was received', () => {
  const delivered = (c: OrderWithDetails, partIds: number[]): OrderWithDetails => ({
    ...c,
    parts: c.parts.map(p => (partIds.includes(p.id) ? { ...p, deliveredOn: '2026-11-20' } : p)),
  });
  const withMoney = (advance: number, previousDue: number): OrderWithDetails => ({
    ...card,
    order: { ...card.order, advance, previousDue },
    parts: card.parts.map(p => ({ ...p, blouses: p.blouses.map(b => ({ ...b, paid: false })) })),
  });

  it('settles the whole order once everything is delivered', () => {
    const bill = buildBill(delivered(withMoney(200, 150), [1, 2]), b => b.type);
    expect(bill).toMatchObject({ total: 850, advance: 200, paid: 650, balance: 0 });
  });
  it('counts only the delivered part while the rest is still with her', () => {
    const bill = buildBill(delivered(withMoney(200, 150), [1]), b => b.type);
    expect(bill).toMatchObject({ total: 850, advance: 200, paid: 400, balance: 250 });
  });
  it('does not count the advance twice', () => {
    const bill = buildBill(delivered(withMoney(700, 0), [1, 2]), b => b.type);
    expect(bill).toMatchObject({ total: 700, advance: 700, paid: 0, balance: 0 });
  });
});

describe('bill for several orders', () => {
  const second: OrderWithDetails = {
    ...card,
    order: { ...card.order, id: 43, advance: 100 },
    parts: [{
      id: 3, orderId: 43, priority: 'general', promisedDelivery: '2026-11-20', cancelled: false, smallWork: [],
      blouses: [{ id: 4, partId: 3, orderId: 43, type: 'astar', price: 500, status: 'scheduled', paid: false }],
    }],
  };
  const bill = buildBill([card, second], b => b.name ?? b.type);

  it('adds the money up across the orders', () => {
    expect(bill.orderNo).toBe('P-0042, P-0043');
    expect(bill.orders.map(o => o.orderNo)).toEqual(['P-0042', 'P-0043']);
    expect(bill).toMatchObject({ subtotal: 1200, total: 1200, advance: 100, paid: 400, balance: 700 });
  });
  it('lists each order in the WhatsApp text', () => {
    const text = billText(bill, { name: 'Shop', tailor: '', phone: '', upi: '' });
    expect(text).toContain('*P-0042 ');
    expect(text).toContain('*P-0043 ');
    // Numbering starts again for each order.
    expect(text).toContain('2. Green silk');
    expect(text).toContain('1. astar');
    expect(text).not.toContain('3. astar');
  });
});

describe('advance and old balance', () => {
  it('adds old balance and takes off advance and paid blouses', () => {
    const withMoney: OrderWithDetails = { ...card, order: { ...card.order, advance: 200, previousDue: 150 } };
    const bill = buildBill(withMoney, b => b.name ?? b.type);
    // blouses 700 (400 paid), old balance 150, advance 200
    expect(bill).toMatchObject({ subtotal: 700, previousDue: 150, total: 850, advance: 200, paid: 400, balance: 250 });
    expect(moneyLines(bill).map(([k]) => k)).toEqual(['Total', STRINGS.billPreviousDue, 'Total amount', 'Advance received', 'Paid']);
  });

  it('keeps the bill short when there is nothing extra', () => {
    const bill = buildBill(card, b => b.name ?? b.type);
    expect(moneyLines(bill)).toEqual([['Total', '₹700'], ['Paid', '− ₹400']]);
    expect(bill.balance).toBe(300);
  });
});

describe('small work on the bill', () => {
  const small = (id: number, partId: number, kind: SmallWork['kind'], price: number, qty = 1, name?: string): SmallWork =>
    ({ id, partId, orderId: 42, kind, name, qty, price, paid: false });
  const label = (b: { type: string; name?: string }) => b.name ?? b.type;
  const part2 = card.parts[1];
  const withSmall: OrderWithDetails = {
    ...card,
    parts: [card.parts[0], { ...part2, smallWork: [small(1, 2, 'piko', 50, 2), small(2, 2, 'other', 80, 1, 'Button stitching')] }],
  };

  it('lists it after the stitching and adds it to the money', () => {
    const bill = buildBill(withSmall, label);
    expect(bill.orders[0].items.map(i => [itemTitle(i), i.amount])).toEqual([
      ['designer', 400], ['Green silk', 300], ['Piko × 2', 100], ['Button stitching', 80],
    ]);
    expect(bill).toMatchObject({ subtotal: 880, total: 880, paid: 400, balance: 480 });
  });

  it('shows it in the WhatsApp text with no urgent tag', () => {
    const text = billText(buildBill(withSmall, label), { name: 'Shop', tailor: '', phone: '', upi: '' });
    expect(text).toContain('3. Piko × 2 – ₹100 (₹50 each)');
    expect(text).toContain('4. Button stitching – ₹80');
  });

  it('merges identical small work and keeps a different price apart', () => {
    expect(groupSmallWork([small(1, 1, 'piko', 50), small(2, 1, 'piko', 50, 2), small(3, 1, 'piko', 60)]).map(i => [i.qty, i.amount]))
      .toEqual([[3, 150], [1, 60]]);
  });

  it('a small-work-only order has one delivery, and delivering it settles it', () => {
    const only: OrderWithDetails = {
      ...card,
      parts: [{ id: 9, orderId: 42, priority: 'general', promisedDelivery: '2026-11-10', cancelled: false, blouses: [], smallWork: [small(1, 9, 'piko_fall', 120)] }],
    };
    expect(buildBill(only, label)).toMatchObject({ total: 120, balance: 120 });
    expect(buildBill(only, label).orders[0].deliveries).toEqual([{ priority: null, date: '10/11/2026', delivered: false }]);

    const handed = { ...only, parts: [{ ...only.parts[0], deliveredOn: '2026-11-10' }] };
    expect(buildBill(handed, label)).toMatchObject({ total: 120, paid: 120, balance: 0 });
  });

  it('a cancelled delivery takes its small work off the bill', () => {
    const off = { ...withSmall, parts: [card.parts[0], { ...withSmall.parts[1], cancelled: true }] };
    const bill = buildBill(off, label);
    expect(bill.orders[0].items.map(i => i.label)).toEqual(['designer']);
    expect(bill.total).toBe(400);
  });
});

describe('what to collect at hand-over', () => {
  const unpaid = (advance: number, previousDue: number): OrderWithDetails => ({
    ...card,
    order: { ...card.order, advance, previousDue },
    parts: card.parts.map(p => ({ ...p, blouses: p.blouses.map(b => ({ ...b, paid: false })) })),
  });
  const handed = (c: OrderWithDetails, partId: number): OrderWithDetails => ({
    ...c,
    parts: c.parts.map(p => (p.id === partId ? { ...p, deliveredOn: '2026-11-08' } : p)),
  });

  it('takes the advance off, not the full total', () => {
    const one: OrderWithDetails = { ...unpaid(200, 0), parts: [unpaid(200, 0).parts[1]] };
    expect(collectOnDelivery(one, 2)).toBe(100); // 300 work, 200 advance
  });
  it('the only delivery also collects the old balance', () => {
    const one: OrderWithDetails = { ...unpaid(0, 150), parts: [unpaid(0, 150).parts[1]] };
    expect(collectOnDelivery(one, 2)).toBe(450);
  });
  it('a split order: first delivery its own work, last delivery everything left', () => {
    const c = unpaid(200, 150); // work 400 + 300, old balance 150, advance 200
    expect(collectOnDelivery(c, 1)).toBe(400);
    const after = handed(c, 1);
    expect(collectOnDelivery(after, 2)).toBe(250);
    expect(cardMoney(handed(after, 2)).balance).toBe(0);
  });
  it('already paid or covered by the advance: nothing to collect', () => {
    const one: OrderWithDetails = { ...card, parts: [card.parts[0]] }; // ₹400, marked paid
    expect(collectOnDelivery(one, 1)).toBe(0);
    const covered: OrderWithDetails = { ...unpaid(1000, 0), parts: [unpaid(1000, 0).parts[1]] };
    expect(collectOnDelivery(covered, 2)).toBe(0);
  });
  it('counts small work', () => {
    const base = unpaid(0, 0).parts[1];
    const one: OrderWithDetails = {
      ...card,
      parts: [{ ...base, smallWork: [{ id: 1, partId: 2, orderId: 42, kind: 'piko', qty: 2, price: 50, paid: false }] }],
    };
    expect(collectOnDelivery(one, 2)).toBe(400);
  });
});

describe('where new small work goes', () => {
  it('the last delivery not handed over yet', () => {
    expect(smallWorkPartId(card)).toBe(2);
    const secondHanded: OrderWithDetails = { ...card, parts: [card.parts[0], { ...card.parts[1], deliveredOn: '2026-11-15' }] };
    expect(smallWorkPartId(secondHanded)).toBe(1);
  });
  it('none when everything is handed over or cancelled', () => {
    const done: OrderWithDetails = { ...card, parts: card.parts.map(p => ({ ...p, deliveredOn: '2026-11-15' })) };
    expect(smallWorkPartId(done)).toBeNull();
    const off: OrderWithDetails = { ...card, parts: card.parts.map(p => ({ ...p, cancelled: true })) };
    expect(smallWorkPartId(off)).toBeNull();
  });
});

describe('naming the work', () => {
  it('adds up blouses and names everything else', () => {
    expect(workSummary(
      [{ type: 'astar' }, { type: 'sadha' }, { type: 'designer' }, { type: 'dress' }, { type: 'navvari' }],
      [{ kind: 'piko', qty: 2 }, { kind: 'other', name: 'Button stitching', qty: 1 }],
    )).toBe('3 blouses, 1 dress, 1 nav-vari saree, Piko × 2, Button stitching');
  });
  it('a named piece keeps its kind, and "other" goes by its own name', () => {
    expect(smallWorkLabel({ kind: 'piko', name: 'Green saree' })).toBe('Green saree (Piko)');
    expect(smallWorkLabel({ kind: 'other', name: 'Buttons' })).toBe('Buttons');
    expect(blouseLabel({ type: 'dress', name: 'Party' })).toBe('Party (Dress)');
  });
  it('Marathi uses her words', () => {
    setLanguage('mr');
    expect(workLabel('sadha')).toBe('साधा ब्लाउज');
    expect(workLabel('blouse_alter')).toBe('ब्लाउज अल्टर');
    expect(workSummary([{ type: 'astar' }, { type: 'astar' }, { type: 'dress' }])).toBe('2 ब्लाउज, 1 ड्रेस');
    setLanguage('en');
  });
});
