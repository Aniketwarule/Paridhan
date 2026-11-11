// ============================================================
// Poshakh – New Order (3 short steps)
//   1. Customer  – search old customers, or add a new one
//   2. Work      – tap tiles to add stitching and small work
//   3. Delivery  – engine quote (or a free date for small work), money, confirm
// After saving: send the bill or start the next order.
// ============================================================
import React, { useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
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
import { orderNo } from '../utils/order';
import { addDays, checkDate, quote, quoteBoth, rebuildSchedule, weekStrip } from '../engine';
import type { DateCheck, PriorPart, Priority, QuotePart, QuotePartRequest, WeekExtra } from '../engine';
import type { CustomerSummary, OrderWithDetails, WorkKey } from '../types';
import {
  Actions,
  Button,
  CapacityStrip,
  COLORS,
  DateField,
  FONT,
  LAYOUT,
  NumberInput,
  NumericTextInput,
  Row,
  ScreenHeader,
  Section,
  Separator,
  SPACE,
  Stepper,
  Steps,
  Tag,
  TextField,
  TileGrid,
  useKeepInputVisible,
  useKeyboardVisible,
  WorkTile,
} from '../components/ui';
import { OrderBillModal } from '../components/OrderBill';
import { fmt, fmtLong, fmtShort, isDate, nowIso } from '../utils/date';
import { ALTER_KINDS, blouseLabel, isStitchWork, OTHER_SMALL_KINDS, rateFor, smallWorkLabel, STITCH_TYPES, workLabel, workSummary } from '../utils/labels';
import {
  addWork,
  draftGroups,
  draftParts,
  draftTotal,
  emergencyCount,
  fullDayCount,
  lineTotal,
  missingName,
  pieceNeedsName,
  quoteRequests,
  removeLastPiece,
  smallLines,
  stitchCount,
  stitchLines,
  updatePiece,
  type DraftGroup,
  type DraftLine,
  type DraftPiece,
} from '../utils/orderDraft';

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

const NO_DATES: Record<Priority, string> = { emergency: '', general: '' };
/** Old customers listed at a time; the search box finds the rest. */
const CUSTOMER_ROWS = 10;

const groupLabel = (g: DraftGroup) => (isStitchWork(g.work)
  ? blouseLabel({ type: g.work, name: g.name || undefined })
  : smallWorkLabel({ kind: g.work, name: g.name || undefined }));

/** "3 blouses, 1 dress, Piko" for the bar above the Next button. */
const draftSummary = (lines: DraftLine[]) => workSummary(
  stitchLines(lines).flatMap(l => l.pieces.map(() => ({ type: l.work }))),
  draftGroups(smallLines(lines)).map(g => ({ kind: g.work, name: g.name || undefined, qty: g.qty })),
);

export function NewOrderScreen() {
  const insets = useSafeAreaInsets();
  const { settings, daysOff, today, version, buildInput, refresh } = useAppContext();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  /** Scroll down to the order list once the line just opened has been drawn. */
  const showListNext = useRef(false);
  const keepVisible = useKeepInputVisible(scrollRef);
  const typing = useKeyboardVisible();

  const [step, setStep] = useState(0);

  // ── Step 1: customer ─────────────────────────────────────────
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [nameError, setNameError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CustomerSummary | null>(null);

  // ── Step 2: work ─────────────────────────────────────────────
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [openLine, setOpenLine] = useState<number | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  // ── Step 3: delivery ─────────────────────────────────────────
  const [customDate, setCustomDate] = useState<Record<Priority, string>>(NO_DATES);
  const [smallDate, setSmallDate] = useState('');
  const [advance, setAdvance] = useState(0);
  const [previousDue, setPreviousDue] = useState(0);
  const [extras, setExtras] = useState<Partial<Record<Priority, WeekExtra>>>({});

  // ── After saving ─────────────────────────────────────────────
  const [saved, setSaved] = useState<OrderWithDetails | null>(null);
  const [billOpen, setBillOpen] = useState(false);

  const customers = useMemo(
    () => (!adding && !selected ? DB.searchCustomers(query, CUSTOMER_ROWS) : []),
    // `version` changes after every DB write: reload then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adding, selected, query, version],
  );
  const duplicate = useMemo(
    () => (adding && name.trim().length > 1 ? DB.findCustomerByName(name) : null),
    [adding, name],
  );

  const pieces = stitchCount(lines);
  const emergencyPieces = emergencyCount(lines);
  const priceTotal = draftTotal(lines);
  const customerName = selected?.name ?? name.trim();
  const hasSmall = smallLines(lines).length > 0;

  // ── Quote (only on the delivery step, and only for stitching) ──
  const plan = useMemo(() => {
    if (step !== 2 || pieces === 0) return null;
    const base = buildInput();
    const taken = Object.values(extras).filter((x): x is WeekExtra => !!x);
    const input = { ...base, weekExtras: [...(base.weekExtras ?? []), ...taken] };

    const req: QuotePartRequest[] = quoteRequests(lines);
    const quoted = quote(input, req);
    // Single-priority orders also show what the other priority would give.
    const both = req.length === 1 ? quoteBoth(input, pieces, fullDayCount(lines)) : null;

    const prior: PriorPart[] = [];
    let changed = false;
    const parts: PlannedPart[] = req.map((r, i) => {
      const q = quoted[i];
      const c = customDate[r.priority];
      let p: PlannedPart;
      if (isDate(c)) {
        const check = checkDate(input, r, c, prior);
        p = { priority: r.priority, count: r.count, offered: q.dateOffered, chosen: check.ok ? c : null, custom: true, check, stitchDays: [] };
        changed = true;
      } else if (changed && q.dateOffered) {
        // An earlier part has its own date: re-check this part's offered date against it.
        const check = checkDate(input, r, q.dateOffered, prior);
        const chosen = check.ok ? q.dateOffered : check.nearestValid ?? null;
        p = { priority: r.priority, count: r.count, offered: chosen, chosen, custom: false, stitchDays: check.ok ? q.stitchDays : [] };
      } else {
        p = { priority: r.priority, count: r.count, offered: q.dateOffered, chosen: q.dateOffered, custom: false, stitchDays: q.stitchDays };
      }
      if (p.chosen) prior.push({ count: r.count, priority: r.priority, date: p.chosen, fullDayCount: r.fullDayCount });
      return p;
    });

    const strip = weekStrip(input, rebuildSchedule(input), 5, quoted.flatMap(q => q.weekUsage));
    return { parts, both, strip };
    // `version` changes after every DB write: re-quote then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pieces, lines, customDate, extras, buildInput, version]);

  const canConfirm = pieces > 0 ? !!plan && plan.parts.every(p => p.chosen) : isDate(smallDate);

  // ── Navigation between steps ─────────────────────────────────
  const goTo = (s: number) => {
    Keyboard.dismiss();
    setStep(s);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const nextFromCustomer = () => {
    if (adding && !name.trim()) { setNameError(STRINGS.customerNameRequired); return; }
    if (!adding && !selected) return;
    setNameError('');
    goTo(1);
  };

  const nextFromWork = () => {
    const unnamed = lines.find(missingName);
    if (unnamed) {
      setShowErrors(true);
      setOpenLine(unnamed.key);
      showListNext.current = true;
      scrollRef.current?.scrollToEnd({ animated: true });
      return;
    }
    setCustomDate(NO_DATES);
    setExtras({});
    setSmallDate(addDays(today, 2));
    goTo(2);
  };

  // ── Customer ─────────────────────────────────────────────────
  const startAdding = () => {
    const typed = query.trim();
    const isNumber = /^[\d\s+-]+$/.test(typed);
    setName(typed && !isNumber ? typed : '');
    setPhone(isNumber ? typed : '');
    setNameError('');
    setAdding(true);
  };

  // ── Work ─────────────────────────────────────────────────────
  const countOf = (work: WorkKey) => lines.find(l => l.work === work)?.pieces.length ?? 0;
  const noteFor = (work: WorkKey) => {
    const rate = rateFor(settings, work);
    return rate > 0 ? `₹${rate}` : undefined;
  };

  const tapWork = (work: WorkKey) => {
    const price = rateFor(settings, work);
    const res = addWork(lines, work, price);
    setLines(res.lines);
    // No price yet, or a name is needed: open the line and bring it into view to type it.
    const added = res.lines.find(l => l.key === res.key)?.pieces.at(-1);
    const needsTyping = work === 'other' || added?.price === 0;
    showListNext.current = needsTyping;
    if (needsTyping) setOpenLine(res.key);
  };

  const addToLine = (line: DraftLine) => setLines(addWork(lines, line.work, rateFor(settings, line.work)).lines);

  const setAllEmergency = (on: boolean) => {
    setLines(ls => ls.map(l => (isStitchWork(l.work)
      ? { ...l, pieces: l.pieces.map(p => ({ ...p, emergency: on })) }
      : l)));
    setCustomDate(NO_DATES);
    setExtras({});
  };

  const setCustom = (pr: Priority, v: string) => {
    setCustomDate(d => ({ ...d, [pr]: v }));
    setExtras(x => ({ ...x, [pr]: undefined }));
  };

  // ── Save ─────────────────────────────────────────────────────
  const handleConfirm = () => {
    if (!canConfirm) return;
    const customerId = selected
      ? selected.id
      : DB.createCustomer(name.trim(), phone.trim() || undefined);
    const dates: Partial<Record<Priority, string>> = {};
    for (const p of plan?.parts ?? []) dates[p.priority] = p.chosen!;
    const orderId = DB.createOrder(customerId, nowIso(), draftParts(lines, dates, smallDate), undefined, { advance, previousDue });
    for (const pr of ['emergency', 'general'] as Priority[]) {
      const x = extras[pr];
      if (x && isDate(customDate[pr])) DB.addWeekExtra(x);
    }
    refresh();
    setSaved(DB.loadOrderDetails(orderId));
    Keyboard.dismiss();
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const resetForm = () => {
    setStep(0); setAdding(false); setName(''); setPhone(''); setQuery(''); setSelected(null);
    setLines([]); setOpenLine(null); setShowErrors(false); setCustomDate(NO_DATES); setSmallDate(''); setExtras({});
    setAdvance(0); setPreviousDue(0); setSaved(null); setBillOpen(false);
  };

  // ── Saved ────────────────────────────────────────────────────
  if (saved) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScreenHeader title={STRINGS.newOrderTitle} />
        <ScrollView contentContainerStyle={styles.content}>
          <Section accent={COLORS.success}>
            <View style={styles.savedBlock}>
              <Ionicons name="checkmark-circle" size={56} color={COLORS.success} />
              <Text style={styles.savedTitle}>{STRINGS.orderSaved}</Text>
              <Text style={styles.savedSub}>{STRINGS.orderSavedNo(orderNo(saved.order.id))}</Text>
              <Text style={styles.savedSub}>{saved.customer.name} · {STRINGS.orderTotal(priceTotal)}</Text>
            </View>
          </Section>
          <Actions page>
            <Button label={STRINGS.sendBill} icon="receipt-outline" onPress={() => setBillOpen(true)} />
            <Button label={STRINGS.newOrderAgain} icon="add-circle-outline" variant="secondary" onPress={resetForm} />
          </Actions>
        </ScrollView>
        {billOpen && <OrderBillModal card={saved} onClose={() => setBillOpen(false)} />}
      </View>
    );
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    // Android apps are edge-to-edge: the window no longer shrinks for the keyboard, so the
    // view must make room itself on every platform, or the boxes stay under the keyboard.
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScreenHeader
          title={STRINGS.newOrderTitle}
          subtitle={step > 0 && customerName ? customerName : undefined}
        />
        <Steps steps={[STRINGS.stepCustomer, STRINGS.stepWork, STRINGS.stepDelivery]} current={step} onPress={goTo} />

        <ScrollView
          ref={scrollRef}
          {...keepVisible}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            if (!showListNext.current) return;
            showListNext.current = false;
            scrollRef.current?.scrollToEnd({ animated: true });
          }}
        >
          {/* ── Step 1: Customer ── */}
          {step === 0 && (
            <Section title={STRINGS.stepCustomer}>
              {selected ? (
                <View style={styles.selectedCustomer}>
                  <Ionicons name="person-circle" size={44} color={COLORS.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.custName}>{selected.name}</Text>
                    {selected.phone ? <Text style={styles.custSub}>{selected.phone}</Text> : null}
                  </View>
                  <Button label={STRINGS.change} icon="swap-horizontal" size="small" variant="secondary" onPress={() => setSelected(null)} />
                </View>
              ) : adding ? (
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
                      onPress={() => { setAdding(false); setSelected({ ...duplicate, orderCount: 0 }); }}
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
                  <Actions>
                    <Button label={STRINGS.backToSearch} icon="search" size="small" variant="ghost" onPress={() => setAdding(false)} />
                  </Actions>
                </>
              ) : (
                <>
                  <TextField
                    value={query}
                    onChangeValue={setQuery}
                    placeholder={STRINGS.customerSearch}
                    autoCapitalize="words"
                  />
                  <Actions>
                    <Button
                      label={query.trim() ? STRINGS.addCustomerNamed(query.trim()) : STRINGS.newCustomer}
                      icon="person-add-outline"
                      size="small"
                      variant="secondary"
                      onPress={startAdding}
                    />
                  </Actions>
                  {customers.length === 0 && query.trim() ? (
                    <Text style={styles.muted}>{STRINGS.customerNoMatch}</Text>
                  ) : customers.map(c => (
                    <View key={c.id}>
                      <Separator inset={0} />
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

          {/* ── Step 2: Work ── */}
          {step === 1 && (
            <>
              {/* Tiles come first and never move, so repeated taps can't land on the wrong one. */}
              <Section title={STRINGS.workGroupStitching}>
                <TileGrid>
                  {STITCH_TYPES.map(t => (
                    <WorkTile
                      key={t}
                      label={workLabel(t)}
                      note={t === 'navvari' ? [STRINGS.fullDay, noteFor(t)].filter(Boolean).join(' · ') : noteFor(t)}
                      count={countOf(t)}
                      onPress={() => tapWork(t)}
                    />
                  ))}
                </TileGrid>
              </Section>

              <Section title={STRINGS.workGroupAlter} subtitle={STRINGS.workSmallHint}>
                <TileGrid>
                  {ALTER_KINDS.map(k => (
                    <WorkTile key={k} label={workLabel(k)} note={noteFor(k)} count={countOf(k)} onPress={() => tapWork(k)} />
                  ))}
                </TileGrid>
              </Section>

              <Section title={STRINGS.workGroupOther} subtitle={STRINGS.workSmallHint}>
                <TileGrid>
                  {OTHER_SMALL_KINDS.map(k => (
                    <WorkTile key={k} label={workLabel(k)} note={noteFor(k)} count={countOf(k)} onPress={() => tapWork(k)} />
                  ))}
                </TileGrid>
              </Section>

              {lines.length > 0 && (
                <Section title={STRINGS.workInOrder} count={lines.reduce((s, l) => s + l.pieces.length, 0)}>
                  {lines.map((l, i) => (
                    <View key={l.key}>
                      {i > 0 && <Separator />}
                      <LineRow
                        line={l}
                        open={openLine === l.key}
                        showError={showErrors}
                        onToggle={() => {
                          // The last line opens below the screen's edge: bring it into view.
                          showListNext.current = openLine !== l.key && i === lines.length - 1;
                          setOpenLine(o => (o === l.key ? null : l.key));
                        }}
                        onAdd={() => addToLine(l)}
                        onRemoveLast={() => setLines(ls => removeLastPiece(ls, l.key))}
                        onPiece={(pieceKey, patch) => setLines(ls => updatePiece(ls, l.key, pieceKey, patch))}
                      />
                    </View>
                  ))}
                  <Separator inset={0} />
                  <Row style={styles.totalRow}>
                    <Text style={styles.totalValue}>{STRINGS.orderTotal(priceTotal)}</Text>
                  </Row>
                  {emergencyPieces > 0 && emergencyPieces < pieces && <Text style={styles.hint}>{STRINGS.splitHint}</Text>}
                </Section>
              )}
            </>
          )}

          {/* ── Step 3: Delivery ── */}
          {step === 2 && (
            <>
              <Section title={STRINGS.summary}>
                <Text style={styles.summaryName}>{customerName}</Text>
                {draftGroups(lines).map((g, i) => (
                  <Row key={i} style={styles.summaryRow}>
                    <Text style={styles.summaryText}>{groupLabel(g)}{g.qty > 1 ? ` × ${g.qty}` : ''}</Text>
                    {g.emergency && <Tag label={STRINGS.emergency} color={COLORS.emergency} />}
                    <Text style={styles.summaryPrice}>₹{g.price * g.qty}</Text>
                  </Row>
                ))}
                <Text style={styles.summaryTotal}>{STRINGS.orderTotal(priceTotal)}</Text>
              </Section>

              {pieces === 0 ? (
                <Section title={STRINGS.smallOnlyDate} subtitle={STRINGS.smallOnlyHint} accent={COLORS.tagGeneral}>
                  <DateField
                    value={smallDate}
                    onChange={setSmallDate}
                    minDate={today}
                    offDates={daysOff.map(d => d.date)}
                  />
                </Section>
              ) : plan && (
                <>
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
                  {hasSmall && <Text style={styles.noteBetween}>{STRINGS.smallWithOrder}</Text>}

                  {plan.both && (
                    <AltCard
                      quote={emergencyPieces === 0 ? plan.both.emergency : plan.both.general}
                      label={emergencyPieces === 0 ? STRINGS.allEmergency : STRINGS.allGeneral}
                      onPress={() => setAllEmergency(emergencyPieces === 0)}
                    />
                  )}

                  <Section title={STRINGS.capacity}>
                    <CapacityStrip weeks={plan.strip} />
                  </Section>
                </>
              )}

              <Section title={STRINGS.moneyTitle} subtitle={STRINGS.moneyHint}>
                <NumberInput inline label={STRINGS.moneyAdvance} value={advance} onChangeValue={setAdvance} />
                <NumberInput inline label={STRINGS.moneyPreviousDue} value={previousDue} onChangeValue={setPreviousDue} />
                {(advance > 0 || previousDue > 0) && (
                  <Row style={styles.totalRow}>
                    <Text style={styles.totalValue}>{STRINGS.ordersBalance(Math.max(0, priceTotal + previousDue - advance))}</Text>
                  </Row>
                )}
              </Section>
            </>
          )}
        </ScrollView>

        {/* What is in the order so far; tap to see the list. */}
        {/* Hidden while typing: on a small phone every line of space is needed to see the boxes. */}
        {step === 1 && lines.length > 0 && !typing && (
          <TouchableOpacity style={styles.summaryBar} onPress={() => scrollRef.current?.scrollToEnd({ animated: true })} activeOpacity={0.7}>
            <Text style={styles.summaryBarText} numberOfLines={1}>{draftSummary(lines)}</Text>
            <Text style={styles.summaryBarTotal}>₹{priceTotal}</Text>
            <Ionicons name="chevron-down" size={20} color={COLORS.accent} />
          </TouchableOpacity>
        )}

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
              disabled={adding ? !name.trim() : !selected}
              style={styles.footerNext}
            />
          )}
          {step === 1 && (
            <Button label={STRINGS.next} icon="chevron-forward" iconRight onPress={nextFromWork} disabled={lines.length === 0} style={styles.footerNext} />
          )}
          {step === 2 && (
            <Button label={STRINGS.confirmOrder} icon="checkmark" onPress={handleConfirm} disabled={!canConfirm} style={styles.footerNext} />
          )}
        </Row>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── One kind of work in the order ─────────────────────────────
function LineRow({
  line, open, showError, onToggle, onAdd, onRemoveLast, onPiece,
}: {
  line: DraftLine;
  open: boolean;
  showError: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onRemoveLast: () => void;
  onPiece: (pieceKey: number, patch: Partial<DraftPiece>) => void;
}) {
  const stitching = isStitchWork(line.work);
  const isOther = line.work === 'other';
  const qty = line.pieces.length;
  const samePrice = line.pieces.every(p => p.price === line.pieces[0].price);
  const anyEmergency = line.pieces.some(p => p.emergency);
  return (
    <View>
      <Row style={styles.lineRow}>
        <TouchableOpacity style={styles.lineMain} onPress={onToggle} activeOpacity={0.7}>
          <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={20} color={COLORS.textMuted} />
          <View style={{ flex: 1 }}>
            <Text style={styles.lineTitle}>{workLabel(line.work)}</Text>
            <Text style={styles.lineSub}>
              ₹{lineTotal(line)}{qty > 1 && samePrice ? ` (${STRINGS.billEach(line.pieces[0].price)})` : ''}
            </Text>
            {(anyEmergency || line.work === 'navvari') && (
              <Row style={{ flexWrap: 'wrap' }}>
                {anyEmergency && <Tag label={STRINGS.emergency} color={COLORS.emergency} />}
                {line.work === 'navvari' && <Tag label={STRINGS.fullDay} color={COLORS.tagGeneral} />}
              </Row>
            )}
          </View>
        </TouchableOpacity>
        <Stepper
          value={qty}
          onChange={n => (n > qty ? onAdd() : onRemoveLast())}
          removeLabel={STRINGS.removeWork}
        />
      </Row>
      {open && (
        <View style={styles.lineMore}>
          <Row style={styles.pieceRow}>
            <View style={styles.pieceNo} />
            <Text style={[styles.pieceHead, styles.pieceName]}>{isOther ? STRINGS.workOtherName : STRINGS.workName}</Text>
            <Text style={[styles.pieceHead, styles.piecePrice]}>{STRINGS.workPriceHead}</Text>
            {stitching && <Text style={[styles.pieceHead, styles.pieceUrgent]}>{STRINGS.emergency}</Text>}
          </Row>
          {line.pieces.map((p, i) => {
            const nameMissing = showError && pieceNeedsName(line.work, p);
            return (
              <Row key={p.key} style={styles.pieceRow}>
                <Text style={[styles.pieceNo, styles.pieceNoText]}>{i + 1}</Text>
                <TextInput
                  style={[styles.pieceInput, styles.pieceName, nameMissing && styles.pieceInputError]}
                  value={p.name}
                  onChangeText={v => onPiece(p.key, { name: v })}
                  placeholder={isOther ? STRINGS.workOtherPlaceholder : STRINGS.workNamePlaceholder}
                  placeholderTextColor={COLORS.textMuted}
                  accessibilityLabel={isOther ? STRINGS.workOtherName : STRINGS.workName}
                />
                <NumericTextInput
                  style={[styles.pieceInput, styles.piecePrice, styles.piecePriceInput]}
                  value={p.price}
                  min={0}
                  onChangeValue={n => onPiece(p.key, { price: n })}
                  accessibilityLabel={STRINGS.workPriceHead}
                />
                {stitching && (
                  <View style={styles.pieceUrgent}>
                    <TouchableOpacity
                      onPress={() => onPiece(p.key, { emergency: !p.emergency })}
                      hitSlop={SPACE.sm}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: p.emergency }}
                      accessibilityLabel={STRINGS.emergency}
                    >
                      <Ionicons
                        name={p.emergency ? 'checkbox' : 'square-outline'}
                        size={28}
                        color={p.emergency ? COLORS.emergency : COLORS.textMuted}
                      />
                    </TouchableOpacity>
                  </View>
                )}
              </Row>
            );
          })}
          {showError && missingName(line) && <Text style={styles.pieceError}>{STRINGS.workOtherRequired}</Text>}
        </View>
      )}
    </View>
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
  muted: { fontSize: FONT.size, color: COLORS.textMuted, paddingHorizontal: LAYOUT.inset, paddingVertical: LAYOUT.rowY },
  hint: { fontSize: FONT.sizeSmall, color: COLORS.textMuted, paddingHorizontal: LAYOUT.inset, paddingBottom: SPACE.sm },
  noteBetween: {
    fontSize: FONT.sizeSmall, color: COLORS.textSecondary,
    paddingHorizontal: LAYOUT.inset, marginTop: SPACE.sm,
  },
  dupHint: {
    flexDirection: 'row', gap: SPACE.sm, alignItems: 'center', marginHorizontal: LAYOUT.inset, padding: SPACE.md,
    borderRadius: LAYOUT.radiusSm, backgroundColor: COLORS.infoBg,
  },
  dupText: { flex: 1, fontSize: FONT.sizeSmall, color: COLORS.tagGeneral, fontWeight: FONT.weightMedium },
  selectedCustomer: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, padding: LAYOUT.inset },
  custRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: LAYOUT.inset, paddingVertical: LAYOUT.rowY },
  custName: { fontSize: FONT.sizeLarge, fontWeight: FONT.weightBold, color: COLORS.text },
  custSub: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary, marginTop: 2 },
  lineRow: { gap: SPACE.sm, paddingRight: LAYOUT.inset, paddingLeft: SPACE.md, paddingVertical: SPACE.sm },
  lineMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingVertical: SPACE.xs },
  lineTitle: { fontSize: FONT.size, fontWeight: FONT.weightBold, color: COLORS.text },
  lineSub: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary, marginTop: 2 },
  lineMore: { backgroundColor: COLORS.brandTint, paddingBottom: SPACE.md },
  pieceRow: { gap: SPACE.sm, paddingHorizontal: LAYOUT.inset, paddingTop: SPACE.sm },
  pieceNo: { width: 18 },
  pieceNoText: { fontSize: FONT.size, fontWeight: FONT.weightMedium, color: COLORS.textSecondary },
  pieceHead: { fontSize: FONT.sizeXSmall, fontWeight: FONT.weightMedium, color: COLORS.textSecondary },
  pieceName: { flex: 1, minWidth: 0 },
  piecePrice: { width: 72 },
  pieceUrgent: { width: 52, alignItems: 'center', textAlign: 'center' },
  pieceInput: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: LAYOUT.radiusSm, backgroundColor: COLORS.bg,
    paddingHorizontal: SPACE.sm, paddingVertical: SPACE.sm, fontSize: FONT.size, color: COLORS.text,
  },
  pieceInputError: { borderColor: COLORS.danger },
  piecePriceInput: { textAlign: 'right' },
  pieceError: { fontSize: FONT.sizeSmall, color: COLORS.danger, paddingHorizontal: LAYOUT.inset, paddingTop: SPACE.xs },
  totalRow: { justifyContent: 'flex-end', paddingHorizontal: LAYOUT.inset, paddingVertical: LAYOUT.rowY },
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
  savedBlock: { alignItems: 'center', gap: SPACE.xs, padding: SPACE.xl },
  savedTitle: { fontSize: FONT.sizeTitle, fontWeight: FONT.weightBold, color: COLORS.text },
  savedSub: { fontSize: FONT.size, color: COLORS.textSecondary, textAlign: 'center' },
  summaryBar: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: 44,
    paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.sm, backgroundColor: COLORS.brandTint,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  summaryBarText: { flex: 1, fontSize: FONT.sizeSmall, color: COLORS.text },
  summaryBarTotal: { fontSize: FONT.size, fontWeight: FONT.weightBold, color: COLORS.text },
  footer: {
    gap: LAYOUT.buttonGap, paddingHorizontal: LAYOUT.gutter, paddingVertical: SPACE.sm, backgroundColor: COLORS.bg,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  footerBack: { flex: 1 },
  footerNext: { flex: 2 },
});
