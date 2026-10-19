import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import type { Insights } from '../../core/models';
import { AdvancedStats } from './advanced-stats';

const INSIGHTS: Insights = {
  days: 90,
  totals: { answered: 10, correct: 4, avgSeconds: 32 },
  timing: { correct: 20, wrong: 40 },
  bySubject: [{ subject: 'Direito Civil', answered: 5, correct: 0, avgSeconds: 40 }],
  weakest: [{ subject: 'Direito Civil', answered: 5, correct: 0, avgSeconds: 40 }],
  byYear: [{ year: 2025, answered: 10, correct: 4 }],
  byInstitution: [{ institution: 'OAB', answered: 10, correct: 4 }],
  byDayPart: [
    { part: 'madrugada', answered: 0, correct: 0 },
    { part: 'manha', answered: 10, correct: 4 },
    { part: 'tarde', answered: 0, correct: 0 },
    { part: 'noite', answered: 0, correct: 0 },
  ],
  weekly: Array.from({ length: 12 }, (_, i) => ({ start: `2026-08-${String(i + 1).padStart(2, '0')}`, answered: 0, correct: 0 })),
};

describe('AdvancedStats', () => {
  const premium = signal(false);

  beforeEach(() => {
    premium.set(false);
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    TestBed.configureTestingModule({
      imports: [AdvancedStats],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: AuthService, useValue: { isPremium: premium } }],
    });
  });

  it('shows free users sample numbers behind the Premium lock, without calling the API', () => {
    const fixture = TestBed.createComponent(AdvancedStats);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.lock')?.textContent).toContain('Assinar Premium');
    expect(el.querySelector('.grid')?.getAttribute('inert')).not.toBeNull();
    TestBed.inject(HttpTestingController).expectNone((req) => req.url.includes('insights'));
  });

  it('loads and shows Premium users their own insights', async () => {
    premium.set(true);
    const fixture = TestBed.createComponent(AdvancedStats);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    const req = http.expectOne((r) => r.url === 'api/me/insights');
    expect(req.request.params.get('days')).toBe('90');
    req.flush(INSIGHTS);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.lock')).toBeNull();
    expect(el.querySelector('.weak')?.textContent).toContain('Direito Civil');
    expect(el.querySelector('.timing')?.textContent).toContain('40s');
    expect(el.textContent).toContain('2× mais tempo');
  });
});
