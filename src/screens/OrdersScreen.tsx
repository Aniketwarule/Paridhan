// ============================================================
// Poshakh – Orders Screen  (Pending | Ready | Delivered)
// An order has one delivery (part) or two (emergency + general).
// ============================================================
import React, { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { STRINGS } from '../strings';
import { useAppContext } from '../context/AppContext';
import * as DB from '../db/database';
import { addDays, checkPartDateChange } from '../engine';
import type { Priority } from '../engine';
import type { Blouse, OrderStatus, OrderWithDetails, PartWithBlouses } from '../types';
import {
  Actions,
  Button,
  Card,
  COLORS,
  DateField,
  EmptyState,
  FONT,
  LAYOUT,
  Loading,
  ModalHeader,
  NumberInput,
  NumericTextInput,
  Row,
  ScreenHeader,
  Section,
  Segmented,
  Separator,
  SPACE,
  Tag,
} from '../components/ui';
import { fmt, fmtShort } from '../utils/date';
import { blouseLabel } from '../utils/labels';
import { cardMoney, matchesOrderNo, orderNo } from '../utils/order';
import { OrderBillModal } from '../components/OrderBill';

const liveBlouses = (p: PartWithBlouses) => (p.cancelled ? [] : p.blouses.filter(b => b.status !== 'cancelled'));

export function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const { isReady, version, lateParts, willMissParts } = useAppContext();
  const [tab, setTab] = useState<OrderStatus>('pending');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const orders = useMemo(
    () => (isReady ? DB.loadOrdersWithDetails(tab) : []),
    // `version` changes after every DB write: reload then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isReady, tab, version],
  );
  const q = search.trim().toLowerCase();
  const filtered = orders.filter(o =>
    !q || matchesOrderNo(o.order.id, q) || o.customer.name.toLowerCase().includes(q) || (o.customer.phone ?? '').includes(q)
    || o.parts.some(p => p.blouses.some(b => (b.name ?? '').toLowerCase().includes(q))));

  if (!isReady) return <Loading />;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title={STRINGS.ordersTitle} />

      <View style={styles.toolbar}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'pending', label: STRINGS.ordersPending },
            { value: 'ready', label: STRINGS.ordersReady },
            { value: 'delivered', label: STRINGS.ordersDelivered },
          ]}
        />
        <View style={styles.searchBox}>
          <Ionicons name="search" size={20} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={STRINGS.ordersSearch}
            placeholderTextColor={COLORS.textMuted}
          />
        </View>
      </View>

      {filtered.length === 0 ? (
        <EmptyState message={STRINGS.ordersNoResults} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.order.id)}
          contentContainerStyle={{ paddingBottom: LAYOUT.screenBottom }}
          renderItem={({ item }) => (
            <OrderSummaryCard
              card={item}
              late={item.parts.some(p => lateParts.has(p.id))}
              willMiss={item.parts.some(p => willMissParts.has(p.id))}
              onPress={() => setSelectedId(item.order.id)}
            />
          )}
        />
      )}

      <Modal visible={selectedId !== null} animationType="slide" onRequestClose={() => setSelectedId(null)}>
        {selectedId !== null && <OrderDetail orderId={selectedId} onClose={() => setSelectedId(null)} />}
      </Modal>
    </View>
  );
}

// ── Summary card ──────────────────────────────────────────────
function OrderSummaryCard({
  card, late, willMiss, onPress,
}: { card: OrderWithDetails; late: boolean; willMiss: boolean; onPress: () => void }) {
  const active = card.parts.flatMap(liveBlouses);
  const total = active.reduce((s, b) => s + b.price, 0);
  const dates = card.parts.filter(p => !p.cancelled).map(p => fmt(p.promisedDelivery));
  const hasEmergency = card.parts.some(p => !p.cancelled && p.priority === 'emergency');

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <Card style={[willMiss && { borderLeftWidth: 5, borderLeftColor: COLORS.danger }]}>
        <Row>
          <View style={{ flex: 1 }}>
            <Row style={styles.cTop}>
              <Text style={styles.cNo}>{orderNo(card.order.id)}</Text>
              <Text style={styles.cDate}>{fmt(card.order.createdAt.slice(0, 10))}</Text>
            </Row>
            <Text style={styles.cName}>{card.customer.name}</Text>
            {card.customer.phone ? <Text style={styles.cPhone}>{card.customer.phone}</Text> : null}
            <Text style={styles.cSub}>{STRINGS.blouses(active.length)} · ₹{total}</Text>
            <Text style={styles.cSub}>{STRINGS.ordersDeliverBy(dates.join(' / ') || '—')}</Text>
            <Row style={styles.tags}>
              {hasEmergency && <Tag label={STRINGS.emergency} color={COLORS.emergency} />}
              {willMiss ? <Tag label={STRINGS.todayWillMiss} color={COLORS.danger} />
                : late ? <Tag label={STRINGS.todayMightBeLate} color={COLORS.textMuted} /> : null}
            </Row>
          </View>
          <Ionicons name="chevron-forward" size={24} color={COLORS.textMuted} />
        </Row>
      </Card>
    </TouchableOpacity>
  );
}

