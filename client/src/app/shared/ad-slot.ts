import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ADS, type AdPlacement } from '../core/ads';
import { AuthService } from '../core/auth.service';

const SIZES = {
  leaderboard: '728 × 90',
  rectangle: '300 × 250',
} as const;

/** An ad space (see core/ads.ts). Hidden for Premium users. */
@Component({
  selector: 'app-ad-slot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'complementary',
    'aria-label': 'Publicidade',
    '[class.ad--leaderboard]': "format() === 'leaderboard'",
    '[class.ad--rectangle]': "format() === 'rectangle'",
    '[hidden]': '!visible()',
  },
  template: `
    <span class="ad__label">Publicidade</span>
    @if (format() === 'rectangle') {
      <span class="ad__badge" aria-hidden="true">Ad</span>
      <strong>Espaço para anúncio</strong>
      <small>{{ size() }}</small>
    } @else {
      <strong>Espaço para anúncio · {{ size() }}</strong>
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
    :host(.ad--leaderboard) {
      min-height: 90px;
    }
    :host(.ad--rectangle) {
      min-height: 250px;
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

  readonly placement = input.required<AdPlacement>();

  protected readonly format = computed(() => ADS.placements[this.placement()].format);
  protected readonly size = computed(() => SIZES[this.format()]);
  protected readonly visible = computed(() => ADS.enabled && !this.auth.isPremium());
}
