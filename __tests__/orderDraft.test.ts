import {
  addWork, draftGroups, draftParts, draftTotal, emergencyCount, fullDayCount, lineTotal, missingName, pieceNeedsName,
  quoteRequests, removeLastPiece, stitchCount, updatePiece, type DraftLine,
} from '../src/utils/orderDraft';
import type { WorkKey } from '../src/types';

function draft(...tapped: [WorkKey, number][]): DraftLine[] {
  let lines: DraftLine[] = [];
  for (const [work, price] of tapped) lines = addWork(lines, work, price).lines;
  return lines;
}
const change = (lines: DraftLine[], line: number, piece: number, patch: Parameters<typeof updatePiece>[3]) =>
  updatePiece(lines, lines[line].key, lines[line].pieces[piece].key, patch);

describe('adding work', () => {
  it('each kind of work has one line, with a row per piece', () => {
    const lines = draft(['astar', 300], ['astar', 300], ['astar', 300], ['dress', 500]);
    expect(lines.map(l => [l.work, l.pieces.length])).toEqual([['astar', 3], ['dress', 1]]);
    expect(draftTotal(lines)).toBe(1400);
    expect(stitchCount(lines)).toBe(4);
  });
  it('a new piece starts at the price she last typed', () => {
    let lines = draft(['navvari', 0]);
    lines = change(lines, 0, 0, { price: 900 });
    lines = addWork(lines, 'navvari', 0).lines;
    expect(lines[0].pieces.map(p => p.price)).toEqual([900, 900]);
  });
  it('a new piece starts with no name and not urgent', () => {
    let lines = draft(['astar', 300]);
    lines = change(lines, 0, 0, { name: 'Wedding', emergency: true });
    lines = addWork(lines, 'astar', 300).lines;
    expect(lines[0].pieces[1]).toMatchObject({ name: '', emergency: false, price: 300 });
  });
  it('minus takes the last piece off, and the line goes with its last piece', () => {
    let lines = draft(['astar', 300], ['astar', 300], ['dress', 500]);
    lines = change(lines, 0, 0, { name: 'First' });
    lines = removeLastPiece(lines, lines[0].key);
    expect(lines[0].pieces.map(p => p.name)).toEqual(['First']);
    lines = removeLastPiece(lines, lines[0].key);
    expect(lines.map(l => l.work)).toEqual(['dress']);
  });
});

describe('each piece on its own', () => {
  it('changes only that piece', () => {
    let lines = draft(['astar', 250], ['astar', 250], ['astar', 250], ['astar', 250]);
    lines = change(lines, 0, 1, { name: 'Silk', price: 400, emergency: true });
    expect(lines[0].pieces.map(p => [p.name, p.price, p.emergency])).toEqual([
      ['', 250, false], ['Silk', 400, true], ['', 250, false], ['', 250, false],
    ]);
    expect(lineTotal(lines[0])).toBe(1150);
    expect(emergencyCount(lines)).toBe(1);
  });
  it('every "other" piece must say what it is', () => {
    let lines = draft(['other', 0], ['other', 0]);
    expect(lines).toHaveLength(1);
    expect(missingName(lines[0])).toBe(true);
    lines = change(lines, 0, 0, { name: ' Buttons ' });
    expect(pieceNeedsName('other', lines[0].pieces[0])).toBe(false);
    expect(missingName(lines[0])).toBe(true);
    lines = change(lines, 0, 1, { name: 'Hook' });
    expect(missingName(lines[0])).toBe(false);
    expect(missingName(draft(['piko', 50])[0])).toBe(false);
  });
  it('identical pieces count together in the summary; different ones stay apart', () => {
    let lines = draft(['astar', 250], ['astar', 250], ['astar', 250]);
    lines = change(lines, 0, 2, { name: 'Silk' });
    expect(draftGroups(lines).map(g => [g.name, g.price, g.qty])).toEqual([['', 250, 2], ['Silk', 250, 1]]);
  });
});

