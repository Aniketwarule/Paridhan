// ============================================================
// Poshakh – display labels that depend on the current language
// ============================================================
import { STRINGS } from '../strings';
import type { Weekday } from '../engine';
import type { AppSettings, BlouseType, SmallWorkKind, WorkKey } from '../types';

/** What she can stitch, in the order the New Order screen shows it. */
export const STITCH_TYPES: BlouseType[] = ['astar', 'sadha', 'designer', 'dress', 'navvari'];
export const ALTER_KINDS: SmallWorkKind[] = ['blouse_alter', 'dress_alter', 'parkar_alter'];
export const OTHER_SMALL_KINDS: SmallWorkKind[] = ['parkar_stitch', 'piko_fall', 'piko', 'other'];

export function isStitchWork(key: WorkKey): key is BlouseType {
  return (STITCH_TYPES as WorkKey[]).includes(key);
}

export function workLabel(key: string): string {
  return STRINGS.workNames[key] ?? key;
}

/** "Wedding blouse (Astar blouse)" or just "Astar blouse". */
export function blouseLabel(b: { type: string; name?: string }): string {
  return b.name ? `${b.name} (${workLabel(b.type)})` : workLabel(b.type);
}

/** "Green saree (Piko)" or just "Piko". "Other" work is called by the name she gave it. */
export function smallWorkLabel(w: { kind: string; name?: string }): string {
  if (w.kind === 'other') return w.name || workLabel('other');
  return w.name ? `${w.name} (${workLabel(w.kind)})` : workLabel(w.kind);
}

/** The usual price of a kind of work. */
export function rateFor(settings: AppSettings, key: WorkKey): number {
  if (key === 'astar') return settings.priceAstar;
  if (key === 'designer') return settings.priceDesigner;
  return settings.rates[key] ?? 0;
}

/**
 * Names the work rather than counting "pieces": "2 blouses, 1 dress, Piko × 2".
 * Blouse types are added up; everything else keeps its own name.
 */
export function workSummary(
  blouses: { type: string }[],
  smallWork: { kind: string; name?: string; qty: number }[] = [],
): string {
  const count = (types: string[]) => blouses.filter(b => types.includes(b.type)).length;
  const nBlouses = count(['astar', 'sadha', 'designer']);
  const nDresses = count(['dress']);
  const nNavvari = count(['navvari']);
  const out: string[] = [];
  if (nBlouses) out.push(STRINGS.blouses(nBlouses));
  if (nDresses) out.push(STRINGS.dresses(nDresses));
  if (nNavvari) out.push(STRINGS.navvaris(nNavvari));
  for (const w of smallWork) {
    const label = smallWorkLabel(w);
    out.push(w.qty > 1 ? `${label} × ${w.qty}` : label);
  }
  return out.join(', ');
}

/** Monday first. */
export const WEEK_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** "Mon–Sat", "Mon, Wed, Fri", "Mon–Thu, Sat". */
export function daysSummary(days: Weekday[], names: string[]): string {
  const on = WEEK_ORDER.filter(d => days.includes(d));
  const runs: Weekday[][] = [];
  for (const d of on) {
    const last = runs[runs.length - 1];
    if (last && WEEK_ORDER.indexOf(last[last.length - 1]) === WEEK_ORDER.indexOf(d) - 1) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map(r => (r.length >= 3 ? `${names[r[0]]}–${names[r[r.length - 1]]}` : r.map(d => names[d]).join(', ')))
    .join(', ');
}
