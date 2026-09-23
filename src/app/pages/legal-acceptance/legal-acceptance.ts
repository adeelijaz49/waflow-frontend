import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LegalApiService, LegalAcceptanceStatus } from '../../services/legal-api.service';
import { LegalService } from '../../shared/legal.service';

@Component({
  selector: 'app-legal-acceptance',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './legal-acceptance.html',
  styleUrl: './legal-acceptance.css',
})
export class LegalAcceptance implements OnInit {
  status: LegalAcceptanceStatus | null = null;
  loading = true;
  step: 'combined' | 'dpa' = 'combined';
  combinedChecked = false;
  dpaChecked = false;
  saving = false;
  error: string | null = null;
  private returnUrl = '/dashboard';

  constructor(
    private route: ActivatedRoute, private router: Router,
    private legalApi: LegalApiService, private legal: LegalService,
  ) {}

  ngOnInit() {
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/dashboard';
    this.legalApi.getAcceptanceStatus().subscribe({
      next: (s) => {
        this.status = s;
        this.step = s.requiresCombinedAcceptance ? 'combined' : 'dpa';
        this.loading = false;
        // Reached directly (not via the guard) with nothing actually
        // outstanding — nothing to do here, send them on.
        if (!s.requiresCombinedAcceptance && !s.requiresDpaAcceptance) this.leave();
      },
      error: () => { this.loading = false; },
    });
  }

  acceptCombined() {
    if (!this.combinedChecked || this.saving) return;
    this.saving = true;
    this.error = null;
    this.legalApi.acceptCombined().subscribe({
      next: (s) => {
        this.status = s;
        this.saving = false;
        this.legal.refresh();
        if (s.requiresDpaAcceptance) this.step = 'dpa';
        else this.leave();
      },
      error: (err) => { this.saving = false; this.error = err.error?.error || 'Something went wrong — please try again.'; },
    });
  }

  acceptDpa() {
    if (!this.dpaChecked || this.saving) return;
    this.saving = true;
    this.error = null;
    this.legalApi.acceptDpa().subscribe({
      next: () => { this.saving = false; this.legal.refresh(); this.leave(); },
      error: (err) => { this.saving = false; this.error = err.error?.error || 'Something went wrong — please try again.'; },
    });
  }

  private leave() {
    this.router.navigateByUrl(this.returnUrl);
  }
}
