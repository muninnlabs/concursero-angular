import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  const user = await inject(AuthService).restore();
  return user ? true : router.createUrlTree(['/entrar'], { queryParams: { redirect: state.url } });
};

/** The admin panel: other accounts go to the dashboard (the API checks again). */
export const adminGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const auth = inject(AuthService);
  await auth.restore();
  return auth.isAdmin() ? true : router.createUrlTree(['/app']);
};

/** Keeps logged-in users off the login page. */
export const guestGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const user = await inject(AuthService).restore();
  return user ? router.createUrlTree(['/app']) : true;
};
