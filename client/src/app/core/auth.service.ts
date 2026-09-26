import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, firstValueFrom, tap } from 'rxjs';
import type { Session, User } from './models';

const TOKEN_KEY = 'brasilquiz.token';

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode / blocked storage: the session just won't survive a reload.
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly token = signal<string | null>(readToken());
  readonly user = signal<User | null>(null);
  readonly firstName = computed(() => this.user()?.name.split(' ')[0] ?? '');
  readonly isPremium = computed(() => this.user()?.plan === 'premium');

  login(email: string, password: string): Observable<Session> {
    return this.http.post<Session>('/api/auth/login', { email, password }).pipe(tap((s) => this.start(s)));
  }

  register(name: string, email: string, password: string): Observable<Session> {
    return this.http.post<Session>('/api/auth/register', { name, email, password }).pipe(tap((s) => this.start(s)));
  }

  /** Resolves the stored token into a user; clears the session when it's no longer valid. */
  async restore(): Promise<User | null> {
    if (this.user()) return this.user();
    if (!this.token()) return null;
    try {
      const user = await firstValueFrom(this.http.get<User>('/api/auth/me'));
      this.user.set(user);
      return user;
    } catch {
      this.clear();
      return null;
    }
  }

  logout() {
    this.clear();
    this.router.navigateByUrl('/');
  }

  /** Drops the session without navigating (used when the API answers 401). */
  clear() {
    writeToken(null);
    this.token.set(null);
    this.user.set(null);
  }

  private start({ token, user }: Session) {
    writeToken(token);
    this.token.set(token);
    this.user.set(user);
  }
}
