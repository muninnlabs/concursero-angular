import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { CATEGORIES, CategoryState } from '../../core/categories';
import type { ActivityStats } from '../../core/models';
import { SearchState, matchesSearch } from '../../core/search';
import { Icon, type IconName } from '../../shared/icon';
import { LineChart, type ChartSeries } from '../../shared/line-chart';

interface Kpi {
  icon: IconName;
  tone: 'blue' | 'rose' | 'amber' | 'purple';
  value: string;
  label: string;
  /** Change against the previous period, when there is one to compare with. */
  delta?: { text: string; good: boolean };
}

interface Level {
  name: string;
  tone: 'bronze' | 'silver' | 'gold' | 'diamond';
}

/** Below this many answers in the period, the level would be noise. */
const MIN_ANSWERS_FOR_LEVEL = 10;

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

@Component({
  selector: 'app-stats-page',
  imports: [RouterLink, Icon, LineChart],
  templateUrl: './stats.page.html',
  styleUrl: './stats.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatsPage {
  private readonly api = inject(ApiService);
  private readonly search = inject(SearchState);
  protected readonly categoryState = inject(CategoryState);
  protected readonly categories = CATEGORIES.filter((c) => c.available);

  protected readonly periods = [7, 30] as const;
  protected readonly days = signal<number>(7);

  protected readonly activity = rxResource({
    params: () => ({ days: this.days(), category: this.categoryState.selected() }),
    stream: ({ params }) => this.api.activity(params.days, params.category),
  });

  protected readonly kpis = computed<Kpi[]>(() => {
    const a = this.activity.value();
    if (!a) {
      return (['Acertos Totais', 'Erros Totais', 'Precisão Geral', 'Média por Questão'] as const).map((label, i) => ({
        icon: (['check', 'x', 'target', 'timer'] as const)[i],
        tone: (['blue', 'rose', 'amber', 'purple'] as const)[i],
        value: '—',
        label,
      }));
    }
    const wrong = a.current.answered - a.current.correct;
    const previousWrong = a.previous.answered - a.previous.correct;
    return [
      { icon: 'check', tone: 'blue', value: count(a.current.correct), label: 'Acertos Totais', delta: change(a.current.correct, a.previous.correct, true) },
      { icon: 'x', tone: 'rose', value: count(wrong), label: 'Erros Totais', delta: change(wrong, previousWrong, false) },
      {
        icon: 'target',
        tone: 'amber',
        value: a.current.answered ? `${accuracy(a.current.correct, a.current.answered).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—',
        label: 'Precisão Geral',
      },
      {
        icon: 'timer',
        tone: 'purple',
        value: a.current.avgSeconds == null ? '—' : formatSeconds(a.current.avgSeconds),
        label: 'Média por Questão',
      },
    ];
  });

  protected readonly chart = computed(() => {
    const days = this.activity.value()?.days ?? [];
    const dates = days.map((d) => new Date(`${d.day}T12:00:00`));
    const labels = dates.map((date) =>
      days.length <= 7 ? WEEKDAYS[date.getDay()] : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    );
    const fullLabels = dates.map((date) => date.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }));
    const series: ChartSeries[] = [
      { label: 'Acertos', color: 'var(--series-correct)', values: days.map((d) => d.correct) },
      { label: 'Erros', color: 'var(--series-wrong)', values: days.map((d) => d.wrong) },
    ];
    return { labels, fullLabels, series, empty: days.every((d) => d.correct + d.wrong === 0) };
  });

  protected readonly subjects = computed(() => {
    const query = this.search.query();
    return (this.activity.value()?.bySubject ?? [])
      .filter((s) => !query || matchesSearch(s.subject, query))
      .map((s) => {
        const value = Math.round(accuracy(s.correct, s.answered));
        const tone = value >= 70 ? 'good' : value >= 50 ? 'warning' : 'low';
        return { subject: s.subject, answered: s.answered, value, tone };
      });
  });

  protected readonly level = computed<Level | null>(() => {
    const a = this.activity.value();
    if (!a || a.current.answered < MIN_ANSWERS_FOR_LEVEL) return null;
    const value = accuracy(a.current.correct, a.current.answered);
    if (value >= 85) return { name: 'Diamante', tone: 'diamond' };
    if (value >= 70) return { name: 'Ouro', tone: 'gold' };
    if (value >= 50) return { name: 'Prata', tone: 'silver' };
    return { name: 'Bronze', tone: 'bronze' };
  });

  protected readonly levelText = computed(() => {
    const a = this.activity.value();
    const category = CATEGORIES.find((c) => c.id === this.categoryState.selected())?.label ?? '';
    const period = this.days() === 7 ? 'esta semana' : 'neste mês';
    if (!a) return '';
    if (!this.level()) {
      const missing = MIN_ANSWERS_FOR_LEVEL - a.current.answered;
      return `Responda mais ${missing} ${missing === 1 ? 'questão' : 'questões'} de ${category} para descobrir seu nível nos últimos ${this.days()} dias.`;
    }
    if (a.ranking) return `Você está no top ${a.ranking.topPercent}% dos estudantes que praticam ${category} ${period}.`;
    return `Sua precisão em ${category} ${period} é de ${Math.round(accuracy(a.current.correct, a.current.answered))}%. Continue praticando para subir de nível.`;
  });

  protected chartDescription(a: ActivityStats | undefined): string {
    if (!a) return '';
    return `Acertos e erros por dia nos últimos ${a.days.length} dias`;
  }
}

function count(n: number): string {
  return n.toLocaleString('pt-BR');
}

function accuracy(correct: number, answered: number): number {
  return answered ? (correct / answered) * 100 : 0;
}

/** "+12% vs anterior"; nothing when the previous period was empty. */
function change(current: number, previous: number, higherIsBetter: boolean): Kpi['delta'] {
  if (!previous) return undefined;
  const percent = Math.round(((current - previous) / previous) * 100);
  return {
    text: `${percent > 0 ? '+' : ''}${percent}% vs anterior`,
    good: percent === 0 || percent > 0 === higherIsBetter,
  };
}

function formatSeconds(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}min ${String(seconds % 60).padStart(2, '0')}s`;
}
