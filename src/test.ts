/** The tests, the suites and the hooks of Jest and Vitest, declared to node:test. */
import * as nodeTest from 'node:test';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';

import { callerUrl } from './caller.ts';
import { setSnapshotTest, snapshotFileOf } from './snapshots.ts';

/** The titles of the suites being declared, for the names of their tests. */
const suites: string[] = [];

/** What a test gets: skip ends it skipped, like the context of Vitest. */
export type TestContext = { skip: (message?: string) => never };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (context: TestContext) => any;
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
  (fn: Fn, name: string, testPath: string) =>
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
      await fn(context);
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
export const describe = declaring((name, { timeout: _timeout, ...options }, fn) =>
  nodeTest.describe(
    name,
    options,
    fn &&
      (() => {
        // Declared at once: the tests declared in it are of this suite.
        suites.push(name);
        try {
          void fn({} as TestContext);
        } finally {
          suites.pop();
        }
      }),
  ),
);
export const it = declaring((title, options, fn) => {
  const name = [...suites, title].join(' ');
  const testPath = fileURLToPath(callerUrl());
  // A test skipped keeps its snapshots.
  if (options.skip) snapshotFileOf(testPath)?.skipped.add(name);
  return nodeTest.it(title, options, fn && withContext(fn, name, testPath));
});
/** The `test` of Jest and Vitest. */
export const test = it;

/** A hook, its timeout after its function like Jest and Vitest. */
const hook =
  (register: (fn: () => Promise<void>, options: { timeout?: number }) => void) =>
  (fn: () => unknown, timeout?: number): void =>
    register(async () => void (await fn()), timeout === undefined ? {} : { timeout });
export const beforeAll = hook((fn, options) => nodeTest.before(fn, options));
export const afterAll = hook((fn, options) => nodeTest.after(fn, options));
export const beforeEach = hook((fn, options) => nodeTest.beforeEach(fn, options));
export const afterEach = hook((fn, options) => nodeTest.afterEach(fn, options));
