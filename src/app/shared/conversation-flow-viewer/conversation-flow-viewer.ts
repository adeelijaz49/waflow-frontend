import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MessageNodeDraft } from '../message-node-editor/message-node-editor';

interface PathStep {
  node: MessageNodeDraft;
  tappedButtonLabel?: string; // unset only for the first (entry) step
}

// Renders the same entryDraft tree the flat MessageNodeEditor edits, as an
// actual WhatsApp-style back-and-forth thread — business bubbles, simulated
// customer-tap bubbles, a breadcrumb, and button chips the merchant clicks to
// walk deeper into the tree one path at a time (a full tree can't render
// legibly as one flat thread, so this shows one path at a time instead, per
// the conversation-flow-viewer spec).
//
// Phase 1 scope: render + navigate only. Editing (Phase 2) reuses this same
// pathSteps/root binding — nothing here needs to change to support it.
@Component({
  selector: 'app-conversation-flow-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './conversation-flow-viewer.html',
  styleUrl: './conversation-flow-viewer.css',
})
export class ConversationFlowViewer implements OnChanges {
  @Input() triggerType = '';
  @Input() root: MessageNodeDraft = { bodyText: '', buttons: [] };
  @Input() templateStatus: string | null = null; // only the entry node ever needs one — see models/MessageNode.js

  pathSteps: PathStep[] = [];

  ngOnChanges(changes: SimpleChanges) {
    if (changes['root']) {
      this.pathSteps = [{ node: this.root }];
    }
  }

  get lastStep(): PathStep | undefined {
    return this.pathSteps[this.pathSteps.length - 1];
  }

  tapChip(button: any) {
    if (button.nextAction === 'send_message' && button.followUp) {
      this.pathSteps = [...this.pathSteps, { node: button.followUp, tappedButtonLabel: button.label }];
    }
  }

  jumpTo(index: number) {
    this.pathSteps = this.pathSteps.slice(0, index + 1);
  }
}
