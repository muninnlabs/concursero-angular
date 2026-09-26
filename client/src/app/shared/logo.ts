import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from './icon';

@Component({
  selector: 'app-logo',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="logo" [class.logo--light]="light()" [routerLink]="link()" aria-label="BrasilQuiz, página inicial">
      <span class="logo__mark"><app-icon name="flag" [size]="size() * 0.55" [filled]="true" /></span>
      <span class="logo__text">Brasil<span class="logo__accent">Quiz</span></span>
    </a>
  `,
  styles: `
    .logo { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: var(--text); font-weight: 800; letter-spacing: -0.02em; }
    .logo__mark {
      display: grid; place-items: center; width: var(--size); height: var(--size); border-radius: 10px;
      color: #fff; background: linear-gradient(135deg, var(--primary), #6d5dfc);
      box-shadow: 0 6px 14px rgb(79 70 229 / 0.3);
    }
    .logo__text { font-size: calc(var(--size) * 0.55); }
    .logo__accent { color: var(--primary); }
    .logo--light { color: #fff; }
    .logo--light .logo__accent { color: #fff; }
  `,
  host: { '[style.--size.px]': 'size()' },
})
export class Logo {
  readonly size = input(36);
  readonly light = input(false);
  readonly link = input('/');
}
