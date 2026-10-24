import { DOCUMENT, Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from './auth.service';
import { CATEGORIES, CategoryState } from './categories';

/**
 * Cookieless page views for the admin panel (POST api/track): the page, what was
 * practised, where the visit came from. The server adds location and device and
 * counts visitors without storing addresses (server/src/site/site-store.ts).
 * Admins' own browsing isn't counted.
 */
@Injectable({ providedIn: 'root' })
export class Analytics {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly categories = inject(CategoryState);
  private readonly document = inject(DOCUMENT);
  private first = true;

  start() {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => this.track(e.urlAfterRedirects));
  }

  private track(url: string) {
    const tree = this.router.parseUrl(url);
    const path = url.split(/[?#]/)[0];
    if (this.auth.isAdmin() || path.startsWith('/app/admin')) return;
    const query = tree.queryParams as Record<string, string | undefined>;
    const body: Record<string, unknown> = { path, content: this.content(path, query), signedIn: this.auth.signedIn() };
    // Where the visit came from: only on its first page.
    if (this.first) {
      this.first = false;
      body['referrer'] = this.document.referrer || undefined;
      body['utmSource'] = query['utm_source'];
      body['utmCampaign'] = query['utm_campaign'];
    }
    const json = JSON.stringify(body);
    // sendBeacon survives leaving the page; plain text keeps it a simple (no preflight) request.
    if (!navigator.sendBeacon?.('api/track', json)) {
      fetch('api/track', { method: 'POST', body: json, keepalive: true }).catch(() => undefined);
    }
  }

  /** "OAB · Direito Penal" on Praticar; the chosen exam type on the pages that follow it. */
  private content(path: string, query: Record<string, string | undefined>): string | null {
    const label = (id: string | undefined) => CATEGORIES.find((c) => c.id === id)?.label ?? id;
    if (path === '/app/praticar') return [label(query['categoria']), query['materia']].filter(Boolean).join(' · ') || null;
    if (['/app', '/app/assuntos', '/app/estatisticas'].includes(path)) return label(this.categories.selected()) ?? null;
    return null;
  }
}
