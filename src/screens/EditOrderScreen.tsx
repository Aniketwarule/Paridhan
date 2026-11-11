// ============================================================
// Poshakh – Edit Order
// Opened from an order's detail. Everything she might need to fix in one place:
//   - the day the order was taken
//   - each delivery's date (and emergency / general)
//   - the work: change its kind, name or price, add more, take some out
// Nothing is saved until "Save changes". Before saving, the schedule is asked
// whether the change makes any work late, and she is warned if so.
// Delivered parts are shown but locked.
// ============================================================
import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
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
import { rebuildSchedule } from '../engine';
import type { OrderWithDetails, WorkKey } from '../types';
import {
  Button,
  COLORS,
  DateField,
  FONT,
  LAYOUT,
  ModalHeader,
  NumericTextInput,
  Row,
  Section,
  Segmented,
  Separator,
  SPACE,
  Stepper,
  Tag,
  TileGrid,
  useKeepInputVisible,
  WorkTile,
} from '../components/ui';
import { fmt } from '../utils/date';
import { orderNo } from '../utils/order';
import { ALTER_KINDS, isStitchWork, OTHER_SMALL_KINDS, rateFor, smallWorkLabel, STITCH_TYPES, workLabel } from '../utils/labels';
import {
  addItem,
  changeWork,
  editChanges,
  editFromOrder,
  editProblem,
  editTotal,
  hasChanges,
  itemTotal,
  newEditItem,
  removeItem,
  setPart,
  updateItem,
  type EditItem,
  type EditPart,
} from '../utils/orderEdit';

const SMALL_KINDS: WorkKey[] = [...ALTER_KINDS, ...OTHER_SMALL_KINDS];

/** What the work picker is open for. */
type Picking =
  | { mode: 'add'; partId: number }
  | { mode: 'change'; partId: number; item: EditItem };

