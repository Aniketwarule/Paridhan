import {
  addItem, changeWork, editChanges, editFromOrder, editProblem, editTotal, hasChanges, newEditItem, removeItem,
  setPart, updateItem,
} from '../src/utils/orderEdit';
import type { OrderWithDetails, WorkKey } from '../src/types';

/** Order 7: an open general delivery (2 astar, 1 piko × 2) and a delivered emergency one. */
function order(): OrderWithDetails {
  return {
    order: { id: 7, customerId: 1, createdAt: '2026-11-02T10:15:00.000Z', status: 'pending', advance: 0, previousDue: 0 },
    customer: { id: 1, name: 'Priyanka' },
    parts: [
      {
        id: 10, orderId: 7, priority: 'general', promisedDelivery: '2026-11-20', cancelled: false,
        blouses: [
          { id: 1, partId: 10, orderId: 7, type: 'astar', price: 300, status: 'scheduled', paid: false },
          { id: 2, partId: 10, orderId: 7, type: 'astar', name: 'Wedding', price: 300, status: 'done', doneDate: '2026-11-05', paid: false },
          { id: 3, partId: 10, orderId: 7, type: 'sadha', price: 200, status: 'cancelled', paid: false },
        ],
        // Same id as a blouse on purpose: the tables are separate.
        smallWork: [{ id: 1, partId: 10, orderId: 7, kind: 'piko', qty: 2, price: 50, paid: false }],
      },
      {
        id: 11, orderId: 7, priority: 'emergency', promisedDelivery: '2026-11-04', deliveredOn: '2026-11-04', cancelled: false,
        blouses: [{ id: 4, partId: 11, orderId: 7, type: 'designer', price: 400, status: 'done', doneDate: '2026-11-03', paid: true }],
        smallWork: [],
      },
    ],
  };
}

const rates: Partial<Record<WorkKey, number>> = { astar: 300, sadha: 200, designer: 400, piko: 50, blouse_alter: 100 };
const rate = (w: WorkKey) => rates[w] ?? 0;

describe('editable copy', () => {
  it('leaves cancelled pieces out and locks delivered parts', () => {
    const e = editFromOrder(order());
    expect(e.orderDate).toBe('2026-11-02');
    expect(e.parts[0].items.map(i => [i.work, i.qty, i.done])).toEqual([['astar', 1, false], ['astar', 1, true], ['piko', 2, false]]);
    expect(e.parts[1].locked).toBe(true);
    expect(editTotal(e)).toBe(300 + 300 + 100 + 400);
  });

  it('no change means nothing to save', () => {
    expect(hasChanges(editChanges(order(), editFromOrder(order())))).toBe(false);
  });
});

describe('changes to write', () => {
  it('order date keeps the time of day', () => {
    const e = { ...editFromOrder(order()), orderDate: '2026-11-01' };
    expect(editChanges(order(), e).createdAt).toBe('2026-11-01T10:15:00.000Z');
  });

  it('delivery date and priority of an open part', () => {
    const e = setPart(editFromOrder(order()), 10, { date: '2026-11-18', priority: 'emergency' });
    expect(editChanges(order(), e).parts).toEqual([{ id: 10, date: '2026-11-18', priority: 'emergency' }]);
  });

  it('price, name and kind of saved work become updates', () => {
    let e = editFromOrder(order());
    const [a, b, piko] = e.parts[0].items;
    e = updateItem(e, 10, a.key, { price: 350 });
    e = updateItem(e, 10, b.key, changeWork(b, 'designer', rate));
    e = updateItem(e, 10, piko.key, { qty: 3, name: 'Green saree' });
    const c = editChanges(order(), e);
    expect(c.blouseUpdates).toEqual([
      { id: 1, type: 'astar', name: '', price: 350 },
      // It had the usual astar price, so it takes the usual designer price.
      { id: 2, type: 'designer', name: 'Wedding', price: 400 },
    ]);
    expect(c.smallUpdates).toEqual([{ id: 1, kind: 'piko', name: 'Green saree', price: 50, qty: 3 }]);
    expect(c.blouseRemoves).toEqual([]);
    expect(c.smallRemoves).toEqual([]);
  });

  it('a price she typed herself is kept when the kind changes', () => {
    const item = { ...newEditItem('astar', 300), price: 320 };
    expect(changeWork(item, 'sadha', rate)).toEqual({ work: 'sadha', price: 320, qty: 1 });
  });

  it('added and removed work', () => {
    let e = editFromOrder(order());
    e = removeItem(e, 10, e.parts[0].items[0].key);
    e = addItem(e, 10, newEditItem('sadha', 200));
    e = addItem(e, 10, newEditItem('blouse_alter', 100));
    const c = editChanges(order(), e);
    expect(c.blouseRemoves).toEqual([1]);
    expect(c.smallRemoves).toEqual([]);
    expect(c.blouseAdds).toEqual([{ partId: 10, type: 'sadha', name: '', price: 200 }]);
    expect(c.smallAdds).toEqual([{ partId: 10, kind: 'blouse_alter', name: '', price: 100, qty: 1 }]);
  });

  it('a removed small work is not mixed up with a blouse of the same id', () => {
    let e = editFromOrder(order());
    e = removeItem(e, 10, e.parts[0].items[2].key);
    const c = editChanges(order(), e);
    expect(c.smallRemoves).toEqual([1]);
    expect(c.blouseRemoves).toEqual([]);
  });

  it('an open part with nothing left is marked empty', () => {
    let e = editFromOrder(order());
    for (const i of e.parts[0].items) e = removeItem(e, 10, i.key);
    const c = editChanges(order(), e);
    expect(c.emptyParts).toEqual([10]);
    expect(c.blouseRemoves).toEqual([1, 2]);
    expect(c.smallRemoves).toEqual([1]);
  });

  it('delivered parts are never written', () => {
    let e = editFromOrder(order());
    e = setPart(e, 11, { date: '2026-12-01' });
    expect(editChanges(order(), e).parts).toEqual([]);
  });
});

describe('problems', () => {
  it('an order must keep some work', () => {
    let e = editFromOrder(order());
    e = { ...e, parts: e.parts.map(p => ({ ...p, items: [] })) };
    expect(editProblem(e)).toBe('empty');
  });
  it('"other" work needs a name', () => {
    const e = addItem(editFromOrder(order()), 10, newEditItem('other', 0));
    expect(editProblem(e)).toBe('name');
  });
});
