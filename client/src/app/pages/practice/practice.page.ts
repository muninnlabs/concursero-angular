import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ApiService, assetUrl } from '../../core/api.service';
import type { GradedAnswer } from '../../core/models';
import { PreferencesService } from '../../core/preferences';
import { Icon } from '../../shared/icon';

const MODES = {
  relampago: { title: 'Questão Relâmpago', count: 1, seconds: 30 },
  mini: { title: 'Mini Simulado', count: 10, seconds: 12 * 60 },
} as const;

type Mode = keyof typeof MODES;

/** The exam JSON keeps the PDF's line wraps; join them back into paragraphs. */
export function dewrap(text: string | null | undefined): string {
  return (text ?? '').replace(/([^\n])\n(?!\n)/g, '$1 ').trim();
}

@Component({
  selector: 'app-practice-page',
  imports: [RouterLink, Icon],
  templateUrl: './practice.page.html',
  styleUrl: './practice.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PracticePage {
  private readonly api = inject(ApiService);
  private readonly preferences = inject(PreferencesService);

  // Query params (?modo=mini&categoria=OAB&materia=...), bound by the router.
  readonly modo = input<string>();
  readonly categoria = input<string>();
  readonly materia = input<string>();

  protected readonly mode = computed<Mode>(() => (this.modo() === 'relampago' ? 'relampago' : 'mini'));
  protected readonly config = computed(() => MODES[this.mode()]);
  protected readonly category = computed(() => this.categoria() || 'ENEM');

  protected readonly questions = rxResource({
    params: () => ({ category: this.category(), count: this.config().count, subject: this.materia() || undefined }),
    stream: ({ params }) => this.api.practiceQuestions(params),
  });

  protected readonly index = signal(0);
  protected readonly selected = signal<Record<string, string>>({});
  protected readonly results = signal<GradedAnswer[] | null>(null);
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly current = computed(() => this.questions.value()?.[this.index()]);
  protected readonly total = computed(() => this.questions.value()?.length ?? 0);
  protected readonly answeredCount = computed(() => Object.keys(this.selected()).length);
  protected readonly score = computed(() => this.results()?.filter((r) => r.isCorrect).length ?? 0);
  protected readonly resultFor = computed(() => new Map(this.results()?.map((r) => [r.questionId, r])));

  // Countdown: informative only for now (nothing happens at zero besides the colour).
  private readonly startedAt = Date.now();
  private readonly now = signal(Date.now());
  protected readonly remaining = computed(() =>
    Math.max(0, this.config().seconds - Math.floor((this.now() - this.startedAt) / 1000)),
  );
  protected readonly clock = computed(() => {
    const s = this.remaining();
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  });

  // Time spent looking at each question ("Média por Questão" on Estatísticas).
  private readonly timeSpent = new Map<string, number>();
  private viewingSince = Date.now();

  protected readonly dewrap = dewrap;
  protected readonly assetUrl = assetUrl;

  constructor() {
    const timer = setInterval(() => {
      if (!this.results()) this.now.set(Date.now());
    }, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    // The clock for the first question starts once it's on screen, not while loading.
    effect(() => {
      if (this.questions.value()) this.viewingSince = Date.now();
    });
  }

  /**
   * Some extracted images are 1–20 px fragments of lines from the PDF (mostly
   * ENEM 2016); they'd show up as stray marks, so hide them once loaded.
   */
  protected hideSlivers(event: Event) {
    const img = event.target as HTMLImageElement;
    if (img.naturalWidth < 20 || img.naturalHeight < 20) img.hidden = true;
  }

  protected choose(questionId: string, letter: string) {
    if (this.results()) return;
    this.selected.update((current) => ({ ...current, [questionId]: letter }));
  }

  protected go(delta: number) {
    this.goTo(this.index() + delta);
  }

  protected goTo(index: number) {
    this.recordTime();
    this.index.set(Math.min(Math.max(index, 0), this.total() - 1));
  }

  /** Adds the time since the last switch to the question on screen. */
  private recordTime() {
    const now = Date.now();
    const id = this.current()?.id;
    if (id && !this.results()) this.timeSpent.set(id, (this.timeSpent.get(id) ?? 0) + now - this.viewingSince);
    this.viewingSince = now;
  }

  protected submit() {
    this.recordTime();
    const examOf = new Map(this.questions.value()?.map((q) => [q.id, q.examId]));
    const answers = Object.entries(this.selected()).map(([questionId, selected]) => ({
      questionId,
      examId: examOf.get(questionId)!,
      selected,
      durationMs: this.timeSpent.get(questionId),
    }));
    if (answers.length === 0) return;

    this.submitting.set(true);
    this.error.set(null);
    const simulado =
      this.mode() === 'mini' ? { title: `${this.config().title} — ${this.materia() || this.category()}` } : undefined;

    this.api.submitAnswers(answers, simulado).subscribe({
      next: ({ results }) => {
        this.results.set(results);
        this.submitting.set(false);
        const correct = results.filter((r) => r.isCorrect).length;
        this.preferences.playResult(correct / results.length >= 0.6);
        this.index.set(0);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.error.set((err instanceof HttpErrorResponse && err.error?.error) || 'Não foi possível enviar suas respostas.');
      },
    });
  }

  protected optionState(questionId: string, letter: string): 'correct' | 'wrong' | 'selected' | null {
    const result = this.resultFor().get(questionId);
    if (result) {
      if (letter === result.correctAnswer) return 'correct';
      if (letter === result.selected) return 'wrong';
      return null;
    }
    return this.selected()[questionId] === letter ? 'selected' : null;
  }
}
