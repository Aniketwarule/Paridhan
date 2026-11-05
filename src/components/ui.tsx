// ============================================================
// Poshakh – Shared UI components
// Layout rule: every group of content sits in its own white Section
// (or Card) on a grey screen background, so blocks are clearly apart.
// Spacing and buttons follow .claude/skills/poshakh-ui/SKILL.md:
// use SPACE / LAYOUT, <Button> and <Actions>, never hand-rolled values.
// ============================================================
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import type { CalendarProps, DateData } from 'react-native-calendars';
import type { WeekBar } from '../engine';
import { getLanguage, onLanguageChange, STRINGS } from '../strings';
import { en } from '../strings/en';
import { mr } from '../strings/mr';
import { fmtLong, localToday } from '../utils/date';

// ── Brand ─────────────────────────────────────────────────────
/** Paridhan logo (white background, cropped to the artwork). */
export const BRAND_LOGO = require('../../assets/logo/logo-bill.png');
/** width / height of BRAND_LOGO. */
export const BRAND_LOGO_RATIO = 640 / 567;

/**
 * The Paridhan logo at a fixed width. Always give an explicit width: a percentage width
 * lets Android draw the image at its full pixel size, overflowing its box.
 */
export function BrandLogo({ width }: { width: number }) {
  return (
    <Image
      source={BRAND_LOGO}
      style={{ width, height: Math.round(width / BRAND_LOGO_RATIO) }}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}

// ── Theme ─────────────────────────────────────────────────────
export const COLORS = {
  /** Plum from the logo: primary buttons, selected states, brand text. */
  brand: '#440023',
  /** Rose from the logo's flower: urgent / highlight. */
  brandRose: '#B20854',
  /** Very light pink, for brand-tinted boxes. */
  brandTint: '#FDF2F4',
  bg: '#FFFFFF',
  bgLight: '#ECEDEF',
  bgCard: '#FFFFFF',
  bgInput: '#F6F6F7',
  border: '#DADCE0',
  separator: '#ECECEC',
  text: '#1A1A1A',
  textSecondary: '#555555',
  textMuted: '#888888',
  accent: '#440023',
  accentLight: '#6B1F45',
  danger: '#C0392B',
  dangerBg: '#FDECEA',
  warning: '#E67E22',
  warningBg: '#FFF4E5',
  success: '#27AE60',
  successBg: '#E8F6EE',
  emergency: '#8B0000',
  tagGeneral: '#2F6FB7',
};

export const FONT = {
  size: 16,
  sizeXSmall: 12,
  sizeSmall: 14,
  sizeLarge: 18,
  sizeTitle: 22,
  weight: '400' as const,
  weightBold: '700' as const,
  weightMedium: '600' as const,
};

// ── Spacing ───────────────────────────────────────────────────
/** The only spacing steps used in the app. */
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const LAYOUT = {
  /** Screen edge → white panel (Section / Card / page buttons). */
  gutter: SPACE.md,
  /** Panel edge → its content (text, inputs, button groups). */
  inset: SPACE.lg,
  /** Between two panels. */
  sectionGap: SPACE.lg,
  /** Top/bottom padding of one list row inside a panel. */
  rowY: SPACE.md,
  /** Between buttons in a group. */
  buttonGap: SPACE.sm,
  /** Space under the last panel of a scrolling screen. */
  screenBottom: SPACE.xxl,
  radius: 12,
  radiusSm: 8,
} as const;

// ── Button ────────────────────────────────────────────────────
export type IconName = React.ComponentProps<typeof Ionicons>['name'];

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'dangerGhost' | 'success' | 'whatsapp';

interface ButtonProps {
  label: string;
  onPress: () => void;
  /**
   * primary: the main action of a block (one per block).
   * secondary: other actions. danger: destructive. ghost / dangerGhost: low-key text action.
   * success: an "on" state (e.g. paid). whatsapp: send on WhatsApp.
   */
  variant?: ButtonVariant;
  /** normal: page / footer actions. small: inside list rows and panels. */
  size?: 'normal' | 'small';
  icon?: IconName;
  iconRight?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

const BUTTON_COLORS: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: COLORS.accent, fg: '#FFFFFF' },
  secondary: { bg: COLORS.bg, fg: COLORS.text, border: COLORS.border },
  danger: { bg: COLORS.danger, fg: '#FFFFFF' },
  ghost: { bg: 'transparent', fg: COLORS.tagGeneral },
  dangerGhost: { bg: 'transparent', fg: COLORS.danger },
  success: { bg: COLORS.success, fg: '#FFFFFF' },
  whatsapp: { bg: '#25D366', fg: '#FFFFFF' },
};

