/**
 * expect-test: node:test with the API of Jest and Vitest. The runner, the coverage (of the subprocesses and the workers
 * too) and the timeouts are node's; the assertions are the expect of Jest, the mock functions jest-mock, the module mocks
 * in-thread hooks of its own (see mocked). Run the tests with the expect-test bin (see cli.ts).
 */
import { registerHooks } from 'node:module';
import { basename, dirname, join } from 'node:path';
import * as nodeTest from 'node:test';
import { fileURLToPath } from 'node:url';
import { format, getCallSites } from 'node:util';

import { expect as jestExpect } from 'expect';
import { type Mocked, ModuleMocker } from 'jest-mock';

/** The matchers of an assertion, each failure told after the message given (`expect(value, message)` of Vitest). */
const withMessage = <T extends object>(matchers: T, message: string): T =>
  new Proxy(matchers, {
    get: (target, property, receiver) => {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value === 'object' && value !== null) return withMessage(value, message);
      // A property of the matchers that is not a matcher, like a number: as it is.
      /* node:coverage ignore next */
      if (typeof value !== 'function') return value;
      const fail = (error: unknown) => {
        if (error instanceof Error) error.message = `${message}\n\n${error.message}`;
        throw error;
      };
      return (...args: unknown[]) => {
        try {
          const result: unknown = value.apply(target, args);
          return result instanceof Promise ? result.catch(fail) : result;
        } catch (error) {
          return fail(error);
        }
      };
    },
  });

/** The expect of Jest, with the message of Vitest after the value. */
export const expect = Object.assign(
  ((actual: unknown, message?: string) =>
    message === undefined ? jestExpect(actual) : withMessage(jestExpect(actual), message)) as typeof jestExpect &
    (<T>(actual: T, message?: string) => ReturnType<typeof jestExpect<T>>),
  jestExpect,
);

declare module 'expect' {
  interface Matchers<R extends void | Promise<void>> {
    /** The value against its snapshot, in `__snapshots__/<test file>.snap` (jest-snapshot, an optional peer dependency). */
    toMatchSnapshot(propertiesOrHint?: object | string, hint?: string): R;
    /** The value against its snapshot written in the test (jest-snapshot, an optional peer dependency). */
    toMatchInlineSnapshot(propertiesOrSnapshot?: object | string, inlineSnapshot?: string): R;
    toThrowErrorMatchingSnapshot(hint?: string): R;
    toThrowErrorMatchingInlineSnapshot(inlineSnapshot?: string): R;
  }
}

/**
 * The snapshots of Jest and esmocha, by jest-snapshot when it is installed: the same files (`__snapshots__/<test
 * file>.snap`), the same names (the titles of the suites and of the test, by spaces) and format. Updated by
 * `UPDATE_SNAPSHOT` (`all`, `new` or `none`, the `--update-snapshot` of the bin gives `all`): the new ones written
 * by default, none in CI.
 */
// Without jest-snapshot, which its tests have.
/* node:coverage ignore next */
const snapshots = await import('jest-snapshot').catch(() => undefined);
const SNAPSHOT_MATCHERS = [
  'toMatchSnapshot',
  'toMatchInlineSnapshot',
  'toThrowErrorMatchingSnapshot',
  'toThrowErrorMatchingInlineSnapshot',
] as const;
if (snapshots) {
  jestExpect.extend(Object.fromEntries(SNAPSHOT_MATCHERS.map(name => [name, snapshots[name]])) as never);
  Object.assign(jestExpect, { addSnapshotSerializer: snapshots.addSerializer });
  // Without jest-snapshot, which its tests have.
  /* node:coverage disable */
} else {
  jestExpect.extend(
    Object.fromEntries(
      SNAPSHOT_MATCHERS.map(name => [
        name,
        () => {
          throw new Error(`${name} needs jest-snapshot, an optional peer dependency of expect-test: npm install --save-dev jest-snapshot`);
        },
      ]),
    ),
  );
}
/* node:coverage enable */
type SnapshotState = InstanceType<NonNullable<typeof snapshots>['SnapshotState']>;
/** The state of expect the snapshot matchers read (snapshotState, currentTestName, testPath), not in its types. */
const setSnapshotState = (state: Record<string, unknown>) => jestExpect.setState(state);
/** The snapshots of each test file, whether a test of it failed, and its tests skipped. */
const snapshotFiles = new Map<string, { state: SnapshotState; failed: boolean; skipped: Set<string> }>();
const snapshotFileOf = (testPath: string) => {
  let file = snapshotFiles.get(testPath);
  if (!file) {
    // By the environment of the run: in CI or not, the --update-snapshot of the bin.
    /* node:coverage ignore next */
    const updateSnapshot = (process.env.UPDATE_SNAPSHOT ?? (process.env.CI ? 'none' : 'new')) as 'all' | 'new' | 'none';
    const state = new snapshots!.SnapshotState(join(dirname(testPath), '__snapshots__', `${basename(testPath)}.snap`), {
      updateSnapshot,
      snapshotFormat: { escapeString: false, printBasicPrototype: false },
      rootDir: process.cwd(),
    });
    file = { state, failed: false, skipped: new Set() };
    snapshotFiles.set(testPath, file);
  }
  return file;
};
// At the end of the test file: the snapshots of its tests not run removed (an update of all of them, none failed), saved.
nodeTest.after(() => {
  for (const { state, failed, skipped } of snapshotFiles.values()) {
    for (const name of skipped) state.markSnapshotsAsCheckedForTest(name);
    if (!failed) state.removeUncheckedKeys();
    state.save();
  }
});

