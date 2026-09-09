/**
 * sw-register.test.ts
 *
 * FR-UX-010 (spec §9.2, "installable PWA offline story"). offline-db.ts's
 * own header cites this ID and points to two halves: "apps/web/public/
 * manifest.json + sw.js for the install/cache half; [offline-db.ts] is
 * the client-side data layer" -- the data-layer half is already covered
 * by offline-db.test.ts/offline-sync.test.ts/SyncLedger.test.tsx. This
 * file closes the install half's testable slice: sw-register.ts, the
 * real TypeScript module that actually registers the worker and drives
 * the install prompt.
 *
 * Honest scope note, not silently glossed over: sw.js ITSELF (the worker
 * script -- fetch/cache/background-sync handling) is still not covered
 * by any test after this file. It runs in a ServiceWorkerGlobalScope
 * jsdom does not implement, and its own header states it deliberately
 * cannot import from src/ (ships as-is from public/, outside Next's
 * bundler) -- testing it for real needs either a dedicated service-worker
 * test harness or an extraction refactor to pull its logic into an
 * importable module, either of which is new test infrastructure, not a
 * same-shaped test-writing pass like this one. Flagged for a human
 * scoping decision rather than left unstated, same posture
 * analytics.e2e-spec.ts's header takes with FR-ANL-040.
 * manifest.json's own installability fields (name/icons/start_url/
 * display) are static JSON, not code with a meaningful test to write.
 *
 * Covers:
 *  - registerServiceWorker(): calls navigator.serviceWorker.register()
 *    when the API exists; is a silent no-op (never throws) when it
 *    doesn't -- spec §9.2's own documented "non-https/non-localhost"
 *    limitation, and a rejected registration promise is swallowed rather
 *    than surfaced to the user, exactly as the source comment claims.
 *  - The install-prompt flow end-to-end: captureInstallPrompt() calls
 *    preventDefault() on a real 'beforeinstallprompt' event (suppressing
 *    the browser's own default install UI) and stashes it;
 *    recordRegisterSubmission() only prompts on the SECOND call (spec
 *    §9.2: "after a teacher's second successful register submission, not
 *    on first load"), and never prompts a second time after that (asks
 *    once), even across further submissions.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureInstallPrompt, recordRegisterSubmission, registerServiceWorker } from './sw-register';

const SUBMIT_COUNT_KEY = 'pbsms.registerSubmitCount';
const INSTALL_PROMPTED_KEY = 'pbsms.installPrompted';

interface FakeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function fireBeforeInstallPrompt(): FakeInstallPromptEvent {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome: 'accepted' as const }),
  });
  window.dispatchEvent(event);
  return event;
}

function setServiceWorkerSupport(register: ReturnType<typeof vi.fn> | undefined) {
  if (register === undefined) {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    return;
  }
  Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  setServiceWorkerSupport(undefined);
});

afterEach(() => {
  localStorage.clear();
  setServiceWorkerSupport(undefined);
});

describe('registerServiceWorker()', () => {
  it('calls navigator.serviceWorker.register("/sw.js") when the API exists', () => {
    const register = vi.fn().mockResolvedValue({});
    setServiceWorkerSupport(register);

    registerServiceWorker();

    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('is a silent no-op when navigator.serviceWorker does not exist (the documented non-https/non-localhost case)', () => {
    setServiceWorkerSupport(undefined);
    expect(() => registerServiceWorker()).not.toThrow();
  });

  it('swallows a rejected registration promise rather than surfacing it', async () => {
    const register = vi.fn().mockRejectedValue(new Error('registration failed'));
    setServiceWorkerSupport(register);

    expect(() => registerServiceWorker()).not.toThrow();
    // Let the rejection's .catch() handler actually run before asserting
    // nothing propagated -- an unhandled rejection here would fail the
    // test run via Vitest's own unhandled-rejection reporting.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('install-prompt flow (spec §9.2)', () => {
  // captureInstallPrompt() adds a real window listener -- registered once
  // here, matching how ServiceWorkerInit calls it exactly once per real
  // page load, rather than once per test (which would just stack
  // harmless duplicate listeners doing the same assignment).
  beforeAll(() => {
    captureInstallPrompt();
  });

  // Deliberately first in this describe block: sw-register.ts's
  // deferredInstallPrompt is module-level, not reset between tests (no
  // reset export exists) -- this is the one test that depends on nothing
  // having been captured yet, so it must run before any test below calls
  // fireBeforeInstallPrompt(). Each later test re-captures its own event
  // regardless, so this ordering constraint doesn't spread further.
  it('does not prompt at all when no install prompt was ever captured', async () => {
    recordRegisterSubmission();
    recordRegisterSubmission();
    await Promise.resolve();
    expect(localStorage.getItem(INSTALL_PROMPTED_KEY)).not.toBe('true');
  });

  it('preventDefault()s the browser default install UI and stashes the event', () => {
    const event = fireBeforeInstallPrompt();
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not prompt on the first recordRegisterSubmission() call', () => {
    const event = fireBeforeInstallPrompt();
    recordRegisterSubmission();
    expect(event.prompt).not.toHaveBeenCalled();
    expect(localStorage.getItem(SUBMIT_COUNT_KEY)).toBe('1');
  });

  it('prompts on the second call, per spec: "after a teacher\'s second successful register submission, not on first load"', async () => {
    const event = fireBeforeInstallPrompt();
    recordRegisterSubmission();
    recordRegisterSubmission();

    // promptInstallIfEligible() is fire-and-forget from
    // recordRegisterSubmission()'s point of view -- let its microtasks run.
    await Promise.resolve();
    await Promise.resolve();

    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SUBMIT_COUNT_KEY)).toBe('2');
    expect(localStorage.getItem(INSTALL_PROMPTED_KEY)).toBe('true');
  });

  it('never prompts a second time, even across further submissions ("ask once")', async () => {
    const event = fireBeforeInstallPrompt();
    recordRegisterSubmission(); // 1
    recordRegisterSubmission(); // 2 -- prompts
    await Promise.resolve();
    await Promise.resolve();
    expect(event.prompt).toHaveBeenCalledTimes(1);

    recordRegisterSubmission(); // 3
    recordRegisterSubmission(); // 4
    await Promise.resolve();
    await Promise.resolve();

    // Still exactly once -- a 3rd/4th submission never re-prompts.
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });
});
