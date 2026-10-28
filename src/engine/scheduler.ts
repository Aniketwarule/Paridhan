// ============================================================
// Poshakh – Scheduling Engine
// Pure functions only. No UI, no DB, no side-effects.
// ============================================================

import type {
  AppSettings,
  BlouseAssignment,
  BlouseItem,
  BlousePriority,
  BlouseType,
  DayLoad,
  ScheduleResult,
  WeekCapacity,
} from '../types';

// ──────────────────────────────────────────────────────────────
// Date utilities
// ──────────────────────────────────────────────────────────────

/** Parse a YYYY-MM-DD string into a local Date (noon to avoid DST issues). */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/** Format a Date to YYYY-MM-DD. */
export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Add `n` calendar days to a date string. */
export function addDays(dateStr: string, n: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

/** Monday of the week containing this date. */
export function weekStart(dateStr: string): string {
  const d = parseDate(dateStr);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatDate(d);
}

/** Compare two YYYY-MM-DD strings. */
export function dateLt(a: string, b: string): boolean {
  return a < b;
}
export function dateLte(a: string, b: string): boolean {
  return a <= b;
}
export function dateGte(a: string, b: string): boolean {
  return a >= b;
}

// ──────────────────────────────────────────────────────────────
// Capacity helpers
// ──────────────────────────────────────────────────────────────

/**
 * General slots per week = weeklyTarget - emergencyReserve
 * Emergency slots = emergencyReserve  (emergency can also use general if needed)
 */
export function weeklyGeneralCap(s: AppSettings): number {
  return Math.max(0, s.weeklyTarget - s.emergencyReserve);
}

/**
 * Daily general capacity (spread general slots across working days this week).
 * We honour s.dailyMax as a ceiling.
 */
export function dailyGeneralCap(s: AppSettings): number {
  const days = s.workingDays.length || 1;
  return Math.min(s.dailyMax, Math.ceil(weeklyGeneralCap(s) / days));
}

/** Is this date a working day (not a day-off and the weekday is enabled)? */
export function isWorkingDay(
  dateStr: string,
  settings: AppSettings,
  daysOff: string[],
): boolean {
  if (daysOff.includes(dateStr)) return false;
  const dow = parseDate(dateStr).getDay();
  return settings.workingDays.includes(dow);
}

/**
 * Build a map of load per calendar date from existing BlouseItems.
 * Only scheduled / done blouses count (not cancelled or delivered).
 */
export function buildLoadMap(
  blouses: BlouseItem[],
): Map<string, { general: number; emergency: number }> {
  const map = new Map<string, { general: number; emergency: number }>();
  for (const b of blouses) {
    if (b.status === 'cancelled' || b.status === 'delivered') continue;
    const entry = map.get(b.scheduledDate) ?? { general: 0, emergency: 0 };
    if (b.priority === 'general') entry.general += 1;
    else entry.emergency += 1;
    map.set(b.scheduledDate, entry);
  }
  return map;
}

/**
 * Count weekly general / emergency used for a given Monday-based week string.
 */
export function weekLoad(
  weekStartStr: string,
  loadMap: Map<string, { general: number; emergency: number }>,
): { general: number; emergency: number } {
  let general = 0;
  let emergency = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStartStr, i);
    const entry = loadMap.get(d);
    if (entry) {
      general += entry.general;
      emergency += entry.emergency;
    }
  }
  return { general, emergency };
}

// ──────────────────────────────────────────────────────────────
// Core scheduling
// ──────────────────────────────────────────────────────────────

/**
 * Find the next available working day (>= fromDate) that has capacity for
 * one blouse of the given priority.
 *
 * General blouses: can only use general slots.
 * Emergency blouses: use emergency (reserve) slots first; spill into general
 *   if reserve is full.
 *
 * Returns null if no day is found within maxDays (safety valve).
 */
