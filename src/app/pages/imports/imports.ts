import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';

interface FieldConfig {
  key: string;
  label: string;
  required: boolean;
  type: string;
}

const ENTITY_LABELS: Record<string, string> = {
  customer: 'Customers',
  product: 'Products',
  service: 'Services',
};

@Component({
  selector: 'app-imports',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './imports.html',
  styleUrl: './imports.css',
})
export class Imports implements OnInit {
  step = 1; // 1 Upload, 2 Mapping, 3 Preview & Validate, 4 Results
  entityType = 'customer';

  // Step 1
  file: File | null = null;
  uploading = false;

  // Step 2
  jobId: string | null = null;
  headers: string[] = [];
  fields: FieldConfig[] = [];
  columnMapping: Record<string, string> = {};
  mapping = false;

  // Step 3
  summary: { totalRows: number; clean: number; duplicate: number; error: number; discrepancy: number } | null = null;
  preview: { clean: any[]; duplicate: any[]; error: any[] } = { clean: [], duplicate: [], error: [] };
  discrepancies: any[] = [];
  discrepancyChoice: Record<number, 'apply' | 'skip'> = {};
  running = false;

  // Step 4
  results: { importedCount: number; skippedDuplicateCount: number; failedCount: number; totalRows: number } | null = null;

  error: string | null = null;

  constructor(private api: ApiService, private route: ActivatedRoute) {}

  ngOnInit() {
    this.entityType = this.route.snapshot.queryParamMap.get('entityType') || 'customer';
  }

  get entityLabel(): string {
    return ENTITY_LABELS[this.entityType] || 'Records';
  }

  // ── Step 1 ─────────────────────────────────────────────────────────────
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.file = input.files?.[0] || null;
  }

  upload() {
    if (!this.file || this.uploading) return;
    this.uploading = true;
    this.error = null;
    this.api.uploadImport(this.entityType, this.file).subscribe({
      next: (res) => {
        this.uploading = false;
        this.jobId = res.id;
        this.headers = res.headers;
        this.fields = res.fields;
        this.columnMapping = res.columnMapping;
        this.step = 2;
      },
      error: (err) => { this.uploading = false; this.error = err.error?.error || 'Upload failed — please try again.'; },
    });
  }

  downloadSampleTemplate() {
    this.api.downloadImportSampleTemplate(this.entityType).subscribe(blob => {
      this.downloadBlob(blob, `${this.entityType}-import-template.csv`);
    });
  }

  // ── Step 2 ─────────────────────────────────────────────────────────────
  get unmappedRequiredFields(): FieldConfig[] {
    return this.fields.filter(f => f.required && !this.columnMapping[f.key]);
  }

  confirmMapping() {
    if (!this.jobId || this.mapping || this.unmappedRequiredFields.length) return;
    this.mapping = true;
    this.error = null;
    this.api.updateImportMapping(this.jobId, this.columnMapping).subscribe({
      next: (res) => {
        this.mapping = false;
        this.summary = res.summary;
        this.preview = res.preview;
        this.discrepancies = res.discrepancies;
        this.discrepancyChoice = {};
        for (const d of res.discrepancies) this.discrepancyChoice[d.rowIndex] = 'skip';
        this.step = 3;
      },
      error: (err) => { this.mapping = false; this.error = err.error?.error || 'Something went wrong — please try again.'; },
    });
  }

  backToUpload() {
    this.step = 1;
    this.file = null;
    this.jobId = null;
  }

  // ── Step 3 ─────────────────────────────────────────────────────────────
  runImport() {
    if (!this.jobId || this.running) return;
    this.running = true;
    this.error = null;
    const discrepancyResolutions = this.discrepancies.map(d => ({ rowIndex: d.rowIndex, action: this.discrepancyChoice[d.rowIndex] || 'skip' }));
    this.api.runImport(this.jobId, discrepancyResolutions).subscribe({
      next: (res) => {
        this.running = false;
        this.results = res;
        this.step = 4;
      },
      error: (err) => { this.running = false; this.error = err.error?.error || 'Import failed — please try again.'; },
    });
  }

  // ── Step 4 ─────────────────────────────────────────────────────────────
  downloadErrorReport() {
    if (!this.jobId) return;
    this.api.downloadImportErrorReport(this.jobId).subscribe(blob => {
      this.downloadBlob(blob, 'import-errors.csv');
    });
  }

  startAnother() {
    this.step = 1;
    this.file = null;
    this.jobId = null;
    this.headers = [];
    this.fields = [];
    this.columnMapping = {};
    this.summary = null;
    this.preview = { clean: [], duplicate: [], error: [] };
    this.discrepancies = [];
    this.discrepancyChoice = {};
    this.results = null;
    this.error = null;
  }

  private downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
