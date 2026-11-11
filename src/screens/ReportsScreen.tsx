// ============================================================
// Poshakh – Reports
// Top to bottom, from what matters most:
//   1. Money earned in the period, next to the period before
//   2. Four numbers: stitched, delivered, due, still to stitch
//   3. A bar chart of how much was stitched each day (or week)
//   4. What kind of work was delivered
// Charts are plain views: one colour (the brand plum), thin bars, tap a bar
// to read its number.
// ============================================================
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { STRINGS } from '../strings';
import { useAppContext } from '../context/AppContext';
import * as DB from '../db/database';
import {
  Button,
  COLORS,
  FONT,
  LAYOUT,
  Row,
  ScreenHeader,
  Section,
  Segmented,
  Separator,
  SPACE,
} from '../components/ui';
import { fmt, monthRange, weekRange } from '../utils/date';
import { workLabel } from '../utils/labels';
import { stitchedBars, workReport, type ChartBar } from '../utils/report';

type Period = 'weekly' | 'monthly';

export function ReportsScreen() {
  const insets = useSafeAreaInsets();
  const { isReady, today, settings, version } = useAppContext();
  const [period, setPeriod] = useState<Period>('weekly');
  const [offset, setOffset] = useState(0);

  const range = (o: number) => (period === 'weekly' ? weekRange(today, settings.weekStartsOn, o) : monthRange(today, o));
  const [from, to] = range(offset);
  const [prevFrom, prevTo] = range(offset - 1);

  const data = useMemo(() => {
    if (!isReady) return null;
    const now = workReport(DB.loadReportRows(from, to), from, to);
    const before = workReport(DB.loadReportRows(prevFrom, prevTo), prevFrom, prevTo);
    return {
      ...now,
      prevIncome: before.income,
      open: DB.countOpenBlouses(),
      bars: stitchedBars(now.stitchedByDay, from, to, period, settings.weekStartsOn),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload after every DB write
  }, [isReady, from, to, prevFrom, prevTo, period, settings.weekStartsOn, version]);

  const title = period === 'weekly'
    ? `${fmt(from)} – ${fmt(to)}`
    : `${STRINGS.monthNames[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;

  const workingDays = settings.workingWeekdays.length;
  // The weekly target only means something when no nav-vari (a whole day) is in the count.
  const showTarget = period === 'weekly' && !data?.anyNavvariStitched;
  const barTarget = period === 'weekly'
    ? (workingDays > 0 ? settings.weeklyTarget / workingDays : undefined)
    : settings.weeklyTarget;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title={STRINGS.reportsTitle} />
      <View style={styles.toolbar}>
        <Segmented
          value={period}
          onChange={p => { setPeriod(p); setOffset(0); }}
          options={[
            { value: 'weekly', label: STRINGS.reportsWeekly },
            { value: 'monthly', label: STRINGS.reportsMonthly },
          ]}
        />
        <Row style={styles.navRow}>
          <Button label={STRINGS.reportsPrev} icon="chevron-back" size="small" variant="secondary" onPress={() => setOffset(o => o - 1)} />
          <Text style={styles.periodLabel}>{title}</Text>
          <Button label={STRINGS.reportsNext} icon="chevron-forward" iconRight size="small" variant="secondary" onPress={() => setOffset(o => o + 1)} />
        </Row>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {data ? (
          <>
            <IncomeCard
              income={data.income}
              fromStitching={data.income - data.smallDelivered}
              fromSmall={data.smallDelivered}
              prev={data.prevIncome}
              prevLabel={period === 'weekly' ? STRINGS.reportsLastWeek : STRINGS.reportsLastMonth}
            />

            <View style={styles.tiles}>
              <StatTile
                icon="cut-outline"
                label={STRINGS.reportsTileStitched}
                value={String(data.stitchedCount)}
                note={`₹${data.stitchedValue}`}
                progress={showTarget ? { done: data.stitchedCount, target: settings.weeklyTarget } : undefined}
              />
              <StatTile
                icon="checkmark-done-outline"
                label={STRINGS.reportsTileDelivered}
                value={String(data.deliveredCount)}
                note={`₹${data.income}`}
              />
              <StatTile
                icon="calendar-outline"
                label={STRINGS.reportsTileDue}
                value={String(data.dueCount)}
                note={data.dueCount === 0 ? `₹${data.dueValue}`
                  : data.pendingDueCount > 0 ? STRINGS.reportsDueNotReady(data.pendingDueCount) : STRINGS.reportsDueAllReady}
                noteColor={data.dueCount === 0 ? undefined : data.pendingDueCount > 0 ? COLORS.warning : COLORS.success}
              />
              <StatTile
                icon="hourglass-outline"
                label={STRINGS.reportsTileOpen}
                value={String(data.open)}
              />
            </View>

            <Section
              title={period === 'weekly' ? STRINGS.reportsChartDaily : STRINGS.reportsChartWeekly}
              count={data.stitchedCount}
            >
              {data.stitchedCount === 0
                ? <Text style={styles.empty}>{STRINGS.reportsNothingStitched}</Text>
                : <BarChart key={`${from}|${period}`} bars={data.bars} target={barTarget} today={today} />}
            </Section>

            {data.deliveredCount > 0 && (
              <Section title={STRINGS.reportsWhatDelivered} count={data.deliveredCount}>
                <HBars
                  rows={data.byType.map(x => ({ key: x.type, label: workLabel(x.type), n: x.n }))}
                  max={Math.max(...data.byType.map(x => x.n))}
                />
                <Separator />
                <HBars
                  rows={[
                    { key: 'emergency', label: STRINGS.reportsEmergency, n: data.emergency },
                    { key: 'general', label: STRINGS.reportsGeneral, n: data.general },
                  ]}
                  max={data.deliveredCount}
                />
              </Section>
            )}
          </>
        ) : (
          <Text style={styles.empty}>{STRINGS.reportsNoData}</Text>
        )}
      </ScrollView>
    </View>
  );
}

// ── Income ────────────────────────────────────────────────────
function IncomeCard({
  income, fromStitching, fromSmall, prev, prevLabel,
}: { income: number; fromStitching: number; fromSmall: number; prev: number; prevLabel: (n: number) => string }) {
  const diff = income - prev;
  const trend = diff > 0 ? { icon: 'arrow-up' as const, color: COLORS.success }
    : diff < 0 ? { icon: 'arrow-down' as const, color: COLORS.danger }
      : { icon: 'remove' as const, color: COLORS.textMuted };
  const both = fromStitching > 0 && fromSmall > 0;
  return (
    <Section accent={COLORS.success}>
      <View style={styles.income}>
        <Text style={styles.incomeLabel}>{STRINGS.reportsIncome}</Text>
        <Text style={styles.incomeValue}>₹{income.toLocaleString('en-IN')}</Text>
        <Row style={styles.trend}>
          <Ionicons name={trend.icon} size={16} color={trend.color} />
          {diff !== 0 && <Text style={[styles.trendDiff, { color: trend.color }]}>₹{Math.abs(diff).toLocaleString('en-IN')}</Text>}
          <Text style={styles.trendPrev}>{prevLabel(prev)}</Text>
        </Row>
        {both && (
          <>
            {/* Where the money came from: two segments with a small gap, named below. */}
            <View style={styles.split}>
              <View style={[styles.splitPart, { flex: fromStitching, backgroundColor: COLORS.brand }]} />
              <View style={[styles.splitPart, { flex: fromSmall, backgroundColor: COLORS.brandRose }]} />
            </View>
            <Row style={styles.legend}>
              <Legend color={COLORS.brand} label={STRINGS.reportsFromStitching} value={fromStitching} />
              <Legend color={COLORS.brandRose} label={STRINGS.reportsFromSmall} value={fromSmall} />
            </Row>
          </>
        )}
      </View>
    </Section>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <Row style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={styles.legendText} numberOfLines={2}>{label} <Text style={styles.legendValue}>₹{value.toLocaleString('en-IN')}</Text></Text>
    </Row>
  );
}

// ── A number in a tile ────────────────────────────────────────
function StatTile({
  icon, label, value, note, noteColor, progress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  note?: string;
  noteColor?: string;
  progress?: { done: number; target: number };
}) {
  const pct = progress && progress.target > 0 ? Math.min(1, progress.done / progress.target) : 0;
  const reached = !!progress && progress.done >= progress.target;
  return (
    <View style={styles.tile}>
      <Row style={styles.tileHead}>
        <Ionicons name={icon} size={18} color={COLORS.accent} />
        <Text style={styles.tileLabel} numberOfLines={2}>{label}</Text>
      </Row>
      <Text style={styles.tileValue}>{value}</Text>
      {progress && (
        <>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${pct * 100}%`, backgroundColor: reached ? COLORS.success : COLORS.brand }]} />
          </View>
          <Text style={styles.tileNote}>{STRINGS.reportsOfTarget(progress.done, progress.target)}</Text>
        </>
      )}
      {note ? <Text style={[styles.tileNote, noteColor ? { color: noteColor, fontWeight: FONT.weightMedium } : null]}>{note}</Text> : null}
    </View>
  );
}

