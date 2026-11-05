// ============================================================
// Poshakh – the one place the app imports the scheduling engine from.
// The engine itself lives in "Scheduling engine/src" (pure TS, own tests).
// ============================================================
export * from '../../Scheduling engine/src';
export { toEngineInput, toEngineSettings, weekStrip } from './adapter';
export type { EngineData, WeekBar } from './adapter';
