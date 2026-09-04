import { Component, HostListener } from '@angular/core';
import { DialogService } from '../dialog.service';

@Component({
  selector: 'app-dialog',
  imports: [],
  templateUrl: './dialog.html',
  styleUrl: './dialog.css',
})
export class Dialog {
  constructor(public dialogService: DialogService) {}

  respond(result: boolean) {
    this.dialogService.respond(result);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.dialogService.state) this.respond(false);
  }
}
