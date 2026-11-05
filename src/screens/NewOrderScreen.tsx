// ============================================================
// Poshakh – New Order (3 short steps)
//   1. Customer  – new, or pick an old one
//   2. Blouses   – type, optional name, price, emergency tick per blouse
//   3. Delivery  – engine quote, optional other date (calendar), confirm
// ============================================================
import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { STRINGS } from '../strings';
import { useAppContext } from '../context/AppContext';
import * as DB from '../db/database';
import { orderNo } from '../utils/order';
import { addDays, checkDate, quote, quoteBoth, rebuildSchedule, weekStrip } from '../engine';
import type { DateCheck, PriorPart, Priority, QuotePart, WeekExtra } from '../engine';
import type { BlouseType, CustomerSummary } from '../types';
import {
  Actions,
  Button,
  CapacityStrip,
  Checkbox,
  COLORS,
  DateField,
  FONT,
  LAYOUT,
  NumberInput,
  NumericTextInput,
  Row,
  ScreenHeader,
  Section,
  Segmented,
  Separator,
  SPACE,
  Steps,
  Tag,
  TextField,
} from '../components/ui';
import { fmt, fmtLong, fmtShort, isDate, nowIso } from '../utils/date';

interface DraftBlouse {
  key: number;
  type: BlouseType;
  name: string;
  price: number;
  /** She typed a price herself: don't overwrite it when the type changes. */
  priceEdited: boolean;
  emergency: boolean;
}

/** One delivery of the new order, with the date we will promise. */
interface PlannedPart {
  priority: Priority;
  count: number;
  offered: string | null;
  /** Date that will be saved; null = cannot confirm yet. */
  chosen: string | null;
  custom: boolean;
  check?: DateCheck;
  stitchDays: string[];
}

const PRIORITIES: Priority[] = ['emergency', 'general'];
/** Stable keys for draft blouse cards. */
let blouseKey = 0;
const NO_DATES: Record<Priority, string> = { emergency: '', general: '' };

