// ============================================================
// Poshakh – the order she is writing on the New Order screen
// One line per kind of work, and each piece on a line has its own name,
// price and urgency. Stitching pieces are saved one by one; identical
// small work is saved as one row with a quantity.
// ============================================================
import type { Priority, QuotePartRequest } from '../engine';
import type { NewPart } from '../db/database';
import type { BlouseType, SmallWorkKind, WorkKey } from '../types';
import { isStitchWork } from './labels';

export interface DraftPiece {
  key: number;
  name: string;
  price: number;
  /** Stitching only. */
  emergency: boolean;
}

export interface DraftLine {
  key: number;
  work: WorkKey;
  pieces: DraftPiece[];
}

let lastKey = 0;
const newKey = () => ++lastKey;

const newPiece = (price: number): DraftPiece => ({ key: newKey(), name: '', price, emergency: false });

/**
 * Adds one piece and says which line it went on. Each kind of work has one line. A new piece
 * starts at the price of the piece before it, because she may have typed one; else `rate`.
 */
export function addWork(lines: DraftLine[], work: WorkKey, rate: number): { lines: DraftLine[]; key: number } {
  const line = lines.find(l => l.work === work);
  if (!line) {
    const key = newKey();
    return { key, lines: [...lines, { key, work, pieces: [newPiece(rate)] }] };
  }
  const price = line.pieces[line.pieces.length - 1]?.price ?? rate;
  return {
    key: line.key,
    lines: lines.map(l => (l === line ? { ...l, pieces: [...l.pieces, newPiece(price)] } : l)),
  };
}

/** Takes the last piece off a line; a line with no pieces left goes away. */
export function removeLastPiece(lines: DraftLine[], key: number): DraftLine[] {
  return lines
    .map(l => (l.key === key ? { ...l, pieces: l.pieces.slice(0, -1) } : l))
    .filter(l => l.pieces.length > 0);
}

export function updatePiece(lines: DraftLine[], lineKey: number, pieceKey: number, patch: Partial<DraftPiece>): DraftLine[] {
  return lines.map(l => (l.key !== lineKey ? l : {
    ...l,
    pieces: l.pieces.map(p => (p.key === pieceKey ? { ...p, ...patch } : p)),
  }));
}

export const lineTotal = (l: DraftLine) => l.pieces.reduce((s, p) => s + p.price, 0);
export const draftTotal = (lines: DraftLine[]) => lines.reduce((s, l) => s + lineTotal(l), 0);
export const stitchLines = (lines: DraftLine[]) => lines.filter(l => isStitchWork(l.work));
export const smallLines = (lines: DraftLine[]) => lines.filter(l => !isStitchWork(l.work));
const countPieces = (lines: DraftLine[], keep: (p: DraftPiece) => boolean = () => true) =>
  lines.reduce((s, l) => s + l.pieces.filter(keep).length, 0);
export const stitchCount = (lines: DraftLine[]) => countPieces(stitchLines(lines));
export const emergencyCount = (lines: DraftLine[]) => countPieces(stitchLines(lines), p => p.emergency);
export const fullDayCount = (lines: DraftLine[]) => countPieces(lines.filter(l => l.work === 'navvari'));

const piecePriority = (p: DraftPiece): Priority => (p.emergency ? 'emergency' : 'general');

/** What to ask the engine: one request per priority that has stitching work. */
export function quoteRequests(lines: DraftLine[]): QuotePartRequest[] {
  return (['emergency', 'general'] as Priority[])
    .map(priority => {
      const mine = (p: DraftPiece) => piecePriority(p) === priority;
      return {
        priority,
        count: countPieces(stitchLines(lines), mine),
        fullDayCount: countPieces(lines.filter(l => l.work === 'navvari'), mine),
      };
    })
    .filter(r => r.count > 0);
}

/** "Other" work must say what it is. */
export const pieceNeedsName = (work: WorkKey, p: DraftPiece) => work === 'other' && !p.name.trim();
export const missingName = (l: DraftLine) => l.pieces.some(p => pieceNeedsName(l.work, p));

export interface DraftGroup {
  work: WorkKey;
  name: string;
  price: number;
  emergency: boolean;
  qty: number;
}

/** Identical pieces together, for the summary and for saving small work. */
export function draftGroups(lines: DraftLine[]): DraftGroup[] {
  const groups: DraftGroup[] = [];
  for (const l of lines) {
    for (const p of l.pieces) {
      const name = p.name.trim();
      const same = groups.find(g => g.work === l.work && g.name.toLowerCase() === name.toLowerCase()
        && g.price === p.price && g.emergency === p.emergency);
      if (same) same.qty += 1;
      else groups.push({ work: l.work, name, price: p.price, emergency: p.emergency, qty: 1 });
    }
  }
  return groups;
}

/**
 * The deliveries to save. Small work has no date of its own: it goes with the last delivery,
 * or gets one delivery on `smallOnlyDate` if the order has no stitching at all.
 */
export function draftParts(
  lines: DraftLine[],
  dates: Partial<Record<Priority, string>>,
  smallOnlyDate: string,
): NewPart[] {
  const parts: NewPart[] = quoteRequests(lines).map(r => ({
    priority: r.priority,
    promisedDelivery: dates[r.priority]!,
    blouses: stitchLines(lines)
      // Nav-vari first: the quote plans it first, so the saved order gets the days it promised.
      .sort((a, b) => Number(b.work === 'navvari') - Number(a.work === 'navvari'))
      .flatMap(l => l.pieces
        .filter(p => piecePriority(p) === r.priority)
        .map(p => ({ type: l.work as BlouseType, price: p.price, name: p.name }))),
  }));

  const small = draftGroups(smallLines(lines)).map(g => ({ kind: g.work as SmallWorkKind, qty: g.qty, price: g.price, name: g.name }));
  if (small.length === 0) return parts;
  if (parts.length === 0) {
    return [{ priority: 'general', promisedDelivery: smallOnlyDate, blouses: [], smallWork: small }];
  }
  const last = parts.reduce((a, b) => (b.promisedDelivery >= a.promisedDelivery ? b : a));
  return parts.map(p => (p === last ? { ...p, smallWork: small } : p));
}
