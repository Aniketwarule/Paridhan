// ============================================================
// Poshakh – Settings
// The first page is a short menu: each row says what is set now, so she can see
// everything at a glance and only open what she wants to change. Each topic opens
// on its own page with its own Save, so a change in one place can't be lost
// because of another. Language switches straight away.
// ============================================================
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LANGUAGES, STRINGS } from '../strings';
import { useAppContext } from '../context/AppContext';
import type { AppSettings, WorkKey } from '../types';
import type { Weekday } from '../engine';
import { daysBetween, fmtLong, fmtShort, localToday } from '../utils/date';
import { ALTER_KINDS, daysSummary, OTHER_SMALL_KINDS, rateFor, STITCH_TYPES, WEEK_ORDER, workLabel } from '../utils/labels';
import { isUpiId } from '../utils/upi';
import {
  Actions,
  BrandLogo,
  Button,
  COLORS,
  DateField,
  EmptyState,
  FONT,
  LAYOUT,
  ListRow,
  ModalHeader,
  NumberInput,
  Row,
  ScreenHeader,
  Section,
  Segmented,
  Separator,
  SPACE,
  TextField,
  useKeepInputVisible,
} from '../components/ui';
import * as DB from '../db/database';
import { createBackupFile, NotABackupError, restoreBackupFile } from '../db/backup';

type Page = 'schedule' | 'prices' | 'holidays' | 'shop' | 'backup';

/** Usual prices, grouped the way the New Order screen groups the work. "Other" has none: each one is different. */
const PRICE_GROUPS: { title: () => string; keys: WorkKey[] }[] = [
  { title: () => STRINGS.workGroupStitching, keys: STITCH_TYPES },
  { title: () => STRINGS.workGroupAlter, keys: ALTER_KINDS },
  { title: () => STRINGS.workGroupOther, keys: OTHER_SMALL_KINDS.filter(k => k !== 'other') },
];
const RATE_KEYS = PRICE_GROUPS.flatMap(g => g.keys);

/** A backup older than this is worth a reminder. */
const BACKUP_OLD_DAYS = 7;

// ──────────────────────────────────────────────────────────────
export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { today, settings, daysOff, language, setLanguage, version } = useAppContext();
  const [page, setPage] = useState<Page | null>(null);
  // Bumped when a page closes, so the summaries re-read what was saved.
  const [seen, setSeen] = useState(0);
  const close = () => { setPage(null); setSeen(n => n + 1); };

  useFocusEffect(useCallback(() => { setSeen(n => n + 1); }, []));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read after a page closes or the data changes
  const shop = useMemo(() => DB.getShopInfo(), [seen, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lastBackup = useMemo(() => DB.getLastBackup(), [seen, version]);

  // What each row says is set now.
  const days = settings.workingWeekdays.length > 0
    ? STRINGS.settingsScheduleSummary(daysSummary(settings.workingWeekdays, STRINGS.dayNamesShort), settings.weeklyTarget)
    : STRINGS.settingsNoWorkingDays;
  const priced = RATE_KEYS.filter(k => rateFor(settings, k) > 0);
  const prices = priced.length > 0
    ? STRINGS.settingsPricesSummary(priced.slice(0, 2).map(k => `${workLabel(k)} ₹${rateFor(settings, k)}`).join(' · '), priced.length - 2)
    : STRINGS.settingsPricesNone;
  const upcoming = daysOff.filter(d => d.date >= today);
  const holidays = STRINGS.settingsHolidaysSummary(upcoming.length, upcoming[0] ? fmtShort(upcoming[0].date) : '');
  const backupAge = lastBackup ? daysBetween(lastBackup, today) : null;
  const backupWarn = backupAge === null || backupAge > BACKUP_OLD_DAYS;
  const shopNamed = !!(shop.name || shop.tailor);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title={STRINGS.settingsTitle} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.brand}>
          <BrandLogo width={150} />
        </View>

        <Section title={STRINGS.settingsGroupWork}>
          <ListRow icon="calendar-outline" title={STRINGS.settingsScheduleRow} subtitle={days}
            warn={settings.workingWeekdays.length === 0} onPress={() => setPage('schedule')} />
          <Separator />
          <ListRow icon="pricetag-outline" title={STRINGS.settingsPrices} subtitle={prices} onPress={() => setPage('prices')} />
          <Separator />
          <ListRow icon="sunny-outline" title={STRINGS.settingsDaysOff} subtitle={holidays} onPress={() => setPage('holidays')} />
        </Section>

        <Section title={STRINGS.settingsGroupShop}>
          <ListRow
            icon="receipt-outline"
            title={STRINGS.settingsShop}
            subtitle={!shopNamed ? STRINGS.settingsShopMissing : shop.upi ? `UPI: ${shop.upi}` : STRINGS.settingsUpiMissing}
            warn={!shopNamed || !shop.upi}
            onPress={() => setPage('shop')}
          />
        </Section>

        <Section title={STRINGS.settingsGroupApp}>
          <ListRow icon="language-outline" title={STRINGS.settingsLanguage} />
          <Segmented
            style={styles.language}
            value={language}
            onChange={setLanguage}
            options={LANGUAGES.map(l => ({ value: l.code, label: l.label }))}
          />
          <Separator />
          <ListRow
            icon="cloud-upload-outline"
            title={STRINGS.settingsBackup}
            subtitle={backupAge === null ? STRINGS.settingsNoBackup : STRINGS.settingsLastBackup(backupAge)}
            warn={backupWarn}
            onPress={() => setPage('backup')}
          />
        </Section>
      </ScrollView>

      <Modal visible={page !== null} animationType="slide" onRequestClose={close}>
        {page === 'schedule' && <SchedulePage onClose={close} />}
        {page === 'prices' && <PricesPage onClose={close} />}
        {page === 'holidays' && <HolidaysPage onClose={close} />}
        {page === 'shop' && <ShopPage onClose={close} />}
        {page === 'backup' && <BackupPage onClose={close} />}
      </Modal>
    </View>
  );
}

