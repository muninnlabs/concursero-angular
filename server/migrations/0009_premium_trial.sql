-- New accounts start with 7 days of Premium (users.plan/premium_until, as a
-- redeem code would give). One trial per Google e-mail: its SHA-256 is kept here,
-- and NOT removed when the account is deleted, so deleting and signing in again
-- doesn't start another trial. Only the hash is stored, never the address.
CREATE TABLE IF NOT EXISTS trial_claims (
  email_hash TEXT PRIMARY KEY,
  claimed_at TEXT NOT NULL
);
