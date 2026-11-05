// ============================================================
// Poshakh – Today Screen
// Today's list is the top of the engine's work queue. Below it, the plan
// for the next six days (she can stitch those early). A search finds any
// open blouse she stitched outside the list.
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { STRINGS } from '../strings';
import { useAppContext } from '../context/AppContext';
import * as DB from '../db/database';
import { addDays, catchUpExtra, toDay, weekdayOf } from '../engine';
import type { CatchUp } from '../engine';
import type { BlouseView } from '../types';
import {
  Actions,
  Button,
  COLORS,
  EmptyState,
  FONT,
  IconButton,
  LAYOUT,
  Loading,
  ModalHeader,
  Row,
  ScreenHeader,
  Section,
  Separator,
  SPACE,
  Tag,
} from '../components/ui';
import { fmt, fmtLong, fmtRelative, fmtShort } from '../utils/date';
import { blouseLabel } from '../utils/labels';

/** The list she saw on a day, so the next day we can ask about unticked ones. */
interface SavedList { date: string; ids: number[] }
const LIST_KEY = 'todayList';
const DAYS_AHEAD = 6;

export function TodayScreen() {
  const insets = useSafeAreaInsets();
  const {
    isReady, today, settings, daysOff, schedule, version, late, willMiss, buildInput, refresh,
  } = useAppContext();
  const [searchOpen, setSearchOpen] = useState(false);

  const queue = useMemo(() => schedule.queue.map(Number), [schedule]);
  const left = Math.max(0, schedule.todayTarget - schedule.doneTodayCount);
  const todayIds = queue.slice(0, left);

  // Next six calendar days with their planned blouses.
  const ahead = useMemo(() => {
    const byDate = new Map(schedule.days.map(d => [d.date, d.blouseIds.map(Number)]));
    const off = new Set(daysOff.map(d => d.date));
    return Array.from({ length: DAYS_AHEAD }, (_, i) => {
      const date = addDays(today, i + 1);
      const working = settings.workingWeekdays.includes(weekdayOf(toDay(date))) && !off.has(date);
      return { date, working, ids: byDate.get(date) ?? [] };
    });
  }, [schedule, today, settings, daysOff]);

  // ── Data that needs the DB (reloaded after every rebuild) ────
  const data = useMemo(() => {
    if (!isReady) return null;
    const doneToday = DB.loadBlouseIdsDoneOn(today);
    const saved = DB.getState<SavedList>(LIST_KEY);
    const needIds = [
      ...todayIds, ...ahead.flatMap(d => d.ids), ...doneToday,
      ...schedule.willMiss.map(Number), ...(saved?.ids ?? []),
    ];
    const views = DB.loadBlouseViews([...new Set(needIds)]);
    const unticked = saved && saved.date < today
      ? saved.ids.filter(id => {
        const v = views.get(id);
        return v && v.status === 'scheduled' && !v.partDeliveredOn;
      })
      : [];
    return { doneToday, views, ready: DB.loadReadyParts(), saved, unticked };
    // `version` changes after every DB write: reload then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, version, ahead]);

  // Remember today's list once yesterday's question is answered.
  useEffect(() => {
    if (!data || data.unticked.length > 0) return;
    DB.setState(LIST_KEY, { date: today, ids: todayIds } satisfies SavedList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Catch-up suggestion after a missed day.
  const catchUp = useMemo<CatchUp | null>(
    () => (isReady && schedule.late.length > 0 ? catchUpExtra(buildInput()) : null),
    [isReady, schedule, buildInput],
  );

  if (!isReady || !data) return <Loading />;
  const view = (id: number) => data.views.get(id);

  // ── Actions ──────────────────────────────────────────────────
  const markDone = (ids: number[], date = today) => { DB.markBlousesDone(ids, date); refresh(); };
  const undo = (id: number) => { DB.markBlouseUndone(id); refresh(); };

  const skipYesterday = () => {
    DB.setState(LIST_KEY, { date: today, ids: todayIds } satisfies SavedList);
    refresh();
  };

  const deliver = (partId: number, name: string) => {
    Alert.alert(STRINGS.todayDeliverConfirm, name, [
      { text: STRINGS.cancel, style: 'cancel' },
      { text: STRINGS.todayMarkDelivered, onPress: () => { DB.setPartDelivered(partId, today); refresh(); } },
    ]);
  };

  // Will-miss parts, one row per customer delivery.
  const missParts = new Map<number, BlouseView[]>();
  for (const id of schedule.willMiss.map(Number)) {
    const v = view(id);
    if (!v) continue;
    missParts.set(v.partId, [...(missParts.get(v.partId) ?? []), v]);
  }

  const yesterdayDate = data.saved?.date ?? '';
  const rows = (ids: number[], render: (v: BlouseView) => React.ReactNode) =>
    ids.map(id => view(id)).filter((v): v is BlouseView => !!v).map((v, i) => (
      <View key={v.id}>
        {i > 0 && <Separator />}
        {render(v)}
      </View>
    ));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title={STRINGS.todayTitle}
        subtitle={fmtLong(today)}
        right={<IconButton name="search" label={STRINGS.todaySearchTitle} onPress={() => setSearchOpen(true)} />}
      />
      <ScrollView contentContainerStyle={styles.content}>

        {/* Will miss: the serious warning, on top */}
        {missParts.size > 0 && (
          <Section
            title={`⚠ ${STRINGS.todayWillMissTitle(schedule.willMiss.length)}`}
            subtitle={STRINGS.todayWillMissHint}
            accent={COLORS.danger}
          >
            {[...missParts.values()].map((bs, i) => (
              <View key={bs[0].partId}>
                {i > 0 && <Separator />}
                <Row style={styles.listRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{bs[0].customerName}</Text>
                    <Text style={styles.sub}>{STRINGS.blouses(bs.length)} · {STRINGS.ordersDeliverBy(fmt(bs[0].promisedDelivery))}</Text>
                  </View>
                  {bs[0].customerPhone ? (
                    <Button
                      label={STRINGS.todayCall}
                      icon="call-outline"
                      size="small"
                      variant="secondary"
                      onPress={() => Linking.openURL(`tel:${bs[0].customerPhone}`)}
                    />
                  ) : null}
                </Row>
              </View>
            ))}
          </Section>
        )}

        {/* Yesterday's unticked blouses */}
        {data.unticked.length > 0 && (
          <Section title={STRINGS.todayYesterdayTitle(fmtShort(yesterdayDate))} accent={COLORS.warning}>
            {rows(data.unticked, v => (
              <Row style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{v.customerName}</Text>
                  <Text style={styles.sub}>{blouseLabel(v)}</Text>
                </View>
                <Button label={STRINGS.todayYesterdayDone} size="small" onPress={() => markDone([v.id], yesterdayDate)} />
              </Row>
            ))}
            <Actions row>
              <Button label={STRINGS.todayYesterdayAllDone} icon="checkmark-done" size="small" onPress={() => markDone(data.unticked, yesterdayDate)} />
              <Button label={STRINGS.todayYesterdayNone} size="small" onPress={skipYesterday} variant="secondary" />
            </Actions>
          </Section>
        )}

        {/* Late: quiet note + catch-up offer */}
        {schedule.late.length > 0 && (
          <Section accent={COLORS.textMuted}>
            <Text style={styles.lateText}>{STRINGS.todayLateNote(schedule.late.length)}</Text>
            {catchUp && (
              <Row style={styles.listRow}>
                <Text style={[styles.lateText, styles.catchUpText]}>
                  {STRINGS.todayCatchUp(catchUp.dayExtras.map(e => `+${e.n} ${fmtShort(e.date)}`).join(', '))}
                </Text>
                <Button
                  label={STRINGS.todayCatchUpYes}
                  size="small"
                  variant="secondary"
                  onPress={() => { DB.addDayExtras(catchUp.dayExtras); refresh(); }}
                />
              </Row>
            )}
          </Section>
        )}

        {/* Today */}
        <Section
          title={STRINGS.todayStitchToday}
          subtitle={schedule.todayTarget > 0
            ? STRINGS.todayDone(schedule.doneTodayCount, schedule.todayTarget)
            : STRINGS.todayDayOff}
          count={todayIds.length}
          accent={COLORS.accent}
        >
          {todayIds.length === 0 && <EmptyState message={STRINGS.todayNothingToday} />}
          {rows(todayIds, v => (
            <BlouseRow item={v} late={late.has(v.id)} willMiss={willMiss.has(v.id)} onDone={() => markDone([v.id])} />
          ))}
          {data.doneToday.length > 0 && (
            <>
              <Separator inset={0} />
              {rows(data.doneToday, v => <BlouseRow item={v} done onUndo={() => undo(v.id)} />)}
            </>
          )}
        </Section>

        {/* Next six days */}
        <Text style={styles.aheadHint}>{STRINGS.todayAheadHint}</Text>
        {ahead.map(day => (
          <Section
            key={day.date}
            title={fmtRelative(day.date, today)}
            subtitle={fmtLong(day.date)}
            count={day.ids.length || undefined}
          >
            {day.ids.length === 0 ? (
              <Text style={styles.dayEmpty}>{day.working ? STRINGS.todayNothingPlanned : STRINGS.todayNoStitchDay}</Text>
            ) : rows(day.ids, v => (
              <BlouseRow item={v} late={late.has(v.id)} willMiss={willMiss.has(v.id)} onDone={() => markDone([v.id])} />
            ))}
          </Section>
        ))}

        {/* Ready to deliver (one row per delivery) */}
        {data.ready.length > 0 && (
          <Section title={STRINGS.todayReadyToDeliver} count={data.ready.length} accent={COLORS.success}>
            {data.ready.map((p, i) => {
              const total = p.blouses.reduce((s, b) => s + b.price, 0);
              const paid = p.blouses.every(b => b.paid);
              return (
                <View key={p.id}>
                  {i > 0 && <Separator />}
                  <View style={styles.listRow}>
                    <Text style={styles.name}>{p.customerName}</Text>
                    <Text style={styles.sub}>
                      {STRINGS.blouses(p.blouses.length)} · ₹{total} · {STRINGS.ordersDeliverBy(fmt(p.promisedDelivery))}
                    </Text>
                    <Actions row style={styles.rowActions}>
                      <Button label={STRINGS.todayMarkDelivered} icon="checkmark-done" size="small" onPress={() => deliver(p.id, p.customerName)} />
                      <Button
                        label={paid ? STRINGS.todayPaid : STRINGS.todayMarkPaid}
                        icon={paid ? undefined : 'cash-outline'}
                        size="small"
                        variant={paid ? 'success' : 'secondary'}
                        onPress={() => { DB.setPartPaid(p.id, !paid); refresh(); }}
                      />
                    </Actions>
                  </View>
                </View>
              );
            })}
          </Section>
        )}
      </ScrollView>

      <SearchModal
        visible={searchOpen}
        stitchDate={schedule.stitchDate}
        version={version}
        onClose={() => setSearchOpen(false)}
        onDone={id => markDone([id])}
      />
    </View>
  );
}

// ── One blouse in a list ──────────────────────────────────────
function BlouseRow({
  item, late, willMiss, done, plannedOn, onDone, onUndo,
}: {
  item: BlouseView;
  late?: boolean;
  willMiss?: boolean;
  done?: boolean;
  plannedOn?: string | null;
  onDone?: () => void;
  onUndo?: () => void;
}) {
  return (
    <Row style={[styles.listRow, done && { opacity: 0.55 }]}>
      <View style={styles.rowMain}>
        <Text style={[styles.name, done && styles.doneText]}>
          {done ? '✓ ' : ''}{item.customerName}
        </Text>
        <Text style={styles.sub}>{blouseLabel(item)} · ₹{item.price}</Text>
        <Text style={styles.small}>
          {STRINGS.ordersDeliverBy(fmt(item.promisedDelivery))}
          {plannedOn ? `  ·  ${STRINGS.todayPlannedOn(fmtShort(plannedOn))}` : ''}
        </Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {item.priority === 'emergency' && <Tag label={STRINGS.emergency} color={COLORS.emergency} />}
          {willMiss ? <Tag label={STRINGS.todayWillMiss} color={COLORS.danger} />
            : late ? <Tag label={STRINGS.todayMightBeLate} color={COLORS.textMuted} /> : null}
        </Row>
      </View>
      {done
        ? <Button label={STRINGS.undo} size="small" variant="secondary" onPress={onUndo ?? (() => {})} />
        : <Button label={STRINGS.todayMarkDone} icon="checkmark" size="small" onPress={onDone ?? (() => {})} />}
    </Row>
  );
}

// ── Search any open blouse ────────────────────────────────────
function SearchModal({
  visible, stitchDate, version, onClose, onDone,
}: {
  visible: boolean;
  stitchDate: Record<string, string | null>;
  version: number;
  onClose: () => void;
  onDone: (id: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    if (!visible) return [];
    const ids = DB.searchOpenBlouseIds(query);
    const views = DB.loadBlouseViews(ids);
    return ids.map(id => views.get(id)).filter((v): v is BlouseView => !!v);
    // `version` changes after every DB write: search again then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, query, version]);

  const close = () => { setQuery(''); onClose(); };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <ModalHeader onBack={close}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={20} color={COLORS.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder={STRINGS.todaySearchPlaceholder}
                placeholderTextColor={COLORS.textMuted}
                autoFocus
              />
            </View>
          </ModalHeader>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.aheadHint}>{STRINGS.todaySearchHint}</Text>
            <Section>
              {results.length === 0 ? <EmptyState message={STRINGS.todaySearchEmpty} /> : results.map((v, i) => (
                <View key={v.id}>
                  {i > 0 && <Separator />}
                  <BlouseRow item={v} plannedOn={stitchDate[String(v.id)]} onDone={() => onDone(v.id)} />
                </View>
              ))}
            </Section>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgLight },
  content: { paddingBottom: LAYOUT.screenBottom },
  listRow: { paddingHorizontal: LAYOUT.inset, paddingVertical: LAYOUT.rowY },
  rowMain: { flex: 1, paddingRight: SPACE.sm },
  rowActions: { paddingHorizontal: 0, paddingBottom: 0 },
  catchUpText: { flex: 1, paddingHorizontal: 0, paddingTop: 0, paddingRight: SPACE.sm },
  name: { fontSize: FONT.sizeLarge, fontWeight: FONT.weightBold, color: COLORS.text },
  doneText: { textDecorationLine: 'line-through' },
  sub: { fontSize: FONT.size, color: COLORS.textSecondary, marginTop: 2 },
  small: { fontSize: FONT.sizeSmall, color: COLORS.textMuted, marginTop: 2 },
  lateText: { fontSize: FONT.size, color: COLORS.textSecondary, paddingHorizontal: LAYOUT.inset, paddingTop: SPACE.sm },
  /** Note between panels: sits in the gutter, just above the next panel. */
  aheadHint: {
    fontSize: FONT.sizeSmall, color: COLORS.textSecondary,
    paddingHorizontal: LAYOUT.inset, marginTop: LAYOUT.sectionGap, marginBottom: -SPACE.sm,
  },
  dayEmpty: { fontSize: FONT.size, color: COLORS.textMuted, paddingHorizontal: LAYOUT.inset, paddingVertical: LAYOUT.rowY },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: SPACE.md,
    borderRadius: LAYOUT.radius, backgroundColor: COLORS.bgInput, borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, fontSize: FONT.size, paddingVertical: SPACE.md, color: COLORS.text },
});
