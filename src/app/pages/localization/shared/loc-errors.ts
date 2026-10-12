import { I18nService } from '../../../i18n';

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

export function errorText(i18n: I18nService, err: unknown, fallbackKey = 'errors.generic'): string {
  const code = errorCode(err);
  if (code && i18n.has(`errors.${code}`)) return i18n.t(`errors.${code}`);
  const status = errorStatus(err);
  if (status === 0) return i18n.t('errors.network');
  if (status === 403) return i18n.t('errors.forbidden');
  if (status === 404) return i18n.t('errors.notFound');
  if (status === 413) return i18n.t('errors.tooLarge');
  if (status === 429) return i18n.t('errors.rateLimited');
  console.warn('[localization] request failed', err);
  return i18n.t(fallbackKey);
}
