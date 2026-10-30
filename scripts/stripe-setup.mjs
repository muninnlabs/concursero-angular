// Creates what the Premium subscription needs in Stripe; safe to run again.
//
//   STRIPE_SECRET_KEY=sk_live_… node scripts/stripe-setup.mjs [--webhook https://concursero.com/api/billing/webhook] [--env-out path]
//
// 1. Product "Concursero Premium" with a monthly BRL price (lookup key concursero_premium_monthly).
// 2. Concursero's own customer portal (cancel at period end, change card, invoices), since the
//    Stripe account is shared with other Munnin Labs projects.
// 3. With --webhook, the webhook endpoint. Stripe shows its signing secret only when it's created.
// Prints STRIPE_PRICE_ID and STRIPE_PORTAL_CONFIG (go in wrangler.toml / server/.env); with --env-out, appends the
// price and the webhook secret to that file instead of printing the secret.
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const LOOKUP_KEY = 'concursero_premium_monthly';
const PRICE_CENTS = 4999; // R$ 49,99/mês; keep in sync with PREMIUM.price (client/src/app/core/premium.ts)
const SITE = 'https://concursero.com';
const EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
];

const { values } = parseArgs({ options: { webhook: { type: 'string' }, 'env-out': { type: 'string' } } });
const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Set STRIPE_SECRET_KEY.');
  process.exit(1);
}

function encode(params, prefix = '', pairs = []) {
  for (const [k, v] of Object.entries(params)) {
    const name = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') encode(Array.isArray(v) ? Object.fromEntries(v.entries()) : v, name, pairs);
    else pairs.push([name, String(v)]);
  }
  return pairs;
}

async function stripe(method, path, params = {}) {
  const query = new URLSearchParams(encode(params)).toString();
  const res = await fetch(`https://api.stripe.com/v1${path}${method === 'GET' && query ? `?${query}` : ''}`, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'POST' ? query : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${body.error?.message}`);
  return body;
}

const output = [];

const brl = (cents) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
let [price] = (await stripe('GET', '/prices', { lookup_keys: [LOOKUP_KEY], active: true })).data;
if (price && price.unit_amount !== PRICE_CENTS) {
  // Prices can't change: add the new amount to the same product and move the lookup key to it.
  // Existing subscribers stay on their old price until it's changed in Stripe.
  const old = price;
  price = await stripe('POST', '/prices', {
    product: old.product,
    currency: 'brl',
    unit_amount: PRICE_CENTS,
    recurring: { interval: 'month' },
    lookup_key: LOOKUP_KEY,
    transfer_lookup_key: true,
    nickname: 'Premium mensal',
  });
  console.log(`Created price ${price.id} (${brl(PRICE_CENTS)}/mês), replacing ${old.id} (${brl(old.unit_amount)})`);
} else if (price) {
  console.log(`Price exists: ${price.id} (${brl(price.unit_amount)}/${price.recurring.interval})`);
} else {
  const product = await stripe('POST', '/products', {
    name: 'Concursero Premium',
    description: 'Comentários das questões da OAB, estatísticas avançadas e nenhum anúncio.',
    statement_descriptor: 'CONCURSERO',
    url: SITE,
  });
  price = await stripe('POST', '/prices', {
    product: product.id,
    currency: 'brl',
    unit_amount: PRICE_CENTS,
    recurring: { interval: 'month' },
    lookup_key: LOOKUP_KEY,
    nickname: 'Premium mensal',
  });
  console.log(`Created price ${price.id} (${brl(PRICE_CENTS)}/mês)`);
}
output.push(`STRIPE_PRICE_ID=${price.id}`);

let portal = (await stripe('GET', '/billing_portal/configurations', { active: true, limit: 100 })).data.find((p) => p.metadata?.app === 'concursero');
if (portal) {
  console.log(`Customer portal exists: ${portal.id}`);
} else {
  portal = await stripe('POST', '/billing_portal/configurations', {
    metadata: { app: 'concursero' },
    business_profile: { headline: 'Concursero Premium', privacy_policy_url: `${SITE}/privacidade`, terms_of_service_url: `${SITE}/termos` },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end', cancellation_reason: { enabled: true, options: ['too_expensive', 'unused', 'other'] } },
    },
  });
  console.log(`Created customer portal ${portal.id}`);
}
output.push(`STRIPE_PORTAL_CONFIG=${portal.id}`);

if (values.webhook) {
  const existing = (await stripe('GET', '/webhook_endpoints', { limit: 100 })).data.find((w) => w.url === values.webhook);
  if (existing) {
    console.log(`Webhook exists: ${existing.id} (its secret is in the Stripe dashboard)`);
  } else {
    const hook = await stripe('POST', '/webhook_endpoints', { url: values.webhook, enabled_events: EVENTS, description: 'Concursero Premium' });
    console.log(`Created webhook ${hook.id}`);
    output.push(`STRIPE_WEBHOOK_SECRET=${hook.secret}`);
  }
}

if (values['env-out']) {
  appendFileSync(values['env-out'], `${output.join('\n')}\n`);
  console.log(`Wrote ${output.map((l) => l.split('=')[0]).join(', ')} to ${values['env-out']}`);
} else {
  console.log(`\n${output.join('\n')}`);
}
