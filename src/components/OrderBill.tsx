// ============================================================
// Paridhan – order bill: preview, share as image, send on WhatsApp
// ============================================================
import React, { useRef, useState } from 'react';
import { Alert, Linking, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { STRINGS } from '../strings';
import * as DB from '../db/database';
import type { OrderWithDetails } from '../types';
import {
  billText, buildBill, deliveryLabel, deliveryValue, itemTitle, moneyLines, shopContactLine, whatsappUrl,
  type BillData, type ShopInfo,
} from '../utils/order';
import { blouseLabel } from '../utils/labels';
import { Actions, BrandLogo, Button, COLORS, FONT, LAYOUT, ModalHeader, Row, SPACE } from './ui';

export function OrderBillModal({
  card, visible, onClose,
}: { card: OrderWithDetails; visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const billRef = useRef<React.ComponentRef<typeof View>>(null);
  const [busy, setBusy] = useState(false);
  const bill = buildBill(card, blouseLabel);
  const shop = DB.getShopInfo();

  const shareImage = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const uri = await captureRef(billRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        fileName: `bill-${bill.orderNo}`,
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
    const url = whatsappUrl(card.customer.phone, billText(bill, shop));
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(STRINGS.billShareFailed, STRINGS.billNoWhatsApp);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ModalHeader title={`${STRINGS.billTitle} · ${bill.orderNo}`} subtitle={bill.customerName} onBack={onClose} />

        <ScrollView contentContainerStyle={styles.scroll}>
          {/* This view is what becomes the image. */}
          <View ref={billRef} collapsable={false} style={styles.billWrap}>
            <BillView bill={bill} shop={shop} />
          </View>
          {!shop.tailor && !shop.phone && <Text style={styles.hint}>{STRINGS.billShopHint}</Text>}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: SPACE.sm + insets.bottom }]}>
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
    </Modal>
  );
}

/** The printed-looking bill: plain and minimal, with the logo on top. Kept free of buttons. */
function BillView({ bill, shop }: { bill: BillData; shop: ShopInfo }) {
  const S = STRINGS;
  const contact = shopContactLine(shop);
  return (
    <View style={styles.bill}>
      <View style={styles.hero}>
        <BrandLogo width={150} />
        {shop.tailor ? (
          <Text style={styles.tailor}>{shop.tailor}</Text>
        ) : null}

        {shop.phone ? (
          <Text style={styles.phone}>{shop.phone}</Text>
        ) : null}
        <Text style={styles.billLabel }>{S.billTitle}</Text>
      </View>

      <View style={styles.dash} />
      <KV k={S.billOrderNo} v={bill.orderNo} />
      <KV k={S.billOrderDate} v={bill.orderDate} />
      <KV k={S.billCustomer} v={bill.customerName} />
      {bill.customerPhone ? <KV k={S.billPhone} v={bill.customerPhone} /> : null}
      <View style={styles.dash} />

      <Row style={styles.tableHead}>
        <Text style={[styles.th, styles.numCol]}>#</Text>
        <Text style={[styles.th, { flex: 1 }]}>{S.billItem}</Text>
        <Text style={[styles.th, styles.right]}>{S.billAmount}</Text>
      </Row>
      {bill.items.map((it, i) => (
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

      {bill.deliveries.map((d, i) => (
        <KV key={i} k={deliveryLabel(d)} v={deliveryValue(d)} />
      ))}
      <View style={styles.dash} />

      {moneyLines(bill).map(([k, v], i) => <KV key={i} k={k} v={v} />)}
      <KV k={S.billBalance} v={`₹${bill.balance}`} big />

      <Text style={styles.thanks}>{S.billThanks}</Text>
    </View>
  );
}

function KV({ k, v, bold, big }: { k: string; v: string; bold?: boolean; big?: boolean }) {
  return (
    <Row style={styles.kv}>
      <Text style={[styles.k, big && styles.big]}>{k}</Text>
      <Text style={[styles.v, (bold || big) && { fontWeight: FONT.weightBold }, big && styles.big]}>{v}</Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgLight },
  scroll: { padding: LAYOUT.gutter, paddingBottom: LAYOUT.screenBottom },
  billWrap: { backgroundColor: '#fff' },
  hint: { fontSize: FONT.sizeSmall, color: COLORS.textMuted, textAlign: 'center', marginTop: SPACE.md },
  footer: { paddingTop: SPACE.sm, backgroundColor: COLORS.bg, borderTopWidth: 1, borderTopColor: COLORS.border },
  footerActions: { paddingHorizontal: LAYOUT.gutter, paddingVertical: 0 },

  bill: { backgroundColor: '#fff', padding: SPACE.xl, borderWidth: 1, borderColor: COLORS.border },
  hero: { alignItems: 'center' },
  tailor: { fontSize: FONT.sizeXSmall, color: COLORS.textSecondary, textAlign: 'center', marginTop: 4, display: 'flex', },
  phone: { fontSize: FONT.sizeXSmall, color: COLORS.textSecondary, textAlign: 'center', marginTop: 2, marginBottom:4, display: 'flex', },
  
  billLabel: {
    fontSize: FONT.sizeLarge, color: COLORS.textSecondary, textAlign: 'center', marginTop: SPACE.xs,
    letterSpacing: 2, fontWeight: 600
  },
  dash: { borderBottomWidth: 1, borderStyle: 'dashed', borderColor: '#BBBBBB', marginVertical: SPACE.sm },
  kv: { justifyContent: 'space-between', paddingVertical: 2, gap: SPACE.md },
  k: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary, flexShrink: 1 },
  v: { fontSize: FONT.sizeSmall, color: COLORS.text, textAlign: 'right', flexShrink: 1 },
  big: { fontSize: FONT.sizeLarge, color: COLORS.text, fontWeight: FONT.weightBold },
  tableHead: { paddingBottom: SPACE.xs, borderBottomWidth: 1, borderBottomColor: COLORS.separator },
  th: { fontSize: FONT.sizeXSmall, color: COLORS.textMuted, fontWeight: FONT.weightMedium },
  numCol: { width: 24 },
  tr: { paddingVertical: SPACE.xs, alignItems: 'flex-start' },
  td: { fontSize: FONT.sizeSmall, color: COLORS.text },
  right: { minWidth: 70, textAlign: 'right' },
  sub: { fontSize: FONT.sizeXSmall, color: COLORS.textSecondary },
  urgent: { fontSize: FONT.sizeXSmall, color: COLORS.emergency },
  thanks: { fontSize: FONT.sizeSmall, color: COLORS.textSecondary, textAlign: 'center', marginTop: SPACE.lg },
});
