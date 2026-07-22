import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

export interface MessageNodeButtonDraft {
  position: number;
  label: string;
  nextAction: 'end_flow' | 'send_message';
  followUpBody: string; // only meaningful when nextAction === 'send_message'
  targetNodeId?: string; // set once the follow-up node has been created/loaded — orchestrated by the parent, unused by this component
}

export interface MessageNodeDraft {
  bodyText: string;
  buttons: MessageNodeButtonDraft[];
}

// Shared body + CTA-button editor, reused for a Flow's custom entry message.
// showButtons=false renders the follow-up leaf case (Phase 1: a follow-up
// message has no further buttons of its own — single branching level only).
// Phase 3 will let a follow-up's own buttons branch further by turning
// showButtons on recursively; nothing here needs to change to support that.
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
  @Input() showButtons = true;
  @Output() nodeChange = new EventEmitter<MessageNodeDraft>();

  variables: Array<{ key: string; label: string; slot: number }> = [];

  constructor(private api: ApiService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['triggerType']) this.loadVariables();
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
    this.node.buttons.push({ position: this.node.buttons.length, label: '', nextAction: 'end_flow', followUpBody: '' });
    this.emit();
  }

  removeButton(position: number) {
    this.node.buttons = this.node.buttons
      .filter(b => b.position !== position)
      .map((b, i) => ({ ...b, position: i }));
    this.emit();
  }

  emit() {
    this.nodeChange.emit(this.node);
  }
}
