import { defineConfig } from '../../../src/config.ts';

export default defineConfig({
  files: ['*.check.ts'],
  import: ['setup.ts'],
  timeout: 10_000,
  concurrency: 2,
  setup: () => {
    process.env.EXPECT_NODE_SETUP = 'from the runner';
  },
  coverage: { include: ['*.ts'], exclude: ['*.check.ts'], lines: 100, branches: 100, functions: 100 },
});
