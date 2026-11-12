import { defineConfig } from 'vitest/config';

// Live tests against the real account, on lab reports only: npm run test:live
export default defineConfig({
  test: { include: ['tests/live/**/*.live.ts'], testTimeout: 600_000, hookTimeout: 120_000, fileParallelism: false, silent: false },
});
