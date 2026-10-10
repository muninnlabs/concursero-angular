import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CATEGORIES, CategoryState } from '../../core/categories';
import { ConcursoFilterState, filterParams } from '../../core/concurso-filter';
import type { Simulado } from '../../core/models';
import { Icon, type IconName } from '../../shared/icon';
import { ConcursoFilterCard } from './concurso-filter';

interface StatCard {
  icon: IconName;
  tone: 'indigo' | 'green' | 'amber' | 'rose';
  value: string;
  label: string;
}

const CATEGORY_STYLE: Record<string, { icon: IconName; tone: StatCard['tone'] }> = {
  ENEM: { icon: 'book-open', tone: 'indigo' },
  OAB: { icon: 'gavel', tone: 'amber' },
  CONCURSOS: { icon: 'landmark', tone: 'green' },
  VESTIBULARES: { icon: 'graduation-cap', tone: 'rose' },
};

@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, Icon, ConcursoFilterCard],
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  protected readonly categoryState = inject(CategoryState);
  protected readonly categories = CATEGORIES;
  private readonly concursoFilter = inject(ConcursoFilterState);

  /** Concursos and Vestibulares have a level / state / ... filter; it applies to that category's practice only. */
  protected readonly hasFilter = computed(() => ['CONCURSOS', 'VESTIBULARES'].includes(this.categoryState.selected()));
  protected readonly practiceFilter = computed(() =>
    this.hasFilter() ? filterParams(this.concursoFilter.filter(this.categoryState.selected())) : {},
  );

  private readonly stats = rxResource({
    params: () => this.categoryState.selected(),
    stream: ({ params }) => this.api.stats(params),
  });

  /** A random question picked ahead of time, so the card can show its subject. */
  private readonly nextQuestion = rxResource({
    params: () => ({ category: this.categoryState.selected(), ...this.practiceFilter() }),
    stream: ({ params }) => this.api.practiceQuestions({ ...params, count: 1 }),
  });

  /** Across all categories, like the mock. */
  protected readonly simulados = rxResource({ stream: () => this.api.simulados(undefined, 5) });

  protected readonly nextQuestionLoading = this.nextQuestion.isLoading;

  protected readonly nextSubject = computed(() => {
    const question = this.nextQuestion.value()?.[0];
    return question?.subject ?? null;
  });

  protected readonly statCards = computed<StatCard[]>(() => {
    const s = this.stats.value();
    const number = (n: number | undefined) => (n === undefined ? '—' : n.toLocaleString('pt-BR'));
    const days = s?.streakDays;
    return [
      { icon: 'list-checks', tone: 'indigo', value: number(s?.answered), label: 'Total de Questões' },
      { icon: 'check-circle', tone: 'green', value: number(s?.correct), label: 'Acertos' },
      { icon: 'target', tone: 'amber', value: s ? `${s.accuracy}%` : '—', label: 'Taxa de Acerto' },
      { icon: 'flame', tone: 'rose', value: days === undefined ? '—' : `${days} ${days === 1 ? 'dia' : 'dias'}`, label: 'Sequência Atual' },
    ];
  });

  protected styleFor(simulado: Simulado) {
    return CATEGORY_STYLE[simulado.category] ?? { icon: 'calculator', tone: 'rose' };
  }

  protected accuracy(simulado: Simulado): number {
    return simulado.total ? Math.round((simulado.correct / simulado.total) * 100) : 0;
  }

  protected accuracyTone(simulado: Simulado): 'green' | 'amber' | 'rose' {
    const value = this.accuracy(simulado);
    return value >= 80 ? 'green' : value >= 65 ? 'amber' : 'rose';
  }

  /** "Hoje, 14:20" / "Ontem, 09:45" / "12 mai., 18:10" */
  protected when(iso: string): string {
    const date = new Date(iso);
    const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return `Hoje, ${time}`;
    if (date.toDateString() === yesterday.toDateString()) return `Ontem, ${time}`;
    return `${date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}, ${time}`;
  }

  protected isAvailable(category: string): boolean {
    return CATEGORIES.some((c) => c.id === category && c.available);
  }
}
