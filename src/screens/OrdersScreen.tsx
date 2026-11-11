// ============================================================
// Poshakh – Orders Screen  (Pending | Ready | Delivered)
// An order has one delivery (part) or two (emergency + general).
// ============================================================
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
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
import type { Blouse, OrderStatus, OrderWithDetails, PartWithBlouses, SmallWork, SmallWorkKind } from '../types';
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
  Stepper,
  Tag,
  TextField,
  TileGrid,
  WorkTile,
} from '../components/ui';
import { fmt, fmtShort } from '../utils/date';
import { ALTER_KINDS, blouseLabel, OTHER_SMALL_KINDS, rateFor, smallWorkLabel, workLabel, workSummary } from '../utils/labels';
import {
  cardMoney,
  collectOnDelivery,
  matchesOrderNo,
  orderNo,
  partAmounts,
  smallWorkPartId,
  whatsappUrl,
} from '../utils/order';
import { OrderBillModal } from '../components/OrderBill';
import { EditOrder } from './EditOrderScreen';

const liveBlouses = (p: PartWithBlouses) => (p.cancelled ? [] : p.blouses.filter(b => b.status !== 'cancelled'));

const TABS: OrderStatus[] = ['pending', 'ready', 'delivered'];

/** Each tab has its own light background, so she can tell at a glance which list she is on. */
const TAB_BG: Record<OrderStatus, string> = {
  pending: COLORS.warningBg,
  ready: COLORS.infoBg,
  delivered: COLORS.successBg,
  cancelled: COLORS.bgLight,
};

export function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const { isReady, version, lateParts, willMissParts } = useAppContext();
  const [tab, setTab] = useState<OrderStatus>('pending');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const pageSwipe = usePageSwipe(dir => setTab(t => TABS[Math.min(TABS.length - 1, Math.max(0, TABS.indexOf(t) + dir))]));

  const orders = useMemo(
    () => (isReady ? DB.loadOrdersWithDetails(tab) : []),
    // `version` changes after every DB write: reload then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isReady, tab, version],
  );
  const q = search.trim().toLowerCase();
  const filtered = orders.filter(o =>
    !q || matchesOrderNo(o.order.id, q) || o.customer.name.toLowerCase().includes(q) || (o.customer.phone ?? '').includes(q)
    || o.parts.some(p => [...p.blouses, ...p.smallWork].some(w => (w.name ?? '').toLowerCase().includes(q))));

  if (!isReady) return <Loading />;

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: TAB_BG[tab] }]}>
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

      {/* Swipe the page left / right to go to the next / previous tab. */}
      <Animated.View style={[styles.page, { transform: [{ translateX: pageSwipe.offset }] }]} {...pageSwipe.handlers}>
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
      </Animated.View>

      <Modal visible={selectedId !== null} animationType="slide" onRequestClose={() => setSelectedId(null)}>
        {selectedId !== null && <OrderDetail orderId={selectedId} onClose={() => setSelectedId(null)} />}
      </Modal>
    </View>
  );
}

/**
 * A sideways swipe anywhere on the list moves to the next tab (finger to the left)
 * or the previous one (finger to the right). Up/down still scrolls the list.
 * The page follows the finger a little so she can feel it working.
 */
function usePageSwipe(go: (dir: 1 | -1) => void) {
  const [offset] = useState(() => new Animated.Value(0));
  const [handlers] = useState(() => {
    const settle = () => Animated.spring(offset, { toValue: 0, useNativeDriver: true }).start();
    return PanResponder.create({
      // Only take over clearly sideways moves; anything else is a scroll or a tap.
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderMove: (_e, g) => offset.setValue(g.dx * 0.3),
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -60 || g.vx < -0.5) go(1);
        else if (g.dx > 60 || g.vx > 0.5) go(-1);
        settle();
      },
      onPanResponderTerminate: settle,
    }).panHandlers;
  });
  return { offset, handlers };
}

