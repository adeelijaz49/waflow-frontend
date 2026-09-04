import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';
import { SettingsService } from '../../shared/settings.service';
import { StatusBadgePipe } from '../../shared/status-badge.pipe';
import { ImageCarousel } from '../../shared/image-carousel/image-carousel';
import { DialogService } from '../../shared/dialog.service';

@Component({
  selector: 'app-services',
  imports: [CommonModule, FormsModule, RouterLink, AppCurrencyPipe, StatusBadgePipe, ImageCarousel],
  templateUrl: './services.html',
  styleUrl: './services.css',
})
export class Services implements OnInit {
  services: any[] = [];
  loading = false;

  activeService: any = null;
  activeTab: 'slots' | 'bookings' | 'requests' = 'slots';
  slots: any[] = [];
  bookings: any[] = [];
  loadingDetail = false;

  // Service modal
  showServiceModal = false;
  editingServiceId: string | null = null;
  savingService = false;
  serviceForm: any = this.emptyServiceForm();

  // Slot modal
  showSlotModal = false;
  editingSlotId: string | null = null;
  savingSlot = false;
  slotForm: any = this.emptySlotForm();

  // Reschedule modal
  showRescheduleModal: string | null = null; // bookingId being rescheduled
  selectedNewSlotId = '';
  rescheduling = false;

  constructor(private api: ApiService, private settings: SettingsService, private dialog: DialogService) {}

  get currencyCode(): string {
    return this.settings.currencySnapshot;
  }

  ngOnInit() { this.loadServices(); }

  emptyServiceForm() {
    return { name: '', description: '', category: '', duration: 60, basePrice: 0, pointsPrice: 0, images: '' };
  }

  emptySlotForm() {
    return { date: '', startTime: '', endTime: '', capacity: 1 };
  }

