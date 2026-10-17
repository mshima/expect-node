import { defineConfig } from '../../../src/config.ts';

export default defineConfig({ files: ['*.check.ts'], workers: true, setupFiles: ['setup.ts'] });