export function nextAvailableDay(
  fromDate: string,
  priority: BlousePriority,
  settings: AppSettings,
  daysOff: string[],
  loadMap: Map<string, { general: number; emergency: number }>,
  maxDays = 365,
): string | null {
  let current = fromDate;
  for (let i = 0; i < maxDays; i++) {
    if (isWorkingDay(current, settings, daysOff)) {
      const dayEntry = loadMap.get(current) ?? { general: 0, emergency: 0 };
      const ws = weekStart(current);
      const wl = weekLoad(ws, loadMap);

      const generalCapDay = dailyGeneralCap(settings);
      const emergencyCapWeek = settings.emergencyReserve;
      const generalCapWeek = weeklyGeneralCap(settings);

      if (priority === 'general') {
        // Must fit in daily general cap AND weekly general cap
        if (
          dayEntry.general < generalCapDay &&
          wl.general < generalCapWeek
        ) {
          return current;
        }
      } else {
        // Emergency: try reserved slot first
        if (wl.emergency < emergencyCapWeek && dayEntry.general + dayEntry.emergency < settings.dailyMax) {
          return current;
        }
        // Spill into general slots
        if (
          dayEntry.general < generalCapDay &&
          wl.general < generalCapWeek
        ) {
          return current;
        }
      }
    }
    current = addDays(current, 1);
  }
  return null;
}

/**
 * Schedule a list of blouses (described by type+priority) starting from
 * `fromDate`. Mutates a *copy* of `loadMap` so callers can chain calls.
 *
 * Returns the ScheduleResult including per-blouse assignments and whether
 * any weekly/daily limit was exceeded.
 */
export function scheduleBlouses(
  blouses: Array<{ type: BlouseType; priority: BlousePriority }>,
  fromDate: string,
  settings: AppSettings,
  daysOff: string[],
  existingLoad: Map<string, { general: number; emergency: number }>,
  spareDays: number,
): ScheduleResult {
  // Work on a mutable copy so we don't corrupt the caller's map
  const loadMap = new Map(existingLoad);
  for (const [k, v] of existingLoad) loadMap.set(k, { ...v });

  const assignments: BlouseAssignment[] = [];
  let overLimit = false;
  let overLimitDetail: string | undefined;
  let lastStitchDate: string | null = null;

  for (const b of blouses) {
    const day = nextAvailableDay(fromDate, b.priority, settings, daysOff, loadMap);
    if (day === null) {
      // Extreme edge case – just place on fromDate and flag
      overLimit = true;
      overLimitDetail = 'No available day found in next year.';
      assignments.push({
        type: b.type,
        priority: b.priority,
        scheduledDate: fromDate,
        promisedDeliveryDate: fromDate,
      });
      continue;
    }

    // Check if this placement exceeds limits (soft – we allow it)
    const ws = weekStart(day);
    const wl = weekLoad(ws, loadMap);
    const totalWeekUsed = wl.general + wl.emergency + 1;
    if (totalWeekUsed > settings.weeklyTarget) {
      overLimit = true;
      overLimitDetail = `This makes the week ${totalWeekUsed} of ${settings.weeklyTarget}`;
    }

    // Record assignment
    assignments.push({
      type: b.type,
      priority: b.priority,
      scheduledDate: day,
      promisedDeliveryDate: '', // filled below
    });

    // Update load map
    const entry = loadMap.get(day) ?? { general: 0, emergency: 0 };
    if (b.priority === 'general' || wl.emergency >= settings.emergencyReserve) {
      entry.general += 1;
    } else {
      entry.emergency += 1;
    }
    loadMap.set(day, entry);

    if (lastStitchDate === null || day > lastStitchDate) {
      lastStitchDate = day;
    }
  }

  // Delivery date = last stitch day + spare days (skip non-working days)
  const deliveryDate = lastStitchDate
    ? computeDeliveryDate(lastStitchDate, spareDays, settings, daysOff)
    : fromDate;

  // Back-fill promised delivery date on every assignment
  for (const a of assignments) {
    a.promisedDeliveryDate = deliveryDate;
  }

  return { assignments, deliveryDate, overLimit, overLimitDetail };
}

/**
 * Delivery date = last stitch date + spareDays, advancing past non-working
 * days if needed (so delivery lands on a day she is actually working or the
 * next calendar day after that).
 */
export function computeDeliveryDate(
  lastStitchDate: string,
  spareDays: number,
  settings: AppSettings,
  daysOff: string[],
): string {
  let d = lastStitchDate;
  let spare = spareDays;
  while (spare > 0) {
    d = addDays(d, 1);
    spare--;
  }
  return d;
}

/**
 * Calculate earliest GENERAL and EMERGENCY delivery dates for a new order
 * consisting of `totalBlouses` blouses with `emergencyCount` of them emergency.
 *
 * Returns two ScheduleResults (general part and emergency part).
 */
