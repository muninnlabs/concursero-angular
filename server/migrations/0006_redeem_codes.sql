-- Premium without payment: codes handed out (gifts, partners, early users) and
-- redeemed on Configurações. A code gives `days` of Premium (NULL: no end) to up
-- to `max_uses` accounts, each at most once; past `expires_at` it can't be redeemed.
-- users.premium_until: when Premium ends; NULL with plan 'premium' means it doesn't.
ALTER TABLE users ADD COLUMN premium_until TEXT;

CREATE TABLE IF NOT EXISTS redeem_codes (
  code       TEXT PRIMARY KEY,
  days       INTEGER,
  max_uses   INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  note       TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS code_redemptions (
  code        TEXT NOT NULL REFERENCES redeem_codes(code),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at TEXT NOT NULL,
  PRIMARY KEY (code, user_id)
);
