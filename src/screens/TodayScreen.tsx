// ============================================================
// Poshakh – Today Screen
// Today's list is the engine's plan for today, one group per customer delivery.
// Then what is waiting to be handed over, then the coming six days folded up
// (she can stitch those early). A search finds any open work she stitched
// outside the list.
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
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { STRINGS } from '../strings';
import { useAppContext } from '../context/AppContext';
import * as DB from '../db/database';
import { addDays, catchUpExtra, toDay, weekdayOf } from '../engine';
import type { CatchUp } from '../engine';
import type { BlouseView, SmallWork } from '../types';
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
import { daysBetween, fmt, fmtLong, fmtRelative, fmtShort } from '../utils/date';
import { blouseLabel, workSummary } from '../utils/labels';
import { collectOnDelivery, partAmounts } from '../utils/order';

/** The list she saw on a day, so the next day we can ask about unticked ones. */
interface SavedList { date: string; ids: number[] }
const LIST_KEY = 'todayList';
const DAYS_AHEAD = 6;
/** Remind her about a backup after this many days. */
const BACKUP_REMINDER_DAYS = 7;

/** One group per delivery, in the order the pieces come. */
function groupByPart(pieces: BlouseView[]): BlouseView[][] {
  const groups = new Map<number, BlouseView[]>();
  for (const p of pieces) groups.set(p.partId, [...(groups.get(p.partId) ?? []), p]);
  return [...groups.values()];
}