export function NewOrderScreen() {
  const insets = useSafeAreaInsets();
  const { settings, daysOff, today, version, buildInput, refresh } = useAppContext();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const [step, setStep] = useState(0);

  // ── Step 1: customer ─────────────────────────────────────────
  const [mode, setMode] = useState<'new' | 'old'>('new');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [nameError, setNameError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CustomerSummary | null>(null);

  // ── Step 2: blouses ──────────────────────────────────────────
  const newBlouse = (): DraftBlouse => ({
    key: ++blouseKey, type: 'astar', name: '', price: settings.priceAstar, priceEdited: false, emergency: false,
  });
  const [blouses, setBlouses] = useState<DraftBlouse[]>(() => [newBlouse()]);

  // ── Step 3: delivery ─────────────────────────────────────────
  const [customDate, setCustomDate] = useState<Record<Priority, string>>(NO_DATES);
  const [advance, setAdvance] = useState(0);
  const [previousDue, setPreviousDue] = useState(0);
  const [extras, setExtras] = useState<Partial<Record<Priority, WeekExtra>>>({});

  const customers = useMemo(
    () => (mode === 'old' && !selected ? DB.searchCustomers(query) : []),
    // `version` changes after every DB write: reload then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, selected, query, version],
  );
  const duplicate = useMemo(
    () => (mode === 'new' && name.trim().length > 1 ? DB.findCustomerByName(name) : null),
    [mode, name],
  );

  const total = blouses.length;
  const eCount = blouses.filter(b => b.emergency).length;
  const gCount = total - eCount;
  const priceTotal = blouses.reduce((s, b) => s + b.price, 0);
  const customerName = mode === 'old' ? selected?.name ?? '' : name.trim();

  // ── Quote (only on the delivery step) ────────────────────────
  const plan = useMemo(() => {
    if (step !== 2 || total === 0) return null;
    const base = buildInput();
    const taken = Object.values(extras).filter((x): x is WeekExtra => !!x);
    const input = { ...base, weekExtras: [...(base.weekExtras ?? []), ...taken] };

    const req = PRIORITIES
      .map(priority => ({ priority, count: priority === 'emergency' ? eCount : gCount }))
      .filter(r => r.count > 0);
    const quoted = quote(input, req);
    // Single-priority orders also show what the other priority would give.
    const both = req.length === 1 ? quoteBoth(input, total) : null;

    const prior: PriorPart[] = [];
    let changed = false;
    const parts: PlannedPart[] = req.map((r, i) => {
      const q = quoted[i];
      const c = customDate[r.priority];
      let p: PlannedPart;
      if (isDate(c)) {
        const check = checkDate(input, r, c, prior);
        p = { ...r, offered: q.dateOffered, chosen: check.ok ? c : null, custom: true, check, stitchDays: [] };
        changed = true;
      } else if (changed && q.dateOffered) {
        // An earlier part has its own date: re-check this part's offered date against it.
        const check = checkDate(input, r, q.dateOffered, prior);
        const chosen = check.ok ? q.dateOffered : check.nearestValid ?? null;
        p = { ...r, offered: chosen, chosen, custom: false, stitchDays: check.ok ? q.stitchDays : [] };
      } else {
        p = { ...r, offered: q.dateOffered, chosen: q.dateOffered, custom: false, stitchDays: q.stitchDays };
      }
      if (p.chosen) prior.push({ count: r.count, priority: r.priority, date: p.chosen });
      return p;
    });

    const strip = weekStrip(input, rebuildSchedule(input), 5, quoted.flatMap(q => q.weekUsage));
    return { parts, both, strip };
    // `version` changes after every DB write: re-quote then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, total, eCount, gCount, customDate, extras, buildInput, version]);

  const canConfirm = !!plan && plan.parts.every(p => p.chosen);

  // ── Navigation between steps ─────────────────────────────────
  const goTo = (s: number) => {
    Keyboard.dismiss();
    setStep(s);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const nextFromCustomer = () => {
    if (mode === 'new' && !name.trim()) { setNameError(STRINGS.customerNameRequired); return; }
    if (mode === 'old' && !selected) return;
    setNameError('');
    goTo(1);
  };

  const nextFromBlouses = () => {
    setCustomDate(NO_DATES);
    setExtras({});
    goTo(2);
  };

  // ── Blouse edits ─────────────────────────────────────────────
  const updateBlouse = (key: number, patch: Partial<DraftBlouse>) =>
    setBlouses(bs => bs.map(b => (b.key === key ? { ...b, ...patch } : b)));

  const setType = (b: DraftBlouse, type: BlouseType) =>
    updateBlouse(b.key, {
      type,
      price: b.priceEdited ? b.price : type === 'astar' ? settings.priceAstar : settings.priceDesigner,
    });

  const setAllEmergency = (on: boolean) => {
    setBlouses(bs => bs.map(b => ({ ...b, emergency: on })));
    setCustomDate(NO_DATES);
    setExtras({});
  };

  const setCustom = (pr: Priority, v: string) => {
    setCustomDate(d => ({ ...d, [pr]: v }));
    setExtras(x => ({ ...x, [pr]: undefined }));
  };

  // ── Save ─────────────────────────────────────────────────────
  const handleConfirm = () => {
    if (!plan || !canConfirm) return;
    const customerId = mode === 'old' && selected
      ? selected.id
      : DB.createCustomer(name.trim(), phone.trim() || undefined);
    const orderId = DB.createOrder(customerId, nowIso(), plan.parts.map(p => ({
      priority: p.priority,
      promisedDelivery: p.chosen!,
      blouses: blouses
        .filter(b => (b.emergency ? 'emergency' : 'general') === p.priority)
        .map(b => ({ type: b.type, price: b.price, name: b.name })),
    })), undefined, { advance, previousDue });
    for (const pr of PRIORITIES) {
      const x = extras[pr];
      if (x && isDate(customDate[pr])) DB.addWeekExtra(x);
    }
    refresh();
    Alert.alert(STRINGS.orderSaved, STRINGS.orderSavedNo(orderNo(orderId)), [{ text: STRINGS.ok, onPress: resetForm }]);
  };

  const resetForm = () => {
    setStep(0); setMode('new'); setName(''); setPhone(''); setQuery(''); setSelected(null);
    setBlouses([newBlouse()]); setCustomDate(NO_DATES); setExtras({});
    setAdvance(0); setPreviousDue(0);
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScreenHeader
          title={STRINGS.newOrderTitle}
          subtitle={step > 0 && customerName ? customerName : undefined}
        />
        <Steps steps={[STRINGS.stepCustomer, STRINGS.stepBlouses, STRINGS.stepDelivery]} current={step} onPress={goTo} />

        <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* ── Step 1: Customer ── */}
          {step === 0 && (
            <Section title={STRINGS.stepCustomer}>
              <Segmented
                style={styles.segment}
                value={mode}
                onChange={m => { setMode(m); setNameError(''); }}
                options={[
                  { value: 'new', label: STRINGS.newCustomer },
                  { value: 'old', label: STRINGS.oldCustomer },
                ]}
              />

              {mode === 'new' ? (
                <>
                  <TextField
                    label={STRINGS.customerName}
                    value={name}
                    onChangeValue={v => { setName(v); if (v.trim()) setNameError(''); }}
                    placeholder={STRINGS.customerNamePlaceholder}
                    error={nameError}
                    autoCapitalize="words"
                  />
                  {duplicate && (
                    <TouchableOpacity
                      style={styles.dupHint}
                      onPress={() => { setMode('old'); setSelected({ ...duplicate, orderCount: 0 }); }}
                    >
                      <Ionicons name="information-circle" size={20} color={COLORS.tagGeneral} />
                      <Text style={styles.dupText}>{STRINGS.customerExists(duplicate.name)}</Text>
                    </TouchableOpacity>
                  )}
                  <TextField
                    label={STRINGS.customerPhone}
                    value={phone}
                    onChangeValue={setPhone}
                    keyboardType="phone-pad"
                  />
                </>
              ) : selected ? (
                <View style={styles.selectedCustomer}>
                  <Ionicons name="person-circle" size={44} color={COLORS.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.custName}>{selected.name}</Text>
                    {selected.phone ? <Text style={styles.custSub}>{selected.phone}</Text> : null}
                  </View>
                  <Button label={STRINGS.change} icon="swap-horizontal" size="small" variant="secondary" onPress={() => setSelected(null)} />
                </View>
              ) : (
                <>
                  <TextField
                    value={query}
                    onChangeValue={setQuery}
                    placeholder={STRINGS.customerSearch}
                  />
                  {customers.length === 0 ? (
                    <Text style={styles.muted}>{STRINGS.customerNoMatch}</Text>
                  ) : customers.map((c, i) => (
                    <View key={c.id}>
                      {i > 0 && <Separator />}
                      <TouchableOpacity style={styles.custRow} onPress={() => setSelected(c)}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.custName}>{c.name}</Text>
                          <Text style={styles.custSub}>
                            {[c.phone, c.lastOrderAt ? STRINGS.customerLastOrder(fmt(c.lastOrderAt.slice(0, 10))) : STRINGS.customerNoOrders]
                              .filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={22} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </>
              )}
            </Section>
          )}

          {/* ── Step 2: Blouses ── */}
          {step === 1 && (
            <>
              {blouses.map((b, i) => (
                <Section
                  key={b.key}
                  title={STRINGS.blouseNumber(i + 1)}
                  accent={b.emergency ? COLORS.emergency : undefined}
                  right={blouses.length > 1 ? (
                    <Button
                      label={STRINGS.removeBlouse}
                      icon="trash-outline"
                      size="small"
                      variant="dangerGhost"
                      onPress={() => setBlouses(bs => bs.filter(x => x.key !== b.key))}
                    />
                  ) : undefined}
                >
                  <Segmented
                    style={styles.segment}
                    value={b.type}
                    onChange={t => setType(b, t)}
                    options={[
                      { value: 'astar', label: STRINGS.astar },
                      { value: 'designer', label: STRINGS.designer },
                    ]}
                  />
                  <TextField
                    label={STRINGS.blouseName}
                    value={b.name}
                    onChangeValue={v => updateBlouse(b.key, { name: v })}
                    placeholder={STRINGS.blouseNamePlaceholder}
                  />
                  <Row style={styles.priceRow}>
                    <Text style={styles.priceLabel}>{STRINGS.price}</Text>
                    <NumericTextInput
                      style={styles.priceInput}
                      value={b.price}
                      min={0}
                      onChangeValue={n => updateBlouse(b.key, { price: n, priceEdited: true })}
                    />
                  </Row>
                  <View style={styles.checkbox}>
                    <Checkbox
                      label={STRINGS.emergencyCheck}
                      value={b.emergency}
                      color={COLORS.emergency}
                      onChange={v => updateBlouse(b.key, { emergency: v })}
                    />
                  </View>
                </Section>
              ))}
              <Actions page>
                <Button
                  label={STRINGS.addBlouse}
                  icon="add-circle-outline"
                  variant="secondary"
                  onPress={() => setBlouses(bs => [...bs, newBlouse()])}
                />
              </Actions>
              <Section>
                <Row style={styles.totalRow}>
                  <Text style={styles.totalLabel}>{STRINGS.blouses(total)}</Text>
                  <Text style={styles.totalValue}>{STRINGS.orderTotal(priceTotal)}</Text>
                </Row>
                {eCount > 0 && gCount > 0 && <Text style={styles.hint}>{STRINGS.splitHint}</Text>}
              </Section>
              <Section title={STRINGS.moneyTitle} subtitle={STRINGS.moneyHint}>
                <NumberInput label={STRINGS.moneyAdvance} value={advance} onChangeValue={setAdvance} />
                <NumberInput label={STRINGS.moneyPreviousDue} value={previousDue} onChangeValue={setPreviousDue} />
              </Section>
            </>
          )}

          {/* ── Step 3: Delivery ── */}
          {step === 2 && plan && (
            <>
              <Section title={STRINGS.summary}>
                <Text style={styles.summaryName}>{customerName}</Text>
                {blouses.map((b, i) => (
                  <Row key={b.key} style={styles.summaryRow}>
                    <Text style={styles.summaryText}>
                      {i + 1}. {b.name.trim() || (b.type === 'astar' ? STRINGS.astar : STRINGS.designer)}
                      {b.name.trim() ? ` (${b.type === 'astar' ? STRINGS.astar : STRINGS.designer})` : ''}
                    </Text>
                    {b.emergency && <Tag label={STRINGS.emergency} color={COLORS.emergency} />}
                    <Text style={styles.summaryPrice}>₹{b.price}</Text>
                  </Row>
                ))}
                <Text style={styles.summaryTotal}>{STRINGS.orderTotal(priceTotal)}</Text>
              </Section>

              {plan.parts.map(p => (
                <PartCard
                  key={p.priority}
                  part={p}
                  custom={customDate[p.priority]}
                  extra={extras[p.priority]}
                  minDate={addDays(today, 1)}
                  offDates={daysOff.map(d => d.date)}
                  onCustom={v => setCustom(p.priority, v)}
                  onTakeExtra={x => setExtras(e => ({ ...e, [p.priority]: x }))}
                />
              ))}

              {plan.both && (
                <AltCard
                  quote={eCount === 0 ? plan.both.emergency : plan.both.general}
                  label={eCount === 0 ? STRINGS.allEmergency : STRINGS.allGeneral}
                  onPress={() => setAllEmergency(eCount === 0)}
                />
              )}

              <Section title={STRINGS.capacity}>
                <CapacityStrip weeks={plan.strip} />
              </Section>
            </>
          )}
        </ScrollView>

        {/* Sticky footer: back / next */}
        <Row style={styles.footer}>
          {step > 0 && (
            <Button label={STRINGS.back} icon="chevron-back" variant="secondary" onPress={() => goTo(step - 1)} style={styles.footerBack} />
          )}
          {step === 0 && (
            <Button
              label={STRINGS.next}
              icon="chevron-forward"
              iconRight
              onPress={nextFromCustomer}
              disabled={mode === 'old' ? !selected : !name.trim()}
              style={styles.footerNext}
            />
          )}
          {step === 1 && (
            <Button label={STRINGS.next} icon="chevron-forward" iconRight onPress={nextFromBlouses} disabled={total === 0} style={styles.footerNext} />
          )}
          {step === 2 && (
            <Button label={STRINGS.confirmOrder} icon="checkmark" onPress={handleConfirm} disabled={!canConfirm} style={styles.footerNext} />
          )}
        </Row>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── One delivery of the order ─────────────────────────────────
function PartCard({
  part, custom, extra, minDate, offDates, onCustom, onTakeExtra,
}: {
  part: PlannedPart;
  custom: string;
  extra?: WeekExtra;
  minDate: string;
  offDates: string[];
  onCustom: (v: string) => void;
  onTakeExtra: (x: WeekExtra) => void;
}) {
  const emergency = part.priority === 'emergency';
  const check = part.check;
  return (
    <Section
      title={`${emergency ? '⚡ ' + STRINGS.emergencyDelivery : '📅 ' + STRINGS.generalDelivery}`}
      count={part.count}
      accent={emergency ? COLORS.emergency : COLORS.tagGeneral}
    >
      <View style={styles.dateBlock}>
        <Text style={styles.dateValue}>
          {part.chosen ? fmtLong(part.chosen) : part.offered ? fmtLong(part.offered) : STRINGS.noFreeDate}
        </Text>
        {part.custom && part.offered && <Text style={styles.dateSub}>{STRINGS.earliest(fmt(part.offered))}</Text>}
        {part.stitchDays.length > 0 && (
          <Text style={styles.dateSub}>
            {STRINGS.stitchDays([...new Set(part.stitchDays)].map(fmtShort).join(', '))}
          </Text>
        )}
      </View>
      <Separator inset={0} />
      <DateField
        label={STRINGS.customDate}
        value={custom}
        onChange={onCustom}
        minDate={minDate}
        offDates={offDates}
        clearable
      />
      {check?.ok && (
        <Text style={styles.okText}>
          ✓ {STRINGS.customDateOk}{extra ? ` (${STRINGS.extraTaken(extra.n, fmtShort(extra.weekStart))})` : ''}
        </Text>
      )}
      {check && !check.ok && (
        <View>
          <Text style={styles.errTxt}>
            {STRINGS.reason[check.reason ?? 'full']}
            {check.fullDay ? ` (${fmtShort(check.fullDay)})` : ''}
          </Text>
          <Actions>
            {check.extraNeeded && (
              <Button
                label={STRINGS.takeExtra(check.extraNeeded.n, fmtShort(check.extraNeeded.weekStart))}
                size="small"
                variant="secondary"
                onPress={() => onTakeExtra(check.extraNeeded!)}
              />
            )}
            {check.nearestValid && (
              <Button
                label={STRINGS.pickNearest(fmt(check.nearestValid))}
                icon="calendar-outline"
                size="small"
                variant="secondary"
                onPress={() => onCustom(check.nearestValid!)}
              />
            )}
          </Actions>
        </View>
      )}
    </Section>
  );
}

function AltCard({ quote: q, label, onPress }: { quote: QuotePart; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <View style={styles.altCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.altLabel}>{label}</Text>
          <Text style={styles.altHint}>{STRINGS.tapToSwitch}</Text>
        </View>
        <Text style={styles.altValue}>{q.dateOffered ? fmt(q.dateOffered) : STRINGS.noFreeDate}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgLight },
  content: { paddingBottom: LAYOUT.screenBottom },
  segment: { marginHorizontal: LAYOUT.inset, marginVertical: SPACE.sm },
  muted: { fontSize: FONT.size, color: COLORS.textMuted, paddingHorizontal: LAYOUT.inset, paddingVertical: LAYOUT.rowY },
  hint: { fontSize: FONT.sizeSmall, color: COLORS.textMuted, paddingHorizontal: LAYOUT.inset, paddingBottom: SPACE.sm },
  dupHint: {
    flexDirection: 'row', gap: SPACE.sm, alignItems: 'center', marginHorizontal: LAYOUT.inset, padding: SPACE.md,
    borderRadius: LAYOUT.radiusSm, backgroundColor: '#EAF2FB',
  },
  dupText: { flex: 1, fontSize: FONT.sizeSmall, color: COLORS.tagGeneral, fontWeight: FONT.weightMedium },
  selectedCustomer: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, padding: LAYOUT.inset },
  custRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: LAYOUT.inset, paddingVertical: LAYOUT.rowY },
  custName: { fontSize: FONT.sizeLarge, fontWeight: FONT.weightBold, color: COLORS.text },
  custSub: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary, marginTop: 2 },
  checkbox: { paddingHorizontal: LAYOUT.inset },
  priceRow: { paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.sm, gap: SPACE.md },
  priceLabel: { fontSize: FONT.size, color: COLORS.text, fontWeight: FONT.weightMedium, flex: 1 },
  priceInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: LAYOUT.radiusSm,
    padding: SPACE.md,
    fontSize: FONT.sizeLarge,
    backgroundColor: COLORS.bgInput,
    width: 120,
    textAlign: 'right',
    color: COLORS.text,
  },
  totalRow: { justifyContent: 'space-between', paddingHorizontal: LAYOUT.inset, paddingVertical: LAYOUT.rowY },
  totalLabel: { fontSize: FONT.size, color: COLORS.textSecondary },
  totalValue: { fontSize: FONT.sizeLarge, fontWeight: FONT.weightBold, color: COLORS.text },
  summaryName: {
    fontSize: FONT.sizeLarge, fontWeight: FONT.weightBold, color: COLORS.text,
    paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.sm,
  },
  summaryRow: { paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.xs, gap: SPACE.sm },
  summaryText: { fontSize: FONT.size, color: COLORS.text, flex: 1 },
  summaryPrice: { fontSize: FONT.size, color: COLORS.text, fontWeight: FONT.weightMedium },
  summaryTotal: {
    fontSize: FONT.sizeLarge, fontWeight: FONT.weightBold, color: COLORS.text, textAlign: 'right',
    paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.sm,
  },
  dateBlock: { paddingHorizontal: LAYOUT.inset, paddingVertical: LAYOUT.rowY },
  dateValue: { fontSize: 24, fontWeight: FONT.weightBold, color: COLORS.text },
  dateSub: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary, marginTop: SPACE.xs },
  okText: { color: COLORS.success, fontSize: FONT.size, paddingHorizontal: LAYOUT.inset, paddingBottom: SPACE.sm },
  errTxt: { color: COLORS.danger, fontSize: FONT.size, paddingHorizontal: LAYOUT.inset },
  altCard: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: LAYOUT.gutter, marginTop: LAYOUT.sectionGap,
    padding: LAYOUT.inset, borderRadius: LAYOUT.radius, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: COLORS.textMuted, backgroundColor: COLORS.bg,
  },
  altLabel: { fontSize: FONT.size, color: COLORS.text, fontWeight: FONT.weightMedium },
  altHint: { fontSize: FONT.sizeSmall, color: COLORS.tagGeneral, marginTop: 2 },
  altValue: { fontSize: FONT.sizeLarge, fontWeight: FONT.weightBold, color: COLORS.textSecondary },
  footer: {
    gap: LAYOUT.buttonGap, paddingHorizontal: LAYOUT.gutter, paddingVertical: SPACE.sm, backgroundColor: COLORS.bg,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  footerBack: { flex: 1 },
  footerNext: { flex: 2 },
});
