// ============================================================
// Paridhan – UPI payment link and its QR code for the bill
// ============================================================
import { toQR } from 'toqr';

/** "name@bank". Catches a phone number or a typo before it is printed as an unpayable QR. */
export const isUpiId = (s: string) => /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/.test(s.trim());

/**
 * The link a UPI app reads from the QR, with the amount already filled in.
 * Null when there is nothing to pay or no valid UPI ID, so the bill shows no QR.
 */
export function upiPayUrl(upiId: string, payeeName: string, amount: number): string | null {
  if (!isUpiId(upiId) || !(amount > 0)) return null;
  // UPI apps handle a Latin name reliably, and a Marathi one would make the QR much denser.
  const name = payeeName.replace(/[^\x20-\x7E]/g, '').trim() || 'Paridhan';
  return `upi://pay?pa=${upiId.trim()}&pn=${encodeURIComponent(name)}&am=${amount.toFixed(2)}&cu=INR`;
}

export interface QrRuns {
  /** Modules per side, without the quiet zone. */
  size: number;
  /** Per row, alternating run lengths: light, dark, light, dark… */
  rows: number[][];
}

/** The QR as runs of modules, so it can be drawn with far fewer views than one per module. */
export function qrRuns(text: string): QrRuns {
  const modules = toQR(text);
  const size = Math.sqrt(modules.length);
  const rows: number[][] = [];
  for (let y = 0; y < size; y++) {
    const runs = [0];
    for (let x = 0; x < size; x++) {
      const dark = modules[y * size + x] === 1;
      if (dark !== (runs.length % 2 === 0)) runs.push(0);
      runs[runs.length - 1]++;
    }
    rows.push(runs);
  }
  return { size, rows };
}
