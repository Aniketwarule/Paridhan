export * from './types';
export { addDays, fromDay, toDay, weekdayOf } from './dates';
export { DEFAULT_SETTINGS, HORIZON_DAYS, normalizeSettings } from './core';
export { rebuildSchedule } from './schedule';
export { quote, quoteBoth, maxByDate, checkDate, checkPartDateChange, catchUpExtra, confirmOrder, report } from './quote';
export type { PriorPart, ConfirmPart, CatchUp } from './quote';

import { makeCtx, deliveryFor, latestStitchFor } from './core';
import { fromDay, toDay } from './dates';
import type { DateStr, EngineInput, Priority } from './types';

/** D2/D3 helper for the UI: delivery date for a blouse stitched on `stitch`. */
export function deliveryDateFor(input: EngineInput, stitch: DateStr, p: Priority): DateStr | null {
  const r = deliveryFor(makeCtx(input), toDay(stitch), p);
  return r === null ? null : fromDay(r);
}

/** D4 helper for the UI. */
export function latestStitchDayFor(input: EngineInput, promised: DateStr, p: Priority): DateStr | null {
  const r = latestStitchFor(makeCtx(input), toDay(promised), p);
  return r === null ? null : fromDay(r);
}
