/**
 * The `setupFiles` of the configuration (see config.ts), imported by each test process before its test files, the bin
 * giving them by the environment (see env.ts) and this module by `--import`: not by the worker threads nor the
 * subprocesses the tests start, which get the `--import` but no longer the variable, unlike the modules of `import`.
 */
import { pathToFileURL } from 'node:url';

import { ENV } from './env.ts';

const files = process.env[ENV.setupFiles];
delete process.env[ENV.setupFiles];
for (const file of JSON.parse(files ?? '[]') as string[]) await import(pathToFileURL(file).href);