export function calcEarliestDates(
  totalAstar: number,
  totalDesigner: number,
  emergencyCount: number,
  fromDate: string,
  settings: AppSettings,
  daysOff: string[],
  existingBlouses: BlouseItem[],
): {
  generalResult: ScheduleResult;
  emergencyResult: ScheduleResult;
} {
  const loadMap = buildLoadMap(existingBlouses);
  const totalBlouses = totalAstar + totalDesigner;
  const generalCount = totalBlouses - emergencyCount;

  // Build blouse list: emergency first so they get the earliest slots
  const emergencyBlouses: Array<{ type: BlouseType; priority: BlousePriority }> = [];
  let eAstar = Math.min(emergencyCount, totalAstar);
  let eDesigner = emergencyCount - eAstar;
  for (let i = 0; i < eAstar; i++) emergencyBlouses.push({ type: 'astar', priority: 'emergency' });
  for (let i = 0; i < eDesigner; i++) emergencyBlouses.push({ type: 'designer', priority: 'emergency' });

  const generalBlouses: Array<{ type: BlouseType; priority: BlousePriority }> = [];
  let gAstar = totalAstar - eAstar;
  let gDesigner = totalDesigner - eDesigner;
  for (let i = 0; i < gAstar; i++) generalBlouses.push({ type: 'astar', priority: 'general' });
  for (let i = 0; i < gDesigner; i++) generalBlouses.push({ type: 'designer', priority: 'general' });

  // Emergency: no spare days
  const emergencyResult = emergencyBlouses.length > 0
    ? scheduleBlouses(emergencyBlouses, fromDate, settings, daysOff, loadMap, 0)
    : { assignments: [], deliveryDate: fromDate, overLimit: false };

  // General: spare days apply; share the load map (read only – general starts fresh)
  const generalResult = generalBlouses.length > 0
    ? scheduleBlouses(generalBlouses, fromDate, settings, daysOff, loadMap, settings.spareDaysBeforeDelivery)
    : { assignments: [], deliveryDate: fromDate, overLimit: false };

  return { generalResult, emergencyResult };
}

// ──────────────────────────────────────────────────────────────
// Dynamic pull-forward
// ──────────────────────────────────────────────────────────────

/**
 * Pull-forward: given all pending blouses, reschedule them from today onwards,
 * preserving promisedDeliveryDate (only scheduledDate changes).
 *
 * Returns a map of blouseId -> new scheduledDate for all items that moved.
 */
export function pullForward(
  today: string,
  blouses: BlouseItem[],
  settings: AppSettings,
  daysOff: string[],
): Map<number, string> {
  const changes = new Map<number, string>();
  const loadMap = new Map<string, { general: number; emergency: number }>();

  // Sort by promisedDeliveryDate ASC (nearest deadline first) then by id
  const pending = blouses
    .filter(b => b.status === 'scheduled')
    .sort((a, b) => {
      if (a.promisedDeliveryDate !== b.promisedDeliveryDate)
        return a.promisedDeliveryDate < b.promisedDeliveryDate ? -1 : 1;
      return a.id - b.id;
    });

  for (const blouse of pending) {
    const earliest = dateLte(blouse.scheduledDate, today) ? today : blouse.scheduledDate;
    const day = nextAvailableDay(earliest, blouse.priority, settings, daysOff, loadMap);
    if (!day) continue;

    if (day !== blouse.scheduledDate) {
      changes.set(blouse.id, day);
    }

    // Occupy that slot in the virtual load map
    const entry = loadMap.get(day) ?? { general: 0, emergency: 0 };
    if (blouse.priority === 'general') entry.general += 1;
    else entry.emergency += 1;
    loadMap.set(day, entry);
  }

  return changes;
}

// ──────────────────────────────────────────────────────────────
// Roll-over (past undone blouses)
// ──────────────────────────────────────────────────────────────

/**
 * Roll-over: blouses whose scheduledDate < today and status === 'scheduled'
 * need to be moved to today or later.
 *
 * This is a special case of pull-forward but only for overdue items.
 * Returns map of blouseId -> new scheduledDate.
 */
