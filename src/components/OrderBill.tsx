// ============================================================
// Paridhan – order bill: pick orders, preview, share as image, send on WhatsApp
// ============================================================
import React, { useMemo, useRef, useState } from 'react';
import { Alert, Image, Linking, Modal, PixelRatio, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { STRINGS } from '../strings';
import { fmt } from '../utils/date';
import * as DB from '../db/database';
import type { OrderWithDetails } from '../types';
import {
  billText, buildBill, cardMoney, deliveryLabel, deliveryValue, itemTitle, moneyLines, shopContactLine, whatsappUrl,
  orderNo, type BillData, type ShopInfo,
} from '../utils/order';
import { blouseLabel } from '../utils/labels';
import { qrRuns, upiPayUrl } from '../utils/upi';
import { Actions, BrandLogo, Button, Checkbox, COLORS, FONT, LAYOUT, ModalHeader, Row, Section, Separator, SPACE, Tag } from './ui';

/** The bill is laid out and saved at this width on every phone; the preview shrinks it to fit. */
const BILL_WIDTH = 580;
/** Side of the QR code without its white margin. */
const QR_SIZE = 128;
const PAY_LOGO_HEIGHT = 12;
/** UPI apps that can scan the QR. Ratios are width / height of the PNGs. */
const PAY_LOGOS = [
  { name: 'Google Pay', source: require('../../assets/logo/pay-gpay.png'), ratio: 192 / 72 },
  { name: 'PhonePe', source: require('../../assets/logo/pay-phonepe.png'), ratio: 237 / 72 },
  { name: 'Paytm', source: require('../../assets/logo/pay-paytm.png'), ratio: 229 / 72 },
];

/**
 * Starts from `card`. If the customer has other undelivered orders she first ticks which ones
 * go on the bill (one or many). Otherwise, or from a delivered order, that order's own bill
 * opens straight away. Mount it only while it is open.
 */
export function OrderBillModal({ card, onClose }: { card: OrderWithDetails; onClose: () => void }) {
  const [orders] = useState(() => (card.order.status === 'delivered' ? [] : DB.loadUndeliveredOrders(card.customer.id)));
  const canPick = orders.length > 1;
  const [picked, setPicked] = useState<number[]>([card.order.id]);
  const [picking, setPicking] = useState(canPick);
  const backFromBill = canPick ? () => setPicking(true) : onClose;

  return (
    <Modal visible animationType="slide" onRequestClose={picking ? onClose : backFromBill}>
      {picking ? (
        <OrderPicker
          orders={orders}
          picked={picked}
          customerName={card.customer.name}
          onChange={setPicked}
          onBack={onClose}
          onNext={() => setPicking(false)}
        />
      ) : (
        <BillPreview cards={canPick ? orders.filter(o => picked.includes(o.order.id)) : [card]} onBack={backFromBill} />
      )}
    </Modal>
  );
}

function OrderPicker({
  orders, picked, customerName, onChange, onBack, onNext,
}: {
  orders: OrderWithDetails[];
  picked: number[];
  customerName: string;
  onChange: (ids: number[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const insets = useSafeAreaInsets();
  const S = STRINGS;
  const toggle = (id: number) => onChange(picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id]);
  const allPicked = picked.length === orders.length;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ModalHeader
        title={S.billPickTitle}
        subtitle={customerName}
        onBack={onBack}
        right={allPicked ? undefined : (
          <Button label={S.billSelectAll} size="small" variant="secondary" onPress={() => onChange(orders.map(o => o.order.id))} />
        )}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: LAYOUT.screenBottom }}>
        <Section subtitle={S.billPickHint}>
          {[...orders].reverse().map((o, i) => {
            const money = cardMoney(o);
            return (
              <View key={o.order.id}>
                {i > 0 && <Separator inset={0} />}
                <Checkbox
                  label={`${orderNo(o.order.id)} · ${fmt(o.order.createdAt.slice(0, 10))}`}
                  value={picked.includes(o.order.id)}
                  onChange={() => toggle(o.order.id)}
                />
                <Row style={styles.pickInfo}>
                  <Text style={styles.pickText}>₹{money.total} · {S.ordersBalance(money.balance)}</Text>
                  <Tag label={o.order.status === 'ready' ? S.ordersReady : S.ordersPending} color={COLORS.textMuted} />
                </Row>
              </View>
            );
          })}
        </Section>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: SPACE.sm + insets.bottom }]}>
        <Actions style={styles.footerActions}>
          <Button label={S.billMake(picked.length)} icon="receipt-outline" onPress={onNext} disabled={picked.length === 0} />
        </Actions>
      </View>
    </View>
  );
}

