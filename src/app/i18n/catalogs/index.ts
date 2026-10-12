// Registry of translation catalogues. One flat JSON file per namespace and
// language: ./en/<ns>.json and ./ar/<ns>.json. Keys inside a file are bare
// ("title"); the full key used in code and templates is "<ns>.<key>".
// Arabic review status (draft / reviewed, reviewer, date) lives separately in
// ./meta/<ns>.json so it never ships in the bundle; scripts/i18n-review.mjs
// reads and writes both.
//
// Each language has ONE barrel module (./en/all.ts, ./ar/all.ts) that imports
// every namespace, so the browser downloads a single lazy chunk per language.
// Adding a namespace = add <ns>.json to en/, ar/ and meta/, plus one import line
// and one entry in each language's all.ts.
import type { CatalogMap, Lang } from '../i18n.types';

type Barrel = () => Promise<{ default: Record<string, CatalogMap> }>;

const BARRELS: Record<Lang, Barrel> = {
  en: () => import('./en/all'),
  ar: () => import('./ar/all'),
};

// Flattens { ns: { key: text } } into { "ns.key": text }.
export function flattenCatalogue(barrel: Record<string, CatalogMap>): CatalogMap {
  const flat: CatalogMap = {};
  for (const [ns, table] of Object.entries(barrel)) {
    for (const [key, value] of Object.entries(table)) flat[`${ns}.${key}`] = value;
  }
  return flat;
}

export async function loadCatalog(lang: Lang): Promise<CatalogMap> {
  try {
    const mod = await BARRELS[lang]();
    return flattenCatalogue(mod.default);
  } catch (err) {
    console.warn(`[i18n] could not load the ${lang} catalogue`, err);
    return {};
  }
}
