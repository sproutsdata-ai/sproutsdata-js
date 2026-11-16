import { defineConfig } from 'vitest/config';

// The live suite: this adapter against the local stack sproutsdata-py runs (`make e2e-up`).
// Each test skips when the stack has not been seeded. Part of every regression (`npm run e2e`).
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
