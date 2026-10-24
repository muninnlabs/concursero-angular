// What a request says about the visitor, for the cookieless page-view and ad counts.

/** Crawlers and link previews (WhatsApp, Telegram, Facebook…) aren't visitors. */
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|whatsapp|telegram|curl|wget|python|node-fetch|axios/i;

export function isBot(userAgent: string): boolean {
  return !userAgent || BOT.test(userAgent);
}

export function deviceOf(userAgent: string): 'mobile' | 'tablet' | 'desktop' {
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(userAgent)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

/** Cloudflare's location estimate from the IP (request.cf); nulls when running on Node. */
export function geoOf(request: Request): { country: string | null; region: string | null; city: string | null } {
  const cf = (request as Request & { cf?: { country?: string; region?: string; city?: string } }).cf;
  return { country: cf?.country ?? null, region: cf?.region ?? null, city: cf?.city ?? null };
}

/** Host of an external referrer ("www.google.com" → "google.com"); null for direct visits and our own pages. */
export function referrerHost(referrer: unknown, ownHost: string): string | null {
  if (typeof referrer !== 'string' || !referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase();
    return host && host !== ownHost.replace(/^www\./, '') ? host.slice(0, 100) : null;
  } catch {
    return null;
  }
}

/** Trims client-sent text: null when missing or empty. */
export function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}
