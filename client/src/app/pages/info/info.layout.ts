import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { Logo } from '../../shared/logo';
import { SiteFooter } from '../../shared/site-footer';

/** Public header + footer around the Ajuda, Sobre, Contato, Privacidade and Termos pages. */
@Component({
  selector: 'app-info-layout',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, Logo, SiteFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="nav">
      <div class="container nav__inner">
        <app-logo [size]="30" />
        <nav class="nav__links" aria-label="Principal">
          <a routerLink="/ajuda" routerLinkActive="nav__link--active" class="nav__link">Ajuda</a>
          <a routerLink="/contato" routerLinkActive="nav__link--active" class="nav__link">Contato</a>
          @if (signedIn()) {
            <a routerLink="/app" class="btn btn--primary nav__cta">Meu painel</a>
          } @else {
            <a routerLink="/entrar" class="btn btn--primary nav__cta">Entrar</a>
          }
        </nav>
      </div>
    </header>
    <main class="container info">
      <router-outlet />
    </main>
    <app-site-footer />
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 100vh; background: var(--surface); }
    .container { width: min(1140px, 100% - 32px); margin-inline: auto; }
    .nav { position: sticky; top: 0; z-index: 10; background: var(--surface); border-bottom: 1px solid var(--border); }
    .nav__inner { display: flex; align-items: center; justify-content: space-between; gap: 16px; height: 64px; }
    .nav__links { display: flex; align-items: center; gap: 24px; }
    .nav__link { color: var(--text); font-size: 14px; font-weight: 500; text-decoration: none; }
    .nav__link:hover, .nav__link--active { color: var(--primary); }
    .nav__cta { min-height: 38px; padding: 0 16px; font-size: 14px; }
    .info { flex: 1; padding-block: 56px 80px; }
    @media (max-width: 600px) {
      .nav__links { gap: 16px; }
      .info { padding-block: 32px 56px; }
    }
  `,
})
export class InfoLayout {
  protected readonly signedIn = inject(AuthService).signedIn;
}
