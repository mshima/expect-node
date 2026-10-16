import { defineConfig } from './src/config.ts';

export default defineConfig({
  // The tests of the package, not the ones of its fixtures.
  files: ['test/*.test.ts'],
  coverage: { include: ['src/**/*.ts'], lines: 100, branches: 100, functions: 100 },
});
