import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Icon, type IconName } from '../../shared/icon';
import { Logo } from '../../shared/logo';

interface Feature {
  icon: IconName;
  title: string;
  text: string;
}

interface PricingPlan {
  name: string;
  price: number;
  perks: string[];
  cta: string;
  highlighted: boolean;
}

@Component({
  selector: 'app-landing-page',
  imports: [RouterLink, Icon, Logo],
  templateUrl: './landing.page.html',
  styleUrl: './landing.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingPage {
  private readonly auth = inject(AuthService);
  private readonly catalog = toSignal(inject(ApiService).catalog().pipe(catchError(() => of(null))));

  /** Where the "start" buttons go: straight to the dashboard when already logged in. */
  protected readonly startLink = computed(() => (this.auth.token() ? '/app' : '/entrar'));

  /** Real question count, rounded down to the thousand ("7.000+"). */
  protected readonly questionCount = computed(() => {
    const total = this.catalog()?.totalQuestions;
    if (!total) return '—';
    const rounded = total >= 1000 ? Math.floor(total / 1000) * 1000 : total;
    return `${rounded.toLocaleString('pt-BR')}+`;
  });

  protected readonly year = new Date().getFullYear();

  protected readonly features: Feature[] = [
    {
      icon: 'list-checks',
      title: 'Correções Detalhadas',
      text: 'Cada questão vem com explicação completa e referência legal para você entender o "porquê" da resposta correta.',
    },
    {
      icon: 'chart',
      title: 'Simulados por Assunto',
      text: 'Monte seu próprio simulado filtrando por banca, ano ou matéria. Foque exatamente no que precisa melhorar.',
    },
    {
      icon: 'trophy',
      title: 'Estatísticas de Desempenho',
      text: 'Acompanhe sua evolução ao longo do tempo com gráficos claros e identifique seus pontos fortes e fracos.',
    },
  ];

  protected readonly mobilePerks = [
    'Modo offline para estudar sem internet',
    'Sincronização automática entre dispositivos',
    'Notificações inteligentes de revisão',
  ];

  protected readonly plans: PricingPlan[] = [
    {
      name: 'Gratuito',
      price: 0,
      perks: ['Todas as questões comentadas', 'Simulados ilimitados', 'Estatísticas básicas'],
      cta: 'Começar Agora',
      highlighted: false,
    },
    {
      name: 'Sem Anúncios',
      price: 19,
      perks: ['Tudo do plano Gratuito', 'Experiência sem anúncios', 'Estatísticas avançadas'],
      cta: 'Remover Anúncios',
      highlighted: true,
    },
  ];
}