export function TodayScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const {
    isReady, today, settings, daysOff, schedule, version, late, willMiss, buildInput, refresh,
  } = useAppContext();
  const [searchOpen, setSearchOpen] = useState(false);
  const [openDay, setOpenDay] = useState<string | null>(null);

  // The engine's plan for today, so a nav-vari gets the day to itself.
  const todayIds = useMemo(() => schedule.today.blouseIds.map(Number), [schedule]);

  // Next six calendar days with their planned work.
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
    const small = DB.loadSmallWorkByPart([...new Set([...views.values()].map(v => v.partId))]);
    const ready = DB.loadReadyParts().map(p => {
      const card = DB.loadOrderDetails(p.orderId);
      return { ...p, collect: card ? collectOnDelivery(card, p.id) : 0 };
    });
    const lastBackup = DB.getLastBackup();
    return {
      doneToday, views, small, ready, saved, unticked, lastBackup,
      remindBackup: DB.hasOrders() && (!lastBackup || daysBetween(lastBackup, today) >= BACKUP_REMINDER_DAYS),
    };
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
  const viewsOf = (ids: number[]) => ids.map(view).filter((v): v is BlouseView => !!v);

  // ── Actions ──────────────────────────────────────────────────
  const markDone = (ids: number[], date = today) => { DB.markBlousesDone(ids, date); refresh(); };
  const undo = (id: number) => { DB.markBlouseUndone(id); refresh(); };

  const skipYesterday = () => {
    DB.setState(LIST_KEY, { date: today, ids: todayIds } satisfies SavedList);
    refresh();
  };

  const deliver = (partId: number, name: string, collect: number) => {
    const money = collect > 0 ? STRINGS.todayCollect(collect) : STRINGS.todayNothingToCollect;
    Alert.alert(STRINGS.todayDeliverConfirm, `${name}\n${money}`, [
      { text: STRINGS.cancel, style: 'cancel' },
      { text: STRINGS.todayMarkDelivered, onPress: () => { DB.setPartDelivered(partId, today); refresh(); } },
    ]);
  };

  // Will-miss parts, one row per customer delivery.
  const missParts = groupByPart(viewsOf(schedule.willMiss.map(Number)));

  const yesterdayDate = data.saved?.date ?? '';
  const rows = (ids: number[], render: (v: BlouseView) => React.ReactNode) =>
    viewsOf(ids).map((v, i) => (
      <View key={v.id}>
        {i > 0 && <Separator />}
        {render(v)}
      </View>
    ));

  /** Today's or a coming day's work, one group per customer delivery. */
  const groups = (ids: number[]) => groupByPart(viewsOf(ids)).map((pieces, i) => (
    <View key={pieces[0].partId}>
      {i > 0 && <Separator />}
      <WorkGroup
        pieces={pieces}
        small={data.small.get(pieces[0].partId) ?? []}
        late={late}
        willMiss={willMiss}
        onDone={id => markDone([id])}
      />
    </View>
  ));

  const backupMessage = data.lastBackup
    ? STRINGS.todayBackupOld(daysBetween(data.lastBackup, today))
    : STRINGS.todayBackupNever;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title={STRINGS.todayTitle}
        subtitle={fmtLong(today)}
        right={<IconButton name="search" label={STRINGS.todaySearchTitle} onPress={() => setSearchOpen(true)} />}
      />
      <ScrollView contentContainerStyle={styles.content}>

        {/* Will miss: the serious warning, on top */}
        {missParts.length > 0 && (
          <Section
            title={`⚠ ${STRINGS.todayWillMissTitle}`}
            subtitle={STRINGS.todayWillMissHint}
            accent={COLORS.danger}
          >
            {missParts.map((bs, i) => (
              <View key={bs[0].partId}>
                {i > 0 && <Separator />}
                <Row style={styles.listRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{bs[0].customerName}</Text>
                    <Text style={styles.sub}>{workSummary(bs)} · {STRINGS.ordersDeliverBy(fmt(bs[0].promisedDelivery))}</Text>
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

        {/* Yesterday's unticked work */}
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
            <Text style={styles.lateText}>{STRINGS.todayLateNote}</Text>
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
          {groups(todayIds)}
          {data.doneToday.length > 0 && (
            <>
              <Separator inset={0} />
              {groupByPart(viewsOf(data.doneToday)).map((pieces, i) => (
                <View key={pieces[0].partId}>
                  {i > 0 && <Separator />}
                  <WorkGroup pieces={pieces} small={[]} done onUndo={undo} />
                </View>
              ))}
            </>
          )}
        </Section>

        {/* To hand over (one row per delivery) */}
        {data.ready.length > 0 && (
          <Section title={STRINGS.todayReadyToDeliver} count={data.ready.length} accent={COLORS.success}>
            {data.ready.map((p, i) => {
              const paid = partAmounts(p).every(a => a.paid);
              return (
                <View key={p.id}>
                  {i > 0 && <Separator />}
                  <View style={styles.listRow}>
                    <Text style={styles.name}>{p.customerName}</Text>
                    <Text style={styles.sub}>{workSummary(p.blouses, p.smallWork)}</Text>
                    <Text style={styles.small}>{STRINGS.ordersDeliverBy(fmt(p.promisedDelivery))}</Text>
                    <Text style={[styles.collect, p.collect === 0 && styles.collectNone]}>
                      {p.collect > 0 ? STRINGS.todayCollect(p.collect) : STRINGS.todayNothingToCollect}
                    </Text>
                    <Actions row style={styles.rowActions}>
                      <Button
                        label={STRINGS.todayMarkDelivered}
                        icon="checkmark-done"
                        size="small"
                        onPress={() => deliver(p.id, p.customerName, p.collect)}
                      />
                      {(paid || p.collect > 0) && (
                        <Button
                          label={paid ? STRINGS.todayPaid : STRINGS.todayMarkPaid}
                          icon={paid ? undefined : 'cash-outline'}
                          size="small"
                          variant={paid ? 'success' : 'secondary'}
                          onPress={() => { DB.setPartPaid(p.id, !paid); refresh(); }}
                        />
                      )}
                    </Actions>
                  </View>
                </View>
              );
            })}
          </Section>
        )}

        {/* Coming days, folded up: tap a day to see its work */}
        <Section title={STRINGS.todayComingDays} subtitle={STRINGS.todayAheadHint}>
          {ahead.map((day, i) => {
            const pieces = viewsOf(day.ids);
            const hasWork = pieces.length > 0;
            const open = hasWork && openDay === day.date;
            const fullDay = pieces.some(p => p.type === 'navvari');
            return (
              <View key={day.date}>
                {i > 0 && <Separator inset={0} />}
                <TouchableOpacity
                  style={styles.dayRow}
                  disabled={!hasWork}
                  activeOpacity={0.7}
                  onPress={() => setOpenDay(o => (o === day.date ? null : day.date))}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.dayTitle, !hasWork && styles.dayTitleEmpty]}>{fmtRelative(day.date, today)}</Text>
                    <Text style={styles.small}>
                      {hasWork
                        ? `${workSummary(pieces)}${fullDay ? ` · ${STRINGS.fullDay}` : ''}`
                        : day.working ? STRINGS.todayNothingPlanned : STRINGS.todayNoStitchDay}
                    </Text>
                  </View>
                  {hasWork && <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={COLORS.textMuted} />}
                </TouchableOpacity>
                {open && <View style={styles.dayOpen}>{groups(day.ids)}</View>}
              </View>
            );
          })}
        </Section>

        {/* Everything lives only on this phone */}
        {data.remindBackup && (
          <Section accent={COLORS.warning}>
            <Text style={styles.lateText}>{backupMessage}</Text>
            <Actions>
              <Button
                label={STRINGS.settingsExportDB}
                icon="cloud-upload-outline"
                size="small"
                variant="secondary"
                onPress={() => navigation.navigate('Settings')}
              />
            </Actions>
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

// ── One customer delivery in a list ───────────────────────────
function WorkGroup({
  pieces, small, late, willMiss, done, onDone, onUndo,
}: {
  pieces: BlouseView[];
  /** Small work on this delivery, so it isn't forgotten. */
  small: SmallWork[];
  late?: Set<number>;
  willMiss?: Set<number>;
  done?: boolean;
  onDone?: (id: number) => void;
  onUndo?: (id: number) => void;
}) {
  const first = pieces[0];
  const missing = pieces.some(p => willMiss?.has(p.id));
  const isLate = pieces.some(p => late?.has(p.id));
  return (
    <View style={[styles.listRow, done && { opacity: 0.55 }]}>
      <Text style={[styles.name, done && styles.doneText]}>{done ? '✓ ' : ''}{first.customerName}</Text>
      <Text style={styles.small}>{STRINGS.ordersDeliverBy(fmt(first.promisedDelivery))}</Text>
      {!done && (first.priority === 'emergency' || missing || isLate) && (
        <Row style={{ flexWrap: 'wrap' }}>
          {first.priority === 'emergency' && <Tag label={STRINGS.emergency} color={COLORS.emergency} />}
          {missing ? <Tag label={STRINGS.todayWillMiss} color={COLORS.danger} />
            : isLate ? <Tag label={STRINGS.todayMightBeLate} color={COLORS.textMuted} /> : null}
        </Row>
      )}
      {pieces.map(p => (
        <Row key={p.id} style={styles.pieceRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.piece}>{blouseLabel(p)}</Text>
            {p.type === 'navvari' && <Tag label={STRINGS.fullDay} color={COLORS.tagGeneral} />}
          </View>
          {done
            ? <Button label={STRINGS.undo} size="small" variant="secondary" onPress={() => onUndo?.(p.id)} />
            : <Button label={STRINGS.todayMarkDone} icon="checkmark" size="small" onPress={() => onDone?.(p.id)} />}
        </Row>
      ))}
      {small.length > 0 && <Text style={styles.smallNote}>+ {workSummary([], small)}</Text>}
    </View>
  );
}

// ── One piece in the search results ───────────────────────────
function SearchRow({
  item, plannedOn, onDone,
}: { item: BlouseView; plannedOn?: string | null; onDone: () => void }) {
  return (
    <Row style={styles.listRow}>
      <View style={styles.rowMain}>
        <Text style={styles.name}>{item.customerName}</Text>
        <Text style={styles.sub}>{blouseLabel(item)}</Text>
        <Text style={styles.small}>
          {STRINGS.ordersDeliverBy(fmt(item.promisedDelivery))}
          {plannedOn ? `  ·  ${STRINGS.todayPlannedOn(fmtShort(plannedOn))}` : ''}
        </Text>
      </View>
      <Button label={STRINGS.todayMarkDone} icon="checkmark" size="small" onPress={onDone} />
    </Row>
  );
}

// ── Search any open work ──────────────────────────────────────
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
            <Text style={styles.searchHint}>{STRINGS.todaySearchHint}</Text>
            <Section>
              {results.length === 0 ? <EmptyState message={STRINGS.todaySearchEmpty} /> : results.map((v, i) => (
                <View key={v.id}>
                  {i > 0 && <Separator />}
                  <SearchRow item={v} plannedOn={stitchDate[String(v.id)]} onDone={() => onDone(v.id)} />
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
  pieceRow: { gap: SPACE.sm, marginTop: SPACE.sm },
  piece: { fontSize: FONT.size, color: COLORS.text, fontWeight: FONT.weightMedium },
  smallNote: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary, marginTop: SPACE.sm },
  collect: { fontSize: FONT.size, fontWeight: FONT.weightBold, color: COLORS.text, marginTop: SPACE.xs },
  collectNone: { fontWeight: FONT.weightMedium, color: COLORS.success },
  lateText: { fontSize: FONT.size, color: COLORS.textSecondary, paddingHorizontal: LAYOUT.inset, paddingTop: SPACE.sm },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: LAYOUT.inset, paddingVertical: LAYOUT.rowY },
  dayTitle: { fontSize: FONT.size, fontWeight: FONT.weightBold, color: COLORS.text },
  dayTitleEmpty: { fontWeight: FONT.weightMedium, color: COLORS.textSecondary },
  dayOpen: { backgroundColor: COLORS.brandTint },
  searchHint: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary, paddingHorizontal: LAYOUT.inset, marginTop: LAYOUT.sectionGap, marginBottom: -SPACE.sm },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: SPACE.md,
    borderRadius: LAYOUT.radius, backgroundColor: COLORS.bgInput, borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, fontSize: FONT.size, paddingVertical: SPACE.md, color: COLORS.text },
});