// ── Summary card ──────────────────────────────────────────────
function OrderSummaryCard({
  card, late, willMiss, onPress,
}: { card: OrderWithDetails; late: boolean; willMiss: boolean; onPress: () => void }) {
  const total = card.parts.flatMap(partAmounts).reduce((s, a) => s + a.price, 0);
  const small = card.parts.flatMap(p => (p.cancelled ? [] : p.smallWork));
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
            <Text style={styles.cSub}>{workSummary(card.parts.flatMap(liveBlouses), small)} · ₹{total}</Text>
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
  const [editing, setEditing] = useState(false);

  if (!card) return null;
  if (editing) return <EditOrder card={card} onClose={() => setEditing(false)} />;
  const money = cardMoney(card);
  const open = card.order.status === 'pending' || card.order.status === 'ready';

  const addPartId = open ? smallWorkPartId(card) : null;
  const phone = card.customer.phone;

  const handleCancel = () => {
    Alert.alert(STRINGS.ordersCancelTitle, STRINGS.ordersCancelConfirm, [
      { text: STRINGS.cancel, style: 'cancel' },
      { text: STRINGS.ordersCancel, style: 'destructive', onPress: () => { DB.cancelOrder(orderId); refresh(); onClose(); } },
    ]);
  };

  const openWhatsApp = async () => {
    try {
      await Linking.openURL(whatsappUrl(phone, ''));
    } catch {
      Alert.alert(STRINGS.billShareFailed, STRINGS.billNoWhatsApp);
    }
  };

  /** The last piece of work can't be removed: that is what cancelling the order is for. */
  const removeSmall = (w: SmallWork) => {
    if (card.parts.flatMap(partAmounts).length <= 1) {
      Alert.alert(STRINGS.ordersRemoveWork, STRINGS.ordersLastWork);
      return;
    }
    Alert.alert(STRINGS.ordersRemoveWork, smallWorkLabel(w), [
      { text: STRINGS.cancel, style: 'cancel' },
      { text: STRINGS.removeWork, style: 'destructive', onPress: () => { DB.removeSmallWork(w.id); refresh(); } },
    ]);
  };

  /** Check with the engine before moving a promised date. */
  const moveDate = (part: PartWithBlouses, date: string, priority?: Priority): boolean => {
    const save = (d: string) => { DB.updatePartDate(part.id, d, priority); refresh(); };
    // Nothing left to stitch: the schedule has no say, so any date is fine.
    if (!part.blouses.some(b => b.status === 'scheduled')) { save(date); return true; }

    const res = checkPartDateChange(buildInput(), String(part.id), date, priority);
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
    <KeyboardAvoidingView style={[styles.container, { paddingTop: insets.top }]} behavior="padding">
      <ModalHeader
        title={card.customer.name}
        subtitle={STRINGS.ordersNumber(orderNo(card.order.id), fmt(card.order.createdAt.slice(0, 10)))}
        onBack={onClose}
        right={card.order.status !== 'cancelled' ? (
          <Button label={STRINGS.billButton} icon="receipt-outline" size="small" onPress={() => setBillOpen(true)} />
        ) : undefined}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: LAYOUT.screenBottom }} keyboardShouldPersistTaps="handled">
        <Section>
          <Row style={styles.infoRow}>
            <View>
              <Text style={styles.infoLabel}>{STRINGS.ordersTotal(money.total)}</Text>
              <Text style={styles.infoValue}>{STRINGS.ordersBalance(money.balance)}</Text>
            </View>
            {phone ? <Text style={styles.infoValue}>{phone}</Text> : null}
          </Row>
          {phone ? (
            <Actions row>
              <Button label={STRINGS.todayCall} icon="call-outline" size="small" variant="secondary" onPress={() => Linking.openURL(`tel:${phone}`)} />
              <Button label={STRINGS.ordersWhatsApp} icon="logo-whatsapp" size="small" variant="whatsapp" onPress={openWhatsApp} />
            </Actions>
          ) : null}
          {card.order.status !== 'cancelled' && (
            <Actions>
              <Button label={STRINGS.ordersEdit} icon="create-outline" size="small" variant="secondary" onPress={() => setEditing(true)} />
            </Actions>
          )}
        </Section>

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
            collect={collectOnDelivery(card, part.id)}
            onPaid={paid => { DB.setPartPaid(part.id, paid); refresh(); }}
            onSmallPrice={(w, price) => { DB.updateSmallWorkPrice(w.id, price); refresh(); }}
            onSmallQty={(w, qty) => { DB.updateSmallWorkQty(w.id, qty); refresh(); }}
            onSmallRemove={removeSmall}
          />
        ))}

        {addPartId !== null && (
          <AddSmallWork onAdd={w => { DB.addSmallWork(addPartId, w); refresh(); }} />
        )}

        <MoneySection
          key={`${card.order.advance}|${card.order.previousDue}`}
          advance={card.order.advance}
          previousDue={card.order.previousDue}
          onSave={m => { DB.updateOrderMoney(orderId, m); refresh(); }}
        />

        {open && (
          <Actions page>
            <Button label={STRINGS.ordersCancel} icon="close-circle-outline" onPress={handleCancel} variant="danger" />
          </Actions>
        )}
      </ScrollView>

      {billOpen && <OrderBillModal card={card} onClose={() => setBillOpen(false)} />}
    </KeyboardAvoidingView>
  );
}