describe('asking for dates', () => {
  it('small work asks the schedule for nothing', () => {
    expect(quoteRequests(draft(['piko', 50], ['blouse_alter', 100], ['other', 30]))).toEqual([]);
  });
  it('a dress counts like a blouse and a nav-vari as a full day', () => {
    const lines = draft(['sadha', 250], ['dress', 500], ['navvari', 900], ['piko', 50]);
    expect(quoteRequests(lines)).toEqual([{ priority: 'general', count: 3, fullDayCount: 1 }]);
    expect(fullDayCount(lines)).toBe(1);
  });
  it('urgent pieces ask separately, first, even from the same line', () => {
    let lines = draft(['astar', 300], ['astar', 300], ['navvari', 900], ['navvari', 900]);
    lines = change(lines, 0, 1, { emergency: true });
    lines = change(lines, 1, 0, { emergency: true });
    expect(quoteRequests(lines)).toEqual([
      { priority: 'emergency', count: 2, fullDayCount: 1 },
      { priority: 'general', count: 2, fullDayCount: 1 },
    ]);
  });
});

describe('what gets saved', () => {
  it('stitching is saved piece by piece, with each one\'s own name, price and delivery', () => {
    let lines = draft(['astar', 300], ['astar', 300], ['astar', 300]);
    lines = change(lines, 0, 0, { name: 'Silk', price: 400 });
    lines = change(lines, 0, 2, { emergency: true });
    expect(draftParts(lines, { emergency: '2026-11-05', general: '2026-11-12' }, '')).toEqual([
      { priority: 'emergency', promisedDelivery: '2026-11-05', blouses: [{ type: 'astar', price: 300, name: '' }] },
      {
        priority: 'general',
        promisedDelivery: '2026-11-12',
        blouses: [{ type: 'astar', price: 400, name: 'Silk' }, { type: 'astar', price: 300, name: '' }],
      },
    ]);
  });
  it('identical small work stays one row with a quantity; different pieces get their own', () => {
    let lines = draft(['piko', 50], ['piko', 50], ['piko', 50]);
    lines = change(lines, 0, 2, { name: 'Green saree', price: 60 });
    expect(draftParts(lines, {}, '2026-11-09')[0].smallWork).toEqual([
      { kind: 'piko', qty: 2, price: 50, name: '' },
      { kind: 'piko', qty: 1, price: 60, name: 'Green saree' },
    ]);
  });
  it('saves a nav-vari ahead of the blouses, as the quote plans it', () => {
    const parts = draftParts(draft(['astar', 300], ['dress', 500], ['navvari', 900]), { general: '2026-11-14' }, '');
    expect(parts[0].blouses.map(b => b.type)).toEqual(['navvari', 'astar', 'dress']);
  });
  it('small work goes with the last delivery of a split order', () => {
    const lines = draft(['astar', 300], ['designer', 400], ['piko', 50]);
    const split = change(lines, 0, 0, { emergency: true });
    const parts = draftParts(split, { emergency: '2026-11-05', general: '2026-11-12' }, '');
    expect(parts.map(p => [p.priority, p.smallWork?.length ?? 0])).toEqual([['emergency', 0], ['general', 1]]);

    const later = draftParts(split, { emergency: '2026-11-20', general: '2026-11-12' }, '');
    expect(later.map(p => [p.priority, p.smallWork?.length ?? 0])).toEqual([['emergency', 1], ['general', 0]]);
  });
  it('an order of only small work gets one delivery on her date', () => {
    expect(draftParts(draft(['piko_fall', 120]), {}, '2026-11-09')).toEqual([{
      priority: 'general',
      promisedDelivery: '2026-11-09',
      blouses: [],
      smallWork: [{ kind: 'piko_fall', qty: 1, price: 120, name: '' }],
    }]);
  });
});
