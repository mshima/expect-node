import { defineConfig } from './src/config.ts';

export default defineConfig({
  files: ['test/**/*.test.ts'],
  coverage: { include: ['src/**/*.ts'], lines: 100, functions: 100 },
});
