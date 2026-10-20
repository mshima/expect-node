import { defineConfig } from '../../../src/config.ts';

export default defineConfig({
  files: ['*.check.ts'],
  workers: true,
  setupFiles: ['setup.ts'],
  mochaHooks: ['pool-hooks/hooks', './hooks.mjs'],
  durations: true,
  // The test files one after the other without workers, in the order of their durations.
  concurrency: 1,
});
