import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../shared/auth.service';

@Component({
  selector: 'app-support',
  imports: [CommonModule, FormsModule],
  templateUrl: './support.html',
  styleUrl: './support.css',
})
export class Support implements OnInit {
  message = '';
  contactEmail = '';
  submitting = false;
  submitted = false;
  error: string | null = null;
  warning: string | null = null;

  constructor(private api: ApiService, private auth: AuthService) {}

  ngOnInit() {
    this.contactEmail = this.auth.sessionSnapshot?.user?.email || '';
  }

  submit() {
    const message = this.message.trim();
    const contactEmail = this.contactEmail.trim();
    if (!message || !contactEmail || this.submitting) return;
    this.submitting = true;
    this.error = null;
    this.api.submitSupportTicket(message, contactEmail).subscribe({
      next: (res) => {
        this.submitting = false;
        this.submitted = true;
        this.warning = res.sendWarning || null;
      },
      error: (err) => {
        this.submitting = false;
        this.error = err.error?.error || 'Something went wrong — please try again.';
      },
    });
  }

  another() {
    this.message = '';
    this.submitted = false;
    this.warning = null;
  }
}