// ── Detail ────────────────────────────────────────────────────
function OrderDetail({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { today, daysOff, version, schedule, late, willMiss, buildInput, refresh } = useAppContext();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload after every DB write
  const card = useMemo(() => DB.loadOrderDetails(orderId), [orderId, version]);
  const [billOpen, setBillOpen] = useState(false);

  if (!card) return null;
  const money = cardMoney(card);
  const open = card.order.status === 'pending' || card.order.status === 'ready';

  const handleCancel = () => {
    Alert.alert(STRINGS.ordersCancelTitle, STRINGS.ordersCancelConfirm, [
      { text: STRINGS.cancel, style: 'cancel' },
      { text: STRINGS.ordersCancel, style: 'destructive', onPress: () => { DB.cancelOrder(orderId); refresh(); onClose(); } },
    ]);
  };

  /** Check with the engine before moving a promised date. */
  const moveDate = (part: PartWithBlouses, date: string, priority?: Priority): boolean => {
    const res = checkPartDateChange(buildInput(), String(part.id), date, priority);
    const save = (d: string) => { DB.updatePartDate(part.id, d, priority); refresh(); };
    if (res.ok) { save(date); return true; }

    const buttons: { text: string; style?: 'cancel'; onPress?: () => void }[] = [{ text: STRINGS.cancel, style: 'cancel' }];
    if (res.extraNeeded) {
      const x = res.extraNeeded;
      buttons.push({ text: STRINGS.takeExtra(x.n, fmtShort(x.weekStart)), onPress: () => { DB.addWeekExtra(x); save(date); } });
    }
    if (res.nearestValid) {
      const d = res.nearestValid;
      buttons.push({ text: STRINGS.pickNearest(fmt(d)), onPress: () => save(d) });
    }
    Alert.alert(STRINGS.ordersDateNotPossible, STRINGS.reason[res.reason ?? 'full'], buttons);
    return false;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ModalHeader
        title={card.customer.name}
        subtitle={STRINGS.ordersNumber(orderNo(card.order.id), fmt(card.order.createdAt.slice(0, 10)))}
        onBack={onClose}
        right={card.order.status !== 'cancelled' ? (
          <Button label={STRINGS.billButton} icon="receipt-outline" size="small" onPress={() => setBillOpen(true)} />
        ) : undefined}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: LAYOUT.screenBottom }}>
        <Section>
          <Row style={styles.infoRow}>
            <View>
              <Text style={styles.infoLabel}>{STRINGS.ordersTotal(money.total)}</Text>
              <Text style={styles.infoValue}>{STRINGS.ordersBalance(money.balance)}</Text>
            </View>
            {card.customer.phone ? <Text style={styles.infoValue}>📞 {card.customer.phone}</Text> : null}
          </Row>
        </Section>

        <MoneySection
          key={`${card.order.advance}|${card.order.previousDue}`}
          advance={card.order.advance}
          previousDue={card.order.previousDue}
          onSave={m => { DB.updateOrderMoney(orderId, m); refresh(); }}
        />

        {card.parts.map(part => (
          <PartSection
            key={part.id}
            part={part}
            today={today}
            offDates={daysOff.map(d => d.date)}
            stitchDate={schedule.stitchDate}
            late={late}
            willMiss={willMiss}
            onMove={moveDate}
            onDelivered={d => { DB.setPartDelivered(part.id, d); refresh(); }}
            onDone={b => { DB.markBlousesDone([b.id], today); refresh(); }}
            onUndo={b => { DB.markBlouseUndone(b.id); refresh(); }}
            onPrice={(b, price) => { DB.updateBlousePrice(b.id, price); refresh(); }}
          />
        ))}

        <Actions page>
          {card.order.status !== 'cancelled' && (
            <Button label={STRINGS.billShareOrSend} icon="receipt-outline" onPress={() => setBillOpen(true)} />
          )}
          {open && <Button label={STRINGS.ordersCancel} icon="close-circle-outline" onPress={handleCancel} variant="danger" />}
        </Actions>
      </ScrollView>

      {billOpen && <OrderBillModal card={card} onClose={() => setBillOpen(false)} />}
    </View>
  );
}

