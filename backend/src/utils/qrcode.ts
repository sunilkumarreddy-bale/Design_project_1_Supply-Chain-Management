import QRCode from 'qrcode';

/** Returns a PNG data URL for the given payload (product QR codes encode the SKU). */
export async function qrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
}
