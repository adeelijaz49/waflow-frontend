// Constants of the onboarding flow: the frontend kill switch, URL allow-lists and external links.
// Dependency-free on purpose (it is part of the main chunk).
import { InjectionToken } from '@angular/core';

// Frontend kill switch (OD12). `false` = no request, no mount, every guard answers "not mine" without a request.
// The backend flag ONBOARDING_FLOW is the real master switch.
export const ONB_UI_ENABLED = true;
// The guards and the shell mount read the switch through this token (default = the constant), so a test can flip it.
export const ONB_UI_ENABLED_TOKEN = new InjectionToken<boolean>('ONB_UI_ENABLED', { providedIn: 'root', factory: () => ONB_UI_ENABLED });

// Pages that send WhatsApp messages: the strip shows the "Sending is paused" banner on these (DF 2.3 row 5). Every page here has a
// send action the server refuses while sending is paused (ai-mode: confirm-action, arabic: send, customers: consent requests).
// This list is independent of LOCK_ALLOW below: a page can be a send route and still be veiled while the app is locked.
export const SEND_ROUTES: readonly string[] = [
  '/promotions', '/flows', '/referrals', '/inbox', '/instagram-promotions', '/ai-mode', '/arabic', '/customers',
] as const;

// First path segments that stay usable while the rest of the app is locked (DF 2.3).
export const LOCK_ALLOW: readonly string[] = [
  '/dashboard', '/setup', '/onboarding', '/support', '/legal', '/legal-acceptance', '/login', '/auth',
] as const;

/** Path of a router URL without query string or fragment. */
export function pathOf(url: string | null | undefined): string {
  return String(url ?? '').split(/[?#]/)[0] || '/';
}

function segmentMatch(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + '/');
}

/** True when the page may stay interactive while the app is locked (first path segment match). */
export function isLockAllowed(url: string | null | undefined): boolean {
  const path = pathOf(url);
  return LOCK_ALLOW.some((p) => segmentMatch(path, p));
}

/** True when the URL is one of the pages that send messages. */
export function isSendRoute(url: string | null | undefined): boolean {
  const path = pathOf(url);
  return SEND_ROUTES.some((p) => segmentMatch(path, p));
}

/** True for any URL under /setup. */
export function isSetupUrl(url: string | null | undefined): boolean {
  return segmentMatch(pathOf(url), '/setup');
}

// External links. UNVERIFIED constants (OD9): the owner confirms or replaces them. The Step 4 links come from the
// backend (`links{...}` on every approvals row, which always wins); these are only used where the backend gives none.
export const ONB_EXTERNAL_LINKS = {
  // UNVERIFIED (LOW): Facebook account creation page.
  facebookSignup: 'https://www.facebook.com/r.php',
  // UNVERIFIED (LOW): Meta Business Suite security centre (same default as the backend META_SECURITY_CENTER_URL).
  metaSecurityCenter: 'https://business.facebook.com/settings/security',
  // UNVERIFIED (LOW): WhatsApp Manager. ONE URL for both sides: this is the backend default META_WHATSAPP_MANAGER_URL
  // (waflow-backend shared/onboarding/metaConfig.js), so the page and the server never disagree.
  whatsappManager: 'https://business.facebook.com/wa/manage/home/',
} as const;

/** Regulator website shown in the "I need a number" tips. UNVERIFIED deep link (OD9): the home page of Saudi Arabia's telecom regulator. */
export const SAUDI_TELECOM_GUIDANCE_URL = 'https://www.cst.gov.sa';

/**
 * The ONE allow-list of places the billing screen may send the browser to (Stripe Checkout and the Stripe billing portal). An
 * entry is an exact https ORIGIN (scheme + host, no port, no path): any other host, a look-alike host, another port, http and the
 * app's own origin are refused by safeExternalUrl. Extend this list (and only this list) if Stripe-hosted pages ever move.
 */
export const ONB_BILLING_REDIRECT_ORIGINS: readonly string[] = ['https://checkout.stripe.com', 'https://billing.stripe.com'] as const;