/** Advance received and old balance: two plain numbers, saved together. */
function MoneySection({
  advance, previousDue, onSave,
}: { advance: number; previousDue: number; onSave: (m: { advance: number; previousDue: number }) => void }) {
  const [a, setA] = useState(advance);
  const [p, setP] = useState(previousDue);
  const dirty = a !== advance || p !== previousDue;
  return (
    <Section title={STRINGS.moneyTitle} subtitle={STRINGS.moneyHint}>
      <NumberInput label={STRINGS.moneyAdvance} value={a} onChangeValue={setA} />
      <NumberInput label={STRINGS.moneyPreviousDue} value={p} onChangeValue={setP} />
      {dirty && (
        <Actions row>
          <Button label={STRINGS.save} icon="save-outline" size="small" onPress={() => onSave({ advance: a, previousDue: p })} />
          <Button label={STRINGS.cancel} size="small" variant="secondary" onPress={() => { setA(advance); setP(previousDue); }} />
        </Actions>
      )}
    </Section>
  );
}

function PartSection({
  part, today, offDates, stitchDate, late, willMiss, onMove, onDelivered, onDone, onUndo, onPrice,
}: {
  part: PartWithBlouses;
  today: string;
  offDates: string[];
  stitchDate: Record<string, string | null>;
  late: Set<number>;
  willMiss: Set<number>;
  onMove: (p: PartWithBlouses, date: string, priority?: Priority) => boolean;
  onDelivered: (date: string | null) => void;
  onDone: (b: Blouse) => void;
  onUndo: (b: Blouse) => void;
  onPrice: (b: Blouse, price: number) => void;
}) {
  const [moving, setMoving] = useState(false);
  const [editDate, setEditDate] = useState(part.promisedDelivery);
  const [editPriority, setEditPriority] = useState<Priority>(part.priority);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState(0);

  const delivered = !!part.deliveredOn;
  const editable = !part.cancelled && !delivered;
  const emergency = part.priority === 'emergency';

  const startMove = () => { setEditDate(part.promisedDelivery); setEditPriority(part.priority); setMoving(true); };
  const saveMove = () => {
    const pr = editPriority !== part.priority ? editPriority : undefined;
    if (onMove(part, editDate, pr)) setMoving(false);
  };

  return (
    <Section
      title={emergency ? `⚡ ${STRINGS.emergencyDelivery}` : `📅 ${STRINGS.generalDelivery}`}
      subtitle={delivered ? STRINGS.ordersDeliveredOn(fmt(part.deliveredOn)) : STRINGS.ordersDeliverBy(fmt(part.promisedDelivery))}
      count={liveBlouses(part).length}
      accent={part.cancelled ? COLORS.textMuted : delivered ? COLORS.success : emergency ? COLORS.emergency : COLORS.tagGeneral}
    >
      {/* Delivery actions */}
      {moving ? (
        <View>
          <DateField
            label={STRINGS.ordersNewDate}
            value={editDate}
            onChange={setEditDate}
            minDate={addDays(today, 1)}
            offDates={offDates}
          />
          <Segmented
            style={styles.segment}
            value={editPriority}
            onChange={setEditPriority}
            options={[
              { value: 'general', label: STRINGS.general },
              { value: 'emergency', label: STRINGS.emergency },
            ]}
          />
          <Actions row>
            <Button label={STRINGS.save} size="small" onPress={saveMove} />
            <Button label={STRINGS.cancel} size="small" onPress={() => setMoving(false)} variant="secondary" />
          </Actions>
        </View>
      ) : delivered ? (
        <Actions row>
          <Button label={STRINGS.ordersUndoDelivered} icon="arrow-undo-outline" size="small" variant="secondary" onPress={() => onDelivered(null)} />
        </Actions>
      ) : editable ? (
        <Actions row>
          <Button label={STRINGS.ordersMarkDelivered} icon="checkmark-done" size="small" onPress={() => onDelivered(today)} />
          <Button label={STRINGS.ordersChangeDate} icon="calendar-outline" size="small" variant="secondary" onPress={startMove} />
        </Actions>
      ) : (
        <View style={styles.cancelledTag}><Tag label={STRINGS.ordersStatus.cancelled} color={COLORS.textMuted} /></View>
      )}

      {part.blouses.map(item => {
        const isCancelled = item.status === 'cancelled' || part.cancelled;
        const planned = stitchDate[String(item.id)];
        return (
          <View key={item.id} style={isCancelled && { opacity: 0.4 }}>
            <Separator inset={0} />
            <View style={styles.blouseRow}>
              <Row>
                <Text style={styles.itemType}>{blouseLabel(item)}</Text>
                <Text style={[styles.itemStatus, { color: statusColor(item.status) }]}>
                  {STRINGS.ordersStatus[item.status]}
                </Text>
              </Row>
              <Row style={{ flexWrap: 'wrap' }}>
                {willMiss.has(item.id) ? <Tag label={STRINGS.todayWillMiss} color={COLORS.danger} />
                  : late.has(item.id) ? <Tag label={STRINGS.todayMightBeLate} color={COLORS.textMuted} /> : null}
              </Row>

              {editingId === item.id ? (
                <Row style={styles.itemLine}>
                  <NumericTextInput style={styles.editInput} value={editPrice} min={1} onChangeValue={setEditPrice} autoFocus />
                  <Button label={STRINGS.save} size="small" onPress={() => { if (editPrice > 0) onPrice(item, editPrice); setEditingId(null); }} />
                  <Button label={STRINGS.cancel} size="small" variant="secondary" onPress={() => setEditingId(null)} />
                </Row>
              ) : (
                <Row style={styles.itemLine}>
                  <Text style={styles.itemPrice}>₹{item.price}{item.paid || delivered ? `   ${STRINGS.todayPaid}` : ''}</Text>
                  {!isCancelled && (
                    <Button
                      label={STRINGS.ordersEditPrice}
                      icon="create-outline"
                      size="small"
                      variant="ghost"
                      onPress={() => { setEditingId(item.id); setEditPrice(item.price); }}
                    />
                  )}
                </Row>
              )}

              {item.status === 'done' ? (
                <Row style={styles.itemLine}>
                  <Text style={[styles.itemDate, { flex: 1 }]}>{STRINGS.ordersStitchedOn(fmt(item.doneDate))}</Text>
                  {!delivered && <Button label={STRINGS.undo} size="small" variant="secondary" onPress={() => onUndo(item)} />}
                </Row>
              ) : !isCancelled && !delivered ? (
                <Row style={styles.itemLine}>
                  <Text style={[styles.itemDate, { flex: 1 }]}>{STRINGS.ordersScheduledFor(fmtShort(planned))}</Text>
                  <Button label={STRINGS.ordersMarkDone} icon="checkmark" size="small" onPress={() => onDone(item)} />
                </Row>
              ) : null}
            </View>
          </View>
        );
      })}
    </Section>
  );
}

