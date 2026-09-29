import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** Adds the Firebase ID token to API calls and sends the user to /entrar when it's rejected. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('api/')) return next(req);

  const auth = inject(AuthService);
  const router = inject(Router);

  return from(auth.idToken()).pipe(
    switchMap((token) => next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req)),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        router.navigate(['/entrar'], { queryParams: { redirect: router.url } });
      }
      return throwError(() => error);
    }),
  );
};
