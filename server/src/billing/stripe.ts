// Premium subscription through Stripe Checkout, with the Stripe REST API called
// via fetch (works the same on Node and Workers, no SDK). app.ts only sees the
// Billing interface, so tests use a fake.

/** What app.ts needs from the payment provider. */
export interface Billing {
  createCustomer(user: { id: string; email: string; name: string }): Promise<string>;
  /** Stripe Checkout page for the monthly Premium price. */
  checkoutUrl(options: { customerId: string; userId: string; successUrl: string; cancelUrl: string }): Promise<string>;
  /** Stripe's customer portal: cancel, change card, invoices. */
  portalUrl(options: { customerId: string; returnUrl: string }): Promise<string>;
  /** The customer's current subscription, read from Stripe (null when there is none). */
  subscription(customerId: string): Promise<SubscriptionState | null>;
  /** Cancels every live subscription now (account deletion). */
  cancelAll(customerId: string): Promise<void>;
  /** Checks the Stripe-Signature header; returns the customer the event is about, or null to ignore it. */
  webhookCustomer(payload: string, signature: string | undefined): Promise<{ customerId: string | null } | 'invalid'>;
}

export interface SubscriptionState {
  /** Stripe's status: active, trialing, past_due, canceled, unpaid, incomplete… */
  status: string;
  /** End of the paid period (ISO). */
  periodEnd: string;
  /** False once the user cancelled: it ends at periodEnd. */
  renews: boolean;
}

/** Statuses that still give Premium (past_due: Stripe is retrying the card). */
export const LIVE_STATUSES = ['active', 'trialing', 'past_due'];

const API = 'https://api.stripe.com/v1';
/** Webhooks older than this are rejected (Stripe's own default). */
const TOLERANCE_SECONDS = 300;

/** Stripe's form encoding: { a: { b: [ { c: 1 } ] } } → a[b][0][c]=1 */
export function formEncode(params: Record<string, unknown>): string {
  const pairs: [string, string][] = [];
  const walk = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(`${key}[${i}]`, v));
    else if (typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(`${key}[${k}]`, v);
    else pairs.push([key, String(value)]);
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return new URLSearchParams(pairs).toString();
}

/** Stripe-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.payload">[,v1=…] */
export async function verifySignature(payload: string, header: string | undefined, secret: string, now = Date.now()): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const timestamp = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(timestamp) || !signatures.length || Math.abs(now / 1000 - timestamp) > TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return signatures.some((s) => timingSafeEqual(s, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface StripeSubscription {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  /** Before API version 2025-03-31 the period was on the subscription; now it's on each item. */
  current_period_end?: number;
  items?: { data: { current_period_end?: number }[] };
}

function periodEnd(sub: StripeSubscription): number {
  return sub.current_period_end ?? Math.max(0, ...(sub.items?.data ?? []).map((i) => i.current_period_end ?? 0));
}

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  /** Concursero's customer portal (scripts/stripe-setup.mjs); the account's default one otherwise. */
  portalConfig?: string;
}

export class StripeBilling implements Billing {
  private readonly config: StripeConfig;

  constructor(config: StripeConfig) {
    this.config = config;
  }

  private async call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, unknown> = {}): Promise<T> {
    const query = formEncode(params);
    const res = await fetch(`${API}${path}${method === 'GET' && query ? `?${query}` : ''}`, {
      method,
      headers: { authorization: `Bearer ${this.config.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: method === 'POST' ? query : undefined,
    });
    const body = (await res.json()) as T & { error?: { message: string } };
    if (!res.ok) throw new Error(`Stripe ${method} ${path}: ${body.error?.message ?? res.status}`);
    return body;
  }

  async createCustomer(user: { id: string; email: string; name: string }): Promise<string> {
    const customer = await this.call<{ id: string }>('POST', '/customers', {
      email: user.email,
      name: user.name,
      metadata: { uid: user.id },
      preferred_locales: ['pt-BR'],
    });
    return customer.id;
  }

  async checkoutUrl({ customerId, userId, successUrl, cancelUrl }: { customerId: string; userId: string; successUrl: string; cancelUrl: string }) {
    const session = await this.call<{ url: string }>('POST', '/checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price: this.config.priceId, quantity: 1 }],
      subscription_data: { metadata: { uid: userId } },
      allow_promotion_codes: true,
      locale: 'pt-BR',
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    return session.url;
  }

  async portalUrl({ customerId, returnUrl }: { customerId: string; returnUrl: string }) {
    const session = await this.call<{ url: string }>('POST', '/billing_portal/sessions', {
      customer: customerId,
      return_url: returnUrl,
      locale: 'pt-BR',
      configuration: this.config.portalConfig,
    });
    return session.url;
  }

  private async list(customerId: string) {
    return (await this.call<{ data: StripeSubscription[] }>('GET', '/subscriptions', { customer: customerId, status: 'all', limit: 20 })).data;
  }

  async subscription(customerId: string): Promise<SubscriptionState | null> {
    // The live one if any, else the one that ended last.
    const [best] = (await this.list(customerId)).sort(
      (a, b) => Number(LIVE_STATUSES.includes(b.status)) - Number(LIVE_STATUSES.includes(a.status)) || periodEnd(b) - periodEnd(a),
    );
    if (!best) return null;
    return {
      status: best.status,
      periodEnd: new Date(periodEnd(best) * 1000).toISOString(),
      renews: LIVE_STATUSES.includes(best.status) && !best.cancel_at_period_end && !best.cancel_at,
    };
  }

  async cancelAll(customerId: string): Promise<void> {
    for (const sub of await this.list(customerId)) {
      if (!['canceled', 'incomplete_expired'].includes(sub.status)) await this.call('DELETE', `/subscriptions/${sub.id}`);
    }
  }

  async webhookCustomer(payload: string, signature: string | undefined) {
    if (!(await verifySignature(payload, signature, this.config.webhookSecret))) return 'invalid' as const;
    const event = JSON.parse(payload) as { data?: { object?: { customer?: unknown } } };
    const customer = event.data?.object?.customer;
    return { customerId: typeof customer === 'string' ? customer : null };
  }
}
