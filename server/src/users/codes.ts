// Redeem codes: XXXX-XXXX-XXXX from an alphabet without 0/O and 1/I, which look
// alike when typed from a screenshot. scripts/redeem-codes.mjs uses the same rules.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join('')).join('-');
}
