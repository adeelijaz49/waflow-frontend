import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';
import { StatusBadgePipe } from '../../shared/status-badge.pipe';

// inactive_customer, post_purchase_points, and points_balance_reminder have
// working backend triggers so far (Phases 1-3) — booking_no_show is listed so
// the merchant knows it's coming, but isn't selectable yet. Extend this as
// its own phase ships. configField picks which input the create/edit form
// shows: triggers keyed on "how long since an event" use delayHours, triggers
// keyed on "how long since the customer's own state stopped changing" use
// inactivityDays.
// defaultValue mirrors shared/operations.js#FLOW_TYPE_DEFAULTS on the backend
// exactly, so picking a trigger type pre-fills the same number the backend
// would've applied anyway if the field were left blank.
const TRIGGER_TYPES = [
  {
    value: 'inactive_customer', icon: '🔄', label: 'Win-Back (Inactive Customer)', blurb: "Message a customer who hasn't ordered in N days.", available: true,
    configField: 'inactivityDays', defaultValue: 60, configLabel: 'Inactivity threshold (days)', configHint: 'Customers with no order in this many days become eligible.',
  },
  {
    value: 'post_purchase_points', icon: '🎁', label: 'Post-Purchase Points Reminder', blurb: 'Thank a customer and remind them of their points shortly after a purchase.', available: true,
    configField: 'delayHours', defaultValue: 2, configLabel: 'Delay after purchase (hours)', configHint: 'How long to wait after an order is paid before sending.',
  },
  {
    value: 'points_balance_reminder', icon: '💎', label: 'Points Balance Reminder', blurb: "Nudge a customer whose points balance has sat unused for a while.", available: true,
    configField: 'inactivityDays', defaultValue: 30, configLabel: 'Inactivity threshold (days)', configHint: "Customers whose points balance hasn't changed in this many days become eligible.",
  },
  {
    value: 'booking_no_show', icon: '📅', label: 'No-Show Follow-Up', blurb: 'Follow up after a customer misses a booked appointment.', available: false,
    configField: 'delayHours', defaultValue: 1, configLabel: 'Delay after no-show (hours)', configHint: 'How long to wait after a booking is marked no-show before sending.',
  },
];

@Component({
  selector: 'app-flows',
  imports: [CommonModule, FormsModule, AppCurrencyPipe, StatusBadgePipe, DatePipe],
  templateUrl: './flows.html',
  styleUrl: './flows.css',
})
export class Flows implements OnInit {
  flows: any[] = [];
  loading = false;
  triggerTypes = TRIGGER_TYPES;

  showModal = false;
  saving = false;
  editingId: string | null = null;
  form: any = this.emptyForm();

  activeFlow: any = null;
  report: any = null;
  loadingReport = false;
  enrollments: any[] = [];
  loadingEnrollments = false;

  constructor(private api: ApiService) {}

  ngOnInit() { this.load(); }

  emptyForm() {
    return { name: '', triggerType: 'inactive_customer', inactivityDays: 60, delayHours: 2 };
  }

  get selectedTrigger() {
    return this.triggerTypes.find(t => t.value === this.form.triggerType);
  }

  get configField(): 'inactivityDays' | 'delayHours' {
    return (this.selectedTrigger?.configField as 'inactivityDays' | 'delayHours') || 'inactivityDays';
  }

  selectTriggerType(value: string) {
    this.form.triggerType = value;
    const t = this.triggerTypes.find(x => x.value === value);
    if (t) this.form[t.configField] = t.defaultValue;
  }

  load() {
    this.loading = true;
    this.api.getFlows().subscribe({
      next: (data) => { this.flows = data; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  openCreate() {
    this.editingId = null;
    this.form = this.emptyForm();
    this.showModal = true;
  }

  openEdit(f: any, event: Event) {
    event.stopPropagation();
    this.editingId = f._id;
    this.form = {
      name: f.name, triggerType: f.triggerType,
      inactivityDays: f.inactivityDays || 60,
      delayHours: f.delayHours ?? 2,
    };
    this.showModal = true;
  }

  closeModal() {
    this.showModal = false;
    this.editingId = null;
  }

  save() {
    this.saving = true;
    const payload: any = { name: this.form.name };
    if (this.configField === 'delayHours') payload.delayHours = +this.form.delayHours;
    else payload.inactivityDays = +this.form.inactivityDays;
    const req = this.editingId
      ? this.api.updateFlow(this.editingId, payload)
      : this.api.createFlow({ ...payload, triggerType: this.form.triggerType });
    req.subscribe({
      next: () => { this.closeModal(); this.saving = false; this.load(); },
      error: () => { this.saving = false; },
    });
  }

  toggleStatus(f: any, event: Event) {
    event.stopPropagation();
    const req = f.status === 'active' ? this.api.pauseFlow(f._id) : this.api.activateFlow(f._id);
    req.subscribe(() => this.load());
  }

  deleteFlow(f: any, event: Event) {
    event.stopPropagation();
    if (!confirm(`Delete "${f.name}"? This removes its configuration and history.`)) return;
    this.api.deleteFlow(f._id).subscribe(() => {
      this.load();
      if (this.activeFlow?._id === f._id) this.activeFlow = null;
    });
  }

  openDetail(f: any) {
    this.activeFlow = f;
    this.report = null;
    this.enrollments = [];
    this.loadReport();
    this.loadEnrollments();
  }

  loadReport() {
    this.loadingReport = true;
    this.api.getFlowReport(this.activeFlow._id).subscribe({
      next: (data) => { this.report = data; this.loadingReport = false; },
      error: () => { this.loadingReport = false; },
    });
  }

  loadEnrollments() {
    this.loadingEnrollments = true;
    this.api.getFlowEnrollments(this.activeFlow._id).subscribe({
      next: (data) => { this.enrollments = data.enrollments; this.loadingEnrollments = false; },
      error: () => { this.loadingEnrollments = false; },
    });
  }

  triggerLabel(type: string): string {
    return this.triggerTypes.find(t => t.value === type)?.label || type;
  }
}
