import { defineConfig } from '../../../src/config.ts';

export default defineConfig({
  files: ['keep.check.ts'],
  coverage: { include: ['lib.ts', 'dep.ts'], exclude: ['*.check.ts'], lines: 100, branches: 100, functions: 100 },
});
