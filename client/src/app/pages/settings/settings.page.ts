import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { PreferencesService, type Preferences } from '../../core/preferences';
import { PREMIUM } from '../../core/premium';
import { AdSlot } from '../../shared/ad-slot';
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
  imports: [AdSlot, Icon],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  protected readonly preferences = inject(PreferencesService);
  protected readonly securityLinks = SECURITY_LINKS;
  protected readonly premium = PREMIUM;
  private readonly router = inject(Router);

  /** ?assinatura= when Stripe sends the user back: sucesso, cancelada or gerenciada (from the portal). */
  readonly assinatura = input<string>();
  protected readonly billingBusy = signal(false);
  protected readonly billingMessage = signal<{ ok: boolean; text: string } | null>(null);
  /** A subscription that still gives Premium. */
  protected readonly liveSubscription = computed(() => {
    const sub = this.auth.user()?.subscription;
    return sub && ['active', 'trialing', 'past_due'].includes(sub.status) ? sub : null;
  });

  /** Premium from a redeem code or a staff account: nothing to buy while it lasts. */
  protected readonly premiumWithoutPayment = computed(() => {
    const source = this.auth.user()?.premiumSource;
    return !this.liveSubscription() && (source === 'code' || source === 'staff') ? source : null;
  });

  private readonly deleteDialog = viewChild.required<ElementRef<HTMLDialogElement>>('deleteDialog');
  private readonly codeInput = viewChild.required<ElementRef<HTMLInputElement>>('codeInput');
  protected readonly redeeming = signal(false);
  protected readonly redeemMessage = signal<{ ok: boolean; text: string } | null>(null);
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

  constructor() {
    effect(() => {
      const back = this.assinatura();
      if (!back) return;
      untracked(() => this.returnedFromStripe(back));
    });
  }

  private returnedFromStripe(back: string) {
    // Drop ?assinatura= so a reload doesn't repeat the message.
    this.router.navigate([], { queryParams: { assinatura: null }, queryParamsHandling: 'merge', replaceUrl: true, preserveFragment: true });
    if (back === 'cancelada') {
      this.billingMessage.set({ ok: false, text: 'Pagamento não concluído. Nada foi cobrado.' });
      return;
    }
    this.billingBusy.set(true);
    // The webhook may not have arrived yet: ask Stripe directly.
    this.api.syncBilling().subscribe({
      next: (user) => {
        this.auth.user.set(user);
        this.billingBusy.set(false);
        if (back === 'sucesso') {
          this.billingMessage.set(
            user.plan === 'premium'
              ? { ok: true, text: 'Assinatura confirmada. Bem-vindo ao Premium!' }
              : { ok: false, text: 'Seu pagamento ainda está sendo processado. Atualize a página em alguns minutos.' },
          );
        }
      },
      error: () => this.billingBusy.set(false),
    });
  }

  protected subscribe() {
    this.redirectTo(this.api.startCheckout(), 'Não foi possível abrir o pagamento agora. Tente novamente.');
  }

  protected openPortal() {
    this.redirectTo(this.api.billingPortal(), 'Não foi possível abrir sua assinatura agora. Tente novamente.');
  }

  private redirectTo(request: ReturnType<ApiService['startCheckout']>, fallback: string) {
    this.billingBusy.set(true);
    this.billingMessage.set(null);
    request.subscribe({
      next: ({ url }) => window.location.assign(url),
      error: (error: HttpErrorResponse) => {
        this.billingBusy.set(false);
        this.billingMessage.set({ ok: false, text: error.error?.error ?? fallback });
      },
    });
  }

  /** "25 de novembro de 2026" */
  protected day(iso: string) {
    return new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  /** "25 de novembro de 2026" when Premium has an end date. */
  protected readonly premiumUntil = computed(() => {
    const user = this.auth.user();
    const until = user?.premiumSource === 'staff' ? null : user?.premiumUntil;
    return until ? new Date(until).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  });

  protected redeem(event: Event) {
    event.preventDefault();
    const input = this.codeInput().nativeElement;
    if (!input.value.trim()) return;
    this.redeeming.set(true);
    this.redeemMessage.set(null);
    this.api.redeemCode(input.value).subscribe({
      next: (user) => {
        this.auth.user.set(user);
        this.redeeming.set(false);
        input.value = '';
        const until = this.premiumUntil();
        this.redeemMessage.set({ ok: true, text: until ? `Premium ativado até ${until}.` : 'Premium ativado.' });
      },
      error: (error: HttpErrorResponse) => {
        this.redeeming.set(false);
        this.redeemMessage.set({ ok: false, text: error.error?.error ?? 'Não foi possível validar o código agora. Tente novamente.' });
      },
    });
  }

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
