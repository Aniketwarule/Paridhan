// ============================================================
// Poshakh – user-facing strings
// STRINGS always holds the current language. Switch with setLanguage();
// the app context re-renders every screen afterwards.
// ============================================================
import { en, type Strings } from './en';
import { mr } from './mr';

export type Language = 'en' | 'mr';

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'mr', label: 'मराठी' },
];

export const STRINGS: Strings = { ...en };

let current: Language = 'en';
const listeners: ((lang: Language) => void)[] = [];

export function setLanguage(lang: Language): void {
  current = lang;
  Object.assign(STRINGS, lang === 'mr' ? mr : en);
  listeners.forEach(l => l(lang));
}

/** For libraries with their own locale setting (e.g. the calendar). */
export function onLanguageChange(listener: (lang: Language) => void): void {
  listeners.push(listener);
}

export function getLanguage(): Language {
  return current;
}
