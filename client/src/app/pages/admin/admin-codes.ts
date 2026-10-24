import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Icon } from '../../shared/icon';
import { AdminApi, type RedeemCode } from './admin-api';

/** "Códigos": create Premium redeem codes and see how they're used. */
@Component({
  selector: 'app-admin-codes',
  imports: [Icon],
  templateUrl: './admin-codes.html',
  styleUrl: './admin.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCodes {
  private readonly api = inject(AdminApi);
  protected readonly codes = rxResource({ stream: () => this.api.codes() });
  protected readonly created = signal<string[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly copied = signal(false);

  protected create(event: Event) {
    event.preventDefault();
    const data = new FormData(event.target as HTMLFormElement);
    this.saving.set(true);
    this.error.set(null);
    this.api
      .createCodes({
        count: Number(data.get('count')),
        days: Number(data.get('days')),
        maxUses: Number(data.get('maxUses')),
        expiresOn: String(data.get('expiresOn') ?? '') || null,
        note: String(data.get('note') ?? '').trim() || null,
      })
      .subscribe({
        next: ({ codes }) => {
          this.saving.set(false);
          this.created.set(codes);
          this.codes.reload();
        },
        error: (e: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(e.error?.error ?? 'Não foi possível criar os códigos.');
        },
      });
  }

  protected async copy() {
    await navigator.clipboard.writeText(this.created().join('\n'));
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2500);
  }

  protected expire(code: RedeemCode) {
    if (!confirm(`Encerrar o código ${code.code}? Quem já usou continua Premium até o fim do prazo.`)) return;
    this.api.expireCode(code.code).subscribe(() => this.codes.reload());
  }

  protected state(code: RedeemCode): { label: string; tone: string } {
    if (code.expiresAt && code.expiresAt <= new Date().toISOString()) return { label: 'Encerrado', tone: 'muted' };
    if (code.uses >= code.maxUses) return { label: 'Esgotado', tone: 'muted' };
    return { label: 'Disponível', tone: 'ok' };
  }

  protected date(iso: string | null) {
    return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
  }
}
