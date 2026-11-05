import { billText, buildBill, groupBlouses, itemTitle, matchesOrderNo, moneyLines, orderNo, whatsappUrl } from '../src/utils/order';
import type { Blouse, OrderWithDetails } from '../src/types';

const card: OrderWithDetails = {
  order: { id: 42, customerId: 1, createdAt: '2026-11-05T10:00:00.000Z', status: 'pending', advance: 0, previousDue: 0 },
  customer: { id: 1, name: 'Sunita', phone: '98765 43210' },
  parts: [
    {
      id: 1, orderId: 42, priority: 'emergency', promisedDelivery: '2026-11-08', cancelled: false,
      blouses: [{ id: 1, partId: 1, orderId: 42, type: 'designer', price: 400, status: 'scheduled', paid: true }],
    },
    {
      id: 2, orderId: 42, priority: 'general', promisedDelivery: '2026-11-15', cancelled: false,
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
    expect(bill.items.map(i => i.label)).toEqual(['designer', 'Green silk']);
    expect(bill.count).toBe(2);
    expect(bill).toMatchObject({ orderNo: 'P-0042', orderDate: '05/11/2026', total: 700, paid: 400, balance: 300 });
    expect(bill.deliveries).toEqual([
      { priority: 'emergency', date: '08/11/2026', delivered: false },
      { priority: 'general', date: '15/11/2026', delivered: false },
    ]);
  });
  it('writes a text bill with the order number and total', () => {
    const text = billText(bill, { name: 'Sai Tailors', tailor: 'Sunita', phone: '99' });
    expect(text).toContain('Sai Tailors');
    expect(text).toContain('Sunita  ·  📞 99');
    expect(text).toContain('P-0042');
    expect(text).toContain('₹700');
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
    expect(buildBill(one, label).deliveries).toEqual([{ priority: null, date: '15/11/2026', delivered: false }]);
  });
});

describe('advance and old balance', () => {
  it('adds old balance and takes off advance and paid blouses', () => {
    const withMoney: OrderWithDetails = { ...card, order: { ...card.order, advance: 200, previousDue: 150 } };
    const bill = buildBill(withMoney, b => b.name ?? b.type);
    // blouses 700 (400 paid), old balance 150, advance 200
    expect(bill).toMatchObject({ subtotal: 700, previousDue: 150, total: 850, advance: 200, paid: 400, balance: 250 });
    expect(moneyLines(bill).map(([k]) => k)).toEqual(['Total (2 blouses)', 'Old balance', 'Total amount', 'Advance received', 'Paid']);
  });

  it('keeps the bill short when there is nothing extra', () => {
    const bill = buildBill(card, b => b.name ?? b.type);
    expect(moneyLines(bill)).toEqual([['Total (2 blouses)', '₹700'], ['Paid', '− ₹400']]);
    expect(bill.balance).toBe(300);
  });
});
