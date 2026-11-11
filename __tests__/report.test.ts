import { stitchedBars } from '../src/utils/report';
import { daysSummary } from '../src/utils/labels';
import { STRINGS } from '../src/strings';
import type { Weekday } from '../src/engine';

describe('stitched chart bars', () => {
  const byDay = { '2026-11-02': 2, '2026-11-04': 1, '2026-11-10': 3, '2026-11-30': 1 };

  it('a week has one bar per day, named by weekday', () => {
    const bars = stitchedBars(byDay, '2026-11-02', '2026-11-08', 'weekly', 1);
    expect(bars.map(b => b.n)).toEqual([2, 0, 1, 0, 0, 0, 0]);
    expect(bars.map(b => b.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(bars[0].title).toBe('Mon 02/11');
  });

  it('a month has one bar per week, split where her week starts', () => {
    // November 2026 starts on a Sunday; her weeks start on Monday.
    const bars = stitchedBars(byDay, '2026-11-01', '2026-11-30', 'monthly', 1);
    expect(bars.map(b => b.n)).toEqual([0, 3, 3, 0, 0, 1]);
    expect(bars[1].title).toBe(`${STRINGS.reportsWeekNo(2)} (02/11–08/11)`);
  });
});

describe('working days summary', () => {
  const names = STRINGS.dayNamesShort;
  const summary = (...d: number[]) => daysSummary(d as Weekday[], names);

  it('joins three or more days in a row', () => {
    expect(summary(1, 2, 3, 4, 5, 6)).toBe('Mon–Sat');
    expect(summary(0, 1, 2, 3, 4, 5, 6)).toBe('Mon–Sun');
  });
  it('lists days that are apart', () => {
    expect(summary(1, 3, 5)).toBe('Mon, Wed, Fri');
    expect(summary(1, 2, 3, 4, 6)).toBe('Mon–Thu, Sat');
    expect(summary(1, 2)).toBe('Mon, Tue');
  });
});
