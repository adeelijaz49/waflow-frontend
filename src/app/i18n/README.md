# i18n foundation (Arabic localisation, Phase 0)

Everything the Arabic pages (`/arabic`, `src/app/pages/localization/**`) need to show text, numbers, dates and
directions correctly. The rest of the app is still English-only; the fully right-to-left dashboard is **Phase 5
and is deliberately not built** — but everything new is language-ready.

## Using it

```html
<h1>{{ 'templates.title' | t }}</h1>
<p>{{ 'campaigns.willReceive' | tp: count : { language: 'Arabic' } }}</p>   <!-- plural-aware -->
<span appUserText>{{ customer.name }}</span>          <!-- dir="auto": names, messages, product names -->
<span appPhone>{{ customer.phone }}</span>            <!-- always left-to-right -->
<div [appLangDir]="'ar'">…</div>                      <!-- lang + dir on any element (e.g. a customer-language preview) -->
{{ amount | locCurrency }} · {{ n | locNumber }} · {{ date | locDate }}   <!-- Western digits, Gregorian, SAR -->
```

In TypeScript: `inject(I18nService).t('errors.generic')`. Never write user-facing words in a template or component —
`scripts/check-i18n.mjs` (run by `npm run build` through `prebuild`) fails the build for the folders listed in
`scripts/i18n-check.config.json`. Escape hatch for genuinely non-translatable literals: `<!-- i18n-ignore -->`
right before the text node, or `// i18n-ignore` at the end of a TypeScript line.

## Catalogues

`catalogs/<lang>/<namespace>.json` — flat `"key": "text"` objects; the key used in code is `<namespace>.<key>`.
`en` is the default and the fallback for any missing Arabic string. Plural forms use CLDR suffixes
(`_zero|_one|_two|_few|_many|_other`; Arabic uses all six) selected by `Intl.PluralRules`.
`{placeholders}` are filled by `t(key, {name})`; Latin text or numbers placed inside Arabic text are wrapped in a
directional isolate automatically so "50 SAR" and brand names never reorder.

Adding a namespace: create `en/<ns>.json`, `ar/<ns>.json`, `meta/<ns>.json` (`{}`) and add one line in each loader
map in `catalogs/index.ts`.

## Native review (spec §8)

Every Arabic string starts as **draft**. Review state lives beside the text in `catalogs/meta/<ns>.json`
(`{ "<key>": { "status": "reviewed", "reviewer": "Name", "reviewedAt": "2026-10-20" } }`, keys that are absent
are drafts; `"needsLegalApproval": true` flags consent/AI-notice wording that also needs the lawyer).
`node scripts/i18n-review.mjs export --out review.csv` writes `key,english,arabic,status,reviewer,reviewed_at,…`
for a spreadsheet; `import --in review.csv [--dry-run]` applies it back (changed text never becomes "reviewed"
unless the reviewer says so and gives their name). `summary --write` refreshes `review-summary.json`, which the
Review tab reads. Machine/AI text may only ever be saved as draft.

## Conventions

- Locale for formatting: `ar-SA-u-nu-latn-ca-gregory` (Western digits, Gregorian calendar), `en-GB` for English.
- Currency: `SAR 150.00` in English, `150.00 ر.س` in Arabic.
- Phone numbers are always left-to-right, user-entered text is `dir="auto"`, and all CSS in new code uses logical
  properties (`margin-inline-start`, `text-align: start` …) — no physical left/right.
- Arabic terminology follows the marketing website's glossary; tanween is written `اً` (مرحباً).
