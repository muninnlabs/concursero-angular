-- Admin panel (server/src/site/site-store.ts).
--
-- page_views: one row per page shown, recorded by the app itself, without cookies.
-- No IP address is stored: `visitor` is a hash of IP + browser + day with a daily
-- salt, so a person counts once per day and can't be followed across days.
-- Location is Cloudflare's estimate from the IP (country, region, city).
-- `day` is the Brasília date. Rows older than 13 months are purged.
CREATE TABLE IF NOT EXISTS page_views (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  day         TEXT NOT NULL,
  path        TEXT NOT NULL,
  content     TEXT,
  referrer    TEXT,
  utm_source  TEXT,
  utm_campaign TEXT,
  country     TEXT,
  region      TEXT,
  city        TEXT,
  device      TEXT NOT NULL,
  visitor     TEXT NOT NULL,
  signed_in   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS page_views_day ON page_views(day);

-- Ads sold directly to partners (universities, schools, courses). The image is
-- kept here as base64, served by /api/ads/image/:id.
CREATE TABLE IF NOT EXISTS partner_ads (
  id          TEXT PRIMARY KEY,
  advertiser  TEXT NOT NULL,
  title       TEXT NOT NULL,
  link_url    TEXT NOT NULL,
  image       TEXT NOT NULL,
  image_type  TEXT NOT NULL,
  starts_on   TEXT,
  ends_on     TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

-- What each ad space shows: 'google' (AdSense, the default), 'partner' (partner_ad_id,
-- falling back to Google outside its dates) or 'off'.
CREATE TABLE IF NOT EXISTS ad_placements (
  placement     TEXT PRIMARY KEY,
  source        TEXT NOT NULL DEFAULT 'google',
  partner_ad_id TEXT REFERENCES partner_ads(id) ON DELETE SET NULL,
  updated_at    TEXT NOT NULL
);

-- Views (the ad was on screen) and clicks, per placement: the numbers to show advertisers.
CREATE TABLE IF NOT EXISTS ad_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT NOT NULL,
  day           TEXT NOT NULL,
  placement     TEXT NOT NULL,
  source        TEXT NOT NULL,
  partner_ad_id TEXT,
  kind          TEXT NOT NULL,
  country       TEXT,
  region        TEXT,
  device        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ad_events_day ON ad_events(day, placement);

-- A random salt per day for the visitor hash; yesterday's is deleted, so old hashes can't be recomputed.
CREATE TABLE IF NOT EXISTS visitor_salts (
  day  TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);
