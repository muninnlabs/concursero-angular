import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../core/auth.service';
import { AdSlot } from './ad-slot';

describe('AdSlot', () => {
  const premium = signal(false);

  beforeEach(() => {
    premium.set(false);
    TestBed.configureTestingModule({
      imports: [AdSlot],
      providers: [{ provide: AuthService, useValue: { isPremium: premium } }],
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

  it('is hidden for Premium users', () => {
    premium.set(true);
    expect(render('dashboard-top').hidden).toBe(true);
  });
});
