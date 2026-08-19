/**
 * sw-register.ts — registers public/sw.js and manages the PWA install
 * prompt (spec §9.2). Kept separate from the service worker itself: this
 * runs in the page (a normal ES module, real TypeScript, can import
 * anything), sw.js runs in the worker thread and can't.
 */

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

// Not yet in TypeScript's lib.dom.d.ts.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const SUBMIT_COUNT_KEY = 'pbsms.registerSubmitCount';
const INSTALL_PROMPTED_KEY = 'pbsms.installPrompted';

export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Registration can fail for reasons outside app control (non-https,
    // non-localhost origin — spec §9.2's own documented limitation).
    // Nothing to surface to the user; the app works without it, just
    // without offline/install support.
  });
}

export function captureInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
  });
}

/**
 * Spec §9.2: "surfaced as an in-app 'Install PBSMS' action after a
 * teacher's second successful register submission, not on first load."
 * Called by the register screen after each submission that actually
 * reached the server or the offline queue successfully.
 */
export function recordRegisterSubmission(): void {
  if (typeof window === 'undefined') return;
  const count = Number(localStorage.getItem(SUBMIT_COUNT_KEY) ?? '0') + 1;
  localStorage.setItem(SUBMIT_COUNT_KEY, String(count));
  if (count >= 2) promptInstallIfEligible();
}

async function promptInstallIfEligible(): Promise<void> {
  if (!deferredInstallPrompt) return;
  if (localStorage.getItem(INSTALL_PROMPTED_KEY) === 'true') return; // ask once, not on every submission after the 2nd
  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  localStorage.setItem(INSTALL_PROMPTED_KEY, 'true');
  await prompt.prompt();
  await prompt.userChoice;
}
