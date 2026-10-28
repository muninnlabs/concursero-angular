-- Where Premium without a subscription came from, so Configurações can say so:
-- 'trial' (the 7 days every new account gets) or 'code' (a redeem code).
ALTER TABLE users ADD COLUMN premium_source TEXT;

UPDATE users SET premium_source = 'code' WHERE id IN (SELECT user_id FROM code_redemptions);
UPDATE users SET premium_source = 'trial' WHERE premium_source IS NULL AND plan = 'premium' AND premium_until IS NOT NULL;
