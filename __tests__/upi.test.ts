import { isUpiId, qrRuns, upiPayUrl } from '../src/utils/upi';

describe('UPI ID', () => {
  it('accepts name@bank and ignores spaces around it', () => {
    expect(isUpiId('sunita.patil-1_2@okaxis')).toBe(true);
    expect(isUpiId(' 9876543210@ybl ')).toBe(true);
  });
  it('rejects what is not a UPI ID', () => {
    for (const bad of ['', '9876543210', 'sunita@', '@okaxis', 'su nita@okaxis', 'a@b@c', 'a@b&am=1']) {
      expect(isUpiId(bad)).toBe(false);
    }
  });
});

describe('UPI payment link', () => {
  it('carries the UPI ID, the name and the exact amount to pay', () => {
    expect(upiPayUrl(' sunita@okaxis ', 'Sai & Sons', 450)).toBe(
      'upi://pay?pa=sunita@okaxis&pn=Sai%20%26%20Sons&am=450.00&cu=INR',
    );
  });
  it('falls back to a Latin name when the name is in Marathi', () => {
    expect(upiPayUrl('a@b', 'साई टेलर्स', 1)).toContain('pn=Paridhan&');
  });
  it('makes no link when nothing is left to pay or the UPI ID is missing', () => {
    expect(upiPayUrl('a@b', 'Sai', 0)).toBeNull();
    expect(upiPayUrl('a@b', 'Sai', -50)).toBeNull();
    expect(upiPayUrl('', 'Sai', 450)).toBeNull();
    expect(upiPayUrl('9876543210', 'Sai', 450)).toBeNull();
  });
});

describe('QR runs', () => {
  const { size, rows } = qrRuns('upi://pay?pa=sunita@okaxis&pn=Sai&am=450.00&cu=INR');

  it('covers every square of every row, starting with a light run', () => {
    expect(rows).toHaveLength(size);
    for (const runs of rows) expect(runs.reduce((a, b) => a + b, 0)).toBe(size);
  });
  it('draws the corner finder square: 7 dark, then a light gap', () => {
    expect(rows[0].slice(0, 2)).toEqual([0, 7]);
    expect(rows[1].slice(0, 4)).toEqual([0, 1, 5, 1]);
  });
});
