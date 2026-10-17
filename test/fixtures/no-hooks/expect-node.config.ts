import { defineConfig } from '../../../src/config.ts';

export default defineConfig({ files: ['*.check.ts'], mochaHooks: ['./none.mjs'] });
