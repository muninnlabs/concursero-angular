import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { CATEGORIES, CategoryState } from '../../core/categories';
import { SearchState, matchesSearch } from '../../core/search';
import { subjectStyle, type SubjectStyle } from '../../core/subjects';
import { AdSlot } from '../../shared/ad-slot';
import { Icon } from '../../shared/icon';

interface SubjectCard {
  subject: string;
  style: SubjectStyle;
  questionCount: number;
  /** Share of the subject's questions answered at least once, 0–100. */
  progress: number;
  /** Bar segments (percent of the track) split by accuracy. */
  correctWidth: number;
  wrongWidth: number;
}

interface Suggestion {
  subject: string;
  style: SubjectStyle;
  title: string;
  text: string;
}

/** A weak spot needs this many answers before it's worth pointing out. */
const MIN_ANSWERS_FOR_SUGGESTION = 5;

@Component({
  selector: 'app-subjects-page',
  imports: [RouterLink, AdSlot, Icon],
  templateUrl: './subjects.page.html',
  styleUrl: './subjects.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'filterOpen.set(false)' },
})
export class SubjectsPage {
  private readonly api = inject(ApiService);
  private readonly search = inject(SearchState);
  protected readonly categoryState = inject(CategoryState);
  protected readonly categories = CATEGORIES.filter((c) => c.available);

  protected readonly filterOpen = signal(false);

  protected readonly subjects = rxResource({
    params: () => this.categoryState.selected(),
    stream: ({ params }) => this.api.subjects(params),
  });

  private readonly stats = rxResource({
    params: () => this.categoryState.selected(),
    stream: ({ params }) => this.api.stats(params),
  });

  private readonly allCards = computed<SubjectCard[]>(() => {
    const mine = new Map(this.stats.value()?.bySubject.map((s) => [s.subject, s]));
    return (this.subjects.value() ?? []).map((info, index) => {
      const stats = mine.get(info.subject);
      const progress = stats ? Math.min(100, (stats.questions / info.questionCount) * 100) : 0;
      const accuracy = stats?.answered ? stats.correct / stats.answered : 0;
      return {
        subject: info.subject,
        style: subjectStyle(info.subject, index),
        questionCount: info.questionCount,
        progress,
        correctWidth: progress * accuracy,
        wrongWidth: progress * (1 - accuracy),
      };
    });
  });

  protected readonly cards = computed(() => {
    const query = this.search.query();
    return query ? this.allCards().filter((c) => matchesSearch(c.subject, query)) : this.allCards();
  });

  protected readonly categoryLabel = computed(
    () => CATEGORIES.find((c) => c.id === this.categoryState.selected())?.label ?? this.categoryState.selected(),
  );

  /** The subject with the worst accuracy; before there's enough data, the biggest one not started yet. */
  protected readonly suggestion = computed<Suggestion | null>(() => {
    const subjects = this.subjects.value();
    if (!subjects?.length) return null;
    const known = new Set(subjects.map((s) => s.subject));
    const candidates = (this.stats.value()?.bySubject ?? []).filter(
      (s) => known.has(s.subject) && s.answered >= MIN_ANSWERS_FOR_SUGGESTION,
    );
    const weakest = candidates.sort((a, b) => a.correct / a.answered - b.correct / b.answered)[0];

    if (weakest) {
      const errorRate = Math.round((1 - weakest.correct / weakest.answered) * 100);
      return {
        subject: weakest.subject,
        style: subjectStyle(weakest.subject),
        title: `Melhore seu desempenho em ${shortName(weakest.subject)}`,
        text: `Sua taxa de erro em ${weakest.subject} está em ${errorRate}%, a maior entre as matérias que você praticou. Que tal um simulado focado apenas nela?`,
      };
    }
    const practised = new Set(this.stats.value()?.bySubject.map((s) => s.subject));
    const next = subjects.find((s) => !practised.has(s.subject)) ?? subjects[0];
    return {
      subject: next.subject,
      style: subjectStyle(next.subject),
      title: `Comece por ${shortName(next.subject)}`,
      text: `São ${next.questionCount.toLocaleString('pt-BR')} questões de provas anteriores em ${next.subject}. Um simulado curto já mostra onde você está.`,
    };
  });

  protected pickCategory(id: string) {
    this.categoryState.select(id);
    this.filterOpen.set(false);
  }

  protected toggleFilter(event: Event) {
    event.stopPropagation();
    this.filterOpen.update((open) => !open);
  }

  /** "0%", "<1%" for a first few questions in a big subject, then whole numbers. */
  protected percent(value: number): string {
    if (value > 0 && value < 1) return '<1%';
    return `${Math.round(value)}%`;
  }
}

/** "Matemática e Suas Tecnologias" → "Matemática", "Direito Penal" stays. */
function shortName(subject: string): string {
  return subject.replace(/ e Suas Tecnologias$/, '').replace(/ \(.*\)$/, '');
}
