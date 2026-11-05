// ============================================================
// Poshakh – Reports Screen
// ============================================================
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STRINGS } from '../strings';
import { useAppContext } from '../context/AppContext';
import * as DB from '../db/database';
import { report } from '../engine';
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

type Period = 'weekly' | 'monthly';

export function ReportsScreen() {
  const insets = useSafeAreaInsets();
  const { isReady, today, settings, version } = useAppContext();
  const [period, setPeriod] = useState<Period>('weekly');
  const [offset, setOffset] = useState(0);

  const [from, to] = period === 'weekly'
    ? weekRange(today, settings.weekStartsOn, offset)
    : monthRange(today, offset);

  const data = useMemo(() => {
    if (!isReady) return null;
    const { parts, blouses } = DB.loadReportRows(from, to);
    const r = report(
      parts.map(p => ({ ...p, id: String(p.id), orderId: String(p.orderId) })),
      blouses.map(b => ({ ...b, id: String(b.id), partId: String(b.partId) })),
      from,
      to,
    );
    // Breakdown of what was handed over in the period.
    const partById = new Map(parts.map(p => [p.id, p]));
    const delivered = blouses.filter(b => {
      const p = partById.get(b.partId);
      return b.status !== 'cancelled' && p && !p.cancelled && p.deliveredOn && p.deliveredOn >= from && p.deliveredOn <= to;
    });
    const count = (f: (b: typeof delivered[number]) => boolean) => delivered.filter(f).length;
    return {
      ...r,
      astar: count(b => b.type === 'astar'),
      designer: count(b => b.type === 'designer'),
      emergency: count(b => partById.get(b.partId)?.priority === 'emergency'),
      general: count(b => partById.get(b.partId)?.priority === 'general'),
      open: DB.countOpenBlouses(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload after every DB write
  }, [isReady, from, to, version]);

  const title = period === 'weekly'
    ? `${fmt(from)} – ${fmt(to)}`
    : `${STRINGS.monthNames[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;

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
          <Section title={STRINGS.reportsDeliveredSection} accent={COLORS.success}>
            <TableRow label={STRINGS.reportsIncome} value={`₹${data.deliveredValue}`} bold />
            <Separator />
            <TableRow label={STRINGS.reportsBlousesDelivered} value={String(data.deliveredCount)} />
            <TableRow label={`   ${STRINGS.reportsAstar}`} value={String(data.astar)} muted />
            <TableRow label={`   ${STRINGS.reportsDesigner}`} value={String(data.designer)} muted />
            <TableRow label={`   ${STRINGS.reportsEmergency}`} value={String(data.emergency)} muted />
            <TableRow label={`   ${STRINGS.reportsGeneral}`} value={String(data.general)} muted />
          </Section>
          <Section title={STRINGS.reportsWorkSection} accent={COLORS.tagGeneral}>
            <TableRow label={STRINGS.reportsStitched} value={`${data.stitchedCount}${period === 'weekly' ? ` / ${settings.weeklyTarget}` : ''}`} bold />
            <Separator />
            <TableRow label={STRINGS.reportsStitchedValue} value={`₹${data.stitchedValue}`} />
            <Separator />
            <TableRow label={STRINGS.reportsOpen} value={String(data.open)} />
          </Section>
          <Section title={STRINGS.reportsDue} accent={COLORS.warning}>
            <TableRow label={STRINGS.reportsDue} value={String(data.dueCount)} bold />
            <Separator />
            <TableRow label={STRINGS.reportsDueValue} value={`₹${data.dueValue}`} />
            <Separator />
            <TableRow label={STRINGS.reportsPendingDue} value={String(data.pendingDueCount)} />
          </Section>
        </>
      ) : (
        <Text style={styles.noData}>{STRINGS.reportsNoData}</Text>
      )}
      </ScrollView>
    </View>
  );
}

function TableRow({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <Row style={[styles.tableRow, muted && { paddingVertical: SPACE.xs }]}>
      <Text style={[styles.tableLabel, bold && { fontWeight: FONT.weightBold }, muted && { color: COLORS.textSecondary }]}>{label}</Text>
      <Text style={[styles.tableValue, bold && { fontWeight: FONT.weightBold, fontSize: FONT.sizeLarge }, muted && { color: COLORS.textSecondary }]}>
        {value}
      </Text>
    </Row>
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
  tableRow: { justifyContent: 'space-between', paddingVertical: LAYOUT.rowY, paddingHorizontal: LAYOUT.inset },
  tableLabel: { fontSize: FONT.size, color: COLORS.text, flex: 1 },
  tableValue: { fontSize: FONT.size, color: COLORS.text, fontWeight: FONT.weightMedium },
  noData: { textAlign: 'center', color: COLORS.textMuted, fontSize: FONT.size, marginTop: SPACE.xxl },
});