/** Add small work to a saved order: pick the work, check the price, add. */
function AddSmallWork({
  onAdd,
}: { onAdd: (w: { kind: SmallWorkKind; qty: number; price: number; name?: string }) => void }) {
  const { settings } = useAppContext();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<SmallWorkKind | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState(0);
  const [qty, setQty] = useState(1);
  const [showError, setShowError] = useState(false);

  const close = () => { setOpen(false); setKind(null); setName(''); setQty(1); setShowError(false); };
  const pick = (k: SmallWorkKind) => { setKind(k); setPrice(rateFor(settings, k)); setName(''); setQty(1); setShowError(false); };
  const add = () => {
    if (!kind) return;
    if (kind === 'other' && !name.trim()) { setShowError(true); return; }
    onAdd({ kind, qty, price, name });
    close();
  };

  if (!open) {
    return (
      <Actions page>
        <Button label={STRINGS.ordersAddSmall} icon="add-circle-outline" variant="secondary" onPress={() => setOpen(true)} />
      </Actions>
    );
  }

  if (!kind) {
    return (
      <Section title={STRINGS.ordersAddSmall} subtitle={STRINGS.workSmallHint}>
        <TileGrid>
          {[...ALTER_KINDS, ...OTHER_SMALL_KINDS].map(k => {
            const rate = rateFor(settings, k);
            return <WorkTile key={k} label={workLabel(k)} note={rate > 0 ? `₹${rate}` : undefined} count={0} onPress={() => pick(k)} />;
          })}
        </TileGrid>
        <Actions>
          <Button label={STRINGS.cancel} size="small" variant="ghost" onPress={close} />
        </Actions>
      </Section>
    );
  }

  const isOther = kind === 'other';
  return (
    <Section title={workLabel(kind)} subtitle={STRINGS.workSmallHint}>
      <TextField
        label={isOther ? STRINGS.workOtherName : STRINGS.workName}
        value={name}
        onChangeValue={setName}
        placeholder={isOther ? STRINGS.workOtherPlaceholder : STRINGS.workNamePlaceholder}
        error={showError && !name.trim() ? STRINGS.workOtherRequired : undefined}
      />
      <NumberInput inline label={STRINGS.priceEach} value={price} onChangeValue={setPrice} />
      <NumberInput inline label={STRINGS.ordersHowMany} value={qty} onChangeValue={setQty} min={1} />
      <Actions row>
        <Button label={STRINGS.ordersAdd} icon="add-circle-outline" size="small" onPress={add} />
        <Button label={STRINGS.cancel} size="small" variant="secondary" onPress={close} />
      </Actions>
    </Section>
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
      <NumberInput inline label={STRINGS.moneyAdvance} value={a} onChangeValue={setA} />
      <NumberInput inline label={STRINGS.moneyPreviousDue} value={p} onChangeValue={setP} />
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
  part, today, offDates, stitchDate, late, willMiss, collect, onMove, onDelivered, onPaid, onDone, onUndo, onPrice,
  onSmallPrice, onSmallQty, onSmallRemove,
}: {
  part: PartWithBlouses;
  today: string;
  offDates: string[];
  stitchDate: Record<string, string | null>;
  late: Set<number>;
  willMiss: Set<number>;
  /** What she takes from the customer when this delivery is handed over. */
  collect: number;
  onMove: (p: PartWithBlouses, date: string, priority?: Priority) => boolean;
  onDelivered: (date: string | null) => void;
  onPaid: (paid: boolean) => void;
  onDone: (b: Blouse) => void;
  onUndo: (b: Blouse) => void;
  onPrice: (b: Blouse, price: number) => void;
  onSmallPrice: (w: SmallWork, price: number) => void;
  onSmallQty: (w: SmallWork, qty: number) => void;
  onSmallRemove: (w: SmallWork) => void;
}) {
  const [moving, setMoving] = useState(false);
  const [editDate, setEditDate] = useState(part.promisedDelivery);
  const [editPriority, setEditPriority] = useState<Priority>(part.priority);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState(0);

  const delivered = !!part.deliveredOn;
  const editable = !part.cancelled && !delivered;
  const emergency = part.priority === 'emergency';
  const toStitch = part.blouses.some(b => b.status === 'scheduled');
  const paid = partAmounts(part).every(a => a.paid);

  const confirmDelivered = () => {
    Alert.alert(STRINGS.todayDeliverConfirm, collect > 0 ? STRINGS.todayCollect(collect) : STRINGS.todayNothingToCollect, [
      { text: STRINGS.cancel, style: 'cancel' },
      { text: STRINGS.todayMarkDelivered, onPress: () => onDelivered(today) },
    ]);
  };

  const startMove = () => { setEditDate(part.promisedDelivery); setEditPriority(part.priority); setMoving(true); };
  const saveMove = () => {
    const pr = editPriority !== part.priority ? editPriority : undefined;
    if (onMove(part, editDate, pr)) setMoving(false);
  };

  return (
    <Section
      title={emergency ? `⚡ ${STRINGS.emergencyDelivery}` : `📅 ${STRINGS.generalDelivery}`}
      subtitle={delivered ? STRINGS.ordersDeliveredOn(fmt(part.deliveredOn)) : STRINGS.ordersDeliverBy(fmt(part.promisedDelivery))}
      count={part.cancelled ? 0 : liveBlouses(part).length + part.smallWork.reduce((s, w) => s + w.qty, 0)}
      accent={part.cancelled ? COLORS.textMuted : delivered ? COLORS.success : emergency ? COLORS.emergency : COLORS.tagGeneral}
    >
      {/* Delivery actions */}
      {moving ? (
        <View>
          <DateField
            label={STRINGS.ordersNewDate}
            value={editDate}
            onChange={setEditDate}
            minDate={toStitch ? addDays(today, 1) : today}
            offDates={offDates}
          />
          {toStitch && (
            <Segmented
              style={styles.segment}
              value={editPriority}
              onChange={setEditPriority}
              options={[
                { value: 'general', label: STRINGS.general },
                { value: 'emergency', label: STRINGS.emergency },
              ]}
            />
          )}
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
        <>
          <Actions row>
            <Button label={STRINGS.ordersMarkDelivered} icon="checkmark-done" size="small" onPress={confirmDelivered} />
            <Button label={STRINGS.ordersChangeDate} icon="calendar-outline" size="small" variant="secondary" onPress={startMove} />
          </Actions>
          {(paid || collect > 0) && (
            <Actions style={styles.paidAction}>
              <Button
                label={paid ? STRINGS.todayPaid : STRINGS.todayMarkPaid}
                icon={paid ? undefined : 'cash-outline'}
                size="small"
                variant={paid ? 'success' : 'secondary'}
                onPress={() => onPaid(!paid)}
              />
            </Actions>
          )}
        </>
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
                {item.type === 'navvari' && <Tag label={STRINGS.fullDay} color={COLORS.tagGeneral} />}
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

      {part.smallWork.map(work => (
        <SmallWorkRow
          key={work.id}
          work={work}
          dimmed={part.cancelled}
          paid={work.paid || delivered}
          changeable={editable}
          onPrice={price => onSmallPrice(work, price)}
          onQty={qty => (qty > 0 ? onSmallQty(work, qty) : onSmallRemove(work))}
        />
      ))}
    </Section>
  );
}

/** Bill-only work: a name, an amount and a price to fix. Nothing to tick. */
function SmallWorkRow({
  work, dimmed, paid, changeable, onPrice, onQty,
}: {
  work: SmallWork;
  dimmed: boolean;
  paid: boolean;
  /** Not handed over yet: the amount can still change, or it can be removed. */
  changeable: boolean;
  onPrice: (price: number) => void;
  /** 0 means remove. */
  onQty: (qty: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(work.price);
  return (
    <View style={dimmed && { opacity: 0.4 }}>
      <Separator inset={0} />
      <View style={styles.blouseRow}>
        <Row style={styles.smallTitleRow}>
          <Text style={styles.itemType}>{smallWorkLabel(work)}{!changeable && work.qty > 1 ? ` × ${work.qty}` : ''}</Text>
          {changeable && <Stepper value={work.qty} onChange={onQty} removeLabel={STRINGS.removeWork} />}
        </Row>
        {editing ? (
          <Row style={styles.itemLine}>
            <NumericTextInput style={styles.editInput} value={price} min={0} onChangeValue={setPrice} autoFocus />
            <Button label={STRINGS.save} size="small" onPress={() => { onPrice(price); setEditing(false); }} />
            <Button label={STRINGS.cancel} size="small" variant="secondary" onPress={() => setEditing(false)} />
          </Row>
        ) : (
          <Row style={styles.itemLine}>
            <Text style={styles.itemPrice}>
              ₹{work.price * work.qty}
              {work.qty > 1 ? ` (${STRINGS.billEach(work.price)})` : ''}
              {paid ? `   ${STRINGS.todayPaid}` : ''}
            </Text>
            {!dimmed && (
              <Button
                label={STRINGS.ordersEditPrice}
                icon="create-outline"
                size="small"
                variant="ghost"
                onPress={() => { setPrice(work.price); setEditing(true); }}
              />
            )}
          </Row>
        )}
      </View>
    </View>
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
  page: { flex: 1 },
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
  paidAction: { paddingTop: 0 },
  smallTitleRow: { gap: SPACE.sm },
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
