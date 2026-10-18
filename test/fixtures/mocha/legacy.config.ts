import { defineConfig } from '../../../src/config.ts';

// The compatibility mocha by its former option.
export default defineConfig({ files: ['legacy.spec.ts'], mocha: true });
