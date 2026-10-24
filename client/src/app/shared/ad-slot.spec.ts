import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdSettings } from '../core/ads';
import { AuthService } from '../core/auth.service';
import { AdSlot } from './ad-slot';

describe('AdSlot', () => {
  const premium = signal(false);
  const placements = signal<Record<string, unknown> | undefined>({});

  beforeEach(() => {
    premium.set(false);
    placements.set({});
    TestBed.configureTestingModule({
      imports: [AdSlot],
      providers: [
        { provide: AuthService, useValue: { isPremium: premium } },
        { provide: AdSettings, useValue: { placements } },
      ],
    });
  });

  function render(placement: string) {
    const fixture = TestBed.createComponent(AdSlot);
    fixture.componentRef.setInput('placement', placement);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows a placeholder, and loads no ad script, while the placement has no AdSense slot', () => {
    const el = render('settings-inline');
    expect(el.hidden).toBe(false);
    expect(el.textContent).toContain('Anúncio');
    expect(el.querySelector('ins.adsbygoogle')).toBeNull();
    expect(document.getElementById('adsbygoogle-js')).toBeNull();
  });

  it('shows the partner ad chosen in the admin panel, as a sponsored link', () => {
    placements.set({
      'dashboard-top': { source: 'partner', ad: { id: 'a1', advertiser: 'Uni X', title: 'Vestibular', imageUrl: 'api/ads/image/a1', href: 'api/ads/click/a1?p=dashboard-top' } },
    });
    const link = render('dashboard-top').querySelector('a.ad__partner')!;
    expect(link.getAttribute('href')).toBe('api/ads/click/a1?p=dashboard-top');
    expect(link.getAttribute('rel')).toContain('sponsored');
    expect(link.querySelector('img')!.getAttribute('alt')).toBe('Uni X: Vestibular');
  });

  it('is hidden when the admin panel turned the space off', () => {
    placements.set({ 'stats-top': { source: 'off' } });
    expect(render('stats-top').hidden).toBe(true);
  });

  it('is hidden for Premium users', () => {
    premium.set(true);
    expect(render('dashboard-top').hidden).toBe(true);
  });
});
