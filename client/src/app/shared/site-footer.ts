import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from './icon';
import { Logo } from './logo';

/** Footer of the public pages (landing, Ajuda, Sobre, Contato, Privacidade, Termos). */
@Component({
  selector: 'app-site-footer',
  imports: [RouterLink, Icon, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="footer">
      <div class="container footer__grid">
        <div>
          <app-logo [size]="26" [light]="true" />
          <p class="footer__about">Plataforma líder em preparação para exames públicos e privados no Brasil.</p>
        </div>
        <div>
          <h4>Produto</h4>
          <a routerLink="/entrar">ENEM</a>
          <a routerLink="/entrar">OAB</a>
          <a routerLink="/entrar">Concursos</a>
          <a routerLink="/ajuda">Ajuda</a>
        </div>
        <div>
          <h4>Empresa</h4>
          <a routerLink="/sobre">Sobre nós</a>
          <a routerLink="/contato">Contato</a>
          <a routerLink="/privacidade">Privacidade</a>
          <a routerLink="/termos">Termos de Uso</a>
        </div>
        <div>
          <h4>Social</h4>
          <div class="footer__social">
            <a href="#" aria-label="Instagram"><app-icon name="instagram" [size]="16" /></a>
            <a href="#" aria-label="X (Twitter)"><app-icon name="x-logo" [size]="14" /></a>
          </div>
        </div>
      </div>
      <p class="container footer__copy">© {{ year }} Concursero. Todos os direitos reservados.</p>
    </footer>
  `,
  styles: `
    :host { display: block; }
    .container { width: min(1140px, 100% - 32px); margin-inline: auto; }
    .footer { padding-block: 72px 32px; color: #cbd5e1; background: var(--dark); font-size: 14px; }
    .footer__grid {
      display: grid; grid-template-columns: 1.4fr repeat(3, 1fr); gap: 40px;
      h4 { margin: 0 0 16px; color: #fff; font-size: 14px; }
      a { display: block; margin-bottom: 10px; color: #94a3b8; text-decoration: none; }
      a:hover { color: #fff; }
    }
    .footer__about { margin-top: 16px; max-width: 280px; color: #94a3b8; line-height: 1.6; }
    .footer__social {
      display: flex; gap: 12px;
      a { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 8px; background: rgb(255 255 255 / 0.08); color: #e2e8f0; }
    }
    .footer__copy {
      margin-top: 56px; padding-top: 32px; border-top: 1px solid rgb(255 255 255 / 0.08);
      color: #64748b; text-align: center; font-size: 13px;
    }
  `,
})
export class SiteFooter {
  protected readonly year = new Date().getFullYear();
}
