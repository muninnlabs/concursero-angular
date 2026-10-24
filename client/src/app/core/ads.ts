import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';

/**
 * Ad placements (Google AdSense, publisher ca-pub-4635716355371884). A
 * placement without a `slot` ID renders a placeholder box of the right size;
 * once the site is approved, create one ad unit per placement in AdSense and
 * paste its slot ID here — AdSlot then loads adsbygoogle.js and renders the
 * real unit.
 */
export const ADS = {
  /** Premium users never see ads. */
  enabled: true,
  client: 'ca-pub-4635716355371884' as string | null,
  placements: {
    'dashboard-top': { format: 'leaderboard', slot: null as string | null },
    'stats-top': { format: 'leaderboard', slot: null as string | null },
    'stats-inline': { format: 'leaderboard', slot: null as string | null },
    'subjects-grid': { format: 'rectangle', slot: null as string | null },
    'profile-side': { format: 'card', slot: null as string | null },
    'settings-inline': { format: 'inline', slot: null as string | null },
    'landing-top': { format: 'leaderboard', slot: null as string | null },
  },
} as const;

export type AdPlacement = keyof typeof ADS.placements;

/** What a placement shows, set in the admin panel (GET api/ads). */
export type PlacementSetting =
  | { source: 'google' | 'off' }
  | { source: 'partner'; ad: { id: string; advertiser: string; title: string; imageUrl: string; href: string } };

/** The admin panel's choice per placement, loaded once per visit. Undefined while loading; Google for all if it fails. */
@Injectable({ providedIn: 'root' })
export class AdSettings {
  readonly placements = toSignal(
    inject(HttpClient)
      .get<Record<string, PlacementSetting>>('api/ads')
      .pipe(catchError(() => of({} as Record<string, PlacementSetting>))),
  );
}
