import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

// Mirrors server/src/app.ts (/api/admin/*) and server/src/site/site-store.ts.

export interface Ranked {
  views: number;
  visitors: number;
}

export interface AdminReport {
  days: number;
  from: string;
  to: string;
  totals: { views: number; visitors: number; signedInViews: number };
  previous: { views: number; visitors: number };
  daily: { day: string; views: number; visitors: number }[];
  pages: (Ranked & { path: string })[];
  content: (Ranked & { content: string })[];
  countries: (Ranked & { country: string | null })[];
  regions: (Ranked & { country: string | null; region: string | null })[];
  cities: (Ranked & { country: string | null; region: string | null; city: string | null })[];
  /** '' = direct visits. */
  referrers: (Ranked & { referrer: string })[];
  campaigns: (Ranked & { source: string; campaign: string | null })[];
  devices: (Ranked & { device: 'mobile' | 'tablet' | 'desktop' })[];
  ads: { placement: string; source: 'google' | 'partner'; views: number; clicks: number }[];
  partnerAds: { partnerAdId: string; views: number; clicks: number }[];
  practice: { category: string; answers: number; students: number }[];
  exams: { examId: string; label: string; category: string | null; answers: number; students: number }[];
  users: { total: number; created: number; active: number; subscribers: number; codePremium: number };
}

export type AdSource = 'google' | 'partner' | 'off';

export interface PlacementSetting {
  placement: string;
  label: string;
  source: AdSource;
  partnerAdId: string | null;
}

export interface PartnerAd {
  id: string;
  advertiser: string;
  title: string;
  linkUrl: string;
  imageType: string;
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
  createdAt: string;
}

export interface PartnerAdInput {
  advertiser?: string;
  title?: string;
  linkUrl?: string;
  startsOn?: string | null;
  endsOn?: string | null;
  active?: boolean;
  /** data: URL */
  image?: string;
}

export interface RedeemCode {
  code: string;
  days: number | null;
  maxUses: number;
  uses: number;
  expiresAt: string | null;
  note: string | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);

  report(days: number): Observable<AdminReport> {
    return this.http.get<AdminReport>('api/admin/report', { params: { days } });
  }

  ads(): Observable<{ placements: PlacementSetting[]; partnerAds: PartnerAd[] }> {
    return this.http.get<{ placements: PlacementSetting[]; partnerAds: PartnerAd[] }>('api/admin/ads');
  }

  setPlacement(placement: string, source: AdSource, partnerAdId?: string | null): Observable<PlacementSetting[]> {
    return this.http.put<PlacementSetting[]>(`api/admin/placements/${placement}`, { source, partnerAdId });
  }

  createAd(ad: PartnerAdInput): Observable<PartnerAd> {
    return this.http.post<PartnerAd>('api/admin/ads', ad);
  }

  updateAd(id: string, fields: PartnerAdInput): Observable<PartnerAd> {
    return this.http.patch<PartnerAd>(`api/admin/ads/${id}`, fields);
  }

  deleteAd(id: string): Observable<void> {
    return this.http.delete<void>(`api/admin/ads/${id}`);
  }

  codes(): Observable<RedeemCode[]> {
    return this.http.get<RedeemCode[]>('api/admin/codes');
  }

  createCodes(options: { count: number; days: number; maxUses: number; expiresOn?: string | null; note?: string | null }): Observable<{ codes: string[] }> {
    return this.http.post<{ codes: string[] }>('api/admin/codes', options);
  }

  expireCode(code: string): Observable<{ ok: true }> {
    return this.http.post<{ ok: true }>(`api/admin/codes/${code}/expire`, {});
  }
}
