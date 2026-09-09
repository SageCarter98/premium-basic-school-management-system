import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';

// globals: false in vitest.config.mts means @testing-library/react's own
// automatic cleanup (which hooks into a global afterEach) never registers
// -- every previously-rendered component's DOM stayed mounted into the
// next test, first surfaced by SyncLedger.test.tsx (the first suite to
// actually render a component, rather than exercise a lib module
// directly). Registered explicitly here so every future component test
// gets a clean document between cases without repeating this per file.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
