/** The tests, the suites and the hooks of node:test, Vitest, Jest and mocha, declared to node:test. */
import * as nodeTest from 'node:test';
import { format } from 'node:util';

import { callAt, callerSite, type Site } from './caller.ts';
import { checkTimeout, COMPATIBILITY, type Format } from './compatibility.ts';
import { ENV } from './env.ts';
import { DEFAULT_TIMEOUT, MOCHA, type MochaThis, mochaThis, timed } from './mocha.ts';
import { setSnapshotTest, snapshotFileOf } from './snapshots.ts';

/**
 * A suite: the titles of it and of its parents, for the names of its tests; the timeout of its tests (of Vitest, and of
 * mocha its hooks too) and whether a hook skipped them, by the `this` of mocha.
 */
type Suite = { titles: string[]; parent?: Suite; timeout?: number; skipped?: boolean };
/** The suite being declared, the root one out of any. */
let suite: Suite = { titles: [] };
/** The timeout of the tests of a suite, the one of the nearest suite giving one. */
const timeoutOf = (of: Suite | undefined): number | undefined => (of ? (of.timeout ?? timeoutOf(of.parent)) : undefined);
const skippedOf = (of: Suite | undefined): boolean => Boolean(of && (of.skipped || skippedOf(of.parent)));
/** The next test skipped by a beforeEach, by the `this` of mocha. */
let skipNext = false;

/** What a test gets: skip ends it skipped, like the context of Vitest. */
export type TestContext = { skip: (message?: string) => never };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (this: MochaThis, context: TestContext) => any;
type Options = { timeout?: number; skip?: boolean; only?: boolean; todo?: boolean };
/** A test or a suite: its name, its options or not, its function, the timeout of Vitest and Jest after it. */
type Declare = (name: string, optionsOrFn?: Options | Fn, fnOrTimeout?: Fn | number) => void;

/** The function of a case of a table, given its values. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Case = (...args: any[]) => unknown;
type Each = (table: readonly unknown[]) => (name: string, optionsOrFn: Options | Case, fn?: Case) => void;
type Declaring = Declare & {
  each: Each;
  skipIf: (condition: unknown) => Declare;
  runIf: (condition: unknown) => Declare;
  only: Declare;
  skip: Declare;
  /** A test to write, reported as such. */
  todo: (name: string) => void;
};

/** The options and the function of a declaration, from its arguments after the name, and the format of its timeout. */
const argumentsOf = <F extends Fn | Case>(
  optionsOrFn?: Options | F,
  fnOrTimeout?: F | number,
): [Options, F | undefined, Format | undefined] => {
  if (typeof optionsOrFn === 'object') {
    return [optionsOrFn, fnOrTimeout as F | undefined, optionsOrFn.timeout === undefined ? undefined : 'options before'];
  }
  return typeof fnOrTimeout === 'number' ? [{ timeout: fnOrTimeout }, optionsOrFn, 'number after'] : [{}, optionsOrFn, undefined];
};

/** The name of a case of a table, its placeholders (%s, %d, %i, %j, %o) replaced by its values in order. */
const nameOf = (name: string, args: readonly unknown[]) => {
  let index = 0;
  return name.replace(/%[sdijo%]/g, placeholder => (placeholder === '%%' ? '%' : format(placeholder, args[index++])));
};

/** Thrown by skip, to end the test, which is then not failed. */
const SKIPPED = Symbol('skipped');

/**
 * The function of a test with the context of Vitest (node gives a callback to a function of two parameters), and the
 * snapshots of its file.
 */
const withContext =
  (fn: Fn, name: string, testPath: string, of: Suite) =>
  async (t: { skip: (message?: string) => void }): Promise<void> => {
    const context: TestContext = {
      skip: message => {
        t.skip(message);
        throw SKIPPED;
      },
    };
    const file = snapshotFileOf(testPath);
    if (file) setSnapshotTest({ file, name, testPath });
    try {
      if (skipNext || skippedOf(of)) {
        skipNext = false;
        context.skip();
      }
      await (MOCHA
        ? timed(timeoutOf(of) ?? DEFAULT_TIMEOUT, async timeout => {
            await fn.call(mochaThis(context.skip, timeout)!, context);
          })
        : fn.call(undefined as unknown as MochaThis, context));
    } catch (error) {
      if (error === SKIPPED) {
        file?.skipped.add(name);
        return;
      }
      if (file) file.failed = true;
      throw error;
    } finally {
      if (file) setSnapshotTest();
    }
  };

const declaring = (of: 'test' | 'suite', declare: (name: string, options: Options, fn?: Fn) => unknown): Declaring => {
  const withOptions =
    (extra: Options): Declare =>
    (name, optionsOrFn, fnOrTimeout) => {
      const [options, fn, timeoutFormat] = argumentsOf(optionsOrFn, fnOrTimeout);
      if (timeoutFormat) checkTimeout(of, timeoutFormat);
      void declare(name, { ...options, ...extra }, fn);
    };
  const declared = withOptions({});
  const each: Each = table => (name, optionsOrFn, fn) => {
    const [options, run] = argumentsOf<Case>(optionsOrFn, fn);
    for (const row of table) {
      const args = Array.isArray(row) ? row : [row];
      declared(nameOf(name, args), options, () => run!(...args));
    }
  };
  return Object.assign(declared, {
    each,
    skipIf: (condition: unknown) => withOptions({ skip: Boolean(condition) }),
    runIf: (condition: unknown) => withOptions({ skip: !condition }),
    only: withOptions({ only: true }),
    skip: withOptions({ skip: true }),
    todo: (name: string) => declared(name, { todo: true }),
  });
};

