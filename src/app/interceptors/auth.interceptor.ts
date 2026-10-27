import { HttpInterceptorFn } from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../shared/auth.service';
import { SKIP_AUTO_LOGOUT } from '../shared/platform-api.service';

const TOKEN_KEY = 'waflow_auth_token';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem(TOKEN_KEY);
  const authedReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  const router = inject(Router);
  // Looked up lazily, only on a 401: AuthService's own constructor sends a request, so asking for it eagerly
  // here would be a circular dependency the first time any request goes out.
  const injector = inject(Injector);

  return next(authedReq).pipe(
    catchError((err) => {
      // Only auto-redirect when a token was actually sent and rejected — a
      // login-page request (no token yet) 401ing is just "wrong code", not
      // an expired session, and should stay an inline error.
      if (err.status === 401 && token && !req.context.get(SKIP_AUTO_LOGOUT)) {
        // Through AuthService so the in-memory session (and a stashed super-admin home token) go too,
        // not just the stored token: otherwise a stale "acting as" banner could linger.
        injector.get(AuthService).logout();
        router.navigateByUrl('/login');
      }
      return throwError(() => err);
    }),
  );
};
