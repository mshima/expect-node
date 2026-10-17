/**
 * The `setupFiles` of the configuration (see config.ts), imported by each test process before its test files, the bin
 * giving them by `EXNODE_SETUP_FILES` and this module by `--import`: not by the worker threads nor the subprocesses the
 * tests start, which get the `--import` but no longer the variable, unlike the modules of `import`.
 */
import { pathToFileURL } from 'node:url';

const files = process.env.EXNODE_SETUP_FILES;
delete process.env.EXNODE_SETUP_FILES;
for (const file of JSON.parse(files ?? '[]') as string[]) await import(pathToFileURL(file).href);