/** The URL of the module calling a function of this one, to resolve its relative specifiers. */
const callerUrl = () => {
  const site = getCallSites().find(({ scriptName }) => scriptName && scriptName !== import.meta.url && scriptName !== import.meta.filename);
  // A path instead of a URL, a CommonJS module calling.
  /* node:coverage ignore next */
  return site!.scriptName.startsWith('file:') ? site!.scriptName : new URL(`file://${site!.scriptName}`).href;
};

/** The URL of a module, a relative specifier from the module calling. */
const urlOf = (specifier: string) => (specifier.startsWith('.') ? new URL(specifier, callerUrl()).href : import.meta.resolve(specifier));

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

/** The name of a case of a table, its placeholders (%s, %d, %i, %j, %o) replaced by its values in order. */
const nameOf = (name: string, args: readonly unknown[]) => {
  let index = 0;
  return name.replace(/%[sdijo%]/g, placeholder => (placeholder === '%%' ? '%' : format(placeholder, args[index++])));
};

/** Thrown by skip, to end the test, which is then not failed. */
const SKIPPED = Symbol('skipped');

/** A test: its name with the titles of its suites, and its file, the ones of its snapshots. */
type Identity = { name: string; testPath: string };

/**
 * The function of a test with the context of Vitest (node gives a callback to a function of two parameters), and the
 * snapshots of its file.
 */
const withContext =
  (fn: Fn, { name, testPath }: Identity) =>
  async (t: { skip: (message?: string) => void }): Promise<void> => {
    const context: TestContext = {
      skip: message => {
        t.skip(message);
        throw SKIPPED;
      },
    };
    const file = snapshots && snapshotFileOf(testPath);
    if (file) setSnapshotState({ snapshotState: file.state, currentTestName: name, testPath });
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
      if (file) setSnapshotState({ snapshotState: undefined, currentTestName: undefined, testPath: undefined });
    }
  };

