import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../shared/auth.service';

@Component({
  selector: 'app-auth-verify',
  imports: [CommonModule, RouterLink],
  templateUrl: './auth-verify.html',
  styleUrl: './auth-verify.css',
})
export class AuthVerify implements OnInit {
  status: 'verifying' | 'error' | 'chooseWorkspace' = 'verifying';
  error = '';
  workspaces: { id: string; name: string; role: string }[] = [];
  private preAuthToken = '';

  constructor(private route: ActivatedRoute, private api: ApiService, private auth: AuthService, private router: Router) {}

  ngOnInit() {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.status = 'error';
      this.error = 'This link is missing its token.';
      return;
    }
    this.api.verifyMagicLink(token).subscribe({
      next: (res) => {
        if (res.chooseWorkspace) {
          this.status = 'chooseWorkspace';
          this.workspaces = res.workspaces;
          this.preAuthToken = res.preAuthToken;
          return;
        }
        this.auth.completeLogin(res.token);
        this.router.navigateByUrl('/dashboard');
      },
      error: (err) => {
        this.status = 'error';
        this.error = err.error?.error || 'This link is invalid or has expired.';
      },
    });
  }

  selectWorkspace(workspaceId: string) {
    this.api.selectWorkspace(this.preAuthToken, workspaceId).subscribe({
      next: (res) => { this.auth.completeLogin(res.token); this.router.navigateByUrl('/dashboard'); },
      error: (err) => { this.status = 'error'; this.error = err.error?.error || 'Something went wrong — please try again.'; },
    });
  }
}
