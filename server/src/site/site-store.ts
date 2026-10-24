// The admin panel's data: page views (cookieless), ad placements, partner ads and
// their views/clicks, plus summaries of users and redeem codes. Schema:
// migrations/0008_site_analytics_ads.sql.
import type { SqlDatabase } from '../users/sql-store.ts';

/** Ad spaces in the client (client/src/app/core/ads.ts), with the names the admin panel shows. */
export const AD_PLACEMENTS = {
  'landing-top': 'Página inicial (visitantes)',
  'dashboard-top': 'Início · topo',
  'stats-top': 'Estatísticas · topo',
  'stats-inline': 'Estatísticas · meio',
  'subjects-grid': 'Assuntos · grade',
  'profile-side': 'Perfil · lateral',
  'settings-inline': 'Configurações',
} as const;
export type AdPlacementId = keyof typeof AD_PLACEMENTS;
export type AdSource = 'google' | 'partner' | 'off';

export interface PageView {
  path: string;
  content: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  device: 'mobile' | 'tablet' | 'desktop';
  signedIn: boolean;
  /** IP + user agent: hashed with the day's salt, never stored. */
  fingerprint: string;
}

export interface AdEvent {
  placement: AdPlacementId;
  source: 'google' | 'partner';
  partnerAdId: string | null;
  kind: 'view' | 'click';
  country: string | null;
  region: string | null;
  device: PageView['device'];
}

export interface PartnerAd {
  id: string;
  advertiser: string;
  title: string;
  linkUrl: string;
  imageType: string;
  /** YYYY-MM-DD, inclusive; null = no limit. */
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
  createdAt: string;
}

/** What an ad space shows right now (GET /api/ads). */
export type ResolvedPlacement =
  | { source: 'google' | 'off' }
  | { source: 'partner'; ad: { id: string; advertiser: string; title: string } };

/** Rows older than this are purged (13 months, so a year can be compared). */
const RETENTION_DAYS = 400;
/** Brasília (UTC−3, no daylight saving since 2019): the day the audience lives in. */
const BRT_OFFSET_MS = -3 * 3_600_000;