function BillPreview({ cards, onBack }: { cards: OrderWithDetails[]; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const billRef = useRef<React.ComponentRef<typeof View>>(null);
  const [busy, setBusy] = useState(false);
  // Made once, so the time on the bill does not change while it is open.
  const [bill] = useState(() => buildBill(cards, blouseLabel));
  const shop = DB.getShopInfo();
  const several = cards.length > 1;
  const { width: screenWidth } = useWindowDimensions();
  const [billHeight, setBillHeight] = useState(0);
  const previewScale = Math.min(1, (screenWidth - LAYOUT.gutter * 2) / BILL_WIDTH);
  // Null when there is no UPI ID or nothing left to pay: then there is no QR to offer.
  const payUrl = upiPayUrl(shop.upi, shop.name || shop.tailor, bill.balance);
  const [withQr, setWithQr] = useState(false);

  const shareImage = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const uri = await captureRef(billRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        fileName: `bill-${bill.orderNo.replace(/, /g, '-')}`,
      });
      if (!(await Sharing.isAvailableAsync())) throw new Error(STRINGS.billShareUnavailable);
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: STRINGS.billShare });
    } catch (e: any) {
      Alert.alert(STRINGS.billShareFailed, e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const sendWhatsApp = async () => {
    const url = whatsappUrl(bill.customerPhone, billText(bill, shop));
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(STRINGS.billShareFailed, STRINGS.billNoWhatsApp);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ModalHeader
        title={`${STRINGS.billTitle} · ${several ? STRINGS.billOrderCount(cards.length) : bill.orderNo}`}
        subtitle={bill.customerName}
        onBack={onBack}
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Only the preview is scaled, on the views around the bill. The image keeps the full width. */}
        <View style={{ width: BILL_WIDTH * previewScale, height: billHeight * previewScale }}>
          <View style={[styles.billScaler, { transform: [{ scale: previewScale }] }]}>
            {/* This view is what becomes the image. */}
            <View
              ref={billRef}
              collapsable={false}
              style={styles.billWrap}
              onLayout={e => setBillHeight(e.nativeEvent.layout.height)}
            >
              <BillView bill={bill} shop={shop} payUrl={withQr ? payUrl : null} />
            </View>
          </View>
        </View>
        {!shop.tailor && !shop.phone && <Text style={styles.hint}>{STRINGS.billShopHint}</Text>}
        {!shop.upi && bill.balance > 0 && <Text style={styles.hint}>{STRINGS.billUpiHint}</Text>}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: SPACE.sm + insets.bottom }]}>
        {payUrl && (
          <View style={styles.qrToggle}>
            <Checkbox label={STRINGS.billAddQr} value={withQr} onChange={setWithQr} />
          </View>
        )}
        <Actions style={styles.footerActions}>
          <Button label={STRINGS.billWhatsApp} icon="logo-whatsapp" variant="whatsapp" onPress={sendWhatsApp} disabled={busy} />
          <Button
            label={busy ? STRINGS.loading : STRINGS.billShare}
            icon="share-social-outline"
            onPress={shareImage}
            disabled={busy}
            variant="secondary"
          />
        </Actions>
      </View>
    </View>
  );
}

/**
 * The printed-looking bill: plain and minimal, kept free of buttons. Shop and customer share the
 * top row, each order has its own heading and numbering, and the QR sits beside the money.
 */
