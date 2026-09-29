import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { Logo } from '../../shared/logo';

@Component({
  selector: 'app-login-page',
  imports: [Logo],
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** ?redirect= is where to go after signing in. */
  readonly redirect = input<string>();

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async signIn() {
    this.submitting.set(true);
    this.error.set(null);
    try {
      const user = await this.auth.signInWithGoogle();
      if (!user) throw new Error('profile');
      await this.router.navigateByUrl(this.safeRedirect());
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        this.error.set(
          code === 'auth/unauthorized-domain'
            ? 'Este endereço ainda não está autorizado no Firebase para login com Google.'
            : 'Não foi possível entrar agora. Tente novamente.',
        );
      }
    } finally {
      this.submitting.set(false);
    }
  }

  /** Only follow in-app redirects. */
  private safeRedirect(): string {
    const target = this.redirect();
    return target?.startsWith('/app') ? target : '/app';
  }
}