// ── Vertical bars: stitched per day / week ────────────────────
const CHART_HEIGHT = 140;

function BarChart({ bars, target, today }: { bars: ChartBar[]; target?: number; today: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const top = Math.max(1, ...bars.map(b => b.n), target ?? 0) * 1.15;
  const sel = bars.find(b => b.key === selected);
  const targetY = target ? (target / top) * CHART_HEIGHT : null;

  return (
    <View style={styles.chart}>
      <Text style={[styles.chartCaption, sel && styles.chartCaptionOn]}>
        {sel ? STRINGS.reportsBarValue(sel.title, sel.n) : STRINGS.reportsTapBar}
      </Text>
      <View style={styles.plot}>
        {targetY !== null && (
          <View style={[styles.targetLine, { bottom: targetY }]} pointerEvents="none">
            <Text style={styles.targetText}>{Number.isInteger(target) ? target : target!.toFixed(1)}</Text>
          </View>
        )}
        {bars.map(b => {
          const on = b.key === selected;
          const h = b.n > 0 ? Math.max(4, (b.n / top) * CHART_HEIGHT) : 2;
          return (
            <TouchableOpacity
              key={b.key}
              style={styles.barCol}
              onPress={() => setSelected(on ? null : b.key)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={STRINGS.reportsBarValue(b.title, b.n)}
            >
              {on && <Text style={styles.barValue}>{b.n}</Text>}
              <View
                style={[
                  styles.bar,
                  { height: h, backgroundColor: b.n === 0 ? COLORS.border : COLORS.brand },
                  selected && !on && b.n > 0 && { opacity: 0.35 },
                ]}
              />
            </TouchableOpacity>
          );
        })}
      </View>
      <Row style={styles.axis}>
        {bars.map(b => (
          <Text key={b.key} style={[styles.axisLabel, b.key === today && styles.axisToday]} numberOfLines={1}>{b.label}</Text>
        ))}
      </Row>
    </View>
  );
}

// ── Horizontal bars: count by kind ────────────────────────────
function HBars({ rows, max }: { rows: { key: string; label: string; n: number }[]; max: number }) {
  return (
    <View style={styles.hbars}>
      {rows.map(r => (
        <Row key={r.key} style={styles.hbarRow}>
          <Text style={styles.hbarLabel} numberOfLines={1}>{r.label}</Text>
          <View style={styles.hbarTrack}>
            <View style={[styles.hbarFill, { width: `${max > 0 ? (r.n / max) * 100 : 0}%` }]} />
          </View>
          <Text style={styles.hbarValue}>{r.n}</Text>
        </Row>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgLight },
  content: { paddingBottom: LAYOUT.screenBottom },
  toolbar: {
    gap: SPACE.sm, padding: LAYOUT.gutter, backgroundColor: COLORS.bg,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  navRow: { justifyContent: 'space-between', alignItems: 'center', gap: SPACE.sm },
  periodLabel: { fontSize: FONT.size, color: COLORS.text, fontWeight: FONT.weightBold, flex: 1, textAlign: 'center' },
  empty: { textAlign: 'center', color: COLORS.textMuted, fontSize: FONT.size, paddingVertical: SPACE.xl, paddingHorizontal: LAYOUT.inset },

  income: { paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.sm },
  incomeLabel: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary, fontWeight: FONT.weightMedium },
  incomeValue: { fontSize: 34, fontWeight: FONT.weightBold, color: COLORS.text, marginTop: 2 },
  trend: { gap: SPACE.xs, marginTop: SPACE.xs },
  trendDiff: { fontSize: FONT.sizeSmall, fontWeight: FONT.weightBold },
  trendPrev: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary },
  split: { flexDirection: 'row', gap: 2, height: 10, marginTop: SPACE.md, borderRadius: 4, overflow: 'hidden' },
  splitPart: { height: '100%' },
  legend: { flexWrap: 'wrap', gap: SPACE.md, marginTop: SPACE.sm },
  legendItem: { gap: SPACE.xs, flexShrink: 1 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary, flexShrink: 1 },
  legendValue: { color: COLORS.text, fontWeight: FONT.weightBold },

  tiles: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: SPACE.sm,
    marginHorizontal: LAYOUT.gutter, marginTop: LAYOUT.sectionGap,
  },
  tile: {
    width: '48.5%', padding: SPACE.md, gap: SPACE.xs,
    backgroundColor: COLORS.bg, borderRadius: LAYOUT.radius, borderWidth: 1, borderColor: COLORS.border,
  },
  tileHead: { gap: SPACE.xs, alignItems: 'flex-start' },
  tileLabel: { flex: 1, fontSize: FONT.sizeSmall, color: COLORS.textSecondary, fontWeight: FONT.weightMedium },
  tileValue: { fontSize: 28, fontWeight: FONT.weightBold, color: COLORS.text },
  tileNote: { fontSize: FONT.sizeXSmall, color: COLORS.textSecondary },
  progressBg: { height: 6, borderRadius: 3, backgroundColor: COLORS.separator, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },

  chart: { paddingHorizontal: LAYOUT.inset, paddingBottom: SPACE.sm },
  chartCaption: { fontSize: FONT.sizeSmall, color: COLORS.textMuted, paddingVertical: SPACE.xs },
  chartCaptionOn: { color: COLORS.text, fontWeight: FONT.weightBold },
  plot: {
    height: CHART_HEIGHT + SPACE.lg, flexDirection: 'row', alignItems: 'flex-end',
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  targetLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: COLORS.textMuted, opacity: 0.6 },
  targetText: { position: 'absolute', right: 0, bottom: 2, fontSize: FONT.sizeXSmall, color: COLORS.textSecondary },
  barCol: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '55%', maxWidth: 28, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barValue: { fontSize: FONT.sizeSmall, fontWeight: FONT.weightBold, color: COLORS.text, marginBottom: 2 },
  axis: { paddingTop: SPACE.xs },
  axisLabel: { flex: 1, textAlign: 'center', fontSize: FONT.sizeXSmall, color: COLORS.textMuted },
  axisToday: { color: COLORS.text, fontWeight: FONT.weightBold },

  hbars: { paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.xs, gap: SPACE.sm },
  hbarRow: { gap: SPACE.sm },
  hbarLabel: { width: 120, fontSize: FONT.sizeSmall, color: COLORS.text },
  hbarTrack: { flex: 1, height: 10, borderRadius: 4, backgroundColor: COLORS.bgInput, overflow: 'hidden' },
  hbarFill: { height: '100%', borderRadius: 4, backgroundColor: COLORS.brand },
  hbarValue: { minWidth: 24, textAlign: 'right', fontSize: FONT.sizeSmall, fontWeight: FONT.weightBold, color: COLORS.text },
});
