/** The tests, the suites and the hooks of Jest and Vitest, declared to node:test. */
import * as nodeTest from 'node:test';
import { format } from 'node:util';
import { compileFunction } from 'node:vm';

import { callerSite, type Site } from './caller.ts';
import { type MochaThis, mochaThis } from './mocha.ts';
import { setSnapshotTest, snapshotFileOf } from './snapshots.ts';

/**
 * A suite: the titles of it and of its parents, for the names of its tests; the timeout of its tests and whether a hook
 * skipped them, by the `this` of mocha.
 */
type Suite = { titles: string[]; parent?: Suite; timeout?: number; skipped?: boolean };
/** The suite being declared, the root one out of any. */
let suite: Suite = { titles: [] };
/** The timeout of the tests of a suite, the one of the nearest suite giving one. */
const timeoutOf = (of: Suite | undefined): number | undefined => (of ? (of.timeout ?? timeoutOf(of.parent)) : undefined);
const skippedOf = (of: Suite | undefined): boolean => Boolean(of && (of.skipped || skippedOf(of.parent)));
/** The next test skipped by a beforeEach, by the `this` of mocha. */
let skipNext = false;

/**
 * A function of node:test called from a line of the test file, the location node gives the test (it takes the one of
 * its caller, else expect-node).
 */
type Call = (declare: unknown, args: unknown[]) => unknown;
const calls = new Map<string, Call>();
const callAt = ({ file, line, column }: Site, declare: unknown, args: unknown[]) => {
  const key = `${file}:${line}:${column}`;
  let call = calls.get(key);
  if (!call) {
    // The path, not the URL: the coverage of node takes the modules of a file: URL only.
    call = compileFunction('return declare(...args)', ['declare', 'args'], {
      filename: file,
      lineOffset: line - 1,
      columnOffset: column - 1 - 'return '.length,
    }) as unknown as Call;
    calls.set(key, call);
  }
  return call(declare, args);
};

/** What a test gets: skip ends it skipped, like the context of Vitest. */
export type TestContext = { skip: (message?: string) => never };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (this: MochaThis, context: TestContext) => any;
type Options = { timeout?: number; skip?: boolean; only?: boolean; todo?: boolean };
/** A test or a suite: its name, its options or not, its function, the timeout of Jest and Vitest after it. */
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

/** The options and the function of a declaration, from its arguments after the name. */
const argumentsOf = <F extends Fn | Case>(optionsOrFn?: Options | F, fnOrTimeout?: F | number): [Options, F | undefined] =>
  typeof optionsOrFn === 'object'
    ? [optionsOrFn, fnOrTimeout as F | undefined]
    : [typeof fnOrTimeout === 'number' ? { timeout: fnOrTimeout } : {}, optionsOrFn];

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
      await fn.call(mochaThis(context.skip)!, context);
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

const declaring = (declare: (name: string, options: Options, fn?: Fn) => unknown): Declaring => {
  const withOptions =
    (extra: Options): Declare =>
    (name, optionsOrFn, fnOrTimeout) => {
      const [options, fn] = argumentsOf(optionsOrFn, fnOrTimeout);
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

// The timeout of a suite of Vitest is the one of each of its tests, the one given to the runner: a timeout of node is
// the one of the whole suite.
export const describe = declaring((title, { timeout: _timeout, ...options }, fn) =>
  callAt(callerSite(), nodeTest.describe, [
    title,
    options,
    fn &&
      (() => {
        // Declared at once: the tests declared in it are of this suite.
        const parent = suite;
        suite = { titles: [...parent.titles, title], parent };
        const of = suite;
        try {
          void fn.call(
            mochaThis(
              () => (of.skipped = true),
              ms => (of.timeout = ms),
            )!,
            {} as TestContext,
          );
        } finally {
          suite = parent;
        }
      }),
  ]),
);
export const it = declaring((title, options, fn) => {
  const site = callerSite();
  const name = [...suite.titles, title].join(' ');
  // A test skipped keeps its snapshots.
  if (options.skip) snapshotFileOf(site.file)?.skipped.add(name);
  const timeout = options.timeout ?? timeoutOf(suite);
  return callAt(site, nodeTest.it, [
    title,
    timeout === undefined ? options : { ...options, timeout },
    fn && withContext(fn, name, site.file, suite),
  ]);
});
/** The `test` of Jest and Vitest. */
export const test = it;

/**
 * A hook, its timeout after its function like Jest and Vitest; a function of a parameter ends by calling it (`done`, an
 * error failing the hook), like Jest and mocha. The `this.skip()` of mocha in a beforeAll skips the tests of its suite,
 * in a beforeEach the test.
 */
type Hook = (this: MochaThis, done: (error?: unknown) => void) => unknown;
const hook =
  (register: typeof nodeTest.before, skip: (of: Suite) => void = () => undefined) =>
  (fn: Hook, timeout?: number): void => {
    const of = suite;
    const self = mochaThis(() => {
      skip(of);
      throw SKIPPED;
    });
    callAt(callerSite(), register, [
      async () => {
        try {
          await (fn.length > 0
            ? new Promise<void>((resolve, reject) => {
                void fn.call(self!, error => (error ? reject(error as Error) : resolve()));
              })
            : (fn as (this: MochaThis) => unknown).call(self!));
        } catch (error) {
          if (error !== SKIPPED) throw error;
        }
      },
      timeout === undefined ? {} : { timeout },
    ]);
  };
export const beforeAll = hook(nodeTest.before, of => (of.skipped = true));
export const afterAll = hook(nodeTest.after);
export const beforeEach = hook(nodeTest.beforeEach, () => (skipNext = true));
export const afterEach = hook(nodeTest.afterEach);
/** The `before` and the `after` of mocha and esmocha. */
export const before = beforeAll;
export const after = afterAll;