// The timeout of a suite of node:test is the one of the whole suite; of Vitest, the one of each of its tests; of mocha
// (this.timeout), the one of each of its tests and hooks.
export const describe = declaring('suite', (title, { timeout, ...options }, fn) =>
  callAt(callerSite(), nodeTest.describe, [
    title,
    COMPATIBILITY === 'node' && timeout !== undefined ? { ...options, timeout } : options,
    fn &&
      (() => {
        // Declared at once: the tests declared in it are of this suite.
        const parent = suite;
        suite = { titles: [...parent.titles, title], parent, ...(timeout === undefined || COMPATIBILITY === 'node' ? {} : { timeout }) };
        const of = suite;
        try {
          void fn.call(
            mochaThis(
              () => (of.skipped = true),
              ms => {
                if (ms !== undefined) of.timeout = ms;
                return timeoutOf(of) ?? DEFAULT_TIMEOUT;
              },
            )!,
            {} as TestContext,
          );
        } finally {
          suite = parent;
        }
      }),
  ]),
);
export const it = declaring('test', (title, options, fn) => {
  const site = callerSite();
  const name = [...suite.titles, title].join(' ');
  // A test skipped keeps its snapshots.
  if (options.skip) snapshotFileOf(site.file)?.skipped.add(name);
  // A test of mocha within its own timeout (see timed of mocha.ts).
  const timeout = MOCHA ? Infinity : (options.timeout ?? timeoutOf(suite));
  return callAt(site, nodeTest.it, [
    title,
    timeout === undefined ? options : { ...options, timeout },
    fn && withContext(fn, name, site.file, suite),
  ]);
});
/** The `test` of Jest and Vitest. */
export const test = it;

/**
 * The hooks declared out of any suite while closed, by the setup files of a worker: declared again by it for each of its
 * test files (see worker.ts), like the root hooks of mocha, as when each test file runs in a process of its own. Open
 * while a worker imports a test file, and in the process of a test file.
 */
export const rootHooks = { open: process.env[ENV.worker] === undefined, deferred: [] as (() => void)[] };

/**
 * A hook, its timeout after its function: `{ timeout }` of node:test, a number of Vitest and Jest, `this.timeout(ms)` of
 * mocha. A function of a parameter ends by calling it (`done`, an error failing the hook), like Jest and mocha. The
 * `this.skip()` of mocha in a beforeAll skips the tests of its suite, in a beforeEach the test.
 */
export type Hook = (this: MochaThis, done: (error?: unknown) => void) => unknown;
type HookTimeout = number | { timeout?: number };
const hook =
  (register: typeof nodeTest.before, skip: (of: Suite) => void = () => undefined) =>
  (site: Site, fn: Hook, given?: HookTimeout): void => {
    if (given !== undefined) checkTimeout('hook', typeof given === 'number' ? 'number after' : 'options after');
    const timeout = typeof given === 'number' ? given : given?.timeout;
    // A hook of mocha within its own timeout (see timed of mocha.ts).
    const options = MOCHA ? { timeout: Infinity } : { ...(timeout === undefined ? {} : { timeout }) };
    const of = suite;
    const call = async (self: MochaThis | undefined) => {
      try {
        await (fn.length > 0
          ? new Promise<void>((resolve, reject) => {
              void fn.call(self!, error => (error ? reject(error as Error) : resolve()));
            })
          : (fn as (this: MochaThis) => unknown).call(self!));
      } catch (error) {
        if (error !== SKIPPED) throw error;
      }
    };
    const skipped = () => {
      skip(of);
      throw SKIPPED;
    };
    const declare = () =>
      callAt(site, register, [
        // A hook of mocha within its own timeout, the one of its suite else of the configuration (see timed of mocha.ts).
        MOCHA ? () => timed(timeoutOf(of) ?? DEFAULT_TIMEOUT, timeout => call(mochaThis(skipped, timeout))) : () => call(undefined),
        options,
      ]);
    if (!rootHooks.open && suite.parent === undefined) rootHooks.deferred.push(declare);
    else declare();
  };
/** The hooks declared at a site, the one of a test file or of a module of hooks (see setup.ts). */
export const hooksAt = {
  beforeAll: hook(nodeTest.before, of => (of.skipped = true)),
  afterAll: hook(nodeTest.after),
  beforeEach: hook(nodeTest.beforeEach, () => (skipNext = true)),
  afterEach: hook(nodeTest.afterEach),
};
export const beforeAll = (fn: Hook, timeout?: HookTimeout) => hooksAt.beforeAll(callerSite(), fn, timeout);
export const afterAll = (fn: Hook, timeout?: HookTimeout) => hooksAt.afterAll(callerSite(), fn, timeout);
export const beforeEach = (fn: Hook, timeout?: HookTimeout) => hooksAt.beforeEach(callerSite(), fn, timeout);
export const afterEach = (fn: Hook, timeout?: HookTimeout) => hooksAt.afterEach(callerSite(), fn, timeout);
/** The `before` and the `after` of mocha and esmocha. */
export const before = beforeAll;
export const after = afterAll;