// ── A settings page: header, scrolling body, Save at the bottom ─
function SettingsPage({
  title, subtitle, dirty, onClose, onSave, saveDisabled, children,
}: {
  title: string;
  subtitle?: string;
  /** Unsaved changes: ask before leaving. */
  dirty?: boolean;
  onClose: () => void;
  /** Pages that save at once (holidays, backup) have no Save button. */
  onSave?: () => void;
  saveDisabled?: boolean;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const keepVisible = useKeepInputVisible(scrollRef);
  const leave = () => {
    if (!dirty) { onClose(); return; }
    Alert.alert(STRINGS.discardTitle, STRINGS.discardBody, [
      { text: STRINGS.keepEditing, style: 'cancel' },
      { text: STRINGS.discardLeave, style: 'destructive', onPress: onClose },
    ]);
  };
  return (
    <KeyboardAvoidingView style={[styles.container, { paddingTop: insets.top }]} behavior="padding">
      <ModalHeader title={title} subtitle={subtitle} onBack={leave} />
      <ScrollView ref={scrollRef} {...keepVisible} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {onSave && (
        <Row style={styles.footer}>
          <Button label={STRINGS.cancel} variant="secondary" onPress={leave} style={styles.footerBack} />
          <Button label={STRINGS.save} icon="save-outline" onPress={onSave} disabled={!dirty || saveDisabled} style={styles.footerNext} />
        </Row>
      )}
    </KeyboardAvoidingView>
  );
}

/** Saving settings: warn first if the change makes promised dates impossible. */
function useSaveSettings(onClose: () => void) {
  const { saveSettings, previewWillMiss, schedule } = useAppContext();
  return (next: AppSettings) => {
    const go = () => { saveSettings(next); onClose(); };
    if (previewWillMiss({ settings: next }) <= schedule.willMiss.length) { go(); return; }
    Alert.alert(STRINGS.warning, STRINGS.settingsWillMissConfirm, [
      { text: STRINGS.cancel, style: 'cancel' },
      { text: STRINGS.save, style: 'destructive', onPress: go },
    ]);
  };
}

// ── Working days and how much work ────────────────────────────
function SchedulePage({ onClose }: { onClose: () => void }) {
  const { settings } = useAppContext();
  const [local, setLocal] = useState<AppSettings>(settings);
  const [dirty, setDirty] = useState(false);
  const save = useSaveSettings(onClose);
  const update = (patch: Partial<AppSettings>) => { setLocal(prev => ({ ...prev, ...patch })); setDirty(true); };

  const toggleDay = (dow: Weekday) => {
    const cur = local.workingWeekdays;
    update({ workingWeekdays: cur.includes(dow) ? cur.filter(d => d !== dow) : [...cur, dow].sort() });
  };
  const workingDays = local.workingWeekdays.length;
  const perDay = workingDays > 0 ? Math.round((local.weeklyTarget / workingDays) * 10) / 10 : 0;

  return (
    <SettingsPage title={STRINGS.settingsScheduleRow} dirty={dirty} onClose={onClose} onSave={() => save(local)}>
      <Section title={STRINGS.settingsWorkingDays}>
        <DayPicker selected={local.workingWeekdays} onToggle={toggleDay} />
        {workingDays === 0 && <Text style={[styles.hint, { color: COLORS.danger }]}>{STRINGS.settingsNoWorkingDays}</Text>}
      </Section>

      <Section title={STRINGS.settingsCapacity}>
        <NumberInput inline label={STRINGS.settingsWeeklyTarget} value={local.weeklyTarget} onChangeValue={v => update({ weeklyTarget: v })} min={1} />
        {perDay > 0 && <Text style={styles.hint}>{STRINGS.settingsPerDay(perDay)}</Text>}
        <Separator />
        <Row style={styles.switchRow}>
          <Text style={styles.switchLabel}>{STRINGS.settingsAllowToday}</Text>
          <Switch
            value={local.allowNewWorkToday}
            onValueChange={v => update({ allowNewWorkToday: v })}
            trackColor={{ true: COLORS.accentLight }}
            thumbColor={local.allowNewWorkToday ? COLORS.accent : undefined}
          />
        </Row>
      </Section>

      <Section title={STRINGS.settingsEmergencyGroup} accent={COLORS.emergency}>
        <NumberInput
          inline
          label={STRINGS.settingsEmergencyReserve}
          value={local.emergencyReserve}
          onChangeValue={v => update({ emergencyReserve: v })}
          max={local.weeklyTarget}
        />
        <Separator />
        <NumberInput inline label={STRINGS.settingsEmergencyGap} value={local.emergencyGap} onChangeValue={v => update({ emergencyGap: v })} min={1} />
      </Section>

      <Section title={STRINGS.settingsDeliveryGroup} accent={COLORS.tagGeneral}>
        <NumberInput inline label={STRINGS.settingsNormalGap} value={local.normalGap} onChangeValue={v => update({ normalGap: v })} min={1} />
      </Section>
    </SettingsPage>
  );
}

function DayPicker({ selected, onToggle }: { selected: Weekday[]; onToggle: (d: Weekday) => void }) {
  return (
    <Row style={styles.daysRow}>
      {WEEK_ORDER.map(d => {
        const on = selected.includes(d);
        return (
          <TouchableOpacity
            key={d}
            style={[styles.dayBtn, on && styles.dayBtnActive]}
            onPress={() => onToggle(d)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={STRINGS.dayNames[d]}
          >
            <Text style={[styles.dayBtnText, on && styles.dayBtnTextActive]} numberOfLines={1}>{STRINGS.dayNamesShort[d]}</Text>
          </TouchableOpacity>
        );
      })}
    </Row>
  );
}

// ── Usual prices ──────────────────────────────────────────────
function PricesPage({ onClose }: { onClose: () => void }) {
  const { settings } = useAppContext();
  const [local, setLocal] = useState<AppSettings>(settings);
  const [dirty, setDirty] = useState(false);
  const save = useSaveSettings(onClose);

  const setRate = (key: WorkKey, price: number) => {
    setDirty(true);
    setLocal(prev => (key === 'astar' ? { ...prev, priceAstar: price }
      : key === 'designer' ? { ...prev, priceDesigner: price }
        : { ...prev, rates: { ...prev.rates, [key]: price } }));
  };

  return (
    <SettingsPage title={STRINGS.settingsPrices} subtitle={STRINGS.settingsPricesHint} dirty={dirty} onClose={onClose} onSave={() => save(local)}>
      {PRICE_GROUPS.map(g => (
        <Section key={g.keys[0]} title={g.title()}>
          {g.keys.map((key, i) => (
            <View key={key}>
              {i > 0 && <Separator />}
              <NumberInput inline label={STRINGS.settingsPriceOf(workLabel(key))} value={rateFor(local, key)} onChangeValue={v => setRate(key, v)} />
            </View>
          ))}
        </Section>
      ))}
    </SettingsPage>
  );
}

// ── Holidays (saved straight away) ────────────────────────────
function HolidaysPage({ onClose }: { onClose: () => void }) {
  const { today, daysOff, addDayOff, removeDayOff, previewWillMiss, schedule } = useAppContext();
  const [date, setDate] = useState('');
  const [label, setLabel] = useState('');
  const upcoming = daysOff.filter(d => d.date >= today);

  const add = () => {
    if (!date) return;
    const go = () => { addDayOff(date, label.trim() || undefined); setDate(''); setLabel(''); };
    if (previewWillMiss({ daysOff: [...daysOff.map(d => d.date), date] }) <= schedule.willMiss.length) { go(); return; }
    Alert.alert(STRINGS.warning, STRINGS.settingsWillMissConfirm, [
      { text: STRINGS.cancel, style: 'cancel' },
      { text: STRINGS.save, style: 'destructive', onPress: go },
    ]);
  };

  return (
    <SettingsPage title={STRINGS.settingsDaysOff} onClose={onClose}>
      <Section title={STRINGS.settingsNewDayOff}>
        <DateField label={STRINGS.settingsDayOffDate} value={date} onChange={setDate} minDate={today} offDates={daysOff.map(d => d.date)} />
        <TextField
          label={STRINGS.settingsDayOffLabel}
          value={label}
          onChangeValue={setLabel}
          placeholder={STRINGS.settingsDayOffLabelPlaceholder}
        />
        <Actions>
          <Button label={STRINGS.settingsAddDayOff} icon="add-circle-outline" size="small" onPress={add} disabled={!date} />
        </Actions>
      </Section>

      <Section title={STRINGS.settingsCurrentDaysOff} count={upcoming.length}>
        {upcoming.length === 0 && <EmptyState message={STRINGS.settingsNoDaysOff} />}
        {upcoming.map((d, i) => (
          <View key={d.id}>
            {i > 0 && <Separator />}
            <Row style={styles.dayOffRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.dayOffDate}>{fmtLong(d.date)}</Text>
                {d.label ? <Text style={styles.dayOffLabel}>{d.label}</Text> : null}
              </View>
              <Button label={STRINGS.delete} icon="trash-outline" size="small" variant="dangerGhost" onPress={() => removeDayOff(d.id)} />
            </Row>
          </View>
        ))}
      </Section>
    </SettingsPage>
  );
}

// ── Shop details printed on the bill ──────────────────────────
function ShopPage({ onClose }: { onClose: () => void }) {
  const [shop, setShop] = useState(DB.getShopInfo);
  const [dirty, setDirty] = useState(false);
  const upiBad = shop.upi.trim() !== '' && !isUpiId(shop.upi);
  const update = (patch: Partial<typeof shop>) => { setShop(prev => ({ ...prev, ...patch })); setDirty(true); };
  const save = () => { DB.setShopInfo(shop); onClose(); };

  return (
    <SettingsPage title={STRINGS.settingsShop} subtitle={STRINGS.settingsShopHint} dirty={dirty} onClose={onClose} onSave={save} saveDisabled={upiBad}>
      <Section>
        <TextField label={STRINGS.settingsShopName} value={shop.name} onChangeValue={v => update({ name: v })} placeholder={STRINGS.settingsShopNamePlaceholder} />
        <TextField label={STRINGS.settingsTailorName} value={shop.tailor} onChangeValue={v => update({ tailor: v })} placeholder={STRINGS.settingsTailorNamePlaceholder} />
        <TextField label={STRINGS.settingsShopPhone} value={shop.phone} onChangeValue={v => update({ phone: v })} keyboardType="phone-pad" />
      </Section>
      <Section>
        <TextField
          label={STRINGS.settingsShopUpi}
          value={shop.upi}
          onChangeValue={v => update({ upi: v })}
          placeholder={STRINGS.settingsShopUpiPlaceholder}
          error={upiBad ? STRINGS.settingsShopUpiInvalid : undefined}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {!shop.upi.trim() && <Text style={styles.hint}>{STRINGS.settingsUpiMissing}</Text>}
      </Section>
    </SettingsPage>
  );
}

// ── Backup and restore ────────────────────────────────────────
function BackupPage({ onClose }: { onClose: () => void }) {
  const { today, refresh, reloadAll } = useAppContext();
  const [busy, setBusy] = useState(false);
  const [lastBackup, setLastBackup] = useState(DB.getLastBackup);
  const age = lastBackup ? daysBetween(lastBackup, today) : null;
  const old = age === null || age > BACKUP_OLD_DAYS;

  const exportBackup = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const uri = createBackupFile();
      if (!(await Sharing.isAvailableAsync())) throw new Error(STRINGS.billShareUnavailable);
      await Sharing.shareAsync(uri, {
        // A specific type: some apps (WhatsApp, Gmail) refuse to attach generic octet-stream.
        mimeType: 'application/x-sqlite3',
        UTI: 'public.database',
        dialogTitle: STRINGS.settingsBackupDialog,
      });
      DB.setLastBackup(localToday());
      setLastBackup(DB.getLastBackup());
      refresh(); // Today's reminder goes away.
    } catch (e: any) {
      Alert.alert(STRINGS.settingsExportFailed, e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      setBusy(true);
      await restoreBackupFile(result.assets[0].uri);
      reloadAll();
      setLastBackup(DB.getLastBackup());
      Alert.alert(STRINGS.done, STRINGS.settingsRestored);
    } catch (e: any) {
      const msg = e instanceof NotABackupError ? STRINGS.settingsNotABackup : e?.message ?? String(e);
      Alert.alert(STRINGS.settingsImportFailed, msg);
    } finally {
      setBusy(false);
    }
  };

  const importBackup = () => {
    if (busy) return;
    Alert.alert(STRINGS.warning, STRINGS.settingsImportWarning, [
      { text: STRINGS.cancel, style: 'cancel' },
      { text: STRINGS.continue, style: 'destructive', onPress: doImport },
    ]);
  };

  return (
    <SettingsPage title={STRINGS.settingsBackup} onClose={onClose}>
      <Section accent={old ? COLORS.warning : COLORS.success}>
        <ListRow
          icon={old ? 'alert-circle-outline' : 'shield-checkmark-outline'}
          title={age === null ? STRINGS.settingsNoBackup : STRINGS.settingsLastBackup(age)}
          subtitle={old ? STRINGS.settingsBackupDue : undefined}
          warn={old}
        />
        <Text style={styles.hint}>{STRINGS.settingsBackupHint}</Text>
        <Actions>
          <Button label={busy ? STRINGS.loading : STRINGS.settingsExportDB} icon="cloud-upload-outline" size="small" onPress={exportBackup} disabled={busy} />
        </Actions>
      </Section>
      <Section>
        <Actions>
          <Button label={STRINGS.settingsImportDB} icon="cloud-download-outline" size="small" onPress={importBackup} disabled={busy} variant="secondary" />
        </Actions>
      </Section>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgLight },
  content: { paddingBottom: LAYOUT.screenBottom },
  brand: {
    alignItems: 'center', marginHorizontal: LAYOUT.gutter, marginTop: LAYOUT.sectionGap, paddingVertical: SPACE.md,
    backgroundColor: COLORS.bg, borderRadius: LAYOUT.radius, borderWidth: 1, borderColor: COLORS.border,
  },
  language: { marginHorizontal: LAYOUT.inset, marginBottom: SPACE.md },
  hint: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary, paddingHorizontal: LAYOUT.inset, paddingBottom: SPACE.sm },
  daysRow: { flexWrap: 'wrap', gap: SPACE.sm, paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.md },
  dayBtn: {
    width: 46, height: 46, borderRadius: 23, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bgInput,
  },
  dayBtnActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  dayBtnText: { fontSize: FONT.sizeXSmall, color: COLORS.textSecondary },
  dayBtnTextActive: { color: '#fff', fontWeight: FONT.weightBold },
  switchRow: { justifyContent: 'space-between', paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.md, gap: SPACE.md },
  switchLabel: { fontSize: FONT.size, color: COLORS.text, fontWeight: FONT.weightMedium, flex: 1 },
  dayOffRow: { paddingHorizontal: LAYOUT.inset, paddingVertical: LAYOUT.rowY },
  dayOffDate: { fontSize: FONT.size, color: COLORS.text, fontWeight: FONT.weightMedium },
  dayOffLabel: { fontSize: FONT.sizeSmall, color: COLORS.textMuted },
  footer: {
    gap: LAYOUT.buttonGap, paddingHorizontal: LAYOUT.gutter, paddingVertical: SPACE.sm, backgroundColor: COLORS.bg,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  footerBack: { flex: 1 },
  footerNext: { flex: 2 },
});