export function Button({
  label, onPress, variant = 'primary', size = 'normal', icon, iconRight, disabled, style,
}: ButtonProps) {
  const c = BUTTON_COLORS[variant];
  const small = size === 'small';
  const iconEl = icon ? <Ionicons name={icon} size={small ? 18 : 22} color={c.fg} /> : null;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
      accessibilityRole="button"
      style={[
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: c.bg, borderColor: c.border, borderWidth: c.border ? 1 : 0 },
        disabled && styles.btnDisabled,
        style,
      ]}
    >
      {!iconRight && iconEl}
      <Text style={[styles.btnText, small && styles.btnTextSmall, { color: c.fg }]} numberOfLines={2}>{label}</Text>
      {iconRight && iconEl}
    </TouchableOpacity>
  );
}

/**
 * A group of buttons with the standard spacing.
 * - Inside a Section: <Actions> (stacked) or <Actions row> (side by side, equal width).
 * - Directly on the screen, between panels: add `page`.
 */
export function Actions({
  children, row, page, style,
}: { children: React.ReactNode; row?: boolean; page?: boolean; style?: StyleProp<ViewStyle> }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[row ? styles.actionsRow : styles.actionsStack, page ? styles.actionsPage : styles.actionsInset, style]}>
      {row ? items.map((child, i) => <View key={i} style={{ flex: 1 }}>{child}</View>) : items}
    </View>
  );
}

// ── Card ──────────────────────────────────────────────────────
export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// ── Section: titled white panel ───────────────────────────────
export function Section({
  title, subtitle, count, right, children, style, accent,
}: {
  title?: string;
  subtitle?: string;
  count?: number | string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Coloured left edge, e.g. for warnings. */
  accent?: string;
}) {
  return (
    <View style={[styles.section, accent ? { borderLeftWidth: 5, borderLeftColor: accent } : null, style]}>
      {title ? (
        <View style={styles.sectionHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
          </View>
          {count !== undefined && (
            <View style={styles.countPill}><Text style={styles.countText}>{count}</Text></View>
          )}
          {right}
        </View>
      ) : null}
      {children ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

/** Thin line between rows inside a Section. */
export function Separator({ inset = LAYOUT.inset }: { inset?: number }) {
  return <View style={[styles.separator, { marginLeft: inset }]} />;
}

/** Section header used outside a panel (kept for small labels). */
export function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderTitle}>{title}</Text>
      {count !== undefined && <Text style={styles.sectionHeaderCount}>{count}</Text>}
    </View>
  );
}

// ── Tag chip ──────────────────────────────────────────────────
export function Tag({ label, color = COLORS.accent }: { label: string; color?: string }) {
  return (
    <View style={[styles.tag, { backgroundColor: color + '18', borderColor: color }]}>
      <Text style={[styles.tagText, { color }]}>{label}</Text>
    </View>
  );
}

// ── Divider ───────────────────────────────────────────────────
export function Divider() {
  return <View style={styles.divider} />;
}

// ── Loading / empty ───────────────────────────────────────────
export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={COLORS.accent} />
    </View>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

// ── Row ───────────────────────────────────────────────────────
export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

// ── ScreenHeader ──────────────────────────────────────────────
export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View style={styles.screenHeader}>
      <View style={{ flex: 1 }}>
        <Text style={styles.screenTitle}>{title}</Text>
        {subtitle ? <Text style={styles.screenSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** Header of a full-screen modal: back arrow, then a title (or custom content), then optional actions. */
export function ModalHeader({
  title, subtitle, onBack, right, children,
}: {
  title?: string;
  subtitle?: string;
  onBack: () => void;
  right?: React.ReactNode;
  /** Replaces the title, e.g. a search box. */
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.modalHeader}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={10} accessibilityLabel={STRINGS.back}>
        <Ionicons name="arrow-back" size={26} color={COLORS.accent} />
      </TouchableOpacity>
      {children ?? (
        <View style={{ flex: 1 }}>
          <Text style={styles.modalTitle} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.modalSubtitle}>{subtitle}</Text> : null}
        </View>
      )}
      {right}
    </View>
  );
}

