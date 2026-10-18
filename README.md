# expect-node

node:test with the expect and mock API of Jest and Vitest, like [esmocha](https://github.com/mshima/esmocha) gives it
over mocha. The runner, the timeouts and the coverage are node's: the coverage of the code a test runs in a subprocess
or a worker thread counts too, and TypeScript runs as node strips it, without a transform between the tests and the
code. The assertions are the `expect` of Jest, the mock functions `jest-mock`.

node:test does not support threads: it runs each test file in a process of its own, or all of them in one, never in a
worker thread nor in a process reused. On a large code, each test file importing it again makes node:test slower than
mocha `--parallel`; expect-node adds the workers it lacks, processes reused like the ones of mocha, as fast as esmocha
(see Workers).

```ts
import { beforeAll, describe, expect, exnode, it } from 'expect-node';

describe('a module', () => {
  it('works', () => {
    expect({ a: 1, b: [1, 2] }).toMatchObject({ b: expect.arrayContaining([2]) });
  });
});
```

## Install

```sh
npm install --save-dev expect-node
```

The snapshot matchers need `jest-snapshot`, an optional peer dependency, installed apart:

```sh
npm install --save-dev jest-snapshot
```

Without it, everything else works, and a snapshot matcher fails its test, telling to install it (see Snapshots).

## Pure node

The tests run the code as it runs in production: node strips the types of TypeScript in place, without a transform, a
bundler or source maps between the tests and the code.

- The resolution is node's: the `exports` of the packages, the module hooks (`module.registerHooks`), ESM and CommonJS
  behave as when the code runs. A link error only node gives fails the test too, like a module importing a name another
  one does not export, which a transform may let through.
- The runner, its parallelism, the timeouts and the coverage are node's: expect-node depends on `expect` and `jest-mock`
  only, and on `jest-snapshot` for the snapshots, when installed.

## Workers

Each test file runs in a process of its own, which imports again the modules of the code it tests. With `workers` in the
configuration (`workers: true` for as many as the cores, see The bin) or `--workers <n>` (`0` for none), they run by
that many processes reused, like mocha `--parallel`: each runs a test file after the other, in a suite named by its
path, and imports the modules of the code once for them, which is several times faster when the test files import a
large code. A test file starts after the previous one ended, its module mocks and its spies cleaned up after it, and the
hooks of the setup files are of each test file; what else it changes in a module or a global stays for the next one, as
with mocha. The reporters, the summary and the coverage stay the ones of node:test.

node:test has no such pool: `node --test` runs a test file by a process of its own (`--test-isolation=process`, its
default, `--test-concurrency` of them at once), or all of them in one process (`--test-isolation=none`), and has no
isolation by threads.

| node:test                      | What it does                         | What it lacks                                                                                                                                                               |
| ------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--test-isolation=process`     | A process per test file, in parallel | Each imports the modules of the code again                                                                                                                                  |
| `--test-isolation=none`        | Every test file in one process       | One core; it imports every test file before running any, so a module mock of one is seen by the ones before it, and a root hook runs once for all, not after each test file |
| `--test-shard=<index>/<total>` | A share of the test files, by a run  | Meant for several CI machines: each run has its own report and coverage                                                                                                     |

The workers are made of what node:test has: node:test runs them as ordinary test processes (`--test-isolation=process`),
each its first test file, then the next ones of a queue the bin serves by a socket, each in a suite of its own once the
previous one ended. So the reporters, the summary and the merge of the coverage stay node's.

On generator-jhipster (312 test files, about 15,000 tests), the full suite ran in 66s by esmocha, 99s by a process per
test file, and 65s by `workers: 8`.

## Why node:test, and the module mocks by in-thread hooks

Two problems of coverage, which expect-node solves apart:

- **The code a test runs out of its process.** A test that runs a cli in a subprocess, or code in a worker thread, gets
  no coverage of it with Vitest: its v8 provider measures the workers of Vitest only, and they run the code transformed
  by Vite. Merging the raw coverage of the subprocesses (`NODE_V8_COVERAGE`, with Monocart or c8) does not map either:
  the coverage of the code Vite transformed has offsets of its own, not the ones of the sources. node:test measures the
  test files, their subprocesses and their worker threads with `NODE_V8_COVERAGE` and merges them, and node runs
  TypeScript by stripping its types in place, the offsets of the sources kept. This is why expect-node runs on
  node:test.
- **The coverage of a module mocked.** The module mocks of node:test (`mock.module`), and quibble, run off-thread module
  hooks: the thread of the hooks compiles the module mocked and records a coverage of zero under its URL, which node
  merges over the one of the tests by URL alone (nodejs/node#65946). A module covered at 92% by its tests was reported at
  11% once another test file mocked it. expect-node mocks by in-thread hooks of its own (`module.registerHooks`), which
  compile nothing on another thread. This one is a problem of node:test only: `vi.mock` goes through the module runner of
  Vite, not through the loader hooks of node, so the hooks change nothing for Vitest.

## The API

The names Jest and Vitest share, so that a migration renames the imports and `vi` or `jest`:

- `describe`, `it` (and `test`), with `.each(table)` (its name with `%s`, `%d`, `%i`, `%j`, `%o`), `.skipIf(condition)`,
  `.runIf(condition)`, `.only`, `.skip` and `.todo(name)`; the options before the function (`{ timeout }`), or the
  timeout after it.
  The function of a test gets a context whose `skip()` ends it skipped.
- `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, a timeout after the function, which may end by a callback it gets
  (`done`, an error failing the hook) like Jest and mocha; `before` and `after`, the names of mocha.
- `expect`: the one of Jest, with a message after the value like Vitest (`expect(value, 'the value').toBe(1)`).
- `exnode`, the `vi` of Vitest, the `jest` of Jest, the `esmocha` of esmocha:
  - `fn`, `spyOn`, `isMockFunction`, `mocked`, `clearAllMocks`, `resetAllMocks`, `restoreAllMocks`: jest-mock; all but
    `mocked` exported by themselves too, like esmocha.
  - `await exnode.mock(specifier, exports | importOriginal => exports)`: mocks a module for the imports after it, its
    specifier resolved from the calling file (relative, a package, a subpath import), and gives its exports. The
    exports given are over the ones of the module, so the modules importing other names of it still link; without
    them, every export is mocked by jest-mock (its functions mock functions). `unmock(specifier)` and `resetModules()`
    (`reset()` of esmocha) give the module itself again to the imports after them, `importActual(specifier)` gives it
    mocked or not; `doMock` and `doUnmock` are `mock` and `unmock`. Unlike `vi.mock`, it is not hoisted: import the
    module under test after it, with `await import(...)`: a module imported before keeps the module itself. With
    `reimport: true` in the configuration, or in the options of a mock alone
    (`exnode.mock(specifier, exports, { reimport: true })`), a module of the project imported before is imported again
    while a module is mocked so, like quibble of esmocha does, so the module under test sees the mock even when the test file imported it
    first (the packages, `node_modules`, are not imported again); but a module imported again is a second instance of
    it, with a state and classes of its own (`instanceof` tells them apart). node:test reports the coverage of each
    instance apart, a function one of them did not run not covered: the bin merges them by file, before the reporters
    and the minimums. The mocks are
    in-thread hooks (`module.registerHooks`): the module mocks of node run off-thread hooks, whose thread records a
    coverage of zero for the module mocked, which node merges over the one of the tests (nodejs/node#65946).
  - `stubEnv(name, value)` (undefined deletes it), `stubGlobal(name, value)`: given back after each test
    (`unstubAllEnvs`, `unstubAllGlobals`).

## Snapshots

With `jest-snapshot` installed, an optional peer dependency (`npm install --save-dev jest-snapshot`): `toMatchSnapshot`,
`toMatchInlineSnapshot`, `toThrowErrorMatchingSnapshot`, `toThrowErrorMatchingInlineSnapshot` and
`expect.addSnapshotSerializer`, the snapshot files of Jest and esmocha read and written as they are: in
`__snapshots__/<test file>.snap`, named by the titles of the suites and of the test joined by spaces, in the format of
Jest 29 and later. The new snapshots are written, but in CI (`CI` set); `--update-snapshot` of the bin writes every
one again, and removes the ones of the tests no longer there when no test of the file failed (`UPDATE_SNAPSHOT=all`,
or `new`, or `none`).

## The bin

`exnode [--coverage] [--update-snapshot] [--reporter <name>[:<file>]]... [--config <file>] [files...]` runs the test files of the configuration, or the ones given, in
parallel, each in a process of its own. A failed test fails the run; with `--coverage`, a coverage under its minimum too.

The configuration is an `expect-node.config.ts` (or `.mts`, `.js`, `.mjs`) of the cwd:

```ts
import { defineConfig } from 'expect-node/config';

export default defineConfig({
  // The test files, the default patterns of node:test when none.
  files: ['packages/*/test/**/*.test.ts'],
  // Imported first by each test file and the workers it starts, by their absolute path.
  import: ['test/hooks.ts'],
  // Imported by each test process only, before its test files: hooks of the tests, of each test file.
  setupFiles: ['test/setup.ts'],
  // The root hook plugins of mocha (modules exporting mochaHooks), by a package or a path: of each test file too.
  mochaHooks: ['yeoman-test/mocha-cleanup'],
  timeout: 600_000,
  // The test files by processes reused, as many as the cores.
  workers: true,
  // Run once in the runner: the test files inherit its environment.
  setup: () => {
    process.env.MY_CACHE = '/tmp/my-cache';
  },
  coverage: { include: ['packages/*/src/**/*.ts'], lines: 100, branches: 90, functions: 100 },
  // The reporters, spec to the terminal when none: the --reporter of the bin replaces them.
  reporters: ['spec', 'lcov:coverage/lcov.info'],
});
```

A failed test is located in its test file (`test at test/sum.test.ts:12:3`), the line of its `it`.

The modules of `import` are imported by the worker threads and the subprocesses a test starts too (`--import`), for
module hooks and aliases they need as well. The `setupFiles`, like the ones of Vitest, are imported by the test process
alone: the hooks of the tests (a cleanup after each test file), which the threads and the subprocesses would otherwise
run too, or whose dependencies would change them.

### From mocha or esmocha

From esmocha, a test file importing the module under test before mocking what it imports needs the `reimport` of its
mock (`exnode.mock(specifier, exports, { reimport: true })`), or to import the module under test after the mock.

`mocha: true` gives the tests, the suites and the hooks the `this` of mocha: `this.skip()` skips the test, in a suite or a
`before` the tests of its suite, in a `beforeEach` the test; `this.timeout(ms)` of a suite is the timeout of its tests,
of no effect in a test or a hook. It is deprecated, for a migration: each warns once (`EXNODE_MOCHA_THIS`), and the
types mark it. From esmocha, the imports of `esmocha` become the ones of `expect-node`, `esmocha` becoming `exnode`, and
`esmocha.mock(specifier, import(specifier))`, every export mocked, becomes `exnode.mock<typeof import(specifier)>(specifier)`.

The root hook plugins of mocha, given to it by `--require` (a module exporting `mochaHooks`: `beforeAll`, `beforeEach`,
`afterAll`, `afterEach`, each a hook or an array of them, or a function giving them), are given by `mochaHooks`, their
specifiers from the cwd: `mochaHooks: ['yeoman-test/mocha-cleanup']`. Imported by the test processes like the setup
files, their hooks are of each test file, as with mocha `--parallel`.

A reporter is one of node:test (`spec`, `tap`, `dot`, `junit`, `lcov`) or the path of a module of one (its default
export, like an async generator of the events), to the terminal or, after a `:`, to a file: `--reporter dot --reporter
lcov:coverage/lcov.info` prints dots and writes the coverage for a CI to publish.

What is not worth a test is ignored where it is, with node's comments: `/* node:coverage ignore next */`,
`/* node:coverage disable */` and `/* node:coverage enable */`. A comment line inside a block that never runs counts as
not covered: put the `disable` at the end of the last line that runs.

## Requirements

Node.js 22.15 or newer (`module.registerHooks`, `util.getCallSites`); a configuration and tests in TypeScript need the
type stripping of Node.js, on by default from 22.18.