  loadServices() {
    this.loading = true;
    this.api.getServices().subscribe({
      next: (s) => { this.services = s; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  selectService(s: any) {
    this.activeService = s;
    this.activeTab = 'slots';
    this.loadDetail();
  }

  openTab(s: any, tab: 'slots' | 'bookings' | 'requests') {
    this.activeService = s;
    this.activeTab = tab;
    this.loadDetail();
  }

  get pendingRequests(): any[] {
    return this.bookings.filter(b => b.status === 'requested');
  }

  loadDetail() {
    this.loadingDetail = true;
    this.slots = [];
    this.bookings = [];
    this.api.getService(this.activeService._id).subscribe({
      next: (res) => {
        this.slots    = res.slots;
        this.bookings = res.bookings;
        this.loadingDetail = false;
      },
      error: () => { this.loadingDetail = false; },
    });
  }

  // ── Service CRUD ───────────────────────────────────────────────────────────
  openAddService() {
    this.editingServiceId = null;
    this.serviceForm = this.emptyServiceForm();
    this.showServiceModal = true;
  }

  openEditService(s: any, event: Event) {
    event.stopPropagation();
    this.editingServiceId = s._id;
    this.serviceForm = {
      name: s.name, description: s.description || '', category: s.category || '',
      duration: s.duration || 60, basePrice: s.basePrice || 0, pointsPrice: s.pointsPrice || 0,
      images: s.images?.join(', ') || '',
    };
    this.showServiceModal = true;
  }

  // The comma-separated string is the single source of truth for
  // serviceForm.images (matches the existing manual-paste field) — uploads
  // and removals both just rewrite that string, so the two entry methods
  // never fight each other.
  get serviceFormImagesList(): string[] {
    return this.serviceForm.images ? this.serviceForm.images.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
  }

  uploadingImage = false;
  uploadImage(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.uploadingImage = true;
    this.api.uploadImage(file).subscribe({
      next: (res) => {
        const list = this.serviceFormImagesList;
        list.push(res.url);
        this.serviceForm.images = list.join(', ');
        this.uploadingImage = false;
      },
      error: () => { this.uploadingImage = false; },
    });
    (event.target as HTMLInputElement).value = '';
  }

  removeImage(index: number) {
    const list = this.serviceFormImagesList;
    list.splice(index, 1);
    this.serviceForm.images = list.join(', ');
  }

  saveService() {
    this.savingService = true;
    const payload = {
      ...this.serviceForm,
      duration:    +this.serviceForm.duration,
      basePrice:   +this.serviceForm.basePrice,
      pointsPrice: +this.serviceForm.pointsPrice,
      images: this.serviceForm.images ? this.serviceForm.images.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
    };
    const req = this.editingServiceId
      ? this.api.updateService(this.editingServiceId, payload)
      : this.api.createService(payload);
    req.subscribe({
      next: () => { this.showServiceModal = false; this.savingService = false; this.loadServices(); },
      error: (err) => { this.savingService = false; this.dialog.error(err.error?.error || 'Could not save this service — please try again.'); },
    });
  }

  async deleteService(s: any, event: Event) {
    event.stopPropagation();
    const ok = await this.dialog.confirm(`Remove "${s.name}"?`, { title: 'Remove service', confirmLabel: 'Remove', type: 'warning' });
    if (!ok) return;
    this.api.deleteService(s._id).subscribe({
      next: () => {
        this.loadServices();
        if (this.activeService?._id === s._id) this.activeService = null;
      },
      error: (err) => this.dialog.error(err.error?.error || 'Could not remove this service — please try again.'),
    });
  }

  // ── Slot CRUD ──────────────────────────────────────────────────────────────
  openAddSlot() {
    this.editingSlotId = null;
    this.slotForm = this.emptySlotForm();
    this.showSlotModal = true;
  }

  openEditSlot(slot: any) {
    this.editingSlotId = slot._id;
    this.slotForm = { date: slot.date, startTime: slot.startTime, endTime: slot.endTime, capacity: slot.capacity };
    this.showSlotModal = true;
  }

  saveSlot() {
    this.savingSlot = true;
    const payload = { ...this.slotForm, capacity: +this.slotForm.capacity };
    const req = this.editingSlotId
      ? this.api.updateSlot(this.activeService._id, this.editingSlotId, payload)
      : this.api.createSlot(this.activeService._id, payload);
    req.subscribe({
      next: () => { this.showSlotModal = false; this.savingSlot = false; this.loadDetail(); },
      error: (err) => { this.savingSlot = false; this.dialog.error(err.error?.error || 'Could not save this time slot — please try again.'); },
    });
  }

  async deleteSlot(slotId: string) {
    const ok = await this.dialog.confirm('Delete this time slot?', { title: 'Delete time slot', confirmLabel: 'Delete', type: 'error' });
    if (!ok) return;
    this.api.deleteSlot(this.activeService._id, slotId).subscribe({
      next: () => this.loadDetail(),
      error: (err) => this.dialog.error(err.error?.error || 'Could not delete this time slot — please try again.'),
    });
  }

  // ── Bookings ───────────────────────────────────────────────────────────────
  async cancelBooking(bookingId: string) {
    const ok = await this.dialog.confirm('Cancel this booking? A WhatsApp message will be sent to the customer offering to rebook.', {
      title: 'Cancel booking', confirmLabel: 'Cancel booking', type: 'warning',
    });
    if (!ok) return;
    this.api.cancelBooking(bookingId).subscribe({
      next: () => this.loadDetail(),
      error: (err) => this.dialog.error(err.error?.error || 'Could not cancel this booking — please try again.'),
    });
  }

  openReschedule(bookingId: string) {
    this.showRescheduleModal = bookingId;
    this.selectedNewSlotId = '';
  }

  confirmReschedule() {
    if (!this.selectedNewSlotId || !this.showRescheduleModal) return;
    this.rescheduling = true;
    this.api.rescheduleBooking(this.showRescheduleModal, this.selectedNewSlotId).subscribe({
      next: () => { this.showRescheduleModal = null; this.rescheduling = false; this.loadDetail(); },
      error: (err) => { this.rescheduling = false; this.dialog.error(err.error?.error || 'Could not reschedule this booking — please try again.'); },
    });
  }

  completeBooking(bookingId: string) {
    this.api.completeBooking(bookingId).subscribe({
      next: () => this.loadDetail(),
      error: (err) => this.dialog.error(err.error?.error || 'Could not complete this booking — please try again.'),
    });
  }

  confirmRequest(bookingId: string) {
    this.api.confirmBookingRequest(bookingId).subscribe({
      next: () => this.loadDetail(),
      error: (err) => this.dialog.error(err.error?.error || 'Could not confirm this request — please try again.'),
    });
  }

  async declineRequest(bookingId: string) {
    const ok = await this.dialog.confirm('Decline this reservation request? The slot will be freed and the customer notified.', {
      title: 'Decline request', confirmLabel: 'Decline', type: 'warning',
    });
    if (!ok) return;
    this.api.declineBookingRequest(bookingId).subscribe({
      next: () => this.loadDetail(),
      error: (err) => this.dialog.error(err.error?.error || 'Could not decline this request — please try again.'),
    });
  }

  async markNoShow(bookingId: string) {
    const ok = await this.dialog.confirm('Mark this booking as a no-show?', { title: 'Mark as no-show', confirmLabel: 'Mark no-show', type: 'warning' });
    if (!ok) return;
    this.api.markNoShow(bookingId).subscribe({
      next: () => this.loadDetail(),
      error: (err) => this.dialog.error(err.error?.error || 'Could not mark this booking as a no-show — please try again.'),
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  availableSlots(): any[] {
    return this.slots.filter(s => s.bookedCount < s.capacity && s.date >= new Date().toISOString().slice(0, 10));
  }

  slotLabel(slotId: string): string {
    const s = this.slots.find(sl => sl._id === slotId);
    return s ? `${s.date} · ${s.startTime}–${s.endTime}` : slotId;
  }

  paymentBadge(type: string): string {
    const map: any = { cash: '💰 Cash', points: '💎 Points', free: '🔄 Free', pay_later: '🕓 Pay Later' };
    return map[type] ?? type;
  }

  spotsLeft(slot: any): number { return slot.capacity - slot.bookedCount; }
}