function BillView({ bill, shop, payUrl }: { bill: BillData; shop: ShopInfo; payUrl: string | null }) {
  const S = STRINGS;

  return (
    <View style={styles.bill}>
      <Row style={styles.hero}>
        <View style={styles.heroShop}>
          <BrandLogo width={110} />
          {shop.tailor ? <Text style={styles.tailor}>{shop.tailor}</Text> : null}
          {shop.phone ? <Text style={styles.phone}>{'+91 ' + shop.phone}</Text> : null}
        </View>
        <View style={styles.heroBill}>
          <Text style={styles.billLabel}>{S.billTitle}</Text>
          {/* Sits at the bottom, just above the line, whether or not there is a phone number. */}
          <View style={styles.customer}>
            <Text style={styles.customerLabel}>{S.billCustomer}</Text>
            <Text style={styles.customerValue}>{bill.customerName}</Text>
            {bill.customerPhone ? (
              <>
                <Text style={[styles.customerLabel, styles.customerLabelNext]}>{S.billPhone}</Text>
                <Text style={styles.customerValue}>{bill.customerPhone}</Text>
              </>
            ) : null}
          </View>
        </View>
      </Row>
      <View style={styles.dash} />

      <Row style={styles.tableHead}>
        <Text style={[styles.th, styles.numCol]}>#</Text>
        <Text style={[styles.th, { flex: 1 }]}>{S.billItem}</Text>
        <Text style={[styles.th, styles.right]}>{S.billAmount}</Text>
      </Row>
      {bill.orders.map(o => (
        <View key={o.orderNo} style={styles.order}>
          <Row style={styles.orderHead}>
            <Text style={styles.orderNo}>{o.orderNo}</Text>
            <Text style={styles.orderDate}>{S.billOrderDate}: {o.orderDate}</Text>
          </Row>
          {o.items.map((it, i) => (
            <Row key={i} style={styles.tr}>
              <Text style={[styles.td, styles.numCol]}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.td}>{itemTitle(it)}</Text>
                {it.qty > 1 ? <Text style={styles.sub}>{S.billEach(it.price)}</Text> : null}
                {it.priority === 'emergency' ? <Text style={styles.urgent}>⚡ {S.emergency}</Text> : null}
              </View>
              <Text style={[styles.td, styles.right]}>₹{it.amount}</Text>
            </Row>
          ))}
          <View style={styles.dash} />
          {o.deliveries.map((d, i) => (
            <KV key={i} k={deliveryLabel(d)} v={deliveryValue(d)} />
          ))}
        </View>
      ))}

      <Row style={styles.payRow}>
        {payUrl && (
          <Row style={styles.qrBlock}>
            <UpiQr value={payUrl} />
            <View style={styles.qrText}>
              <Text style={styles.qrCaption} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{S.billScanToPay(bill.balance)}</Text>
              <Row style={styles.payLogos}>
                {PAY_LOGOS.map(logo => (
                  <Image
                    key={logo.name}
                    source={logo.source}
                    style={{ width: PAY_LOGO_HEIGHT * logo.ratio, height: PAY_LOGO_HEIGHT }}
                    resizeMode="contain"
                    accessibilityLabel={logo.name}
                  />
                ))}
              </Row>
              {/* One line: an unusually long ID shrinks to fit rather than wrapping. */}
              <Text style={styles.qrUpi} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{shop.upi}</Text>
            </View>
          </Row>
        )}
        <View style={[styles.moneyBox, payUrl ? styles.moneyBoxBesideQr : styles.moneyBoxFull]}>
          {moneyLines(bill).map(([k, v], i) => <KV key={i} k={k} v={v} />)}
          <Row style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>{S.billBalance}</Text>
            <Text style={styles.balanceValue}>₹{bill.balance}</Text>
          </Row>
        </View>
      </Row>

      <Row style={styles.billFoot}>
        <Text style={styles.thanks}>{S.billThanks}</Text>
        <Text style={styles.generatedAt}>{bill.generatedAt}</Text>
      </Row>
    </View>
  );
}

