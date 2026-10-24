-- Premium subscription through Stripe (server/src/billing/stripe.ts). The
-- subscription columns mirror Stripe, refreshed by its webhooks; Premium from a
-- redeem code (plan / premium_until) is kept apart, so either one counts.
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN subscription_status TEXT;
ALTER TABLE users ADD COLUMN subscription_period_end TEXT;
ALTER TABLE users ADD COLUMN subscription_renews INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_customer ON users(stripe_customer_id);
