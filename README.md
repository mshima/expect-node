# expect-test

node:test with the expect and mock API of Jest and Vitest. The runner, the timeouts and the coverage are node's: the
coverage of the code a test runs in a subprocess or a worker thread counts too, and TypeScript runs as node strips it,
without a transform between the tests and the code. The assertions are the `expect` of Jest, the mock functions
`jest-mock`.

```ts
import { beforeAll, describe, expect, it, mocks } from 'expect-test';

describe('a module', () => {
  it('works', () => {
    expect({ a: 1, b: [1, 2] }).toMatchObject({ b: expect.arrayContaining([2]) });
  });
});
```

## The API

- `describe`, `it`, with `.each(table)` (its name with `%s`, `%d`, `%i`, `%j`, `%o`), `.skipIf(condition)`,
  `.runIf(condition)`, `.only` and `.skip`; the options before the function (`{ timeout }`), or the timeout after it.
  The function of a test gets a context whose `skip()` ends it skipped.
- `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, a timeout after the function.
- `expect`: the one of Jest, with a message after the value like Vitest (`expect(value, 'the value').toBe(1)`).
- `mocks`:
  - `fn`, `spyOn`, `restoreAllMocks`: jest-mock.
  - `await mocks.mock(specifier, exports | importOriginal => exports)`: mocks a module for the imports after it, a
    relative specifier from the calling file. Its exports are given over the ones of the module, so the modules
    importing other names of it still link. Unlike `vi.mock`, it is not hoisted: import the module under test after
    it, with `await import(...)`. The mocks are in-thread hooks (`module.registerHooks`): the module mocks of node run
    off-thread hooks, whose thread records a coverage of zero for the module mocked, which node merges over the one of
    the tests (nodejs/node#65946).
  - `stubEnv(name, value)` (undefined deletes it), `stubGlobal(name, value)`: given back after each test
    (`unstubAllEnvs`, `unstubAllGlobals`).

## The bin

`extest [--coverage] [--config <file>] [files...]` runs the test files of the configuration, or the ones given, in
parallel, each in a process of its own. A failed test fails the run; with `--coverage`, a coverage under its minimum too.

The configuration is an `expect-test.config.ts` (or `.mts`, `.js`, `.mjs`) of the cwd:

```ts
import { defineConfig } from 'expect-test/config';

export default defineConfig({
  // The test files, the default patterns of node:test when none.
  files: ['packages/*/test/**/*.test.ts'],
  // Imported first by each test file and the workers it starts, by their absolute path.
  import: ['test/setup.ts'],
  timeout: 600_000,
  // Run once in the runner: the test files inherit its environment.
  setup: () => {
    process.env.MY_CACHE = '/tmp/my-cache';
  },
  coverage: { include: ['packages/*/src/**/*.ts'], lines: 100, branches: 90, functions: 100 },
});
```

What is not worth a test is ignored where it is, with node's comments: `/* node:coverage ignore next */`,
`/* node:coverage disable */` and `/* node:coverage enable */`. A comment line inside a block that never runs counts as
not covered: put the `disable` at the end of the last line that runs.

## Requirements

Node.js 22.15 or newer (`module.registerHooks`, `util.getCallSites`); a configuration and tests in TypeScript need the
type stripping of Node.js, on by default from 22.18.
