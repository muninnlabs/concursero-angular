import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, DOCUMENT, effect, ElementRef, inject, input } from '@angular/core';
import { ADS, AdSettings, type AdPlacement } from '../core/ads';
import { AuthService } from '../core/auth.service';

const SIZES = {
  leaderboard: '728 × 90',
  rectangle: '300 × 250',
  card: '300 × 100',
  inline: '320 × 50',
} as const;

/**
 * An ad space (see core/ads.ts). The admin panel picks what it shows: Google
 * AdSense (default), a partner's ad, or nothing. Hidden for Premium users.
 * Each time it first comes into view it's counted (api/ads/view): the
 * numbers shown to advertisers.
 */
@Component({
  selector: 'app-ad-slot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'complementary',
    'aria-label': 'Publicidade',
    '[class.ad--leaderboard]': "format() === 'leaderboard'",
    '[class.ad--rectangle]': "format() === 'rectangle'",
    '[class.ad--card]': "format() === 'card'",
    '[class.ad--inline]': "format() === 'inline'",
    '[class.ad--live]': 'live() || !!partner()',
    '[hidden]': '!visible()',
  },
  template: `
    <span class="ad__label">Publicidade</span>
    @if (partner(); as ad) {
      <a class="ad__partner" [href]="ad.href" target="_blank" rel="sponsored noopener" [title]="ad.advertiser + ' · ' + ad.title">
        <img [src]="ad.imageUrl" [alt]="ad.advertiser + ': ' + ad.title" />
      </a>
    } @else if (live()) {
      <ins
        class="adsbygoogle"
        style="display: block; width: 100%"
        [attr.data-ad-client]="client"
        [attr.data-ad-slot]="slot()"
        data-ad-format="auto"
        data-full-width-responsive="true"
      ></ins>
    } @else {
      @switch (format()) {
        @case ('rectangle') {
          <span class="ad__badge" aria-hidden="true">Ad</span>
          <strong>Espaço para anúncio</strong>
          <small>{{ size() }}</small>
        }
        @case ('card') {
          <span class="ad__badge ad__badge--sm" aria-hidden="true">Ad</span>
          <strong>Espaço publicitário</strong>
        }
        @case ('inline') {
          <span class="ad__badge ad__badge--xs" aria-hidden="true">Ad</span>
          <strong>Anúncio</strong>
        }
        @default {
          <strong>{{ text() ?? 'Espaço para anúncio' }}</strong>
          <small>{{ size() }}</small>
        }
      }
    }
  `,
  styles: `
    :host {
      position: relative;
      display: grid;
      place-content: center;
      justify-items: center;
      gap: 6px;
      border: 1px dashed var(--border-strong);
      border-radius: 22px;
      color: var(--text-subtle);
      background: color-mix(in srgb, var(--track) 60%, transparent);
      text-align: center;
    }
    :host([hidden]) {
      display: none;
    }
    :host(.ad--live) {
      display: block;
      padding-top: 22px;
      border: 0;
      background: none;
    }
    .ad__partner {
      display: block;
      overflow: hidden;
      border-radius: 14px;
    }
    .ad__partner img {
      display: block;
      width: 100%;
      height: auto;
      max-height: 280px;
      object-fit: contain;
    }
    :host(.ad--leaderboard) {
      min-height: 90px;
    }
    :host(.ad--rectangle) {
      min-height: 250px;
    }
    :host(.ad--card) {
      min-height: 130px;
      border-style: solid;
      border-color: var(--border);
      background: var(--surface);
    }
    :host(.ad--inline) {
      grid-auto-flow: column;
      justify-content: start;
      align-items: center;
      gap: 12px;
      min-height: 56px;
      padding: 0 16px;
      border-radius: 14px;
      border-style: solid;
      border-color: var(--border);
    }
    :host(.ad--inline) .ad__label {
      top: 6px;
      right: 10px;
    }
    .ad__label {
      position: absolute;
      top: 10px;
      right: 16px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .ad__badge {
      display: grid;
      place-items: center;
      width: 52px;
      height: 52px;
      margin-bottom: 10px;
      border-radius: 50%;
      background: var(--border);
      font-size: 12px;
      font-weight: 800;
    }
    .ad__badge--sm {
      width: 40px;
      height: 40px;
      margin-bottom: 4px;
      font-size: 11px;
    }
    .ad__badge--xs {
      width: 28px;
      height: 28px;
      margin: 0;
      border-radius: 8px;
      font-size: 10px;
    }
    strong {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    small {
      font-size: 12px;
    }
  `,
})
export class AdSlot {
  private readonly auth = inject(AuthService);
  private readonly settings = inject(AdSettings);

  readonly placement = input.required<AdPlacement>();
  /** Placeholder wording, e.g. the landing page's "Anuncie aqui…". */
  readonly text = input<string | null>(null);

  protected readonly format = computed(() => ADS.placements[this.placement()].format);
  protected readonly size = computed(() => SIZES[this.format()]);
  /** The admin panel's choice; undefined while it loads. */
  private readonly setting = computed(() => this.settings.placements()?.[this.placement()]);
  protected readonly partner = computed(() => {
    const setting = this.setting();
    return setting?.source === 'partner' ? setting.ad : null;
  });
  protected readonly visible = computed(() => ADS.enabled && !this.auth.isPremium() && this.setting()?.source !== 'off');
  protected readonly client = ADS.client;
  protected readonly slot = computed(() => ADS.placements[this.placement()].slot);
  /** A real AdSense unit (publisher and slot configured, Google chosen), not the placeholder. */
  protected readonly live = computed(() => !!ADS.client && !!this.slot() && this.setting()?.source === 'google');

  constructor() {
    const doc = inject(DOCUMENT);
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    let pushed = false;
    // Once the setting is known, Google renders its unit; partner ads are plain links.
    effect(() => {
      if (pushed || !this.live() || !this.visible()) return;
      pushed = true;
      loadAdSense(doc, ADS.client!);
      queueMicrotask(() => {
        const w = doc.defaultView as (Window & { adsbygoogle?: unknown[] }) | null;
        if (w) (w.adsbygoogle ??= []).push({});
      });
    });

    // Counted once, when at least half of it is on screen with its setting known.
    let observer: IntersectionObserver | undefined;
    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined') return;
      observer = new IntersectionObserver(
        ([entry]) => {
          const setting = this.setting();
          if (!entry?.isIntersecting || !setting || !this.visible()) return;
          observer?.disconnect();
          const view = { placement: this.placement(), source: setting.source, partnerAdId: this.partner()?.id };
          navigator.sendBeacon?.('api/ads/view', JSON.stringify(view));
        },
        { threshold: 0.5 },
      );
      observer.observe(host);
    });
    inject(DestroyRef).onDestroy(() => observer?.disconnect());
  }
}

/** Adds adsbygoogle.js once per page load. */
function loadAdSense(doc: Document, client: string): void {
  if (doc.getElementById('adsbygoogle-js')) return;
  const script = doc.createElement('script');
  script.id = 'adsbygoogle-js';
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
  doc.head.appendChild(script);
}
