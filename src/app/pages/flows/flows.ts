import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';
import { StatusBadgePipe } from '../../shared/status-badge.pipe';
import { DialogService } from '../../shared/dialog.service';

// DEFECT-03: "A Flow = a trigger condition + a reference to an existing
// Promotion." All message content/branching now lives in Promotions
// (DEFECT-02) — this screen is a pure rule builder: pick a metric, an
// operator-shaped config, and which Promotion to send. No message/button
// editor lives here anymore (see git history for the removed Phase 1-4
// custom-entry-message UI this screen used to have).
//
// configField picks which input(s) the create/edit form shows:
//   'delayHours'          — how long since an event (post_purchase_points, booking_no_show)
//   'inactivityDays'      — how long since the customer's own state stopped changing
//   'pointsThreshold'     — a one-time value-crossing trigger (points_threshold)
//   'orderCountAndWindow' — a frequency/count trigger over a rolling window (purchase_frequency)
// defaultValue(s) mirror shared/operations.js#FLOW_TYPE_DEFAULTS on the
// backend exactly, so picking a trigger type pre-fills the same number the
// backend would've applied anyway if the field were left blank.
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
    value: 'booking_no_show', icon: '📅', label: 'No-Show Follow-Up', blurb: 'Follow up after a customer misses a booked appointment.', available: true,
    configField: 'delayHours', defaultValue: 1, configLabel: 'Delay after no-show (hours)', configHint: 'How long to wait after a booking is marked no-show before sending.',
  },
  {
    value: 'points_threshold', icon: '💰', label: 'Points Threshold', blurb: 'Message a customer the first time their points balance crosses a threshold.', available: true,
    configField: 'pointsThreshold', defaultValue: 1000, configLabel: 'Points threshold', configHint: 'Fires once, the first time a customer\'s balance reaches or exceeds this.',
  },
  {
    value: 'purchase_frequency', icon: '🛍️', label: 'Purchase Frequency', blurb: 'Message a customer who shops more than N times within a rolling window.', available: true,
    configField: 'orderCountAndWindow', configLabel: 'Order count within window', configHint: 'Fires once, the first time a customer\'s order count within the window reaches this.',
  },
];

