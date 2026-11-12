const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// Numeric ids in report documents use little-endian base62 in viewer URLs
// and PDF selectors. Keep stored ids (and newer prefixed ids) unchanged.
export function externalPageId(pageId: string): string {
  if (!/^\d+$/.test(pageId)) return pageId;
  let value = BigInt(pageId);
  let encoded = '';
  do {
    encoded += DIGITS[Number(value % 62n)];
    value /= 62n;
  } while (value > 0n);
  return encoded;
}