const declaring = (declare: (name: string, options: Options, fn?: Fn) => unknown): Declaring => {
  const declared: Declare = (name, optionsOrFn, fnOrTimeout) => {
    if (typeof optionsOrFn === 'object') {
      void declare(name, optionsOrFn, fnOrTimeout as Fn | undefined);
    } else {
      void declare(name, typeof fnOrTimeout === 'number' ? { timeout: fnOrTimeout } : {}, optionsOrFn);
    }
  };
  const each: Each = table => (name, optionsOrFn, fn) => {
    for (const row of table) {
      const args = Array.isArray(row) ? row : [row];
      const run = (typeof optionsOrFn === 'function' ? optionsOrFn : fn)!;
      declared(nameOf(name, args), typeof optionsOrFn === 'object' ? optionsOrFn : {}, () => run(...args));
    }
  };
  const withOptions =
    (extra: Options): Declare =>
    (name, optionsOrFn, fnOrTimeout) =>
      declared(
        name,
        typeof optionsOrFn === 'object' ? { ...optionsOrFn, ...extra } : extra,
        (typeof optionsOrFn === 'function' ? optionsOrFn : fnOrTimeout) as Fn,
      );
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
export const it = declaring((name, options, fn) => {
  const identity = { name: [...suites, name].join(' '), testPath: fileURLToPath(callerUrl()) };
  // A test skipped keeps its snapshots.
  if (options.skip && snapshots) snapshotFileOf(identity.testPath).skipped.add(identity.name);
  return nodeTest.it(name, options, fn && withContext(fn, identity));
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

const mocker = new ModuleMocker(globalThis);

/**
 * The modules mocked, by URL: their exports. An import of one resolves to a module of its own reading them, by in-thread
 * hooks: the module mocks of node (and quibble) run off-thread hooks, whose thread compiles the module and records a
 * coverage of zero under its URL, which node merges over the one of the tests (nodejs/node#65946).
 */
const mocked = new Map<string, { exports: Record<string, unknown>; actual: Record<string, unknown>; version: number }>();
/** Each mock of a module a URL of its own: node keeps a module by its URL, a module mocked again is another one. */
let mocks = 0;
const MOCKED = Symbol.for('expect-test.mocked');
const MOCK_PROTOCOL = 'expect-test-mock:';
(globalThis as Record<symbol, unknown>)[MOCKED] = mocked;
const isIdentifier = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name);
registerHooks({
  resolve: (specifier, context, nextResolve) => {
    const resolved = nextResolve(specifier, context);
    const mock = mocked.get(resolved.url);
    return mock ? { url: `${MOCK_PROTOCOL}${mock.version}:${resolved.url}`, shortCircuit: true } : resolved;
  },
  load: (url, context, nextLoad) => {
    if (!url.startsWith(MOCK_PROTOCOL)) return nextLoad(url, context);
    const of = url.slice(url.indexOf(':', MOCK_PROTOCOL.length) + 1);
    const { exports } = mocked.get(of)!;
    const names = Object.keys(exports).filter(name => name !== 'default' && isIdentifier(name));
    const read = `globalThis[Symbol.for('expect-test.mocked')].get(${JSON.stringify(of)}).exports`;
    const source = [
      `const exports = ${read};`,
      ...(names.length > 0 ? [`export const { ${names.join(', ')} } = exports;`] : []),
      ...('default' in exports ? ['export default exports.default;'] : []),
    ].join('\n');
    return { format: 'module', source, shortCircuit: true };
  },
});
/** The environment and the globals as they were before a test stubbed them. */
const envs = new Map<string, string | undefined>();
const globals = new Map<string, { value: unknown; had: boolean }>();

/**
 * The mock functions of jest-mock, the module mocks, the environment and the globals stubbed for a test: the `vi` of
 * Vitest, the `jest` of Jest, the `esmocha` of esmocha.
 */
export const extest = {
  fn: mocker.fn.bind(mocker),
  spyOn: mocker.spyOn.bind(mocker),
  isMockFunction: mocker.isMockFunction.bind(mocker),
  clearAllMocks: () => mocker.clearAllMocks(),
  resetAllMocks: () => mocker.resetAllMocks(),
  restoreAllMocks: () => mocker.restoreAllMocks(),
  /**
   * Mocks a module for the imports after it: import the module under test after it (`await import`), not before, as
   * Vitest hoists vi.mock. Its exports over the ones of the module itself (a factory gets them, like importOriginal),
   * the modules importing other names of it still linking; without them, every export mocked by jest-mock (its
   * functions mock functions), like esmocha. Gives the exports of the mock.
   */
  mock: (async <T extends Record<string, unknown> = Record<string, unknown>>(
    specifier: string,
    exports?: Partial<T> | ((importOriginal: <O = T>() => Promise<O>) => unknown),
  ): Promise<T> => {
    const url = urlOf(specifier);
    // The module itself, not a mock of it before: the import of a module mocked gives the mock.
    const original = mocked.get(url)?.actual ?? ((await import(url)) as Record<string, unknown>);
    const given =
      exports === undefined
        ? mocker.generateFromMetadata(mocker.getMetadata(original)!)
        : ((typeof exports === 'function' ? await exports(async <O>() => original as O) : exports) as Record<string, unknown>);
    const module = { ...original, ...given };
    mocked.set(url, { exports: module, actual: original, version: ++mocks });
    return module as T;
  }) as {
    <T extends Record<string, unknown> = Record<string, unknown>>(specifier: string): Promise<Mocked<T>>;
    <T extends Record<string, unknown> = Record<string, unknown>>(
      specifier: string,
      exports: Partial<T> | ((importOriginal: <O = T>() => Promise<O>) => unknown),
    ): Promise<T>;
  },
  /** The module itself again for the imports after it: the ones before keep the mock. */
  unmock: (specifier: string) => {
    mocked.delete(urlOf(specifier));
  },
  /** The module itself, mocked or not: the `requireActual` of Jest, the `importActual` of Vitest. */
  importActual: async <T = Record<string, unknown>>(specifier: string): Promise<T> => {
    const url = urlOf(specifier);
    return (mocked.get(url)?.actual ?? (await import(url))) as T;
  },
  /** A value typed as its mock, like the `mocked` of Jest and Vitest. */
  mocked: mocker.mocked.bind(mocker),
  /** Every module mocked itself again, for the imports after it. */
  resetModules: () => {
    mocked.clear();
  },
  // The module mocks are never hoisted: doMock and doUnmock of Jest and Vitest are mock and unmock.
  get doMock() {
    return extest.mock;
  },
  get doUnmock() {
    return extest.unmock;
  },
  /** Sets a variable of the environment for the test, undefined deleting it: given back after it (see unstubAllEnvs). */
  stubEnv: (name: string, value: string | undefined) => {
    if (!envs.has(name)) envs.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  },
  unstubAllEnvs: () => {
    for (const [name, value] of envs) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    envs.clear();
  },
  stubGlobal: (name: string, value: unknown) => {
    const scope = globalThis as Record<string, unknown>;
    if (!globals.has(name)) globals.set(name, { value: scope[name], had: name in scope });
    scope[name] = value;
  },
  unstubAllGlobals: () => {
    const scope = globalThis as Record<string, unknown>;
    for (const [name, { value, had }] of globals) {
      if (had) scope[name] = value;
      else delete scope[name];
    }
    globals.clear();
  },
};

// Like Vitest with unstubEnvs and unstubGlobals: what a test stubbed given back after it.
nodeTest.afterEach(() => {
  extest.unstubAllEnvs();
  extest.unstubAllGlobals();
});
