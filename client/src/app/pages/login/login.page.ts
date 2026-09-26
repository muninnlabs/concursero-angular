import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { Logo } from '../../shared/logo';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, Logo],
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** ?modo=cadastro opens the sign-up tab; ?redirect= is where to go afterwards. */
  readonly modo = input<string>();
  readonly redirect = input<string>();

  private readonly modeOverride = signal<'login' | 'register' | null>(null);
  protected readonly mode = computed(() => this.modeOverride() ?? (this.modo() === 'cadastro' ? 'register' : 'login'));
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected setMode(mode: 'login' | 'register') {
    this.modeOverride.set(mode);
    this.error.set(null);
  }

  protected submit() {
    const registering = this.mode() === 'register';
    const { name, email, password } = this.form.getRawValue();

    if (this.form.invalid || (registering && !name.trim())) {
      this.form.markAllAsTouched();
      this.error.set(registering ? 'Preencha nome, e-mail e uma senha com 8+ caracteres.' : 'Informe e-mail e senha.');
      return;
    }

    this.submitting.set(true);
    this.error.set(null);
    const request = registering ? this.auth.register(name.trim(), email, password) : this.auth.login(email, password);

    request.subscribe({
      next: () => this.router.navigateByUrl(this.safeRedirect()),
      error: (err: unknown) => {
        this.submitting.set(false);
        const message = err instanceof HttpErrorResponse ? err.error?.error : null;
        this.error.set(message ?? 'Não foi possível conectar ao servidor. Tente novamente.');
      },
    });
  }

  /** Only follow in-app redirects. */
  private safeRedirect(): string {
    const target = this.redirect();
    return target?.startsWith('/app') ? target : '/app';
  }
}
