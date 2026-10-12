import { I18nService, Lang } from '../../../i18n';

// Turns a failed API call into a localised sentence for the user. Server error
// messages are English, so they are never shown when the error carries a `code`
// we have a catalogue entry for (errors.<code>); everything else falls back to a
// generic localised message and the raw detail goes to the console only.
export function errorCode(err: unknown): string | undefined {
  const code = (err as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' ? code : undefined;
}

export function errorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

// 402 + ARABIC_NOT_ENABLED = the merchant has not been switched on yet.
export function isNotEnabled(err: unknown): boolean {
  return errorStatus(err) === 402 && errorCode(err) === 'ARABIC_NOT_ENABLED';
}

// `lang` (optional) forces the language of the sentence; the default is the active UI language.
export function errorText(i18n: I18nService, err: unknown, fallbackKey = 'errors.generic', lang?: Lang): string {
  const code = errorCode(err);
  if (code && i18n.has(`errors.${code}`, lang)) return i18n.t(`errors.${code}`, undefined, lang);
  const status = errorStatus(err);
  if (status === 0) return i18n.t('errors.network', undefined, lang);
  if (status === 403) return i18n.t('errors.forbidden', undefined, lang);
  if (status === 404) return i18n.t('errors.notFound', undefined, lang);
  if (status === 413) return i18n.t('errors.tooLarge', undefined, lang);
  if (status === 429) return i18n.t('errors.rateLimited', undefined, lang);
  console.warn('[localization] request failed', err);
  return i18n.t(fallbackKey, undefined, lang);
}
