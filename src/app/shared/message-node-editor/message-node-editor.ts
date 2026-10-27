import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import {
  CONSENT_BODY_SUGGESTIONS, CONSENT_LABEL_PAIRS, ConsentLabelPair, DEFAULT_CONFIRMATIONS, OPT_IN_PRESET,
  actionName, isConsentAction, labelLimitFor,
} from './consent-wording';

// opt_in / opt_out / interested are the consent actions (entry step of a consent request only); 'end_flow' is "None".
export type MessageNodeAction = 'end_flow' | 'send_message' | 'apply_discount' | 'redeem_points' | 'opt_in' | 'opt_out' | 'interested';

export interface MessageNodeButtonDraft {
  position: number;
  label: string;
  nextAction: MessageNodeAction; // apply_discount/redeem_points are visible, not-yet-wired no-ops (see server.js#handleMessageNodeTap)
  replyText?: string; // the confirmation sent after a consent tap (opt_in / opt_out / interested); empty = the standard one
  followUp?: MessageNodeDraft; // recursive — only present when nextAction === 'send_message'
  targetNodeId?: string; // set once this button's follow-up has been created/loaded — orchestrated by the parent, unused by this component
}

export interface MessageNodeDraft {
  bodyText: string;
  buttons: MessageNodeButtonDraft[];
  targetNodeId?: string; // set once this node itself has been created/loaded — orchestrated by the parent
}

// Shared body + CTA-button editor, reused for a Flow's custom entry message
// and recursively for every level of follow-up beneath it, up to depth 3
// (MAX_BRANCH_DEPTH, enforced server-side too in shared/operations.js). A
// button whose nextAction is send_message nests another instance of this
// same component bound to that button's own follow-up draft.
@Component({
  selector: 'app-message-node-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './message-node-editor.html',
  styleUrl: './message-node-editor.css',
})
export class MessageNodeEditor implements OnChanges {
  // triggerType only matters when variableSource is 'flow' (selects which
  // fixed per-triggerType variable list to fetch); ignored for 'promotion',
  // which always uses the one fixed PROMOTION_MESSAGE_VARIABLES list
  // (see shared/operations.js) regardless of the promotion's own shape.
  @Input() triggerType = '';
  @Input() variableSource: 'flow' | 'promotion' = 'flow';
  @Input() node: MessageNodeDraft = { bodyText: '', buttons: [] };
  @Input() depth = 0; // 0 = entry node
  @Input() maxDepth = 3;
  @Input() hideNestedEditors = false; // true when a host (e.g. ConversationFlowViewer) handles "go deeper" as navigation instead of an inline nested form
  // True only for a consent request's message: offers Opt in / Opt out / Interested / None per button, the
  // confirmation text and the one-click presets. Only ever applies to the entry step (depth 0).
  @Input() allowConsentActions = false;
  @Output() nodeChange = new EventEmitter<MessageNodeDraft>();

  variables: Array<{ key: string; label: string; slot: number }> = [];
  readonly labelPairs = CONSENT_LABEL_PAIRS;
  readonly defaultConfirmations = DEFAULT_CONFIRMATIONS;
  readonly actionName = actionName;

  constructor(private api: ApiService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['triggerType'] || changes['variableSource']) this.loadVariables();
  }

  get canBranchFurther(): boolean {
    return this.depth < this.maxDepth;
  }

  // The entry step is a WhatsApp template (labels up to 25); every follow-up is an interactive message (20).
  get labelMax(): number {
    return labelLimitFor(this.depth);
  }

  get consentMode(): boolean {
    return this.allowConsentActions && this.depth === 0;
  }

  // A button that already carries a consent action keeps showing it even where the host does not offer them.
  showConsentOptionsFor(b: MessageNodeButtonDraft): boolean {
    return this.consentMode || isConsentAction(b.nextAction);
  }

  isConsentAction(a: string): boolean {
    return isConsentAction(a);
  }

  loadVariables() {
    if (this.variableSource === 'promotion') {
      this.api.getPromotionMessageVariables().subscribe({
        next: (vars) => { this.variables = vars; },
        error: () => { this.variables = []; },
      });
      return;
    }
    if (!this.triggerType) { this.variables = []; return; }
    this.api.getFlowMessageVariables(this.triggerType).subscribe({
      next: (vars) => { this.variables = vars; },
      error: () => { this.variables = []; },
    });
  }

  insertVariable(v: { slot: number }) {
    this.node.bodyText = (this.node.bodyText || '') + `{{${v.slot}}}`;
    this.emit();
  }

  addButton() {
    if (this.node.buttons.length >= 3) return;
    this.node.buttons.push({ position: this.node.buttons.length, label: '', nextAction: 'end_flow' });
    this.emit();
  }

  removeButton(position: number) {
    this.node.buttons = this.node.buttons
      .filter(b => b.position !== position)
      .map((b, i) => ({ ...b, position: i }));
    this.emit();
  }

  onNextActionChange(button: MessageNodeButtonDraft) {
    if (button.nextAction === 'send_message' && !button.followUp) {
      button.followUp = { bodyText: '', buttons: [] };
    }
    // A confirmation text only means something for a consent action: never leave a stale one behind.
    if (!isConsentAction(button.nextAction)) delete button.replyText;
    this.emit();
  }

  onFollowUpChange(button: MessageNodeButtonDraft, updated: MessageNodeDraft) {
    button.followUp = updated;
    this.emit();
  }

  // One click: the two standard buttons (Opt in / Opt out), and the suggested wording when nothing is written yet.
  // Existing confirmation texts are kept, the merchant's own body is never overwritten.
  applyOptInPreset() {
    const keep = (action: string) => this.node.buttons.find((b) => b.nextAction === action)?.replyText;
    const yesReply = keep('opt_in');
    const noReply = keep('opt_out');
    this.node.buttons = [
      { position: 0, label: OPT_IN_PRESET.yes, nextAction: 'opt_in', ...(yesReply ? { replyText: yesReply } : {}) },
      { position: 1, label: OPT_IN_PRESET.no, nextAction: 'opt_out', ...(noReply ? { replyText: noReply } : {}) },
    ];
    if (!(this.node.bodyText || '').trim()) this.node.bodyText = CONSENT_BODY_SUGGESTIONS[0].body;
    this.emit();
  }

  // Sets the labels of the Opt in / Opt out buttons from one of the suggested pairs (adding either button when
  // it is missing). Every label stays editable afterwards.
  applyLabelPair(key: string) {
    const chosen: ConsentLabelPair | undefined = CONSENT_LABEL_PAIRS.find((p) => p.key === key);
    if (!chosen) return;
    const ensure = (action: 'opt_in' | 'opt_out', label: string) => {
      const existing = this.node.buttons.find((b) => b.nextAction === action);
      if (existing) { existing.label = label; return; }
      if (this.node.buttons.length >= 3) return;
      this.node.buttons.push({ position: this.node.buttons.length, label, nextAction: action });
    };
    ensure('opt_in', chosen.yes);
    ensure('opt_out', chosen.no);
    this.emit();
  }

  emit() {
    this.nodeChange.emit(this.node);
  }
}
