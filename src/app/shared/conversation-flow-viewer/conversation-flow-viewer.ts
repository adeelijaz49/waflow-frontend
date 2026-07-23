import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MessageNodeEditor, MessageNodeDraft, MessageNodeButtonDraft, MessageNodeAction } from '../message-node-editor/message-node-editor';

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
// Phase 2: inline editing. Clicking a bubble edits that node's body/buttons
// in place (via a non-recursive MessageNodeEditor — "going deeper" here is a
// navigation gesture, the click-through-chip, not another nested form).
// Clicking a chip's gear icon opens an action-picker to set/change what that
// button does, including creating a brand-new follow-up that the thread
// navigates into immediately.
@Component({
  selector: 'app-conversation-flow-viewer',
  standalone: true,
  imports: [CommonModule, MessageNodeEditor],
  templateUrl: './conversation-flow-viewer.html',
  styleUrl: './conversation-flow-viewer.css',
})
export class ConversationFlowViewer implements OnChanges {
  @Input() triggerType = '';
  @Input() root: MessageNodeDraft = { bodyText: '', buttons: [] };
  @Input() templateStatus: string | null = null;
  @Input() maxDepth = 3;
  @Output() rootChange = new EventEmitter<MessageNodeDraft>();

  pathSteps: PathStep[] = [];
  editingNode: MessageNodeDraft | null = null;
  actionPickerButton: MessageNodeButtonDraft | null = null;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['root']) {
      this.pathSteps = [{ node: this.root }];
      this.editingNode = null;
      this.actionPickerButton = null;
    }
  }

  get lastStep(): PathStep | undefined {
    return this.pathSteps[this.pathSteps.length - 1];
  }

  get currentDepth(): number {
    return this.pathSteps.length - 1;
  }

  get depthCapReached(): boolean {
    return this.currentDepth >= this.maxDepth;
  }

  tapChip(button: MessageNodeButtonDraft) {
    if (button.nextAction === 'send_message' && button.followUp) {
      this.pathSteps = [...this.pathSteps, { node: button.followUp, tappedButtonLabel: button.label }];
      this.actionPickerButton = null;
      this.editingNode = null;
    } else {
      this.openActionPicker(button);
    }
  }

  jumpTo(index: number) {
    this.pathSteps = this.pathSteps.slice(0, index + 1);
    this.editingNode = null;
    this.actionPickerButton = null;
  }

  toggleEdit(node: MessageNodeDraft) {
    this.editingNode = this.editingNode === node ? null : node;
    this.actionPickerButton = null;
  }

  onNodeEdited() {
    this.rootChange.emit(this.root);
  }

  openActionPicker(button: MessageNodeButtonDraft) {
    this.actionPickerButton = this.actionPickerButton === button ? null : button;
    this.editingNode = null;
  }

  closeActionPicker() {
    this.actionPickerButton = null;
  }

  // Whether "Send a follow-up message" should be offered for this specific
  // button right now — always allowed if it already has one (so the merchant
  // can navigate/inspect it), otherwise gated by the depth cap.
  canOfferSendMessage(button: MessageNodeButtonDraft): boolean {
    return (button.nextAction === 'send_message' && !!button.followUp) || !this.depthCapReached;
  }

  setAction(button: MessageNodeButtonDraft, action: MessageNodeAction) {
    button.nextAction = action;
    if (action !== 'send_message') {
      button.followUp = undefined; // orphaned subtree is cascade-cleaned on save (see shared/operations.js#updateMessageNode)
    }
    this.rootChange.emit(this.root);
  }

  createFollowUp(button: MessageNodeButtonDraft) {
    button.nextAction = 'send_message';
    button.followUp = { bodyText: '', buttons: [] };
    this.pathSteps = [...this.pathSteps, { node: button.followUp, tappedButtonLabel: button.label }];
    this.actionPickerButton = null;
    this.rootChange.emit(this.root);
  }
}
