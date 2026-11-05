// ============================================================
// Poshakh – display labels that depend on the current language
// ============================================================
import { STRINGS } from '../strings';

export function typeLabel(type: string): string {
  return type === 'astar' ? STRINGS.astar : STRINGS.designer;
}

/** "Wedding blouse (Astar)" or just "Astar". */
export function blouseLabel(b: { type: string; name?: string }): string {
  return b.name ? `${b.name} (${typeLabel(b.type)})` : typeLabel(b.type);
}
