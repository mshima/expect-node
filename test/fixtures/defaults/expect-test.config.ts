import { defineConfig } from '../../../src/config.ts';

// No files, the default patterns of node:test; a coverage without its files nor minimum.
export default defineConfig({ coverage: {} });