function statusColor(status: string) {
  if (status === 'done') return COLORS.success;
  if (status === 'cancelled') return COLORS.textMuted;
  return COLORS.textSecondary;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgLight },
  toolbar: {
    gap: SPACE.sm, padding: LAYOUT.gutter, backgroundColor: COLORS.bg,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: SPACE.md,
    borderRadius: LAYOUT.radius, backgroundColor: COLORS.bgInput, borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, fontSize: FONT.size, paddingVertical: SPACE.md, color: COLORS.text },
  tags: { flexWrap: 'wrap', marginTop: SPACE.xs },
  cTop: { justifyContent: 'space-between', marginBottom: 2 },
  cNo: { fontSize: FONT.sizeSmall, fontWeight: FONT.weightBold, color: COLORS.tagGeneral, letterSpacing: 0.5 },
  cDate: { fontSize: FONT.sizeSmall, color: COLORS.textMuted, marginRight: SPACE.sm },
  cName: { fontSize: FONT.sizeLarge, fontWeight: FONT.weightBold, color: COLORS.text },
  cPhone: { fontSize: FONT.sizeSmall, color: COLORS.textMuted },
  cSub: { fontSize: FONT.size, color: COLORS.textSecondary, marginTop: 2 },
  infoRow: { justifyContent: 'space-between', paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.sm },
  infoLabel: { fontSize: FONT.sizeLarge, fontWeight: FONT.weightBold, color: COLORS.text },
  infoValue: { fontSize: FONT.size, color: COLORS.textSecondary },
  segment: { marginHorizontal: LAYOUT.inset, marginVertical: SPACE.sm },
  cancelledTag: { paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.sm },
  blouseRow: { paddingHorizontal: LAYOUT.inset, paddingVertical: LAYOUT.rowY },
  itemLine: { gap: SPACE.sm, marginTop: SPACE.xs },
  itemType: { fontSize: FONT.sizeLarge, fontWeight: FONT.weightBold, color: COLORS.text, flex: 1 },
  itemStatus: { fontSize: FONT.sizeSmall, fontWeight: FONT.weightMedium },
  itemPrice: { fontSize: FONT.size, color: COLORS.text, flex: 1, fontWeight: FONT.weightMedium },
  itemDate: { fontSize: FONT.sizeSmall, color: COLORS.textMuted },
  editInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: LAYOUT.radiusSm,
    padding: SPACE.sm,
    fontSize: FONT.size,
    backgroundColor: COLORS.bgInput,
    color: COLORS.text,
  },
});