/** Black squares on white, whole pixels each, so a phone camera reads it even from a compressed image. */
function UpiQr({ value }: { value: string }) {
  const { size, rows } = useMemo(() => qrRuns(value), [value]);
  const square = PixelRatio.roundToNearestPixel(QR_SIZE / size);
  return (
    <View style={{ padding: square * 4, backgroundColor: '#fff' }}>
      {rows.map((runs, y) => (
        <View key={y} style={{ flexDirection: 'row', height: square }}>
          {runs.map((run, i) => (
            <View key={i} style={{ width: run * square, backgroundColor: i % 2 === 1 ? '#000' : '#fff' }} />
          ))}
        </View>
      ))}
    </View>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <Row style={styles.kv}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v}>{v}</Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgLight },
  scroll: { padding: LAYOUT.gutter, paddingBottom: LAYOUT.screenBottom },
  // Absolute, because a child in flow may not measure taller than its parent's fixed height:
  // on the phone every line of text would get height 0 and the bill would collapse.
  billScaler: { position: 'absolute', top: 0, left: 0, width: BILL_WIDTH, transformOrigin: 'top left' },
  billWrap: { backgroundColor: '#fff' },
  hint: { fontSize: FONT.sizeSmall, color: COLORS.textMuted, textAlign: 'center', marginTop: SPACE.md },
  pickInfo: { justifyContent: 'space-between', gap: SPACE.sm, paddingHorizontal: LAYOUT.inset, paddingBottom: LAYOUT.rowY },
  pickText: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary, flexShrink: 1 },
  footer: { paddingTop: SPACE.sm, backgroundColor: COLORS.bg, borderTopWidth: 1, borderTopColor: COLORS.border },
  footerActions: { paddingHorizontal: LAYOUT.gutter, paddingVertical: 0 },
  qrToggle: { paddingHorizontal: LAYOUT.gutter },

  bill: { backgroundColor: '#fff', padding: SPACE.lg, borderWidth: 1, borderColor: COLORS.border },
  hero: { justifyContent: 'space-between', gap: SPACE.xl },
  heroShop: { alignItems: 'center' },
  // As tall as the logo side: the title stays at the top and the customer goes to the bottom.
  heroBill: { flex: 1, alignSelf: 'stretch', alignItems: 'flex-end', justifyContent: 'space-between' },
  customer: { alignItems: 'flex-end' },
  tailor: { fontSize: FONT.sizeXSmall, color: COLORS.textSecondary, textAlign: 'center', marginTop: SPACE.xs },
  phone: { fontSize: FONT.sizeXSmall, color: COLORS.textSecondary, textAlign: 'center', marginTop: 2 },
  billLabel: {
    fontSize: FONT.sizeLarge, color: COLORS.textSecondary, textAlign: 'right', marginBottom: SPACE.sm,
    letterSpacing: 2, fontWeight: FONT.weightMedium,
  },
  customerLabel: { fontSize: FONT.sizeXSmall, color: COLORS.textMuted, textAlign: 'right' },
  customerLabelNext: { marginTop: SPACE.xs },
  customerValue: { fontSize: FONT.size, color: COLORS.text, textAlign: 'right' },
  order: { marginTop: SPACE.md },
  orderHead: {
    justifyContent: 'space-between', gap: SPACE.md, marginHorizontal: -SPACE.sm, marginBottom: SPACE.xs,
    paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xs, borderRadius: LAYOUT.radiusSm, backgroundColor: COLORS.bgLight,
  },
  orderNo: { fontSize: FONT.sizeSmall, fontWeight: FONT.weightBold, color: COLORS.brand },
  orderDate: { fontSize: FONT.sizeXSmall, color: COLORS.textSecondary, flexShrink: 1, textAlign: 'right' },
  payRow: { alignItems: 'stretch', gap: SPACE.sm, marginTop: SPACE.md },
  qrBlock: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: LAYOUT.radiusSm },
  qrText: { flex: 1, gap: SPACE.xs, paddingRight: SPACE.sm },
  qrCaption: { fontSize: FONT.sizeSmall, fontWeight: FONT.weightBold, color: COLORS.text },
  payLogos: { flexWrap: 'wrap', gap: SPACE.xs },
  qrUpi: { fontSize: FONT.sizeXSmall, color: COLORS.textSecondary },
  // A tinted box, a line and colour hold the money together even where a phone's font shows little bold.
  moneyBox: { justifyContent: 'center', padding: SPACE.md, borderRadius: LAYOUT.radiusSm, backgroundColor: COLORS.brandTint },
  moneyBoxBesideQr: { width: 210 },
  moneyBoxFull: { flex: 1 },
  balanceRow: {
    justifyContent: 'space-between', gap: SPACE.sm, marginTop: SPACE.xs, paddingTop: SPACE.sm,
    borderTopWidth: 1, borderTopColor: COLORS.brand,
  },
  // Label and amount share one size so they sit on one line, like the rows above.
  balanceLabel: { fontSize: FONT.sizeLarge, fontWeight: FONT.weightBold, color: COLORS.brand, flexShrink: 1 },
  balanceValue: { fontSize: FONT.sizeLarge, fontWeight: FONT.weightBold, color: COLORS.brand },
  billFoot: { justifyContent: 'space-between', gap: SPACE.md, marginTop: SPACE.md },
  generatedAt: { fontSize: FONT.sizeXSmall, color: COLORS.textMuted, textAlign: 'right', flexShrink: 1 },
  dash: { borderBottomWidth: 1, borderStyle: 'dashed', borderColor: '#BBBBBB', marginVertical: SPACE.sm },
  kv: { justifyContent: 'space-between', paddingVertical: 2, gap: SPACE.md },
  k: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary, flexShrink: 1 },
  // Never shrinks, so an amount like "− ₹100" stays whole; a long label wraps instead.
  v: { fontSize: FONT.sizeSmall, color: COLORS.text, textAlign: 'right' },
  tableHead: { paddingBottom: SPACE.xs, borderBottomWidth: 1, borderBottomColor: COLORS.separator },
  th: { fontSize: FONT.sizeXSmall, color: COLORS.textMuted, fontWeight: FONT.weightMedium },
  numCol: { width: 24 },
  tr: { paddingVertical: SPACE.xs, alignItems: 'flex-start' },
  td: { fontSize: FONT.sizeSmall, color: COLORS.text },
  right: { minWidth: 70, textAlign: 'right' },
  sub: { fontSize: FONT.sizeXSmall, color: COLORS.textSecondary },
  urgent: { fontSize: FONT.sizeXSmall, color: COLORS.emergency },
  thanks: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary, flexShrink: 1 },
});
