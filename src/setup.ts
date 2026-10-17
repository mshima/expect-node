/**
 * The `setupFiles` and the `mochaHooks` of the configuration (see config.ts), imported by each test process before its
 * test files, the bin giving them by the environment (see env.ts) and this module by `--import`: not by the worker
 * threads nor the subprocesses the tests start, which get the `--import` but no longer the variable, unlike the modules
 * of `import`.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ENV } from './env.ts';
import type { Hook } from './test.ts';

type MochaHooks = Partial<Record<'beforeAll' | 'afterAll' | 'beforeEach' | 'afterEach', Hook | Hook[]>>;

const setup = process.env[ENV.setup];
delete process.env[ENV.setup];
if (setup) {
  const { files, mochaHooks, cwd } = JSON.parse(setup) as { files: string[]; mochaHooks: string[]; cwd: string };
  // Imported by the test process only: node:test, imported by a subprocess the tests start, would report to its output.
  const { resolveFrom } = await import('./mocks.ts');
  const { hooksAt } = await import('./test.ts');
  for (const file of files) await import(pathToFileURL(file).href);
  // The root hook plugins of mocha: modules exporting mochaHooks, an object of hooks or a function giving one, their
  // specifiers resolved from the cwd. Their hooks are of each test file, located in their module.
  for (const specifier of mochaHooks) {
    const url = resolveFrom(specifier, cwd);
    const { mochaHooks: exported } = (await import(url)) as { mochaHooks?: MochaHooks | (() => MochaHooks | Promise<MochaHooks>) };
    // Tested (the no-hooks fixture), but a test process failing at its start writes no coverage.
    /* node:coverage ignore next */
    if (!exported) throw new Error(`${specifier} exports no mochaHooks`);
    const hooks = typeof exported === 'function' ? await exported() : exported;
    const site = { url, file: fileURLToPath(url), line: 1, column: 1 };
    for (const [name, declare] of Object.entries(hooksAt)) {
      for (const fn of [hooks[name as keyof MochaHooks] ?? []].flat()) declare(site, fn);
    }
  }
}
