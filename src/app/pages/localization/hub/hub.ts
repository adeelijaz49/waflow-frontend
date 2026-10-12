import { Component, OnInit, ViewEncapsulation, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService, Lang, isLang } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { LocUiHost } from '../shared/loc-ui-host';
import { HubStateService } from './hub-state.service';

interface HubTab { path: string; labelKey: string }

// Shell for the Arabic localisation area (/arabic). It owns the page-level
// language + direction (scoped to this subtree — the rest of the app stays
// English/LTR until the gated Phase 5), the language switch, the tab bar and
// the "not switched on yet" state for merchants without arabic_enabled.
@Component({
  selector: 'app-localization-hub',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, LocUiHost, ...I18N_DIRECTIVES, ...I18N_PIPES],
  templateUrl: './hub.html',
  styleUrl: '../../../i18n/loc-shared.css',
  encapsulation: ViewEncapsulation.None,
})
export class Hub implements OnInit {
  readonly i18n = inject(I18nService);
  readonly state = inject(HubStateService);
  private readonly api = inject(LocalizationApiService);
  private readonly route = inject(ActivatedRoute);

  readonly tabs: HubTab[] = [
    { path: 'overview', labelKey: 'hub.tab.overview' },
    { path: 'customers', labelKey: 'hub.tab.customers' },
    { path: 'templates', labelKey: 'hub.tab.templates' },
    { path: 'campaigns', labelKey: 'hub.tab.campaigns' },
    { path: 'catalog', labelKey: 'hub.tab.catalog' },
    { path: 'inbox', labelKey: 'hub.tab.inbox' },
    { path: 'ai-mode', labelKey: 'hub.tab.aimode' },
    { path: 'flows', labelKey: 'hub.tab.flows' },
    { path: 'captions', labelKey: 'hub.tab.captions' },
    { path: 'review', labelKey: 'hub.tab.review' },
  ];

  // The text catalogues could not be downloaded (offline / a new version was deployed): nothing can be translated yet.
  readonly textsFailed = signal(false);

  ngOnInit(): void {
    this.start();
  }

  start(): void {
    this.textsFailed.set(false);
    // Catalogues first so nothing renders as a raw key; then the settings. An
    // explicit ?lang=ar|en in the URL wins over the remembered choice, exactly
    // like the marketing website's language switch.
    const requested = this.route.snapshot.queryParamMap.get('lang');
    void this.i18n
      .init()
      .then(() => (isLang(requested) && requested !== this.i18n.lang() ? this.i18n.use(requested) : undefined))
      .then(() => this.state.load())
      .catch(() => this.textsFailed.set(true));
  }

  // On a narrow screen the tab bar scrolls: keep the open tab visible (also after a deep link or reload).
  onTabActive(active: boolean, tab: HTMLElement): void {
    if (active) tab.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }

  // The switch shows the OTHER language in its own script (like the website).
  get otherLang(): Lang {
    return this.i18n.lang() === 'ar' ? 'en' : 'ar';
  }

  switchLanguage(): void {
    const next = this.otherLang;
    void this.i18n.use(next).then(
      () => {
        // Best effort: remember it as the user's own screen language.
        if (this.state.enabled()) this.api.updateMyPrefs({ uiLanguage: next }).subscribe({ error: () => undefined });
      },
      () => undefined, // the other language could not be downloaded: stay in the current one
    );
  }
}
