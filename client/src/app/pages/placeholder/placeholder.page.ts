import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Stand-in for sidebar sections that aren't built yet. */
@Component({
  selector: 'app-placeholder-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ heading() }}</h1>
    <div class="card empty">
      <p>Esta seção ainda está em construção.</p>
      <a class="btn btn--primary" routerLink="/app">Voltar ao início</a>
    </div>
  `,
  styles: `
    h1 { font-size: 28px; letter-spacing: -0.02em; }
    .empty { display: grid; justify-items: center; gap: 20px; margin-top: 24px; padding: 56px 24px; color: var(--text-muted); text-align: center; }
  `,
})
export class PlaceholderPage {
  /** From the route's `data`. */
  readonly heading = input('');
}
