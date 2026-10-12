import { HttpClient } from '@angular/common/http';
import { Injectable, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { errorStatus } from '../shared/loc-errors';
import type { FlowTreeItem, OwnerTree, OwnerType } from './flow-language.util';

// The flow-tree endpoints belong to the flows work package: when LocalizationApiService exposes them they are
// used; otherwise this store calls the same two read-only URLs itself, so the existing screens work either way.
interface FlowTreeApi {
  listFlowTrees?(): Observable<{ items: FlowTreeItem[] }>;
  getFlowOwnerTree?(ownerType: OwnerType, ownerId: string): Observable<OwnerTree>;
}
const TREE_API = `${environment.apiBaseUrl}/api/localization/flows`;

export type LoadState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
export interface OwnerTreeState { state: LoadState; tree: OwnerTree | null }
export interface AllTreesState { state: LoadState; items: FlowTreeItem[] }
export type PreviewMode = 'en' | 'ar' | 'both';

const TOKEN_KEY = 'waflow_auth_token';
const readToken = (): string | null => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};

// Read-only cache of the per-language flow trees used by the existing Promotions and Flows screens.
//  * 402 / 404 => 'unavailable' (the screen renders nothing extra, never an error on an existing screen);
//    any other failure => 'error' (the panel offers a retry; strips and chips render nothing).
//  * ONE shared preview-language toggle (English / Arabic / Both) read by the panel, strips and chips.
//  * Answers are dropped when the logged-in token changed (another workspace must never see them).
@Injectable({ providedIn: 'root' })
export class FlowLanguageStore {
  private readonly api = inject(LocalizationApiService) as unknown as FlowTreeApi;
  private readonly http = inject(HttpClient, { optional: true });

  readonly previewMode = signal<PreviewMode>('both');

  private readonly owners = new Map<string, WritableSignal<OwnerTreeState>>();
  private readonly ownerSeq = new Map<string, number>();
  private readonly allState = signal<AllTreesState>({ state: 'idle', items: [] });
  private allSeq = 0;
  private token: string | null | undefined = undefined;

  readonly all: Signal<AllTreesState> = this.allState.asReadonly();

  private key(type: OwnerType, id: string): string { return `${type}:${id}`; }

  private guardToken(): void {
    const now = readToken();
    if (this.token === undefined) { this.token = now; return; }
    if (now === this.token) return;
    this.token = now;
    for (const [k, s] of this.owners) { s.set({ state: 'idle', tree: null }); this.ownerSeq.set(k, (this.ownerSeq.get(k) ?? 0) + 1); }
    this.allSeq += 1;
    this.allState.set({ state: 'idle', items: [] });
  }

  // Reading never writes a signal, so it is safe inside computed() and templates.
  ownerTree(type: OwnerType, id: string): Signal<OwnerTreeState> {
    const k = this.key(type, id);
    let s = this.owners.get(k);
    if (!s) { s = signal<OwnerTreeState>({ state: 'idle', tree: null }); this.owners.set(k, s); }
    return s.asReadonly();
  }

  ensureOwner(type: OwnerType, id: string): void {
    this.guardToken();
    if (this.ownerTree(type, id)().state === 'idle') this.reloadOwner(type, id);
  }

  reloadOwner(type: OwnerType, id: string): void {
    this.guardToken();
    const k = this.key(type, id);
    this.ownerTree(type, id);
    const s = this.owners.get(k)!;
    const mine = (this.ownerSeq.get(k) ?? 0) + 1;
    this.ownerSeq.set(k, mine);
    s.update((cur) => ({ state: 'loading', tree: cur.tree })); // keep the old tree on screen while refreshing
    this.fetchOwner(type, id).subscribe({
      next: (tree) => { if (this.ownerSeq.get(k) === mine) s.set({ state: 'ready', tree }); },
      error: (err: unknown) => {
        if (this.ownerSeq.get(k) !== mine) return;
        const status = errorStatus(err);
        s.set({ state: status === 402 || status === 404 ? 'unavailable' : 'error', tree: null });
      },
    });
  }

  ensureAll(): void {
    this.guardToken();
    if (this.allState().state === 'idle') this.reloadAll();
  }

  reloadAll(): void {
    this.guardToken();
    const mine = ++this.allSeq;
    this.allState.update((cur) => ({ state: 'loading', items: cur.items }));
    this.fetchAll().subscribe({
      next: (res) => { if (mine === this.allSeq) this.allState.set({ state: 'ready', items: res?.items ?? [] }); },
      error: (err: unknown) => {
        if (mine !== this.allSeq) return;
        const status = errorStatus(err);
        this.allState.set({ state: status === 402 || status === 404 ? 'unavailable' : 'error', items: [] });
      },
    });
  }

  private fetchOwner(type: OwnerType, id: string): Observable<OwnerTree> {
    if (typeof this.api.getFlowOwnerTree === 'function') return this.api.getFlowOwnerTree(type, id);
    if (!this.http) return throwError(() => ({ status: 404 }));
    return this.http.get<OwnerTree>(`${TREE_API}/owners/${encodeURIComponent(type)}/${encodeURIComponent(id)}/tree`);
  }

  private fetchAll(): Observable<{ items: FlowTreeItem[] }> {
    if (typeof this.api.listFlowTrees === 'function') return this.api.listFlowTrees();
    if (!this.http) return throwError(() => ({ status: 404 }));
    return this.http.get<{ items: FlowTreeItem[] }>(`${TREE_API}/tree`);
  }

  // The row of one flow in the all-flows listing (null until loaded or when the flow is not in it).
  flowRow(flowId: string): Signal<FlowTreeItem | null> {
    return computed(() => this.allState().items.find((f) => f.flowId === flowId) ?? null);
  }
}
