import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-logo',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="logo" [class.logo--light]="light()" [routerLink]="link()" aria-label="Concursero, página inicial">
      <img class="logo__mark" src="logo.png" alt="" [width]="size()" [height]="size()" />
      <span class="logo__text">Concursero</span>
    </a>
  `,
  styles: `
    .logo { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: var(--text); font-weight: 800; letter-spacing: -0.02em; }
    .logo__mark { display: block; width: var(--size); height: var(--size); }
    .logo__text { font-size: calc(var(--size) * 0.55); }
    .logo--light { color: #fff; }
  `,
  host: { '[style.--size.px]': 'size()' },
})
export class Logo {
  readonly size = input(36);
  readonly light = input(false);
  readonly link = input('/');
}
