import type { Compatibility } from './compatibility.ts';

/** The configuration of a run of expect-node (see cli.ts), in an expect-node.config.ts (or .mts, .js, .mjs) of the cwd. */
export type Config = {
  /** The test files, by glob patterns from the cwd: the default patterns of node:test when none. */
  files?: string[];
  /**
   * Modules each test file imports first, and the workers it starts, by their path from the cwd: hooks of its own, an
   * alias of a package to its sources. Given to them by their absolute path, a worker starting in another folder.
   */
  import?: string[];
  /**
   * Modules each test process imports before its test files, by their path from the cwd, not its worker threads nor
   * its subprocesses (unlike `import`), like the setupFiles of Vitest: hooks of the tests, which are of each test file
   * like the root hooks of mocha.
   */
  setupFiles?: string[];
  /**
   * The root hook plugins of mocha, imported like the setup files: modules exporting `mochaHooks` (`beforeAll`,
   * `beforeEach`, `afterAll`, `afterEach`, each a hook or an array of them; or a function giving them), by their
   * specifier from the cwd, a package (`yeoman-test/mocha-cleanup`) or a path. Their hooks are of each test file, like
   * the ones of mocha --parallel.
   */
  mochaHooks?: string[];
  /** The timeout of each test and hook, in milliseconds. */
  timeout?: number;
  /** The test files run at once: true for as many as node:test chooses. */
  concurrency?: number | boolean;
  /**
   * The test files run by this many processes reused, true for as many as the cores (the `--workers <n>` of the bin, 0
   * for none), like mocha --parallel: each runs a test file after the other, in a suite of its own, its module mocks
   * and spies cleaned after it, and imports the modules of the code once for them, which is faster than a process per
   * test file. The hooks of the setup files are of each test file.
   */
  workers?: number | true;
  /** Run once in the runner before the test files, which inherit its environment: a temporary folder they share. */
  setup?: () => unknown;
  /**
   * The reporters, `<name>[:<file>]`: of node:test (spec, tap, dot, junit, lcov) or the path of a module of one, to
   * the terminal or to the file; `spec` to the terminal when none. The `--reporter` of the bin replaces them.
   */
  reporters?: string[];
  /**
   * The API the tests are written for, `node` by default, of node:test: the format of their timeouts, and with `mocha`
   * the `this` of mocha.
   *
   * - `node`: `{ timeout }` before the function of a test or a suite (the timeout of the whole suite), after the one of a
   *   hook.
   * - `vitest`: `{ timeout }` before or a number after the function of a test or a suite (the timeout of each of its
   *   tests), a number after the one of a hook.
   * - `jest`: a number after the function of a test or a hook; a suite takes none.
   * - `mocha`: `this.timeout(ms)` in a test, a hook or a suite (the one of its tests and hooks), from then like mocha, 0
   *   for none, starting from `timeout`; `this.skip()` in a test, a suite, a `before` (the tests of its suite) or a
   *   `beforeEach` (its test). The `this` of mocha is deprecated, for a migration: each warns once.
   *
   * A timeout in the format of another compatibility fails, never ignored.
   */
  compatibility?: Compatibility;
  /** @deprecated `compatibility: 'mocha'`. */
  mocha?: boolean;
  /**
   * While a module is mocked, the modules of the code imported after a mock imported again, like quibble of esmocha:
   * the module under test sees the mock even when the test file imported it before. A module imported again is a
   * second instance of it, with a state and classes of its own (its coverage merged with the one of the first by the
   * bin): without it, the modules imported before a mock keep the module itself.
   */
  reimport?: boolean;
  /**
   * A test or a suite declared only (`.only`, `{ only: true }`) fails, like mocha --forbid-only (the `--forbid-only` of
   * the bin): a `.only` left behind fails the run in CI, where node:test runs every test but with --test-only.
   */
  forbidOnly?: boolean;
  /** The coverage of a run with --coverage: the files it is measured on, and its minimum in percents. */
  coverage?: { include?: string[]; exclude?: string[]; lines?: number; branches?: number; functions?: number };
};

/** The configuration of expect-node, typed. */
export const defineConfig = (config: Config): Config => config;
