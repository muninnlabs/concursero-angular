import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, output, signal, viewChild } from '@angular/core';
import { ApiService } from '../core/api.service';
import { Icon } from './icon';

/** Same ids as REPORT_REASONS in server/src/users/store.ts. */
export const REPORT_REASONS = [
  { id: 'wrong_answer', label: 'O gabarito está errado', hint: 'A alternativa marcada como correta não é a certa.' },
  { id: 'missing_image', label: 'Falta imagem ou está ilegível', hint: 'Figura, gráfico ou tabela ausente, cortada ou borrada.' },
  { id: 'missing_text', label: 'Falta texto ou informação', hint: 'Enunciado ou texto de apoio incompleto.' },
  { id: 'wrong_text', label: 'O texto tem erros', hint: 'Palavras trocadas, cortadas ou com caracteres estranhos.' },
  { id: 'wrong_options', label: 'Problema nas alternativas', hint: 'Alternativa faltando, repetida ou fora de ordem.' },
  { id: 'wrong_subject', label: 'Matéria errada', hint: 'A questão está classificada na matéria errada.' },
  { id: 'other', label: 'Outro problema', hint: 'Descreva abaixo o que está errado.' },
] as const;

export type ReportReasonId = (typeof REPORT_REASONS)[number]['id'];

const MAX_COMMENT = 500;

/**
 * "Reportar erro" modal: pick a predefined reason (one tap), optionally add a
 * comment, and the question is flagged for review (POST /api/questions/reports).
 * Open it with open(question).
 */
@Component({
  selector: 'app-report-dialog',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="card dialog" aria-labelledby="report-title" (close)="reset()">
      @if (sent()) {
        <span class="icon-badge tone--green"><app-icon name="check-circle" [size]="20" /></span>
        <h2 id="report-title">Obrigado!</h2>
        <p class="dialog__lead">Vamos revisar esta questão. Sua ajuda deixa o banco de questões melhor para todos.</p>
        <div class="dialog__actions">
          <button class="btn btn--primary" type="button" (click)="close()">Fechar</button>
        </div>
      } @else {
        <span class="icon-badge tone--amber"><app-icon name="flag" [size]="20" /></span>
        <h2 id="report-title">Reportar erro na questão</h2>
        <p class="dialog__lead">{{ label() }}</p>

        <div class="reasons" role="radiogroup" aria-label="O que está errado?">
          @for (r of reasons; track r.id) {
            <button
              type="button"
              role="radio"
              class="reason"
              [class.reason--active]="reason() === r.id"
              [attr.aria-checked]="reason() === r.id"
              (click)="reason.set(r.id)"
            >
              <strong>{{ r.label }}</strong>
              <small>{{ r.hint }}</small>
            </button>
          }
        </div>

        <label class="comment">
          <span>Detalhes {{ reason() === 'other' ? '' : '(opcional)' }}</span>
          <textarea
            rows="3"
            [maxLength]="maxComment"
            [placeholder]="reason() === 'wrong_answer' ? 'Ex.: a resposta certa é a C, porque…' : 'Conte o que você percebeu'"
            [value]="comment()"
            (input)="comment.set($any($event.target).value)"
          ></textarea>
        </label>

        @if (error(); as message) {
          <p class="dialog__error" role="alert">{{ message }}</p>
        }
        <div class="dialog__actions">
          <button class="btn btn--soft" type="button" (click)="close()" [disabled]="sending()">Cancelar</button>
          <button class="btn btn--primary" type="button" (click)="send()" [disabled]="!canSend()">
            <app-icon name="flag" [size]="16" /> {{ sending() ? 'Enviando…' : 'Enviar' }}
          </button>
        </div>
      }
    </dialog>
  `,
  styles: `
    .dialog {
      width: min(520px, calc(100vw - 32px));
      max-height: calc(100dvh - 32px);
      padding: 28px;
      color: var(--text);
      border-radius: 20px;
      overflow-y: auto;

      &::backdrop {
        background: rgb(15 23 42 / 0.5);
      }
      h2 {
        margin-top: 16px;
        font-size: 20px;
      }
    }
    .dialog__lead {
      margin-top: 6px;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .reasons {
      display: grid;
      gap: 8px;
      margin-top: 20px;
    }
    .reason {
      display: grid;
      gap: 2px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text);
      background: var(--surface);
      text-align: left;
      cursor: pointer;

      strong {
        font-size: 15px;
      }
      small {
        color: var(--text-muted);
        font-size: 13px;
      }
      &:hover {
        border-color: var(--border-strong);
      }
    }
    .reason--active {
      border-color: var(--primary);
      background: var(--primary-soft);
      box-shadow: 0 0 0 1px var(--primary);
    }
    .comment {
      display: grid;
      gap: 6px;
      margin-top: 18px;
      font-size: 14px;
      font-weight: 600;

      textarea {
        padding: 10px 12px;
        border: 1px solid var(--border);
        border-radius: 12px;
        color: var(--text);
        background: var(--surface);
        font: inherit;
        font-weight: 400;
        resize: vertical;
      }
    }
    .dialog__error {
      margin-top: 12px;
      color: var(--danger);
      font-weight: 600;
    }
    .dialog__actions {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 24px;
    }
  `,
})
export class ReportDialog {
  private readonly api = inject(ApiService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  /** The question id, once its report went through. */
  readonly reported = output<string>();

  protected readonly reasons = REPORT_REASONS;
  protected readonly maxComment = MAX_COMMENT;
  private readonly question = signal<{ id: string; examId: string; label: string } | null>(null);
  protected readonly reason = signal<ReportReasonId | null>(null);
  protected readonly comment = signal('');
  protected readonly sending = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly label = computed(() => this.question()?.label ?? '');
  protected readonly canSend = computed(
    () => !!this.reason() && !this.sending() && (this.reason() !== 'other' || this.comment().trim().length > 0),
  );

  open(question: { id: string; examId: string; label: string }) {
    this.reset();
    this.question.set(question);
    this.dialog().nativeElement.showModal();
  }

  protected close() {
    if (!this.sending()) this.dialog().nativeElement.close();
  }

  protected reset() {
    this.reason.set(null);
    this.comment.set('');
    this.sent.set(false);
    this.error.set(null);
  }

  protected send() {
    const question = this.question();
    const reason = this.reason();
    if (!question || !reason || !this.canSend()) return;
    this.sending.set(true);
    this.error.set(null);
    this.api
      .reportQuestion({ examId: question.examId, questionId: question.id, reason, comment: this.comment().trim() || undefined })
      .subscribe({
        next: () => {
          this.sending.set(false);
          this.sent.set(true);
          this.reported.emit(question.id);
        },
        error: (err: unknown) => {
          this.sending.set(false);
          this.error.set((err instanceof HttpErrorResponse && err.error?.error) || 'Não foi possível enviar. Tente de novo.');
        },
      });
  }
}
