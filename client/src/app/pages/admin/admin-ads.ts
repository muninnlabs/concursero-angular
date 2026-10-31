import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Icon } from '../../shared/icon';
import { AdminApi, type AdSource, type PartnerAd, type PlacementSetting } from './admin-api';

const MAX_IMAGE_BYTES = 500_000;

/** "Anúncios": what each ad space shows, and the partner ads sold directly. */
@Component({
  selector: 'app-admin-ads',
  imports: [Icon],
  templateUrl: './admin-ads.html',
  styleUrl: './admin.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAds {
  private readonly api = inject(AdminApi);
  readonly placements = input<PlacementSetting[]>([]);
  readonly partnerAds = input<PartnerAd[]>([]);
  /** Ask the page to reload placements and ads. */
  readonly changed = output<void>();

  /** Views and clicks of each partner ad in the last 30 days. */
  private readonly stats = rxResource({ stream: () => this.api.report(30) });
  protected readonly adStats = computed(() => new Map((this.stats.value()?.partnerAds ?? []).map((s) => [s.partnerAdId, s])));

  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly image = signal<string | null>(null);
  protected readonly formOpen = signal(false);
  /** The ad being edited in the form; null = creating a new one. */
  protected readonly editing = signal<PartnerAd | null>(null);
  /** Bumped after a save so replaced images aren't served from the browser cache. */
  private readonly imageVersion = signal(Date.now());

  protected readonly today = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

  protected status(ad: PartnerAd): { label: string; tone: string } {
    if (!ad.active) return { label: 'Pausado', tone: 'muted' };
    if (ad.startsOn && ad.startsOn > this.today) return { label: `Começa ${this.date(ad.startsOn)}`, tone: 'warn' };
    if (ad.endsOn && ad.endsOn < this.today) return { label: 'Encerrado', tone: 'muted' };
    return { label: 'No ar', tone: 'ok' };
  }

  protected period(ad: PartnerAd) {
    if (!ad.startsOn && !ad.endsOn) return 'Sem datas definidas';
    if (!ad.endsOn) return `A partir de ${this.date(ad.startsOn)}`;
    if (!ad.startsOn) return `Até ${this.date(ad.endsOn)}`;
    return `${this.date(ad.startsOn)} a ${this.date(ad.endsOn)}`;
  }

  protected date(day: string | null) {
    return day ? day.split('-').reverse().join('/') : '—';
  }

  protected setSource(placement: PlacementSetting, source: AdSource, partnerAdId?: string | null) {
    if (source === 'partner' && !partnerAdId) partnerAdId = placement.partnerAdId ?? this.partnerAds()[0]?.id;
    if (source === 'partner' && !partnerAdId) {
      this.error.set('Cadastre um anúncio de parceiro primeiro.');
      return;
    }
    this.run(this.api.setPlacement(placement.placement, source, partnerAdId));
  }

  protected toggle(ad: PartnerAd) {
    this.run(this.api.updateAd(ad.id, { active: !ad.active }));
  }

  protected remove(ad: PartnerAd) {
    if (confirm(`Excluir o anúncio “${ad.title}” de ${ad.advertiser}? Os espaços dele voltam para o Google.`)) this.run(this.api.deleteAd(ad.id));
  }

  protected pickImage(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    this.image.set(null);
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      this.error.set('A imagem deve ter até 500 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => this.image.set(String(reader.result));
    reader.readAsDataURL(file);
  }

  protected imageUrl(ad: PartnerAd) {
    return `api/ads/image/${ad.id}?v=${this.imageVersion()}`;
  }

  protected openForm(ad: PartnerAd | null) {
    // Close first so the form's inputs are re-created with the new values.
    this.formOpen.set(false);
    this.editing.set(ad);
    this.image.set(null);
    this.error.set(null);
    queueMicrotask(() => this.formOpen.set(true));
  }

  protected closeForm() {
    this.formOpen.set(false);
    this.editing.set(null);
    this.image.set(null);
  }

  protected save(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? '').trim() || null;
    const fields = {
      advertiser: value('advertiser') ?? '',
      title: value('title') ?? '',
      linkUrl: value('linkUrl') ?? '',
      startsOn: value('startsOn'),
      endsOn: value('endsOn'),
    };
    if (fields.startsOn && fields.endsOn && fields.endsOn < fields.startsOn) {
      this.error.set('A data de fim deve ser depois do início.');
      return;
    }
    const done = () => {
      this.imageVersion.set(Date.now());
      this.closeForm();
    };
    const editing = this.editing();
    if (editing) {
      this.run(this.api.updateAd(editing.id, { ...fields, ...(this.image() ? { image: this.image()! } : {}) }), done);
      return;
    }
    if (!this.image()) {
      this.error.set('Escolha a imagem do anúncio.');
      return;
    }
    this.run(this.api.createAd({ ...fields, image: this.image()! }), done);
  }

  private run(request: { subscribe: (o: { next: () => void; error: (e: HttpErrorResponse) => void }) => unknown }, done?: () => void) {
    this.saving.set(true);
    this.error.set(null);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        done?.();
        this.changed.emit();
      },
      error: (e: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(e.error?.error ?? 'Não foi possível salvar. Tente novamente.');
      },
    });
  }
}
