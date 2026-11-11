// ============================================================
// Poshakh – App-wide React context
// Holds settings and the latest schedule from the scheduling engine.
// The schedule is never stored: it is rebuilt from the DB after every change.
// ============================================================
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import * as DB from '../db/database';
import { addDays, rebuildSchedule, toEngineInput } from '../engine';
import type { DateStr, EngineInput, ScheduleResult } from '../engine';
import type { AppSettings, DayOff } from '../types';
import { localToday, weekRange } from '../utils/date';
import { setLanguage as applyLanguage, type Language } from '../strings';

interface InputOverrides {
  settings?: AppSettings;
  daysOff?: string[];
}

interface AppContextValue {
  isReady: boolean;
  language: Language;
  setLanguage: (l: Language) => void;
  today: string;
  settings: AppSettings;
  daysOff: DayOff[];
  /** Latest engine result. */
  schedule: ScheduleResult;
  /** Bumped after every rebuild; use as an effect dependency to reload screens. */
  version: number;
  late: Set<number>;
  willMiss: Set<number>;
  lateParts: Set<number>;
  willMissParts: Set<number>;
  /** Fresh engine input from the DB (optionally with unsaved settings). */
  buildInput: (o?: InputOverrides) => EngineInput;
  /** Call after any data change. */
  refresh: () => void;
  saveSettings: (s: AppSettings) => void;
  addDayOff: (date: string, label?: string) => void;
  removeDayOff: (id: number) => void;
  /** How many blouses would miss their date with these settings (settings preview). */
  previewWillMiss: (o: InputOverrides) => number;
  /** Re-read everything from the DB (after a backup is restored). */
  reloadAll: () => void;
}

const EMPTY: ScheduleResult = {
  today: { date: '', blouseIds: [] },
  days: [],
  stitchDate: {},
  latestStitch: {},
  queue: [],
  todayTarget: 0,
  doneTodayCount: 0,
  late: [],
  lateParts: [],
  willMiss: [],
  willMissParts: [],
  changes: [],
  weekLoad: {},
};

const AppContext = createContext<AppContextValue | null>(null);
const toIds = (xs: string[]) => new Set(xs.map(Number));

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [today, setToday] = useState(localToday());
  const [settings, setSettings] = useState<AppSettings>(DB.DEFAULT_APP_SETTINGS);
  const [daysOff, setDaysOff] = useState<DayOff[]>([]);
  const [schedule, setSchedule] = useState<ScheduleResult>(EMPTY);
  const [version, setVersion] = useState(0);
  const [language, setLanguageState] = useState<Language>('en');

  const settingsRef = useRef(settings);
  const daysOffRef = useRef<string[]>([]);
  const previousRef = useRef<Record<string, DateStr | null> | undefined>(undefined);

  const buildInput = useCallback((o: InputOverrides = {}): EngineInput => {
    const t = localToday();
    const s = o.settings ?? settingsRef.current;
    // A week back from this week's start is enough for the engine's weekly done counts.
    const since = addDays(weekRange(t, s.weekStartsOn)[0], -7);
    return toEngineInput(t, s, o.daysOff ?? daysOffRef.current, DB.loadEngineData(since));
  }, []);

  const refresh = useCallback(() => {
    const input = buildInput();
    const result = rebuildSchedule(input, previousRef.current);
    previousRef.current = result.stitchDate;
    setToday(input.today);
    setSchedule(result);
    setVersion(v => v + 1);
  }, [buildInput]);

  const reloadAll = useCallback(() => {
    const lang = DB.getState<Language>('language') ?? 'en';
    applyLanguage(lang);
    setLanguageState(lang);
    const s = DB.loadSettings();
    const d = DB.loadDaysOff();
    settingsRef.current = s;
    daysOffRef.current = d.map(x => x.date);
    setSettings(s);
    setDaysOff(d);
    // The restored data has its own plan; don't compare with the old one.
    previousRef.current = undefined;
    refresh();
  }, [refresh]);

  useEffect(() => {
    (async () => {
      await DB.initDb();
      reloadAll();
      setIsReady(true);
    })();
  }, [reloadAll]);

  // The day can change while the app sits in the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => {
      if (st === 'active' && isReady) refresh();
    });
    return () => sub.remove();
  }, [isReady, refresh]);

  const saveSettings = useCallback((s: AppSettings) => {
    DB.saveSettings(s);
    settingsRef.current = s;
    setSettings(s);
    refresh();
  }, [refresh]);

  const reloadDaysOff = useCallback(() => {
    const d = DB.loadDaysOff();
    daysOffRef.current = d.map(x => x.date);
    setDaysOff(d);
    refresh();
  }, [refresh]);

  const addDayOff = useCallback((date: string, label?: string) => {
    DB.addDayOff(date, label);
    reloadDaysOff();
  }, [reloadDaysOff]);

  const removeDayOff = useCallback((id: number) => {
    DB.removeDayOff(id);
    reloadDaysOff();
  }, [reloadDaysOff]);

  const setLanguage = useCallback((l: Language) => {
    applyLanguage(l);
    DB.setState('language', l);
    setLanguageState(l);
  }, []);

  const previewWillMiss = useCallback(
    (o: InputOverrides) => rebuildSchedule(buildInput(o)).willMiss.length,
    [buildInput],
  );

  const value = useMemo<AppContextValue>(() => ({
    isReady,
    language,
    setLanguage,
    today,
    settings,
    daysOff,
    schedule,
    version,
    late: toIds(schedule.late),
    willMiss: toIds(schedule.willMiss),
    lateParts: toIds(schedule.lateParts),
    willMissParts: toIds(schedule.willMissParts),
    buildInput,
    refresh,
    saveSettings,
    addDayOff,
    removeDayOff,
    previewWillMiss,
    reloadAll,
  }), [isReady, language, setLanguage, today, settings, daysOff, schedule, version, buildInput, refresh, saveSettings, addDayOff, removeDayOff, previewWillMiss, reloadAll]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used inside AppProvider');
  return ctx;
}