export function brasiliaDay(date = new Date()): string {
  return new Date(date.getTime() + BRT_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface PartnerAdRow {
  id: string;
  advertiser: string;
  title: string;
  link_url: string;
  image_type: string;
  starts_on: string | null;
  ends_on: string | null;
  active: number;
  created_at: string;
}

const PARTNER_COLUMNS = 'id, advertiser, title, link_url, image_type, starts_on, ends_on, active, created_at';

function toPartnerAd(row: PartnerAdRow): PartnerAd {
  return {
    id: row.id,
    advertiser: row.advertiser,
    title: row.title,
    linkUrl: row.link_url,
    imageType: row.image_type,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    active: !!row.active,
    createdAt: row.created_at,
  };
}

function running(ad: PartnerAd, today: string): boolean {
  return ad.active && (!ad.startsOn || ad.startsOn <= today) && (!ad.endsOn || ad.endsOn >= today);
}

export class SiteStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  // --- Page views -----------------------------------------------------------

  /** Today's salt, created on first use; older ones are dropped. */
  private async salt(day: string): Promise<string> {
    const fresh = crypto.randomUUID();
    await this.db.batch([
      { sql: 'INSERT OR IGNORE INTO visitor_salts (day, salt) VALUES (?, ?)', params: [day, fresh] },
      { sql: 'DELETE FROM visitor_salts WHERE day < ?', params: [day] },
    ]);
    return (await this.db.first<{ salt: string }>('SELECT salt FROM visitor_salts WHERE day = ?', [day]))!.salt;
  }

  async recordView(view: PageView, now = new Date()): Promise<void> {
    const day = brasiliaDay(now);
    const visitor = (await sha256(`${await this.salt(day)}|${view.fingerprint}`)).slice(0, 32);
    const statements = [
      {
        sql: `INSERT INTO page_views (at, day, path, content, referrer, utm_source, utm_campaign, country, region, city, device, visitor, signed_in)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          now.toISOString(),
          day,
          view.path,
          view.content,
          view.referrer,
          view.utmSource,
          view.utmCampaign,
          view.country,
          view.region,
          view.city,
          view.device,
          visitor,
          view.signedIn ? 1 : 0,
        ],
      },
    ];
    // Purging now and then is enough (about once per thousand views).
    if (Math.random() < 0.001) {
      const cutoff = addDays(day, -RETENTION_DAYS);
      statements.push(
        { sql: 'DELETE FROM page_views WHERE day < ?', params: [cutoff] },
        { sql: 'DELETE FROM ad_events WHERE day < ?', params: [cutoff] },
      );
    }
    await this.db.batch(statements);
  }

  // --- Ads --------------------------------------------------------------------

  async recordAdEvent(event: AdEvent, now = new Date()): Promise<void> {
    await this.db.batch([
      {
        sql: `INSERT INTO ad_events (at, day, placement, source, partner_ad_id, kind, country, region, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          now.toISOString(),
          brasiliaDay(now),
          event.placement,
          event.source,
          event.partnerAdId,
          event.kind,
          event.country,
          event.region,
          event.device,
        ],
      },
    ]);
  }

  /** Every placement with its stored setting (Google when never set). */
  async placementSettings(): Promise<{ placement: AdPlacementId; label: string; source: AdSource; partnerAdId: string | null }[]> {
    const rows = await this.db.all<{ placement: string; source: AdSource; partner_ad_id: string | null }>('SELECT * FROM ad_placements');
    const byId = new Map(rows.map((r) => [r.placement, r]));
    return (Object.keys(AD_PLACEMENTS) as AdPlacementId[]).map((placement) => ({
      placement,
      label: AD_PLACEMENTS[placement],
      source: byId.get(placement)?.source ?? 'google',
      partnerAdId: byId.get(placement)?.partner_ad_id ?? null,
    }));
  }

  async setPlacement(placement: AdPlacementId, source: AdSource, partnerAdId: string | null): Promise<void> {
    await this.db.batch([
      {
        sql: `INSERT INTO ad_placements (placement, source, partner_ad_id, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(placement) DO UPDATE SET source = excluded.source, partner_ad_id = excluded.partner_ad_id, updated_at = excluded.updated_at`,
        params: [placement, source, source === 'partner' ? partnerAdId : null, new Date().toISOString()],
      },
    ]);
  }

  /** What each placement shows today: a partner ad outside its dates (or paused) falls back to Google. */
  async resolvedPlacements(now = new Date()): Promise<Record<string, ResolvedPlacement>> {
    const today = brasiliaDay(now);
    const ads = new Map((await this.partnerAds()).map((a) => [a.id, a]));
    const result: Record<string, ResolvedPlacement> = {};
    for (const p of await this.placementSettings()) {
      const ad = p.partnerAdId ? ads.get(p.partnerAdId) : undefined;
      if (p.source === 'partner' && ad && running(ad, today)) {
        result[p.placement] = { source: 'partner', ad: { id: ad.id, advertiser: ad.advertiser, title: ad.title } };
      } else {
        result[p.placement] = { source: p.source === 'off' ? 'off' : 'google' };
      }
    }
    return result;
  }

  async partnerAds(): Promise<PartnerAd[]> {
    return (await this.db.all<PartnerAdRow>(`SELECT ${PARTNER_COLUMNS} FROM partner_ads ORDER BY created_at DESC`)).map(toPartnerAd);
  }

  async partnerAd(id: string): Promise<PartnerAd | undefined> {
    const row = await this.db.first<PartnerAdRow>(`SELECT ${PARTNER_COLUMNS} FROM partner_ads WHERE id = ?`, [id]);
    return row && toPartnerAd(row);
  }

  async partnerImage(id: string): Promise<{ data: string; type: string } | undefined> {
    const row = await this.db.first<{ image: string; image_type: string }>('SELECT image, image_type FROM partner_ads WHERE id = ?', [id]);
    return row && { data: row.image, type: row.image_type };
  }

  async createPartnerAd(ad: Omit<PartnerAd, 'id' | 'createdAt'> & { image: string }): Promise<PartnerAd> {
    const id = crypto.randomUUID();
    await this.db.batch([
      {
        sql: `INSERT INTO partner_ads (id, advertiser, title, link_url, image, image_type, starts_on, ends_on, active, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, ad.advertiser, ad.title, ad.linkUrl, ad.image, ad.imageType, ad.startsOn, ad.endsOn, ad.active ? 1 : 0, new Date().toISOString()],
      },
    ]);
    return (await this.partnerAd(id))!;
  }

  async updatePartnerAd(
    id: string,
    fields: Partial<Pick<PartnerAd, 'advertiser' | 'title' | 'linkUrl' | 'startsOn' | 'endsOn' | 'active' | 'imageType'>> & { image?: string },
  ): Promise<PartnerAd | undefined> {
    const columns: Record<string, string> = {
      advertiser: 'advertiser',
      title: 'title',
      linkUrl: 'link_url',
      startsOn: 'starts_on',
      endsOn: 'ends_on',
      active: 'active',
      image: 'image',
      imageType: 'image_type',
    };
    const sets = Object.entries(fields).filter(([key, value]) => value !== undefined && columns[key]);
    if (sets.length) {
      await this.db.batch([
        {
          sql: `UPDATE partner_ads SET ${sets.map(([key]) => `${columns[key]} = ?`).join(', ')} WHERE id = ?`,
          params: [...sets.map(([, value]) => (typeof value === 'boolean' ? (value ? 1 : 0) : value)), id],
        },
      ]);
    }
    return this.partnerAd(id);
  }

  /** The ad's past views and clicks stay in the report. */
  async deletePartnerAd(id: string): Promise<void> {
    await this.db.batch([
      { sql: `UPDATE ad_placements SET source = 'google', partner_ad_id = NULL WHERE partner_ad_id = ?`, params: [id] },
      { sql: 'DELETE FROM partner_ads WHERE id = ?', params: [id] },
    ]);
  }

  // --- Redeem codes -----------------------------------------------------------

  async redeemCodes(limit = 200) {
    return this.db.all<{ code: string; days: number | null; maxUses: number; uses: number; expiresAt: string | null; note: string | null; createdAt: string }>(
      `SELECT c.code, c.days, c.max_uses AS maxUses, c.expires_at AS expiresAt, c.note, c.created_at AS createdAt,
              (SELECT COUNT(*) FROM code_redemptions r WHERE r.code = c.code) AS uses
       FROM redeem_codes c ORDER BY c.created_at DESC, c.code LIMIT ?`,
      [limit],
    );
  }

  /** Stops a code from being redeemed (Premium already given stays). */
  async expireCode(code: string, now = new Date()): Promise<void> {
    await this.db.batch([{ sql: 'UPDATE redeem_codes SET expires_at = ? WHERE code = ?', params: [now.toISOString(), code] }]);
  }

  // --- Report -------------------------------------------------------------------

  /** Everything the admin panel's overview shows, for the Brasília days [from, to]. */
  async report(from: string, to: string, now = new Date()) {
    const range = [from, to];
    const views = 'FROM page_views WHERE day BETWEEN ? AND ?';
    const top = <T>(select: string, group: string, limit: number, where = '') =>
      this.db.all<T>(`SELECT ${select}, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors ${views} ${where} GROUP BY ${group} ORDER BY visitors DESC, views DESC LIMIT ${limit}`, range);
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    const nowIso = now.toISOString();

    const [totals, previous, daily, pages, content, countries, regions, cities, referrers, campaigns, devices] = await Promise.all([
      this.db.first<{ views: number; visitors: number; signedIn: number }>(
        `SELECT COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors, COALESCE(SUM(signed_in), 0) AS signedIn ${views}`,
        range,
      ),
      this.db.first<{ views: number; visitors: number }>(
        `SELECT COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors ${views}`,
        [addDays(from, -days), addDays(from, -1)],
      ),
      this.db.all<{ day: string; views: number; visitors: number }>(
        `SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors ${views} GROUP BY day ORDER BY day`,
        range,
      ),
      top<{ path: string }>('path', 'path', 15),
      top<{ content: string }>('content', 'content', 15, 'AND content IS NOT NULL'),
      top<{ country: string | null }>('country', 'country', 15),
      top<{ country: string | null; region: string | null }>('country, region', 'country, region', 15, 'AND region IS NOT NULL'),
      top<{ country: string | null; region: string | null; city: string | null }>('country, region, city', 'country, region, city', 15, 'AND city IS NOT NULL'),
      top<{ referrer: string | null }>("COALESCE(referrer, '') AS referrer", "COALESCE(referrer, '')", 15),
      top<{ source: string; campaign: string | null }>('utm_source AS source, utm_campaign AS campaign', 'utm_source, utm_campaign', 15, 'AND utm_source IS NOT NULL'),
      top<{ device: string }>('device', 'device', 5),
    ]);

    const [ads, partnerAds, practice, exams, users] = await Promise.all([
      this.db.all<{ placement: string; source: string; views: number; clicks: number }>(
        `SELECT placement, source, SUM(kind = 'view') AS views, SUM(kind = 'click') AS clicks
         FROM ad_events WHERE day BETWEEN ? AND ? GROUP BY placement, source ORDER BY views DESC`,
        range,
      ),
      this.db.all<{ partnerAdId: string; views: number; clicks: number }>(
        `SELECT partner_ad_id AS partnerAdId, SUM(kind = 'view') AS views, SUM(kind = 'click') AS clicks
         FROM ad_events WHERE day BETWEEN ? AND ? AND partner_ad_id IS NOT NULL GROUP BY partner_ad_id`,
        range,
      ),
      // Answers are timestamped in UTC: shift to Brasília days like the views.
      this.db.all<{ category: string; answers: number; students: number }>(
        `SELECT category, COUNT(*) AS answers, COUNT(DISTINCT user_id) AS students FROM answers
         WHERE date(answered_at, '-3 hours') BETWEEN ? AND ? GROUP BY category ORDER BY answers DESC`,
        range,
      ),
      this.db.all<{ examId: string; answers: number; students: number }>(
        `SELECT exam_id AS examId, COUNT(*) AS answers, COUNT(DISTINCT user_id) AS students FROM answers
         WHERE date(answered_at, '-3 hours') BETWEEN ? AND ? GROUP BY exam_id ORDER BY answers DESC LIMIT 15`,
        range,
      ),
      this.db.first<{ total: number; created: number; active: number; subscribers: number; codePremium: number }>(
        `SELECT COUNT(*) AS total,
                SUM(date(created_at, '-3 hours') BETWEEN ? AND ?) AS created,
                (SELECT COUNT(DISTINCT user_id) FROM answers WHERE date(answered_at, '-3 hours') BETWEEN ? AND ?) AS active,
                SUM(subscription_status IN ('active', 'trialing', 'past_due')) AS subscribers,
                SUM(plan = 'premium' AND (premium_until IS NULL OR premium_until > ?)) AS codePremium
         FROM users`,
        [from, to, from, to, nowIso],
      ),
    ]);

    return {
      from,
      to,
      totals: { views: totals?.views ?? 0, visitors: totals?.visitors ?? 0, signedInViews: totals?.signedIn ?? 0 },
      previous: { views: previous?.views ?? 0, visitors: previous?.visitors ?? 0 },
      daily,
      pages,
      content,
      countries,
      regions,
      cities,
      referrers,
      campaigns,
      devices,
      ads,
      partnerAds,
      practice,
      exams,
      users: {
        total: users?.total ?? 0,
        created: users?.created ?? 0,
        active: users?.active ?? 0,
        subscribers: users?.subscribers ?? 0,
        codePremium: users?.codePremium ?? 0,
      },
    };
  }
}