export function EditOrder({ card, onClose }: { card: OrderWithDetails; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { today, daysOff, settings, schedule, buildInput, refresh } = useAppContext();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const keepVisible = useKeepInputVisible(scrollRef);

  const [edit, setEdit] = useState(() => editFromOrder(card));
  const [picking, setPicking] = useState<Picking | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const changes = useMemo(() => editChanges(card, edit), [card, edit]);
  const dirty = hasChanges(changes);
  const total = editTotal(edit);
  const wasTotal = useMemo(() => editTotal(editFromOrder(card)), [card]);
  const offDates = daysOff.map(d => d.date);
  const rate = (w: WorkKey) => rateFor(settings, w);

  const leave = () => {
    if (!dirty) { onClose(); return; }
    Alert.alert(STRINGS.discardTitle, STRINGS.discardBody, [
      { text: STRINGS.keepEditing, style: 'cancel' },
      { text: STRINGS.discardLeave, style: 'destructive', onPress: onClose },
    ]);
  };

  const save = () => {
    const problem = editProblem(edit);
    if (problem === 'empty') { Alert.alert(STRINGS.ordersRemoveWork, STRINGS.editEmpty); return; }
    if (problem === 'name') { setShowErrors(true); return; }

    const write = () => {
      DB.saveOrderEdit(changes);
      refresh();
      onClose();
    };
    // Ask the schedule first: would this make more work miss its date?
    const missAfter = DB.tryOrderEdit(changes, () => rebuildSchedule(buildInput()).willMiss.length);
    if (missAfter > schedule.willMiss.length) {
      Alert.alert(STRINGS.warning, STRINGS.settingsWillMissConfirm, [
        { text: STRINGS.cancel, style: 'cancel' },
        { text: STRINGS.save, style: 'destructive', onPress: write },
      ]);
      return;
    }
    write();
  };

  const pick = (work: WorkKey) => {
    if (!picking) return;
    if (picking.mode === 'add') {
      setEdit(e => addItem(e, picking.partId, newEditItem(work, rate(work))));
      // The new row lands at the end of its delivery: let her see it.
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    } else {
      const { partId, item } = picking;
      setEdit(e => updateItem(e, partId, item.key, changeWork(item, work, rate)));
    }
    setPicking(null);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ModalHeader
          title={STRINGS.editTitle}
          subtitle={`${orderNo(card.order.id)} · ${card.customer.name}`}
          onBack={leave}
        />

        <ScrollView ref={scrollRef} {...keepVisible} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Section>
            <DateField
              label={STRINGS.editOrderDate}
              value={edit.orderDate}
              onChange={d => setEdit(e => ({ ...e, orderDate: d }))}
              offDates={offDates}
            />
          </Section>

          {edit.parts.map(part => (
            <PartEditor
              key={part.id}
              part={part}
              today={today}
              offDates={offDates}
              showErrors={showErrors}
              onDate={d => setEdit(e => setPart(e, part.id, { date: d }))}
              onPriority={p => setEdit(e => setPart(e, part.id, { priority: p }))}
              onItem={(key, patch) => setEdit(e => updateItem(e, part.id, key, patch))}
              onRemove={key => setEdit(e => removeItem(e, part.id, key))}
              onChangeWork={item => setPicking({ mode: 'change', partId: part.id, item })}
              onAdd={() => setPicking({ mode: 'add', partId: part.id })}
            />
          ))}

          <Section>
            <Row style={styles.totalRow}>
              {total !== wasTotal && <Text style={styles.wasTotal}>{STRINGS.editWas(wasTotal)}</Text>}
              <Text style={styles.totalValue}>{STRINGS.orderTotal(total)}</Text>
            </Row>
          </Section>
        </ScrollView>

        <Row style={styles.footer}>
          <Button label={STRINGS.cancel} variant="secondary" onPress={leave} style={styles.footerBack} />
          <Button label={STRINGS.editSave} icon="checkmark" onPress={save} disabled={!dirty} style={styles.footerNext} />
        </Row>
      </KeyboardAvoidingView>

      <WorkPicker
        visible={picking !== null}
        title={picking?.mode === 'change' ? STRINGS.editChangeWork : STRINGS.editPickWork}
        groups={picking?.mode === 'change'
          ? [{ title: '', kinds: isStitchWork(picking.item.work) ? STITCH_TYPES : SMALL_KINDS }]
          : [
            { title: STRINGS.workGroupStitching, kinds: STITCH_TYPES },
            { title: STRINGS.workGroupAlter, kinds: ALTER_KINDS },
            { title: STRINGS.workGroupOther, kinds: OTHER_SMALL_KINDS },
          ]}
        current={picking?.mode === 'change' ? picking.item.work : undefined}
        rate={rate}
        onPick={pick}
        onClose={() => setPicking(null)}
      />
    </View>
  );
}

// ── One delivery ──────────────────────────────────────────────
function PartEditor({
  part, today, offDates, showErrors, onDate, onPriority, onItem, onRemove, onChangeWork, onAdd,
}: {
  part: EditPart;
  today: string;
  offDates: string[];
  showErrors: boolean;
  onDate: (d: string) => void;
  onPriority: (p: EditPart['priority']) => void;
  onItem: (key: number, patch: Partial<EditItem>) => void;
  onRemove: (key: number) => void;
  onChangeWork: (item: EditItem) => void;
  onAdd: () => void;
}) {
  const emergency = part.priority === 'emergency';
  const title = emergency ? `⚡ ${STRINGS.emergencyDelivery}` : `📅 ${STRINGS.generalDelivery}`;
  const pieces = part.items.reduce((s, i) => s + i.qty, 0);

  if (part.locked) {
    return (
      <Section title={title} subtitle={STRINGS.editLocked(fmt(part.deliveredOn))} count={pieces} accent={COLORS.success}>
        {part.items.map((i, n) => (
          <View key={i.key}>
            {n > 0 && <Separator />}
            <Row style={styles.lockedRow}>
              <Text style={styles.lockedText}>{itemLabel(i)}{i.qty > 1 ? ` × ${i.qty}` : ''}</Text>
              <Text style={styles.lockedPrice}>₹{itemTotal(i)}</Text>
            </Row>
          </View>
        ))}
      </Section>
    );
  }

  const hasStitching = part.items.some(i => isStitchWork(i.work));
  return (
    <Section title={title} count={pieces} accent={emergency ? COLORS.emergency : COLORS.tagGeneral}>
      <DateField label={STRINGS.editDeliveryDate} value={part.date} onChange={onDate} minDate={today} offDates={offDates} />
      {hasStitching && (
        <Segmented
          style={styles.segment}
          value={part.priority}
          onChange={onPriority}
          options={[
            { value: 'general', label: STRINGS.general },
            { value: 'emergency', label: STRINGS.emergency },
          ]}
        />
      )}
      {part.items.map(item => (
        <View key={item.key}>
          <Separator inset={0} />
          <ItemEditor
            item={item}
            showError={showErrors && item.work === 'other' && !item.name.trim()}
            onChange={patch => onItem(item.key, patch)}
            onRemove={() => onRemove(item.key)}
            onChangeWork={() => onChangeWork(item)}
          />
        </View>
      ))}
      <Separator inset={0} />
      <View style={styles.addRow}>
        <Button label={STRINGS.editAddWork} icon="add-circle-outline" size="small" variant="secondary" onPress={onAdd} />
      </View>
    </Section>
  );
}

const itemLabel = (i: EditItem) => (isStitchWork(i.work)
  ? (i.name.trim() ? `${i.name.trim()} (${workLabel(i.work)})` : workLabel(i.work))
  : smallWorkLabel({ kind: i.work, name: i.name.trim() || undefined }));

// ── One piece of work ─────────────────────────────────────────
function ItemEditor({
  item, showError, onChange, onRemove, onChangeWork,
}: {
  item: EditItem;
  showError: boolean;
  onChange: (patch: Partial<EditItem>) => void;
  onRemove: () => void;
  onChangeWork: () => void;
}) {
  const stitching = isStitchWork(item.work);
  const isOther = item.work === 'other';
  return (
    <View style={styles.item}>
      <Row style={styles.itemTop}>
        <TouchableOpacity
          style={styles.workChip}
          onPress={onChangeWork}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${STRINGS.editChangeWork}: ${workLabel(item.work)}`}
        >
          <Text style={styles.workChipText} numberOfLines={1}>{workLabel(item.work)}</Text>
          <Ionicons name="chevron-down" size={16} color={COLORS.accent} />
        </TouchableOpacity>
        <View style={styles.itemTags}>
          {item.id === undefined && <Tag label={STRINGS.editNew} color={COLORS.tagGeneral} />}
          {item.done && <Tag label={STRINGS.ordersStatus.done} color={COLORS.success} />}
        </View>
        {stitching ? (
          <TouchableOpacity
            style={styles.removeBtn}
            onPress={onRemove}
            hitSlop={SPACE.xs}
            accessibilityRole="button"
            accessibilityLabel={STRINGS.removeWork}
          >
            <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
          </TouchableOpacity>
        ) : (
          <Stepper value={item.qty} onChange={n => (n > 0 ? onChange({ qty: n }) : onRemove())} removeLabel={STRINGS.removeWork} />
        )}
      </Row>
      <Row style={styles.itemInputs}>
        <TextInput
          style={[styles.input, styles.nameInput, showError && styles.inputError]}
          value={item.name}
          onChangeText={v => onChange({ name: v })}
          placeholder={isOther ? STRINGS.workOtherPlaceholder : STRINGS.workNamePlaceholder}
          placeholderTextColor={COLORS.textMuted}
          accessibilityLabel={isOther ? STRINGS.workOtherName : STRINGS.workName}
        />
        <Text style={styles.rupee}>₹</Text>
        <NumericTextInput
          style={[styles.input, styles.priceInput]}
          value={item.price}
          min={0}
          onChangeValue={n => onChange({ price: n })}
          accessibilityLabel={stitching ? STRINGS.workPriceHead : STRINGS.priceEach}
        />
      </Row>
      {showError && <Text style={styles.error}>{STRINGS.workOtherRequired}</Text>}
      {!stitching && item.qty > 1 && <Text style={styles.each}>{STRINGS.billEach(item.price)} · ₹{itemTotal(item)}</Text>}
    </View>
  );
}

// ── Pick a kind of work (bottom sheet) ────────────────────────
function WorkPicker({
  visible, title, groups, current, rate, onPick, onClose,
}: {
  visible: boolean;
  title: string;
  groups: { title: string; kinds: WorkKey[] }[];
  current?: WorkKey;
  rate: (w: WorkKey) => number;
  onPick: (w: WorkKey) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + SPACE.md }]} onPress={() => {}}>
          <Row style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={SPACE.sm} accessibilityLabel={STRINGS.close}>
              <Ionicons name="close" size={26} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </Row>
          <ScrollView>
            {groups.map(g => (
              <View key={g.title || 'all'}>
                {g.title ? <Text style={styles.sheetGroup}>{g.title}</Text> : null}
                <TileGrid>
                  {g.kinds.map(k => (
                    <WorkTile
                      key={k}
                      label={workLabel(k)}
                      note={rate(k) > 0 ? `₹${rate(k)}` : undefined}
                      count={0}
                      selected={k === current}
                      onPress={() => onPick(k)}
                    />
                  ))}
                </TileGrid>
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgLight },
  content: { paddingBottom: LAYOUT.screenBottom },
  segment: { marginHorizontal: LAYOUT.inset, marginBottom: SPACE.sm },
  item: { paddingHorizontal: LAYOUT.inset, paddingVertical: LAYOUT.rowY, gap: SPACE.sm },
  itemTop: { gap: SPACE.sm },
  itemTags: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  workChip: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, flexShrink: 1,
    paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderRadius: LAYOUT.radiusSm,
    borderWidth: 1, borderColor: COLORS.brand, backgroundColor: COLORS.brandTint,
  },
  workChipText: { fontSize: FONT.size, fontWeight: FONT.weightBold, color: COLORS.brand, flexShrink: 1 },
  removeBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.bg,
  },
  itemInputs: { gap: SPACE.sm },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: LAYOUT.radiusSm, backgroundColor: COLORS.bgInput,
    paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, fontSize: FONT.size, color: COLORS.text,
  },
  inputError: { borderColor: COLORS.danger },
  nameInput: { flex: 1, minWidth: 0 },
  rupee: { fontSize: FONT.size, color: COLORS.textSecondary },
  priceInput: { width: 88, textAlign: 'right' },
  error: { fontSize: FONT.sizeSmall, color: COLORS.danger },
  each: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary },
  addRow: { paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.sm, alignItems: 'flex-start' },
  lockedRow: { gap: SPACE.sm, paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.sm },
  lockedText: { flex: 1, fontSize: FONT.size, color: COLORS.textSecondary },
  lockedPrice: { fontSize: FONT.size, color: COLORS.textSecondary },
  totalRow: { justifyContent: 'flex-end', gap: SPACE.md, paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.xs },
  wasTotal: { fontSize: FONT.size, color: COLORS.textMuted, textDecorationLine: 'line-through' },
  totalValue: { fontSize: FONT.sizeLarge, fontWeight: FONT.weightBold, color: COLORS.text },
  footer: {
    gap: LAYOUT.buttonGap, paddingHorizontal: LAYOUT.gutter, paddingVertical: SPACE.sm, backgroundColor: COLORS.bg,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  footerBack: { flex: 1 },
  footerNext: { flex: 2 },
  backdrop: { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '85%', backgroundColor: COLORS.bg,
    borderTopLeftRadius: LAYOUT.radius, borderTopRightRadius: LAYOUT.radius,
  },
  sheetHead: { justifyContent: 'space-between', paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.md },
  sheetTitle: { fontSize: FONT.sizeLarge, fontWeight: FONT.weightBold, color: COLORS.text },
  sheetGroup: {
    fontSize: FONT.sizeSmall, fontWeight: FONT.weightMedium, color: COLORS.textSecondary,
    paddingHorizontal: LAYOUT.inset, paddingTop: SPACE.sm, paddingBottom: SPACE.xs,
  },
});
