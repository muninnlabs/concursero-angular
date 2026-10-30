import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { PREMIUM, PREMIUM_LINK } from '../../core/premium';
import { AdSlot } from '../../shared/ad-slot';
import { Icon, type IconName } from '../../shared/icon';
import { Logo } from '../../shared/logo';
import { SiteFooter } from '../../shared/site-footer';

interface Feature {
  icon: IconName;
  title: string;
  text: string;
}

interface PricingPlan {
  name: string;
  price: number;
  perks: string[];
  /** Shown under the price. */
  note?: string;
  cta: string;
  /** Default: start practising (or sign in). */
  link?: { path: string; fragment: string };
  highlighted: boolean;
}

@Component({
  selector: 'app-landing-page',
  imports: [RouterLink, AdSlot, Icon, Logo, SiteFooter],
  templateUrl: './landing.page.html',
  styleUrl: './landing.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingPage {
  private readonly auth = inject(AuthService);
  private readonly catalog = toSignal(inject(ApiService).catalog().pipe(catchError(() => of(null))));

  /** Where the "start" buttons go: straight to the dashboard when already logged in. */
  protected readonly startLink = computed(() => (this.auth.signedIn() ? '/app' : '/entrar'));

  /** The real numbers from the catalog, rounded down ("79.000+", "1.500+", "300+"). */
  protected readonly numbers = computed(() => {
    const catalog = this.catalog();
    return {
      questions: roundedDown(catalog?.gradableQuestions),
      exams: roundedDown(catalog?.examCount),
      concursos: roundedDown(catalog?.concursoCount),
    };
  });

  protected readonly features: Feature[] = [
    {
      icon: 'list-checks',
      title: 'Gabarito na Hora',
      text: 'Veja o gabarito oficial logo depois de responder. As questões da OAB têm comentário com a base legal no Premium.',
    },
    {
      icon: 'chart',
      title: 'Simulados por Assunto',
      text: 'Pratique por matéria, instituição ou concurso. Foque exatamente no que precisa melhorar.',
    },
    {
      icon: 'trophy',
      title: 'Estatísticas de Desempenho',
      text: 'Acompanhe sua evolução ao longo do tempo com gráficos claros e identifique seus pontos fortes e fracos.',
    },
  ];

  protected readonly devicePerks = [
    'Funciona no navegador, sem instalar nada',
    'Progresso salvo na sua conta Google',
    'Continue de onde parou em qualquer dispositivo',
  ];

  protected readonly trialDays = PREMIUM.trialDays;

  protected readonly plans: PricingPlan[] = [
    {
      name: 'Gratuito',
      price: 0,
      perks: ['Todas as questões com gabarito', 'Simulados ilimitados', 'Estatísticas básicas'],
      cta: 'Começar Agora',
      highlighted: false,
    },
    {
      name: 'Premium',
      price: PREMIUM.price,
      perks: ['Tudo do plano Gratuito', ...PREMIUM.perks],
      note: `${PREMIUM.trialDays} dias grátis ao criar sua conta`,
      cta: 'Assinar Premium',
      link: PREMIUM_LINK,
      highlighted: true,
    },
  ];
}

/** 79.206 → "79.000+", 1.546 → "1.500+", 324 → "300+"; "—" while loading. */
function roundedDown(total: number | undefined): string {
  if (!total) return '—';
  const step = total >= 10_000 ? 1000 : total >= 100 ? 100 : 10;
  return `${(total >= step ? Math.floor(total / step) * step : total).toLocaleString('pt-BR')}+`;
}
