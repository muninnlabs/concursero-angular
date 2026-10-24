// Generates Premium redeem codes and the SQL that adds them to D1.
//
//   node scripts/redeem-codes.mjs --count 10 --days 30 [--uses 1] [--expires 2026-12-31] [--note "Lançamento"]
//   npx wrangler d1 execute concursero-angular --remote --file redeem-codes.sql
//
// --days 0 gives Premium with no end. --uses is how many accounts can redeem each
// code (each account once). The codes are printed; the SQL goes to redeem-codes.sql
// (git-ignored), or to --out.
import { randomInt } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

// No 0/O or 1/I, which look alike when typed from a screenshot.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '1' },
    days: { type: 'string', default: '30' },
    uses: { type: 'string', default: '1' },
    expires: { type: 'string' },
    note: { type: 'string' },
    out: { type: 'string', default: 'redeem-codes.sql' },
  },
});

const count = Number(values.count);
const days = Number(values.days);
const uses = Number(values.uses);
if (![count, days, uses].every(Number.isInteger) || count < 1 || days < 0 || uses < 1) {
  console.error('--count, --days and --uses must be whole numbers (count and uses at least 1).');
  process.exit(1);
}
const expires = values.expires ? new Date(`${values.expires}T23:59:59-03:00`).toISOString() : null;
const sql = (value) => (value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`);

const code = () =>
  Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')).join('-');
const codes = Array.from({ length: count }, code);
const createdAt = new Date().toISOString();

writeFileSync(
  values.out,
  codes
    .map(
      (c) =>
        `INSERT INTO redeem_codes (code, days, max_uses, expires_at, note, created_at) VALUES (${sql(c)}, ${days || 'NULL'}, ${uses}, ${sql(expires)}, ${sql(values.note)}, ${sql(createdAt)});`,
    )
    .join('\n') + '\n',
);
console.log(codes.join('\n'));
console.error(`\n${count} code(s), ${days ? `${days} days` : 'no end'}, ${uses} use(s) each${expires ? `, redeemable until ${values.expires}` : ''}.`);
console.error(`SQL: ${values.out}  →  npx wrangler d1 execute concursero-angular --remote --file ${values.out}`);
