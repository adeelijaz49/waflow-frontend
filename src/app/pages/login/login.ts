import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../shared/auth.service';

type Method = 'whatsapp' | 'email';

@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  method: Method = 'whatsapp';

  phone = '';
  code = '';
  otpStep: 'phone' | 'code' = 'phone';

  email = '';
  emailSent = false;

  loading = false;
  error: string | null = null;

  chooseWorkspace: { id: string; name: string; role: string }[] | null = null;
  private preAuthToken = '';

  showDevBypass = false;
  devSecret = '';

  constructor(private api: ApiService, private auth: AuthService, private router: Router) {}

  useMethod(m: Method) {
    this.method = m;
    this.error = null;
  }

  requestOtp() {
    const phone = this.phone.trim();
    if (!phone || this.loading) return;
    this.loading = true;
    this.error = null;
    this.api.requestOtp(phone).subscribe({
      next: () => { this.loading = false; this.otpStep = 'code'; },
      error: (err) => { this.loading = false; this.error = err.error?.error || 'Something went wrong — please try again.'; },
    });
  }

  verifyOtp() {
    const code = this.code.trim();
    if (!code || this.loading) return;
    this.loading = true;
    this.error = null;
    this.api.verifyOtp(this.phone.trim(), code).subscribe({
      next: (res) => this.handleAuthResult(res),
      error: (err) => { this.loading = false; this.error = err.error?.error || 'Incorrect code — please try again.'; },
    });
  }

  useDifferentPhone() {
    this.otpStep = 'phone';
    this.code = '';
    this.error = null;
  }

  requestMagicLink() {
    const email = this.email.trim();
    if (!email || this.loading) return;
    this.loading = true;
    this.error = null;
    this.api.requestMagicLink(email).subscribe({
      next: () => { this.loading = false; this.emailSent = true; },
      error: (err) => { this.loading = false; this.error = err.error?.error || 'Something went wrong — please try again.'; },
    });
  }

  useDifferentEmail() {
    this.emailSent = false;
    this.error = null;
  }

  selectWorkspace(workspaceId: string) {
    if (this.loading) return;
    this.loading = true;
    this.error = null;
    this.api.selectWorkspace(this.preAuthToken, workspaceId).subscribe({
      next: (res) => { this.loading = false; this.auth.completeLogin(res.token); this.router.navigateByUrl('/dashboard'); },
      error: (err) => { this.loading = false; this.error = err.error?.error || 'Something went wrong — please try again.'; },
    });
  }

  devLogin() {
    const secret = this.devSecret.trim();
    if (!secret || this.loading) return;
    this.loading = true;
    this.error = null;
    this.api.devLogin(secret).subscribe({
      next: (res) => this.handleAuthResult(res),
      error: (err) => { this.loading = false; this.error = err.error?.error || 'Something went wrong — please try again.'; },
    });
  }

  private handleAuthResult(res: any) {
    this.loading = false;
    if (res.chooseWorkspace) {
      this.chooseWorkspace = res.workspaces;
      this.preAuthToken = res.preAuthToken;
      return;
    }
    this.auth.completeLogin(res.token);
    this.router.navigateByUrl('/dashboard');
  }
}
