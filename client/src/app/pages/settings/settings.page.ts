import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { PreferencesService, type Preferences } from '../../core/preferences';
import { Icon, type IconName } from '../../shared/icon';

interface SecurityLink {
  icon: IconName;
  label: string;
  detail: string;
  href: string;
}

/** Sign-in is Google-only, so password, 2-step verification and devices are managed in the Google account. */
const SECURITY_LINKS: SecurityLink[] = [
  { icon: 'key', label: 'Senha e acesso', detail: 'Conta Google', href: 'https://myaccount.google.com/security' },
  {
    icon: 'shield-check',
    label: 'Verificação em Duas Etapas',
    detail: 'Conta Google',
    href: 'https://myaccount.google.com/signinoptions/two-step-verification',
  },
  { icon: 'smartphone', label: 'Dispositivos Conectados', detail: 'Conta Google', href: 'https://myaccount.google.com/device-activity' },
];

@Component({
  selector: 'app-settings-page',
  imports: [Icon],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  protected readonly preferences = inject(PreferencesService);
  protected readonly securityLinks = SECURITY_LINKS;

  private readonly deleteDialog = viewChild.required<ElementRef<HTMLDialogElement>>('deleteDialog');
  protected readonly deleting = signal(false);
  protected readonly deleteError = signal<string | null>(null);

  protected readonly initials = computed(() =>
    (this.auth.user()?.name ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join(''),
  );

  /** "Janeiro de 2024" */
  protected readonly memberSince = computed(() => {
    const createdAt = this.auth.user()?.createdAt;
    if (!createdAt) return '—';
    const text = new Date(createdAt).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return text.charAt(0).toUpperCase() + text.slice(1);
  });

  protected toggle(key: keyof Preferences) {
    const next = !this.preferences.value()[key];
    this.preferences.set(key, next);
    if (key === 'sounds' && next) this.preferences.playResult(true);
  }

  protected openDelete() {
    this.deleteError.set(null);
    this.deleteDialog().nativeElement.showModal();
  }

  protected closeDelete() {
    if (!this.deleting()) this.deleteDialog().nativeElement.close();
  }

  protected confirmDelete() {
    this.deleting.set(true);
    this.deleteError.set(null);
    this.api.deleteAccount().subscribe({
      next: () => {
        this.deleteDialog().nativeElement.close();
        this.auth.logout();
      },
      error: () => {
        this.deleting.set(false);
        this.deleteError.set('Não foi possível excluir sua conta agora. Tente novamente.');
      },
    });
  }
}