export function IconButton({
  name, onPress, label,
}: { name: IconName; onPress: () => void; label?: string }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.iconBtn} accessibilityLabel={label} hitSlop={8}>
      <Ionicons name={name} size={24} color={COLORS.accent} />
      {label ? <Text style={styles.iconBtnText}>{label}</Text> : null}
    </TouchableOpacity>
  );
}

// ── WarningBanner ─────────────────────────────────────────────
export function WarningBanner({ message }: { message: string }) {
  return (
    <View style={styles.warningBanner}>
      <Text style={styles.warningText}>⚠ {message}</Text>
    </View>
  );
}

// ── Segmented toggle ──────────────────────────────────────────
export function Segmented<T extends string>({
  options, value, onChange, style,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.segmented, style]}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <TouchableOpacity key={o.value} style={[styles.segment, on && styles.segmentOn]} onPress={() => onChange(o.value)}>
            <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Checkbox ──────────────────────────────────────────────────
export function Checkbox({
  label, value, onChange, color = COLORS.accent,
}: { label: string; value: boolean; onChange: (v: boolean) => void; color?: string }) {
  return (
    <TouchableOpacity style={styles.checkRow} onPress={() => onChange(!value)} activeOpacity={0.7}>
      <Ionicons name={value ? 'checkbox' : 'square-outline'} size={26} color={value ? color : COLORS.textMuted} />
      <Text style={[styles.checkLabel, value && { color, fontWeight: FONT.weightBold }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── NumericTextInput ──────────────────────────────────────────
// Keeps a string draft while focused so users can clear, type 0,
// or replace a digit without the previous number snapping back.
interface NumericTextInputProps extends Omit<TextInputProps, 'onChangeText' | 'value' | 'keyboardType'> {
  value: number;
  onChangeValue: (n: number) => void;
  min?: number;
  max?: number;
}

export function NumericTextInput({
  value,
  onChangeValue,
  min = 0,
  max,
  onFocus,
  onBlur,
  ...rest
}: NumericTextInputProps) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  // Latest draft, read on blur (state may not have flushed yet).
  const textRef = useRef(text);

  const clamp = (n: number) => {
    let next = n;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    return next;
  };

  const commit = (raw: string) => {
    if (raw === '') {
      const next = clamp(min);
      onChangeValue(next);
      setText(String(next));
      return;
    }
    const n = parseInt(raw, 10);
    if (isNaN(n)) {
      setText(String(value));
      return;
    }
    const next = clamp(n);
    onChangeValue(next);
    setText(String(next));
  };

  return (
    <TextInput
      {...rest}
      keyboardType="number-pad"
      selectTextOnFocus
      value={focused ? text : String(value)}
      onFocus={e => {
        setFocused(true);
        setText(String(value));
        textRef.current = String(value);
        onFocus?.(e);
      }}
      onChangeText={raw => {
        const cleaned = raw.replace(/[^\d]/g, '');
        setText(cleaned);
        textRef.current = cleaned;
        if (cleaned === '') return;
        const n = parseInt(cleaned, 10);
        if (isNaN(n)) return;
        if (max !== undefined && n > max) {
          onChangeValue(max);
          setText(String(max));
          textRef.current = String(max);
          return;
        }
        onChangeValue(n);
      }}
      onBlur={e => {
        setFocused(false);
        commit(textRef.current);
        onBlur?.(e);
      }}
    />
  );
}

// ── NumberInput ───────────────────────────────────────────────
interface NumberInputProps extends Omit<TextInputProps, 'onChangeText' | 'value'> {
  label: string;
  value: number;
  onChangeValue: (n: number) => void;
  min?: number;
  max?: number;
}

export function NumberInput({ label, value, onChangeValue, min = 0, max, ...rest }: NumberInputProps) {
  return (
    <View style={styles.inputRow}>
      <Text style={styles.label}>{label}</Text>
      <NumericTextInput
        value={value}
        onChangeValue={onChangeValue}
        min={min}
        max={max}
        {...rest}
        style={[styles.numInput, rest.style]}
      />
    </View>
  );
}

// ── TextField ─────────────────────────────────────────────────
interface TextFieldProps extends Omit<TextInputProps, 'onChangeText'> {
  label?: string;
  value: string;
  onChangeValue: (s: string) => void;
  error?: string;
}

export function TextField({ label, value, onChangeValue, error, style, ...rest }: TextFieldProps) {
  return (
    <View style={styles.inputRow}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        style={[styles.textInput, error ? styles.inputError : null, style]}
        value={value}
        onChangeText={onChangeValue}
        placeholderTextColor={COLORS.textMuted}
        {...rest}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

// ── DateField: tap to open a calendar ─────────────────────────
export function DateField({
  label, value, onChange, minDate, offDates, error, clearable,
}: {
  label?: string;
  /** YYYY-MM-DD or '' */
  value: string;
  onChange: (date: string) => void;
  /** Days before this cannot be picked. */
  minDate?: string;
  /** Dates shown greyed (holidays). */
  offDates?: string[];
  error?: string;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.inputRow}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Row style={{ gap: 8 }}>
        <TouchableOpacity style={[styles.dateBox, error ? styles.inputError : null]} onPress={() => setOpen(true)} activeOpacity={0.7}>
          <Ionicons name="calendar-outline" size={22} color={COLORS.accent} />
          <Text style={[styles.dateText, !value && { color: COLORS.textMuted }]}>
            {value ? fmtLong(value) : STRINGS.pickDate}
          </Text>
        </TouchableOpacity>
        {clearable && value ? (
          <TouchableOpacity onPress={() => onChange('')} style={styles.clearBtn} hitSlop={8} accessibilityLabel={STRINGS.clear}>
            <Ionicons name="close-circle" size={26} color={COLORS.textMuted} />
          </TouchableOpacity>
        ) : null}
      </Row>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <CalendarModal
        visible={open}
        value={value}
        minDate={minDate}
        offDates={offDates}
        onClose={() => setOpen(false)}
        onSelect={d => { setOpen(false); onChange(d); }}
      />
    </View>
  );
}

type MarkedDates = NonNullable<CalendarProps['markedDates']>;

// Month/day names for the calendar library, in both app languages.
for (const [code, t] of [['en', en], ['mr', mr]] as const) {
  LocaleConfig.locales[code] = {
    monthNames: t.monthNames,
    monthNamesShort: t.monthShort,
    dayNames: t.dayNames,
    dayNamesShort: t.dayNamesShort,
    today: t.today,
  };
}
LocaleConfig.defaultLocale = getLanguage();
onLanguageChange(lang => { LocaleConfig.defaultLocale = lang; });

/** Month calendar in a pop-up (react-native-calendars). Holidays get a dot. */
export function CalendarModal({
  visible, value, minDate, offDates, onClose, onSelect,
}: {
  visible: boolean;
  value: string;
  minDate?: string;
  offDates?: string[];
  onClose: () => void;
  onSelect: (date: string) => void;
}) {
  const today = localToday();
  const marked: MarkedDates = {};
  for (const d of offDates ?? []) marked[d] = { marked: true, dotColor: COLORS.warning };
  if (value) marked[value] = { ...marked[value], selected: true, selectedColor: COLORS.accent };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.calendar} onPress={() => {}}>
          <Calendar
            key={getLanguage()}
            initialDate={value || (minDate && minDate > today ? minDate : today)}
            minDate={minDate}
            firstDay={1}
            enableSwipeMonths
            hideExtraDays
            markedDates={marked}
            onDayPress={(d: DateData) => onSelect(d.dateString)}
            theme={{
              todayTextColor: COLORS.tagGeneral,
              selectedDayBackgroundColor: COLORS.accent,
              selectedDayTextColor: '#ffffff',
              arrowColor: COLORS.accent,
              monthTextColor: COLORS.text,
              textDisabledColor: '#C8C8C8',
              textMonthFontSize: FONT.sizeLarge,
              textMonthFontWeight: FONT.weightBold,
              textDayFontSize: FONT.size,
              textDayHeaderFontSize: FONT.sizeSmall,
              textSectionTitleColor: COLORS.textMuted,
            }}
          />
          <Button label={STRINGS.cancel} variant="ghost" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Step indicator (New Order) ────────────────────────────────
export function Steps({ steps, current, onPress }: { steps: string[]; current: number; onPress: (i: number) => void }) {
  return (
    <Row style={styles.steps}>
      {steps.map((s, i) => {
        const done = i < current;
        const on = i === current;
        return (
          <TouchableOpacity key={s} style={styles.step} disabled={i >= current} onPress={() => onPress(i)}>
            <View style={[styles.stepDot, (on || done) && styles.stepDotOn]}>
              {done
                ? <Ionicons name="checkmark" size={16} color="#fff" />
                : <Text style={[styles.stepNum, on && { color: '#fff' }]}>{i + 1}</Text>}
            </View>
            <Text style={[styles.stepText, on && styles.stepTextOn]} numberOfLines={1}>{s}</Text>
          </TouchableOpacity>
        );
      })}
    </Row>
  );
}

// ── Capacity Strip ────────────────────────────────────────────
export function CapacityStrip({ weeks }: { weeks: WeekBar[] }) {
  return (
    <View style={styles.capacityStrip}>
      {weeks.map((w, i) => {
        const pct = w.capacity > 0 ? Math.min(1, w.used / w.capacity) : 0;
        const over = w.used > w.capacity;
        const barColor = over ? COLORS.danger : pct > 0.8 ? COLORS.warning : COLORS.success;
        return (
          <View key={w.weekStart} style={styles.capacityWeek}>
            <Text style={styles.capacityLabel}>{i === 0 ? STRINGS.thisWeek : STRINGS.weekPlus(i)}</Text>
            <View style={styles.capacityBarBg}>
              <View style={[styles.capacityBarFill, { width: `${Math.min(100, pct * 100)}%`, backgroundColor: barColor }]} />
            </View>
            <Text style={[styles.capacityNum, over && { color: COLORS.danger }]}>
              {w.used}/{w.capacity}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────
const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.06,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 1 },
  elevation: 1,
};

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    minHeight: 50,
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.lg,
    borderRadius: LAYOUT.radius,
  },
  btnSmall: {
    minHeight: 40,
    paddingVertical: SPACE.sm,
    paddingHorizontal: SPACE.md,
    gap: SPACE.xs,
    borderRadius: LAYOUT.radiusSm,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontSize: FONT.sizeLarge, fontWeight: FONT.weightBold, textAlign: 'center', flexShrink: 1 },
  btnTextSmall: { fontSize: FONT.size, fontWeight: FONT.weightMedium },
  actionsStack: { gap: LAYOUT.buttonGap },
  actionsRow: { flexDirection: 'row', gap: LAYOUT.buttonGap },
  actionsInset: { paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.sm },
  actionsPage: { marginHorizontal: LAYOUT.gutter, marginTop: LAYOUT.sectionGap },
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: LAYOUT.radius,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: LAYOUT.inset,
    marginHorizontal: LAYOUT.gutter,
    marginTop: SPACE.md,
    ...shadow,
  },
  section: {
    backgroundColor: COLORS.bgCard,
    borderRadius: LAYOUT.radius,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginHorizontal: LAYOUT.gutter,
    marginTop: LAYOUT.sectionGap,
    overflow: 'hidden',
    ...shadow,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingHorizontal: LAYOUT.inset,
    paddingVertical: SPACE.md,
    backgroundColor: '#F8F8F9',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.separator,
  },
  sectionTitle: { fontSize: FONT.sizeLarge, fontWeight: FONT.weightBold, color: COLORS.text },
  sectionSubtitle: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary, marginTop: 2 },
  sectionBody: { paddingVertical: SPACE.sm },
  countPill: { minWidth: 28, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 14, backgroundColor: COLORS.accent, alignItems: 'center' },
  countText: { color: '#fff', fontSize: FONT.sizeSmall, fontWeight: FONT.weightBold },
  separator: { height: 1, backgroundColor: COLORS.separator },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: LAYOUT.inset, paddingTop: SPACE.lg, paddingBottom: SPACE.xs },
  sectionHeaderTitle: { fontSize: FONT.sizeLarge, fontWeight: FONT.weightBold, color: COLORS.text, flex: 1 },
  sectionHeaderCount: { fontSize: FONT.size, color: COLORS.textMuted },
  tag: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginRight: 4,
    marginTop: 2,
  },
  tagText: { fontSize: FONT.sizeSmall, fontWeight: FONT.weightMedium },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE.xl },
  empty: { paddingVertical: SPACE.lg, paddingHorizontal: LAYOUT.inset, alignItems: 'center' },
  emptyText: { fontSize: FONT.size, color: COLORS.textMuted, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    paddingHorizontal: LAYOUT.inset,
    paddingVertical: SPACE.md,
    backgroundColor: COLORS.bg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  screenTitle: { fontSize: FONT.sizeTitle, fontWeight: FONT.weightBold, color: COLORS.text },
  screenSubtitle: { fontSize: FONT.size, color: COLORS.textSecondary, marginTop: 2 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    paddingHorizontal: LAYOUT.gutter,
    paddingVertical: SPACE.md,
    backgroundColor: COLORS.bg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: { padding: SPACE.xs },
  modalTitle: { fontSize: FONT.sizeTitle, fontWeight: FONT.weightBold, color: COLORS.text },
  modalSubtitle: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary, marginTop: 2 },
  iconBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 8, borderRadius: 20, backgroundColor: COLORS.bgInput },
  iconBtnText: { fontSize: FONT.size, color: COLORS.accent, fontWeight: FONT.weightMedium },
  warningBanner: {
    backgroundColor: COLORS.warningBg,
    borderColor: COLORS.warning,
    borderWidth: 1,
    borderRadius: LAYOUT.radiusSm,
    padding: SPACE.md,
    marginTop: SPACE.sm,
    marginHorizontal: LAYOUT.gutter,
  },
  warningText: { fontSize: FONT.size, color: '#7D4E00' },
  segmented: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bgInput,
    padding: 3,
  },
  segment: { flex: 1, paddingVertical: 11, alignItems: 'center', borderRadius: 8 },
  segmentOn: { backgroundColor: COLORS.accent },
  segmentText: { fontSize: FONT.size, color: COLORS.textSecondary, fontWeight: FONT.weightMedium },
  segmentTextOn: { color: '#fff', fontWeight: FONT.weightBold },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  checkLabel: { fontSize: FONT.size, color: COLORS.text },
  inputRow: { marginVertical: SPACE.sm, paddingHorizontal: LAYOUT.inset },
  label: { fontSize: FONT.size, color: COLORS.text, marginBottom: 6, fontWeight: FONT.weightMedium },
  numInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    fontSize: FONT.sizeLarge,
    backgroundColor: COLORS.bgInput,
    color: COLORS.text,
    width: 120,
  },
  textInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    fontSize: FONT.size,
    backgroundColor: COLORS.bgInput,
    color: COLORS.text,
  },
  inputError: { borderColor: COLORS.danger },
  errorText: { fontSize: FONT.sizeSmall, color: COLORS.danger, marginTop: 4 },
  dateBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 13,
    paddingHorizontal: 12,
    backgroundColor: COLORS.bgInput,
  },
  dateText: { fontSize: FONT.size, color: COLORS.text, fontWeight: FONT.weightMedium },
  clearBtn: { padding: 4 },
  modalBackdrop: { flex: 1, backgroundColor: '#0006', justifyContent: 'center', padding: 16 },
  calendar: { backgroundColor: COLORS.bg, borderRadius: 16, padding: 8, overflow: 'hidden' },
  steps: { backgroundColor: COLORS.bg, paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  step: { flex: 1, alignItems: 'center', gap: 4 },
  stepDot: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg },
  stepDotOn: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  stepNum: { fontSize: FONT.sizeSmall, fontWeight: FONT.weightBold, color: COLORS.textMuted },
  stepText: { fontSize: FONT.sizeSmall, color: COLORS.textMuted },
  stepTextOn: { color: COLORS.text, fontWeight: FONT.weightBold },
  capacityStrip: { flexDirection: 'row', paddingHorizontal: LAYOUT.inset, paddingVertical: SPACE.md, gap: SPACE.sm },
  capacityWeek: { flex: 1, alignItems: 'center', gap: 3 },
  capacityLabel: { fontSize: 11, color: COLORS.textMuted },
  capacityBarBg: { width: '100%', height: 8, backgroundColor: COLORS.separator, borderRadius: 4, overflow: 'hidden' },
  capacityBarFill: { height: '100%', borderRadius: 4 },
  capacityNum: { fontSize: 11, color: COLORS.textSecondary, fontWeight: FONT.weightMedium },
});
