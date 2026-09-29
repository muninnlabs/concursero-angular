import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User as FirebaseUser } from 'firebase/auth';
import { firstValueFrom } from 'rxjs';
import { firebaseAuth } from './firebase';
import type { User } from './models';

/**
 * Google sign-in through Firebase Authentication, the same accounts as the
 * mobile app. The API receives the Firebase ID token and keeps its own
 * profile/stats for the user (see /api/auth/me).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly firebaseUser = signal<FirebaseUser | null>(null);
  /** The app profile from the API; null until loaded. */
  readonly user = signal<User | null>(null);

  readonly signedIn = computed(() => this.firebaseUser() !== null);
  readonly firstName = computed(() => this.user()?.name.split(' ')[0] ?? '');
  readonly isPremium = computed(() => this.user()?.plan === 'premium');
  readonly photoUrl = computed(() => this.firebaseUser()?.photoURL ?? null);

  constructor() {
    onAuthStateChanged(firebaseAuth, (user) => {
      this.firebaseUser.set(user);
      if (!user) this.user.set(null);
    });
  }

  /** Current ID token (refreshed by Firebase when needed), or null when signed out. */
  async idToken(): Promise<string | null> {
    await firebaseAuth.authStateReady();
    return firebaseAuth.currentUser ? firebaseAuth.currentUser.getIdToken() : null;
  }

  async signInWithGoogle(): Promise<User | null> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(firebaseAuth, provider);
    return this.restore();
  }

  /** Waits for Firebase to restore the session, then loads the app profile. */
  async restore(): Promise<User | null> {
    await firebaseAuth.authStateReady();
    if (!firebaseAuth.currentUser) return null;
    if (this.user()) return this.user();
    try {
      const user = await firstValueFrom(this.http.get<User>('api/auth/me'));
      this.user.set(user);
      return user;
    } catch {
      return null;
    }
  }

  async logout() {
    await signOut(firebaseAuth);
    this.user.set(null);
    this.router.navigateByUrl('/');
  }
}
