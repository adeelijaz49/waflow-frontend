import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';
import { StatusBadgePipe } from '../../shared/status-badge.pipe';
import { MessageNodeEditor, MessageNodeDraft } from '../../shared/message-node-editor/message-node-editor';

// Custom entry messages (see models/MessageNode.js) are now supported for all
// 4 trigger types (Phases 1-2).
const BRANCHING_SUPPORTED_TRIGGERS = ['inactive_customer', 'post_purchase_points', 'points_balance_reminder', 'booking_no_show'];

// All 4 trigger types now have working backend triggers (Phases 1-4).
// configField picks which input the create/edit form shows: triggers keyed on
// "how long since an event" use delayHours, triggers keyed on "how long since
// the customer's own state stopped changing" use inactivityDays.
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
    value: 'booking_no_show', icon: '📅', label: 'No-Show Follow-Up', blurb: 'Follow up after a customer misses a booked appointment.', available: true,
    configField: 'delayHours', defaultValue: 1, configLabel: 'Delay after no-show (hours)', configHint: 'How long to wait after a booking is marked no-show before sending.',
  },
];

@Component({
  selector: 'app-flows',
  imports: [CommonModule, FormsModule, AppCurrencyPipe, StatusBadgePipe, DatePipe, MessageNodeEditor],
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

  // Custom entry message (see models/MessageNode.js) — Phase 1: edit-mode
  // only, since a MessageNode needs a real flow id as its owner. See
  // BRANCHING_SUPPORTED_TRIGGERS above for which trigger types support this.
  useCustomEntry = false;
  existingEntryNode: any = null;
  entryDraft: MessageNodeDraft = { bodyText: '', buttons: [] };
  savingEntryNode = false;
  submittingTemplate = false;
  refreshingStatus = false;

  constructor(private api: ApiService) {}

  ngOnInit() { this.load(); }

  emptyForm() {
    return { name: '', triggerType: 'inactive_customer', inactivityDays: 60, delayHours: 2, cooldownDaysOverride: null };
  }

  get selectedTrigger() {
    return this.triggerTypes.find(t => t.value === this.form.triggerType);
  }

  get configField(): 'inactivityDays' | 'delayHours' {
    return (this.selectedTrigger?.configField as 'inactivityDays' | 'delayHours') || 'inactivityDays';
  }

  get branchingSupported(): boolean {
    return BRANCHING_SUPPORTED_TRIGGERS.includes(this.form.triggerType);
  }

  selectTriggerType(value: string) {
    this.form.triggerType = value;
    const t = this.triggerTypes.find(x => x.value === value);
    if (t) this.form[t.configField] = t.defaultValue;
    this.loadPreview();
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
      next: (data) => { this.flows = data; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  openCreate() {
    this.editingId = null;
    this.form = this.emptyForm();
    this.showModal = true;
    this.resetCustomEntry();
    this.loadPreview();
  }

  openEdit(f: any, event: Event) {
    event.stopPropagation();
    this.editingId = f._id;
    this.form = {
      name: f.name, triggerType: f.triggerType,
      inactivityDays: f.inactivityDays || 60,
      delayHours: f.delayHours ?? 2,
      cooldownDaysOverride: f.cooldownDaysOverride ?? null,
    };
    this.showModal = true;
    this.resetCustomEntry();
    // entryNodeId comes back populated ({_id, templateStatus}) from getFlows/
    // getFlow so the list view can grey out Activate without a second
    // round-trip — extract the plain id here regardless of which shape it is.
    const entryNodeId = f.entryNodeId?._id || f.entryNodeId;
    if (entryNodeId) {
      this.useCustomEntry = true;
      this.loadExistingEntryNode(entryNodeId);
    }
    this.loadPreview();
  }

  closeModal() {
    this.showModal = false;
    this.editingId = null;
  }

  resetCustomEntry() {
    this.useCustomEntry = false;
    this.existingEntryNode = null;
    this.entryDraft = { bodyText: '', buttons: [] };
  }

  // Reverse-maps a saved MessageNode (real nextAction.targetNodeId shape)
  // back into the editor's flat draft shape (nextAction + followUpBody) —
  // fetches each send_message button's target node to show its body inline.
  loadExistingEntryNode(nodeId: string) {
    this.api.getMessageNode(nodeId).subscribe({
      next: (node) => {
        this.existingEntryNode = node;
        const buttonDrafts = node.buttons.map((b: any) => ({
          position: b.position, label: b.label,
          nextAction: b.nextAction.type, followUpBody: '', targetNodeId: b.nextAction.targetNodeId,
        }));
        this.entryDraft = { bodyText: node.bodyText, buttons: buttonDrafts };
        buttonDrafts.filter((b: any) => b.nextAction === 'send_message' && b.targetNodeId).forEach((b: any) => {
          this.api.getMessageNode(b.targetNodeId).subscribe({
            next: (target) => { b.followUpBody = target.bodyText; },
          });
        });
      },
    });
  }

  toggleCustomEntry() {
    this.useCustomEntry = !this.useCustomEntry;
    if (this.useCustomEntry && !this.existingEntryNode) {
      this.entryDraft = { bodyText: '', buttons: [] };
    }
  }

  saveCustomEntry() {
    if (!this.editingId) return;
    this.savingEntryNode = true;

    // Create/refresh each send_message button's follow-up node first (its id
    // is needed to build the entry node's own buttons array), then the entry
    // node itself, then point the flow at it.
    const buttonRequests = this.entryDraft.buttons.map((b: any) => {
      if (b.nextAction !== 'send_message') return Promise.resolve(b);
      const followUp$ = b.targetNodeId
        ? this.api.updateMessageNode(b.targetNodeId, { bodyText: b.followUpBody, buttons: [] })
        : this.api.createMessageNode({ ownerId: this.editingId, bodyText: b.followUpBody, buttons: [] });
      return new Promise((resolve, reject) => {
        followUp$.subscribe({ next: (node) => resolve({ ...b, targetNodeId: node._id }), error: reject });
      });
    });

    Promise.all(buttonRequests).then((resolvedButtons: any) => {
      const buttons = resolvedButtons.map((b: any) => ({
        position: b.position, label: b.label,
        nextAction: { type: b.nextAction, targetNodeId: b.nextAction === 'send_message' ? b.targetNodeId : undefined },
      }));

      const entry$ = this.existingEntryNode
        ? this.api.updateMessageNode(this.existingEntryNode._id, { bodyText: this.entryDraft.bodyText, buttons })
        : this.api.createMessageNode({ ownerId: this.editingId, isEntryNode: true, bodyText: this.entryDraft.bodyText, buttons });

      entry$.subscribe({
        next: (node) => {
          const afterLink = () => { this.existingEntryNode = node; this.savingEntryNode = false; this.load(); };
          if (this.existingEntryNode) afterLink();
          else this.api.updateFlow(this.editingId!, { entryNodeId: node._id }).subscribe({ next: afterLink, error: () => { this.savingEntryNode = false; } });
        },
        error: () => { this.savingEntryNode = false; },
      });
    }).catch(() => { this.savingEntryNode = false; });
  }

  submitEntryTemplate() {
    if (!this.existingEntryNode) return;
    this.submittingTemplate = true;
    this.api.submitMessageNodeTemplate(this.existingEntryNode._id).subscribe({
      next: (node) => { this.existingEntryNode = node; this.submittingTemplate = false; },
      error: () => { this.submittingTemplate = false; },
    });
  }

  refreshEntryTemplateStatus() {
    if (!this.existingEntryNode) return;
    this.refreshingStatus = true;
    this.api.refreshMessageNodeTemplateStatus(this.existingEntryNode._id).subscribe({
      next: (node) => { this.existingEntryNode = node; this.refreshingStatus = false; },
      error: () => { this.refreshingStatus = false; },
    });
  }

  save() {
    this.saving = true;
    const payload: any = { name: this.form.name };
    if (this.configField === 'delayHours') payload.delayHours = +this.form.delayHours;
    else payload.inactivityDays = +this.form.inactivityDays;
    payload.cooldownDaysOverride = this.form.cooldownDaysOverride === null || this.form.cooldownDaysOverride === ''
      ? null : +this.form.cooldownDaysOverride;
    const req = this.editingId
      ? this.api.updateFlow(this.editingId, payload)
      : this.api.createFlow({ ...payload, triggerType: this.form.triggerType });
    req.subscribe({
      next: () => { this.closeModal(); this.saving = false; this.load(); },
      error: () => { this.saving = false; },
    });
  }

  // Mirrors the activateFlow backend guard client-side, so the button reads as
  // disabled instead of round-tripping to a 400. A flow with no custom entry
  // message (entryNodeId unset) is never blocked.
  needsTemplateApproval(f: any): boolean {
    return !!f.entryNodeId && f.entryNodeId.templateStatus !== 'approved';
  }

  toggleStatus(f: any, event: Event) {
    event.stopPropagation();
    if (f.status !== 'active' && this.needsTemplateApproval(f)) return;
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
}
