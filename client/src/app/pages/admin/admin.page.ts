import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { AdminAds } from './admin-ads';
import { AdminApi } from './admin-api';
import { AdminCodes } from './admin-codes';
import { AdminOverview } from './admin-overview';

const TABS = [
  { id: 'geral', label: 'Visão geral' },
  { id: 'anuncios', label: 'Anúncios' },
  { id: 'codigos', label: 'Códigos' },
] as const;

/** Admin panel (/app/admin), for the accounts in server/src/app.ts ADMIN_EMAILS. */
@Component({
  selector: 'app-admin-page',
  imports: [AdminOverview, AdminAds, AdminCodes],
  template: `
    <div class="tabs" role="tablist" aria-label="Painel">
      @for (t of tabs; track t.id) {
        <button type="button" role="tab" [attr.aria-selected]="tab() === t.id" [class.active]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button>
      }
    </div>
    @switch (tab()) {
      @case ('geral') {
        <app-admin-overview [placements]="placements()" />
      }
      @case ('anuncios') {
        <app-admin-ads [placements]="placements()" [partnerAds]="partnerAds()" (changed)="ads.reload()" />
      }
      @case ('codigos') {
        <app-admin-codes />
      }
    }
  `,
  styleUrl: './admin.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPage {
  private readonly api = inject(AdminApi);
  protected readonly tabs = TABS;
  protected readonly tab = signal<(typeof TABS)[number]['id']>('geral');
  protected readonly ads = rxResource({ stream: () => this.api.ads() });
  protected readonly placements = computed(() => this.ads.value()?.placements ?? []);
  protected readonly partnerAds = computed(() => this.ads.value()?.partnerAds ?? []);
}