export function rollOver(
  today: string,
  blouses: BlouseItem[],
  settings: AppSettings,
  daysOff: string[],
): { changes: Map<number, string>; lateIds: number[] } {
  const changes = new Map<number, string>();
  const lateIds: number[] = [];
  const loadMap = new Map<string, { general: number; emergency: number }>();

  // Build current load from non-overdue blouses first
  for (const b of blouses) {
    if (b.status !== 'scheduled') continue;
    if (dateLt(b.scheduledDate, today)) continue; // overdue, skip for now
    const entry = loadMap.get(b.scheduledDate) ?? { general: 0, emergency: 0 };
    if (b.priority === 'general') entry.general += 1;
    else entry.emergency += 1;
    loadMap.set(b.scheduledDate, entry);
  }

  // Now reschedule overdue blouses, nearest deadline first
  const overdue = blouses
    .filter(b => b.status === 'scheduled' && dateLt(b.scheduledDate, today))
    .sort((a, b) => {
      if (a.promisedDeliveryDate !== b.promisedDeliveryDate)
        return a.promisedDeliveryDate < b.promisedDeliveryDate ? -1 : 1;
      return a.id - b.id;
    });

  for (const blouse of overdue) {
    const day = nextAvailableDay(today, blouse.priority, settings, daysOff, loadMap);
    if (!day) continue;

    changes.set(blouse.id, day);

    // Flag if now past promised delivery date
    if (dateGte(day, blouse.promisedDeliveryDate)) {
      lateIds.push(blouse.id);
    }

    const entry = loadMap.get(day) ?? { general: 0, emergency: 0 };
    if (blouse.priority === 'general') entry.general += 1;
    else entry.emergency += 1;
    loadMap.set(day, entry);
  }

  return { changes, lateIds };
}

// ──────────────────────────────────────────────────────────────
// Capacity strip (for new-order preview)
// ──────────────────────────────────────────────────────────────

/**
 * Returns WeekCapacity for this week + next `extraWeeks` weeks.
 */
export function capacityStrip(
  today: string,
  settings: AppSettings,
  existingBlouses: BlouseItem[],
  extraWeeks = 4,
): WeekCapacity[] {
  const loadMap = buildLoadMap(existingBlouses);
  const ws = weekStart(today);
  const result: WeekCapacity[] = [];

  for (let w = 0; w <= extraWeeks; w++) {
    const wDate = addDays(ws, w * 7);
    const wl = weekLoad(wDate, loadMap);
    result.push({
      weekStart: wDate,
      used: wl.general + wl.emergency,
      target: settings.weeklyTarget,
      generalUsed: wl.general,
      emergencyUsed: wl.emergency,
    });
  }

  return result;
}

// ──────────────────────────────────────────────────────────────
// "Extra beyond limit" helper
// ──────────────────────────────────────────────────────────────

/**
 * Force-schedule extra blouses even when limits are exceeded.
 * Finds the least-loaded working day in the target week and places blouses there.
 */
export function scheduleExtra(
  blouses: Array<{ type: BlouseType; priority: BlousePriority }>,
  fromDate: string,
  settings: AppSettings,
  daysOff: string[],
  existingLoad: Map<string, { general: number; emergency: number }>,
  spareDays: number,
): ScheduleResult {
  // Same as scheduleBlouses but we ignore capacity limits
  const loadMap = new Map(existingLoad);
  for (const [k, v] of existingLoad) loadMap.set(k, { ...v });

  const assignments: BlouseAssignment[] = [];
  let lastStitchDate: string | null = null;

  for (const b of blouses) {
    // Find least-loaded working day from fromDate
    let current = fromDate;
    let bestDay = fromDate;
    let bestLoad = Infinity;

    for (let i = 0; i < 30; i++) {
      if (isWorkingDay(current, settings, daysOff)) {
        const entry = loadMap.get(current) ?? { general: 0, emergency: 0 };
        const total = entry.general + entry.emergency;
        if (total < bestLoad) {
          bestLoad = total;
          bestDay = current;
        }
      }
      current = addDays(current, 1);
    }

    assignments.push({
      type: b.type,
      priority: b.priority,
      scheduledDate: bestDay,
      promisedDeliveryDate: '',
    });

    const entry = loadMap.get(bestDay) ?? { general: 0, emergency: 0 };
    if (b.priority === 'general') entry.general += 1;
    else entry.emergency += 1;
    loadMap.set(bestDay, entry);

    if (lastStitchDate === null || bestDay > lastStitchDate) {
      lastStitchDate = bestDay;
    }
  }

  const deliveryDate = lastStitchDate
    ? computeDeliveryDate(lastStitchDate, spareDays, settings, daysOff)
    : fromDate;

  for (const a of assignments) {
    a.promisedDeliveryDate = deliveryDate;
  }

  return {
    assignments,
    deliveryDate,
    overLimit: true,
    overLimitDetail: 'Extra blouses added beyond limit.',
  };
}
