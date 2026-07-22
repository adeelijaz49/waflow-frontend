import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

export type MessageNodeAction = 'end_flow' | 'send_message' | 'apply_discount' | 'redeem_points';

export interface MessageNodeButtonDraft {
  position: number;
  label: string;
  nextAction: MessageNodeAction; // apply_discount/redeem_points are visible, not-yet-wired no-ops (see server.js#handleMessageNodeTap)
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
  @Input() triggerType = '';
  @Input() node: MessageNodeDraft = { bodyText: '', buttons: [] };
  @Input() depth = 0; // 0 = entry node
  @Input() maxDepth = 3;
  @Output() nodeChange = new EventEmitter<MessageNodeDraft>();

  variables: Array<{ key: string; label: string; slot: number }> = [];

  constructor(private api: ApiService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['triggerType']) this.loadVariables();
  }

  get canBranchFurther(): boolean {
    return this.depth < this.maxDepth;
  }

  loadVariables() {
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
    this.emit();
  }

  onFollowUpChange(button: MessageNodeButtonDraft, updated: MessageNodeDraft) {
    button.followUp = updated;
    this.emit();
  }

  emit() {
    this.nodeChange.emit(this.node);
  }
}
