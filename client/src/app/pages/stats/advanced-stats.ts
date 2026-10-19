import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CategoryState } from '../../core/categories';
import type { Insights } from '../../core/models';
import { Icon } from '../../shared/icon';
import { LineChart, type ChartSeries } from '../../shared/line-chart';

interface Row {
  label: string;
  answered: number;
  value: number;
  tone: 'good' | 'warning' | 'low';
}

const DAY_PARTS: Record<Insights['byDayPart'][number]['part'], string> = {
  madrugada: 'Madrugada (0h–6h)',
  manha: 'Manhã (6h–12h)',
  tarde: 'Tarde (12h–18h)',
  noite: 'Noite (18h–24h)',
};

/** Below this many answers a part of the day can't be "the best". */
const MIN_ANSWERS_BEST_PART = 5;

/** What free users see, blurred, behind the "Assinar Premium" card. */
const SAMPLE: Insights = {
  days: 90,
  totals: { answered: 420, correct: 281, avgSeconds: 74 },
  timing: { correct: 61, wrong: 102 },
  bySubject: [
    { subject: 'Direito Constitucional', answered: 96, correct: 71, avgSeconds: 58 },
    { subject: 'Direito Penal', answered: 80, correct: 46, avgSeconds: 92 },
    { subject: 'Direito Civil', answered: 72, correct: 39, avgSeconds: 88 },
    { subject: 'Ética Profissional', answered: 64, correct: 55, avgSeconds: 47 },
    { subject: 'Direito Tributário', answered: 40, correct: 17, avgSeconds: 110 },
  ],
  weakest: [
    { subject: 'Direito Tributário', answered: 40, correct: 17, avgSeconds: 110 },
    { subject: 'Direito Civil', answered: 72, correct: 39, avgSeconds: 88 },
    { subject: 'Direito Penal', answered: 80, correct: 46, avgSeconds: 92 },
  ],
  byYear: [
    { year: 2025, answered: 140, correct: 98 },
    { year: 2024, answered: 120, correct: 79 },
    { year: 2023, answered: 90, correct: 55 },
    { year: 2022, answered: 70, correct: 49 },
  ],
  byInstitution: [
    { institution: 'FGV', answered: 300, correct: 207 },
    { institution: 'CESPE', answered: 120, correct: 74 },
  ],
  byDayPart: [
    { part: 'madrugada', answered: 12, correct: 6 },
    { part: 'manha', answered: 160, correct: 120 },
    { part: 'tarde', answered: 140, correct: 91 },
    { part: 'noite', answered: 108, correct: 64 },
  ],
  weekly: [52, 55, 54, 58, 61, 60, 63, 62, 66, 65, 68, 70].map((value, i) => ({
    start: `2026-${String(7 + Math.floor(i / 4)).padStart(2, '0')}-${String(1 + (i % 4) * 7).padStart(2, '0')}`,
    answered: 100,
    correct: value,
  })),
};

/**
 * "Análise Avançada" at the bottom of Estatísticas. Premium users get their
 * numbers (GET /api/me/insights); everyone else sees sample numbers, blurred,
 * with a call to subscribe.
 */
@Component({
  selector: 'app-advanced-stats',
  imports: [NgTemplateOutlet, RouterLink, Icon, LineChart],
  templateUrl: './advanced-stats.html',
  styleUrl: './advanced-stats.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdvancedStats {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  protected readonly categoryState = inject(CategoryState);

  protected readonly periods = [
    { days: 30, label: '30 dias' },
    { days: 90, label: '90 dias' },
    { days: 0, label: 'Tudo' },
  ] as const;
  protected readonly days = signal<number>(90);

  protected readonly insights = rxResource({
    params: () => (this.auth.isPremium() ? { days: this.days(), category: this.categoryState.selected() } : undefined),
    stream: ({ params }) => this.api.insights(params.days, params.category),
  });

  protected readonly data = computed<Insights | undefined>(() => (this.auth.isPremium() ? this.insights.value() : SAMPLE));

  protected readonly weakest = computed(() => (this.data()?.weakest ?? []).map((s) => ({ ...row(s.subject, s.answered, s.correct), subject: s.subject })));

  protected readonly timing = computed(() => {
    const t = this.data()?.timing;
    if (!t || t.correct == null || t.wrong == null) return null;
    const ratio = t.correct ? t.wrong / t.correct : 0;
    return {
      correct: formatSeconds(t.correct),
      wrong: formatSeconds(t.wrong),
      note:
        ratio >= 1.2
          ? `Você leva ${ratio.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× mais tempo nas questões que erra: quando travar, marque e siga em frente.`
          : 'Seu tempo é parecido nas questões que acerta e nas que erra.',
    };
  });

  protected readonly slowest = computed(() =>
    (this.data()?.bySubject ?? [])
      .filter((s) => s.avgSeconds != null)
      .sort((a, b) => b.avgSeconds! - a.avgSeconds!)
      .slice(0, 5)
      .map((s) => ({ subject: s.subject, time: formatSeconds(s.avgSeconds!) })),
  );

  protected readonly trend = computed(() => {
    const weeks = this.data()?.weekly ?? [];
    const dates = weeks.map((w) => new Date(`${w.start}T12:00:00`));
    const series: ChartSeries[] = [
      { label: 'Precisão (%)', color: 'var(--series-correct)', values: weeks.map((w) => (w.answered ? Math.round((w.correct / w.answered) * 100) : 0)) },
    ];
    return {
      labels: dates.map((d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })),
      fullLabels: dates.map((d, i) => `Semana de ${d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} · ${weeks[i].answered} questões`),
      series,
      empty: weeks.every((w) => w.answered === 0),
    };
  });

  protected readonly byYear = computed<Row[]>(() => (this.data()?.byYear ?? []).map((y) => row(String(y.year), y.answered, y.correct)));
  protected readonly byInstitution = computed<Row[]>(() =>
    (this.data()?.byInstitution ?? []).map((i) => row(i.institution, i.answered, i.correct)),
  );

  protected readonly dayParts = computed(() => {
    const parts = (this.data()?.byDayPart ?? []).map((p) => row(DAY_PARTS[p.part], p.answered, p.correct));
    const best = parts.filter((p) => p.answered >= MIN_ANSWERS_BEST_PART).sort((a, b) => b.value - a.value)[0];
    return { parts, best: best?.label ?? null };
  });

  protected periodText(): string {
    const days = this.data()?.days;
    return days ? `nos últimos ${days} dias` : 'desde o início';
  }
}

function row(label: string, answered: number, correct: number): Row {
  const value = answered ? Math.round((correct / answered) * 100) : 0;
  return { label, answered, value, tone: value >= 70 ? 'good' : value >= 50 ? 'warning' : 'low' };
}

function formatSeconds(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}min ${String(seconds % 60).padStart(2, '0')}s`;
}
