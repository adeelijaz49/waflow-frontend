import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

const TOKEN_KEY = 'waflow_auth_token';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem(TOKEN_KEY);
  const authedReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  const router = inject(Router);

  return next(authedReq).pipe(
    catchError((err) => {
      // Only auto-redirect when a token was actually sent and rejected — a
      // login-page request (no token yet) 401ing is just "wrong code", not
      // an expired session, and should stay an inline error.
      if (err.status === 401 && token) {
        localStorage.removeItem(TOKEN_KEY);
        router.navigateByUrl('/login');
      }
      return throwError(() => err);
    }),
  );
};
