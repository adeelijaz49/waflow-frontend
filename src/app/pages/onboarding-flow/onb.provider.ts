import { EnvironmentProviders, inject, provideAppInitializer } from '@angular/core';
import { OnbShellMount } from './shell/onb-shell-mount';

// The ONLY symbol app.config.ts imports. The initializer returns void (it never delays bootstrap) and swallows errors:
// the onboarding flow is optional and must never break the app.
export function provideOnboardingFlow(): EnvironmentProviders {
  return provideAppInitializer(() => {
    try {
      inject(OnbShellMount).start();
    } catch {
      /* the onboarding flow is optional: never block the app */
    }
  });
}
