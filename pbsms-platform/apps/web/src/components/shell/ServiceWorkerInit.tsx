'use client';

import { useEffect } from 'react';
import { captureInstallPrompt, registerServiceWorker } from '@/lib/sw-register';

/**
 * Mounted once in the root layout (src/app/layout.tsx). A plain function
 * call in a server component's module scope would run at import time, not
 * "once the browser is available" — this needs to be a real client
 * component with an effect so it only runs after hydration, in the
 * browser, exactly once per page load.
 */
export function ServiceWorkerInit() {
  useEffect(() => {
    registerServiceWorker();
    captureInstallPrompt();
  }, []);

  return null;
}