// The two new metrics have no fixed default template (see FLOW_TYPE_DEFAULTS
// on the backend) — a Promotion reference is mandatory, not optional, for them.
const PROMOTION_ONLY_TRIGGER_TYPES = ['points_threshold', 'purchase_frequency'];

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
  enrollmentsPage = 1;
  enrollmentsPages = 1;
  enrollmentsTotal = 0;

  preview: any = null;
  previewLoading = false;

  // DEFECT-03: the action side of the rule — which Promotion this flow sends
  // (message content/branching lives entirely there, see DEFECT-02), and
  // optionally which other Flow this one escalates from (§8.3 cascade).
  allPromotions: any[] = [];
  otherFlows: any[] = []; // for the requiresPriorFlowId picker — excludes self when editing

  // §8.2/§9 static preset catalog.
  showPresets = false;
  presets: any[] = [];
  loadingPresets = false;

  constructor(private api: ApiService, private dialog: DialogService) {}

  ngOnInit() {
    this.load();
    this.api.getPromotions().subscribe({ next: (data) => { this.allPromotions = data; }, error: () => {} });
  }

  emptyForm() {
    return {
      name: '', triggerType: 'inactive_customer', inactivityDays: 60, delayHours: 2, cooldownDaysOverride: null,
      pointsThreshold: 1000, orderCountThreshold: 2,
      promotionId: null as string | null, requiresPriorFlowId: null as string | null,
    };
  }

  get selectedTrigger() {
    return this.triggerTypes.find(t => t.value === this.form.triggerType);
  }

  get configField(): 'inactivityDays' | 'delayHours' | 'pointsThreshold' | 'orderCountAndWindow' {
    return (this.selectedTrigger?.configField as any) || 'inactivityDays';
  }

  get isPromotionOnlyTrigger(): boolean {
    return PROMOTION_ONLY_TRIGGER_TYPES.includes(this.form.triggerType);
  }

  // A trigger type with a fixed default template (the original 4) can still
  // reference a Promotion instead if the merchant wants — it's just optional
  // for them, mandatory for the two new metrics that have no fixed default.
  get promotionRequired(): boolean {
    return this.isPromotionOnlyTrigger;
  }

  selectTriggerType(value: string) {
    this.form.triggerType = value;
    const t = this.triggerTypes.find(x => x.value === value);
    if (t?.configField && t.configField !== 'orderCountAndWindow' && t.defaultValue !== undefined) {
      this.form[t.configField] = t.defaultValue;
    }
    if (!this.isPromotionOnlyTrigger) this.loadPreview();
    else this.preview = null;
  }

  loadPreview() {
    this.previewLoading = true;
    this.preview = null;
    this.api.previewFlowMessage(this.form.triggerType).subscribe({
      next: (data) => { this.preview = data; this.previewLoading = false; },
      error: () => { this.previewLoading = false; },
    });
  }

  load() {
    this.loading = true;
    this.api.getFlows().subscribe({
      next: (data) => {
        this.flows = data;
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  openCreate() {
    this.editingId = null;
    this.form = this.emptyForm();
    this.showModal = true;
    this.showPresets = false;
    this.otherFlows = this.flows;
    this.loadPreview();
  }

  openEdit(f: any, event: Event) {
    event.stopPropagation();
    this.editingId = f._id;
    this.form = {
      name: f.name, triggerType: f.triggerType,
      inactivityDays: f.inactivityDays || 60,
      delayHours: f.delayHours ?? 2,
      pointsThreshold: f.pointsThreshold ?? 1000,
      orderCountThreshold: f.orderCountThreshold ?? 2,
      cooldownDaysOverride: f.cooldownDaysOverride ?? null,
      // promotionId/requiresPriorFlowId come back populated ({_id, name, ...})
      // from getFlows/getFlow — extract the plain id for the form's <select>.
      promotionId: f.promotionId?._id || f.promotionId || null,
      requiresPriorFlowId: f.requiresPriorFlowId?._id || f.requiresPriorFlowId || null,
    };
    this.showModal = true;
    this.showPresets = false;
    this.otherFlows = this.flows.filter(x => x._id !== f._id);
    if (!this.isPromotionOnlyTrigger) this.loadPreview();
  }

  closeModal() {
    this.showModal = false;
    this.editingId = null;
    this.showPresets = false;
  }

  // ── Presets (§8.2/§9) ────────────────────────────────────────────────────
  openPresets() {
    this.showPresets = true;
    this.loadingPresets = true;
    this.api.getFlowPresets().subscribe({
      next: (data) => { this.presets = data; this.loadingPresets = false; },
      error: () => { this.loadingPresets = false; },
    });
  }

  applyPreset(preset: any) {
    if (!preset.buildable || !preset.flowConfig) return;
    const cfg = preset.flowConfig;
    this.form = {
      ...this.emptyForm(),
      name: preset.action,
      triggerType: cfg.triggerType,
      inactivityDays: cfg.inactivityDays ?? this.emptyForm().inactivityDays,
      pointsThreshold: cfg.pointsThreshold ?? this.emptyForm().pointsThreshold,
      orderCountThreshold: cfg.orderCountThreshold ?? this.emptyForm().orderCountThreshold,
    };
    // A2/A3 escalate from a prior preset stage (e.g. A1) — that only means
    // something once the merchant has actually created the prior stage's
    // flow, so this just points them at picking it manually below rather
    // than guessing which existing Flow (if any) corresponds to it.
    this.showPresets = false;
    this.editingId = null;
    this.showModal = true;
    this.otherFlows = this.flows;
    if (!this.isPromotionOnlyTrigger) this.loadPreview();
  }

  save() {
    this.saving = true;
    const payload: any = { name: this.form.name };
    if (this.configField === 'delayHours') payload.delayHours = +this.form.delayHours;
    else if (this.configField === 'pointsThreshold') payload.pointsThreshold = +this.form.pointsThreshold;
    else if (this.configField === 'orderCountAndWindow') {
      payload.inactivityDays = +this.form.inactivityDays;
      payload.orderCountThreshold = +this.form.orderCountThreshold;
    } else payload.inactivityDays = +this.form.inactivityDays;

    payload.cooldownDaysOverride = this.form.cooldownDaysOverride === null || this.form.cooldownDaysOverride === ''
      ? null : +this.form.cooldownDaysOverride;
    payload.promotionId = this.form.promotionId || null;
    payload.requiresPriorFlowId = this.form.requiresPriorFlowId || null;

    const req = this.editingId
      ? this.api.updateFlow(this.editingId, payload)
      : this.api.createFlow({ ...payload, triggerType: this.form.triggerType });
    req.subscribe({
      next: () => { this.closeModal(); this.saving = false; this.load(); },
      error: () => { this.saving = false; },
    });
  }

  // Mirrors the activateFlow backend guard client-side, so the button reads as
  // disabled instead of round-tripping to a 400. Checks whichever message
  // source the flow actually uses — its referenced Promotion's entry message
  // (DEFECT-03, the new way) or its own legacy entryNodeId (pre-DEFECT-03,
  // still supported for any flow already using it). A flow using neither
  // (a fixed-template original-4 trigger with no Promotion picked) is never blocked.
  needsTemplateApproval(f: any): boolean {
    if (f.promotionId) {
      const node = f.promotionId?.entryNodeId;
      return !node || node.templateStatus !== 'approved';
    }
    return !!f.entryNodeId && f.entryNodeId.templateStatus !== 'approved';
  }

  promotionName(f: any): string {
    return f.promotionId?.name || '';
  }

  toggleStatus(f: any, event: Event) {
    event.stopPropagation();
    if (f.status !== 'active' && this.needsTemplateApproval(f)) return;
    const req = f.status === 'active' ? this.api.pauseFlow(f._id) : this.api.activateFlow(f._id);
    req.subscribe(() => this.load());
  }

  async deleteFlow(f: any, event: Event) {
    event.stopPropagation();
    const ok = await this.dialog.confirm(`Delete "${f.name}"? This removes its configuration and history.`, {
      title: 'Delete flow', confirmLabel: 'Delete', type: 'error',
    });
    if (!ok) return;
    this.api.deleteFlow(f._id).subscribe(() => {
      this.load();
      if (this.activeFlow?._id === f._id) this.activeFlow = null;
    });
  }

  openDetail(f: any) {
    this.activeFlow = f;
    this.report = null;
    this.enrollments = [];
    this.enrollmentsPage = 1;
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
    this.api.getFlowEnrollments(this.activeFlow._id, { page: this.enrollmentsPage, limit: 50 }).subscribe({
      next: (data) => {
        this.enrollments = data.enrollments;
        this.enrollmentsTotal = data.total;
        this.enrollmentsPages = data.pages || 1;
        this.loadingEnrollments = false;
      },
      error: () => { this.loadingEnrollments = false; },
    });
  }

  enrollmentsPrevPage() {
    if (this.enrollmentsPage <= 1) return;
    this.enrollmentsPage--;
    this.loadEnrollments();
  }

  enrollmentsNextPage() {
    if (this.enrollmentsPage >= this.enrollmentsPages) return;
    this.enrollmentsPage++;
    this.loadEnrollments();
  }

  triggerLabel(type: string): string {
    return this.triggerTypes.find(t => t.value === type)?.label || type;
  }

  presetCategories = [
    { key: 'repeat_business', label: '📈 Drive Repeat Business' },
    { key: 'lifetime_value',  label: '💰 Increase Customer Lifetime Value' },
    { key: 'redemption',      label: '🎁 Increase Loyalty Redemption Rates' },
  ];

  presetsByCategory(key: string): any[] {
    return this.presets.filter(p => p.category === key);
  }

  canSave(): boolean {
    if (!this.form.name) return false;
    if (this.promotionRequired && !this.form.promotionId) return false;
    if (this.configField === 'delayHours') return this.form.delayHours !== null && this.form.delayHours !== undefined;
    if (this.configField === 'pointsThreshold') return !!this.form.pointsThreshold;
    if (this.configField === 'orderCountAndWindow') return !!this.form.orderCountThreshold && !!this.form.inactivityDays;
    return !!this.form.inactivityDays;
  }
}
