// ============================================================
// Poshakh – Settings Screen
// ============================================================
import React, { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
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
import type { AppSettings } from '../types';
import type { Weekday } from '../engine';
import { fmtLong } from '../utils/date';
import {
  Actions,
  BrandLogo,
  Button,
  COLORS,
  DateField,
  EmptyState,
  FONT,
  LAYOUT,
  NumberInput,
  Row,
  ScreenHeader,
  Section,
  Segmented,
  Separator,
  SPACE,
  TextField,
} from '../components/ui';
import { loadSeedData } from '../seed/seedData';
import * as DB from '../db/database';
import { createBackupFile, NotABackupError, restoreBackupFile } from '../db/backup';

function DayPicker({ selected, onToggle }: { selected: Weekday[]; onToggle: (d: Weekday) => void }) {
  return (
    <Row style={styles.daysRow}>
      {STRINGS.dayNamesShort.map((name, i) => {
        const on = selected.includes(i as Weekday);
        return (
          <TouchableOpacity key={i} style={[styles.dayBtn, on && styles.dayBtnActive]} onPress={() => onToggle(i as Weekday)}>
            <Text style={[styles.dayBtnText, on && styles.dayBtnTextActive]} numberOfLines={1}>{name}</Text>
          </TouchableOpacity>
        );
      })}
    </Row>
  );
}

// ──────────────────────────────────────────────────────────────
export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const {
    today, settings, daysOff, language, setLanguage, saveSettings, addDayOff, removeDayOff,
    previewWillMiss, schedule, refresh, reloadAll,
  } = useAppContext();

  // Local copy so she can edit before saving.
  const [local, setLocal] = useState<AppSettings>(settings);
  const [newDayOff, setNewDayOff] = useState('');
  const [newDayOffLabel, setNewDayOffLabel] = useState('');
  const [dirty, setDirty] = useState(false);
  const [shop, setShop] = useState(DB.getShopInfo);
  const [shopDirty, setShopDirty] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    setLocal(settings); setDirty(false);
    setShop(DB.getShopInfo()); setShopDirty(false);
  }, [settings]));

  const updateShop = (patch: Partial<typeof shop>) => { setShop(prev => ({ ...prev, ...patch })); setShopDirty(true); };
  const saveShop = () => {
    DB.setShopInfo(shop);
    setShopDirty(false);
    Alert.alert(STRINGS.settingsSavedTitle, STRINGS.settingsSaved);
  };

  const update = (patch: Partial<AppSettings>) => {
    setLocal(prev => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const toggleDay = (dow: Weekday) => {
    const cur = local.workingWeekdays;
    update({ workingWeekdays: cur.includes(dow) ? cur.filter(d => d !== dow) : [...cur, dow].sort() });
  };

  /** Settings preview: warn before a change makes promised dates impossible. */
  const confirmIfWorse = (extraMiss: number, go: () => void) => {
    if (extraMiss <= 0) { go(); return; }
    Alert.alert(STRINGS.warning, STRINGS.settingsWillMissConfirm(extraMiss), [
      { text: STRINGS.cancel, style: 'cancel' },
      { text: STRINGS.save, style: 'destructive', onPress: go },
    ]);
  };

  const handleSave = () => {
    const extra = previewWillMiss({ settings: local }) - schedule.willMiss.length;
    confirmIfWorse(extra, () => {
      saveSettings(local);
      setDirty(false);
      Alert.alert(STRINGS.settingsSavedTitle, STRINGS.settingsSaved);
    });
  };

  const handleAddDayOff = () => {
    if (!newDayOff) return;
    const extra = previewWillMiss({ daysOff: [...daysOff.map(d => d.date), newDayOff] }) - schedule.willMiss.length;
    confirmIfWorse(extra, () => {
      addDayOff(newDayOff, newDayOffLabel.trim() || undefined);
      setNewDayOff('');
      setNewDayOffLabel('');
    });
  };

  // ── Backup export ────────────────────────────────────────────
  const handleExport = async () => {
    if (backupBusy) return;
    setBackupBusy(true);
    try {
      const uri = createBackupFile();
      if (!(await Sharing.isAvailableAsync())) throw new Error(STRINGS.billShareUnavailable);
      await Sharing.shareAsync(uri, {
        // A specific type: some apps (WhatsApp, Gmail) refuse to attach generic octet-stream.
        mimeType: 'application/x-sqlite3',
        UTI: 'public.database',
        dialogTitle: STRINGS.settingsBackupDialog,
      });
    } catch (e: any) {
      Alert.alert(STRINGS.settingsExportFailed, e?.message ?? String(e));
    } finally {
      setBackupBusy(false);
    }
  };

  // ── Backup import ─────────────────────────────────────────────
  const doImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      setBackupBusy(true);
      await restoreBackupFile(result.assets[0].uri);
      reloadAll();
      Alert.alert(STRINGS.done, STRINGS.settingsRestored);
    } catch (e: any) {
      const msg = e instanceof NotABackupError ? STRINGS.settingsNotABackup : e?.message ?? String(e);
      Alert.alert(STRINGS.settingsImportFailed, msg);
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImport = () => {
    if (backupBusy) return;
    Alert.alert(STRINGS.warning, STRINGS.settingsImportWarning, [
      { text: STRINGS.cancel, style: 'cancel' },
      { text: STRINGS.continue, style: 'destructive', onPress: doImport },
    ]);
  };

  // ── Demo / seed data ──────────────────────────────────────────
  const handleSeedData = () => {
    Alert.alert(STRINGS.settingsDemoTitle, STRINGS.settingsDemoConfirm, [
      { text: STRINGS.cancel, style: 'cancel' },
      {
        text: STRINGS.load,
        onPress: () => {
          loadSeedData(settings, daysOff.map(d => d.date));
          refresh();
          Alert.alert(STRINGS.done, STRINGS.settingsDemoLoaded);
        },
      },
    ]);
  };

  const upcoming = daysOff.filter(d => d.date >= today);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScreenHeader title={STRINGS.settingsTitle} />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Brand */}
          <View style={styles.brand}>
            <BrandLogo width={150} />
          </View>

          {/* Language: saved at once */}
          <Section title={`🌐 ${STRINGS.settingsLanguage}`}>
            <Segmented
              style={styles.inner}
              value={language}
              onChange={setLanguage}
              options={LANGUAGES.map(l => ({ value: l.code, label: l.label }))}
            />
          </Section>

          {/* Working days */}
          <Section title={STRINGS.settingsWorkingDays}>
            <DayPicker selected={local.workingWeekdays} onToggle={toggleDay} />
          </Section>

          {/* Capacity */}
          <Section title={STRINGS.settingsCapacity}>
            <NumberInput label={STRINGS.settingsWeeklyTarget} value={local.weeklyTarget} onChangeValue={v => update({ weeklyTarget: v })} min={1} />
            <Separator />
            <NumberInput
              label={STRINGS.settingsEmergencyReserve}
              value={local.emergencyReserve}
              onChangeValue={v => update({ emergencyReserve: v })}
              max={local.weeklyTarget}
            />
            <Separator />
            <NumberInput label={STRINGS.settingsEmergencyGap} value={local.emergencyGap} onChangeValue={v => update({ emergencyGap: v })} min={1} />
            <Separator />
            <NumberInput label={STRINGS.settingsNormalGap} value={local.normalGap} onChangeValue={v => update({ normalGap: v })} min={1} />
            <Separator />
            <Row style={styles.switchRow}>
              <Text style={styles.switchLabel}>{STRINGS.settingsAllowToday}</Text>
              <Switch value={local.allowNewWorkToday} onValueChange={v => update({ allowNewWorkToday: v })} />
            </Row>
          </Section>

          {/* Prices */}
          <Section title={STRINGS.settingsPrices}>
            <NumberInput label={STRINGS.settingsPriceAstar} value={local.priceAstar} onChangeValue={v => update({ priceAstar: v })} min={1} />
            <Separator />
            <NumberInput label={STRINGS.settingsPriceDesigner} value={local.priceDesigner} onChangeValue={v => update({ priceDesigner: v })} min={1} />
          </Section>

          <Actions page>
            <Button
              label={dirty ? `● ${STRINGS.settingsSave}` : STRINGS.settingsSave}
              icon="save-outline"
              onPress={handleSave}
              disabled={!dirty}
            />
          </Actions>

          {/* Holidays */}
          <Section title={STRINGS.settingsDaysOff} count={upcoming.length}>
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
            <Separator inset={0} />
            <DateField
              label={STRINGS.settingsDayOffDate}
              value={newDayOff}
              onChange={setNewDayOff}
              minDate={today}
              offDates={daysOff.map(d => d.date)}
            />
            <TextField
              label={STRINGS.settingsDayOffLabel}
              value={newDayOffLabel}
              onChangeValue={setNewDayOffLabel}
              placeholder={STRINGS.settingsDayOffLabelPlaceholder}
            />
            <Actions>
              <Button
                label={STRINGS.settingsAddDayOff}
                icon="add-circle-outline"
                size="small"
                onPress={handleAddDayOff}
                disabled={!newDayOff}
                variant="secondary"
              />
            </Actions>
          </Section>

          {/* Shop details for the bill */}
          <Section title={`🧾 ${STRINGS.settingsShop}`} subtitle={STRINGS.settingsShopHint}>
            <TextField
              label={STRINGS.settingsShopName}
              value={shop.name}
              onChangeValue={v => updateShop({ name: v })}
              placeholder={STRINGS.settingsShopNamePlaceholder}
            />
            <TextField
              label={STRINGS.settingsTailorName}
              value={shop.tailor}
              onChangeValue={v => updateShop({ tailor: v })}
              placeholder={STRINGS.settingsTailorNamePlaceholder}
            />
            <TextField
              label={STRINGS.settingsShopPhone}
              value={shop.phone}
              onChangeValue={v => updateShop({ phone: v })}
              keyboardType="phone-pad"
            />
            <Actions>
              <Button label={STRINGS.save} icon="save-outline" size="small" onPress={saveShop} disabled={!shopDirty} variant="secondary" />
            </Actions>
          </Section>

          {/* Backup */}
          <Section title={STRINGS.settingsBackup} subtitle={STRINGS.settingsBackupHint}>
            <Actions>
              <Button label={STRINGS.settingsExportDB} icon="cloud-upload-outline" size="small" onPress={handleExport} disabled={backupBusy} variant="secondary" />
              <Button label={STRINGS.settingsImportDB} icon="cloud-download-outline" size="small" onPress={handleImport} disabled={backupBusy} variant="secondary" />
            </Actions>
          </Section>

          {/* Demo data */}
          {/* <Section title={STRINGS.settingsDemo}>
            <Actions>
              <Button label={STRINGS.settingsDemoMode} size="small" onPress={handleSeedData} variant="ghost" />
            </Actions>
          </Section> */}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgLight },
  content: { paddingBottom: LAYOUT.screenBottom },
  brand: {
    alignItems: 'center', marginHorizontal: LAYOUT.gutter, marginTop: LAYOUT.sectionGap, paddingVertical: SPACE.md,
    backgroundColor: COLORS.bg, borderRadius: LAYOUT.radius, borderWidth: 1, borderColor: COLORS.border,
  },
  inner: { marginHorizontal: LAYOUT.inset, marginVertical: SPACE.sm },
  daysRow: { flexWrap: 'wrap', gap: SPACE.sm, paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.md },
  dayBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bgInput,
  },
  dayBtnActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  dayBtnText: { fontSize: 13, color: COLORS.textSecondary },
  dayBtnTextActive: { color: '#fff', fontWeight: FONT.weightBold },
  switchRow: { justifyContent: 'space-between', paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.md, gap: SPACE.md },
  switchLabel: { fontSize: FONT.size, color: COLORS.text, fontWeight: FONT.weightMedium, flex: 1 },
  dayOffRow: { paddingHorizontal: LAYOUT.inset, paddingVertical: LAYOUT.rowY },
  dayOffDate: { fontSize: FONT.size, color: COLORS.text, fontWeight: FONT.weightMedium },
  dayOffLabel: { fontSize: FONT.sizeSmall, color: COLORS.textMuted },
});
