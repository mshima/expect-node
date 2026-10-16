/**
 * expect-test: node:test with the API of Jest and Vitest. The runner, the coverage (of the subprocesses and the workers
 * too) and the timeouts are node's; the assertions are the expect of Jest, the mock functions jest-mock, the module mocks
 * in-thread hooks of its own (see mocked). Run the tests with the expect-test bin (see cli.ts).
 */
import { registerHooks } from 'node:module';
import * as test from 'node:test';
import { format, getCallSites } from 'node:util';

import { expect as jestExpect } from 'expect';
import { ModuleMocker } from 'jest-mock';

/** The matchers of an assertion, each failure told after the message given (`expect(value, message)` of Vitest). */
const withMessage = <T extends object>(matchers: T, message: string): T =>
  new Proxy(matchers, {
    get: (target, property, receiver) => {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value === 'object' && value !== null) return withMessage(value, message);
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

/** What a test gets: skip ends it skipped, like the context of Vitest. */
export type TestContext = { skip: (message?: string) => never };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (context: TestContext) => any;
type Options = { timeout?: number; skip?: boolean; only?: boolean };
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
};

/** The name of a case of a table, its placeholders (%s, %d, %i, %j, %o) replaced by its values in order. */
const nameOf = (name: string, args: readonly unknown[]) => {
  let index = 0;
  return name.replace(/%[sdijo%]/g, placeholder => (placeholder === '%%' ? '%' : format(placeholder, args[index++])));
};

/** Thrown by skip, to end the test, which is then not failed. */
const SKIPPED = Symbol('skipped');

/** The function of a test with the context of Vitest: node gives a callback to a function of two parameters. */
const withContext =
  (fn: Fn) =>
  async (t: { skip: (message?: string) => void }): Promise<void> => {
    const context: TestContext = {
      skip: message => {
        t.skip(message);
        throw SKIPPED;
      },
    };
    try {
      await fn(context);
    } catch (error) {
      if (error !== SKIPPED) throw error;
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
  });
};

// The timeout of a suite of Vitest is the one of each of its tests, the one given to the runner: a timeout of node is
// the one of the whole suite.
export const describe = declaring((name, { timeout: _timeout, ...options }, fn) =>
  test.describe(name, options, fn && (() => void fn({} as TestContext))),
);
export const it = declaring((name, options, fn) => test.it(name, options, fn && withContext(fn)));
/** A hook, its timeout after its function like Jest and Vitest. */
const hook =
  (register: (fn: () => Promise<void>, options: { timeout?: number }) => void) =>
  (fn: () => unknown, timeout?: number): void =>
    register(async () => void (await fn()), timeout === undefined ? {} : { timeout });
export const beforeAll = hook((fn, options) => test.before(fn, options));
export const afterAll = hook((fn, options) => test.after(fn, options));
export const beforeEach = hook((fn, options) => test.beforeEach(fn, options));
export const afterEach = hook((fn, options) => test.afterEach(fn, options));

const mocker = new ModuleMocker(globalThis);

/**
 * The modules mocked, by URL: their exports. An import of one resolves to a module of its own reading them, by in-thread
 * hooks: the module mocks of node (and quibble) run off-thread hooks, whose thread compiles the module and records a
 * coverage of zero under its URL, which node merges over the one of the tests (nodejs/node#65946).
 */
const mocked = new Map<string, Record<string, unknown>>();
const MOCKED = Symbol.for('expect-test.mocked');
const MOCK_PROTOCOL = 'expect-test-mock:';
(globalThis as Record<symbol, unknown>)[MOCKED] = mocked;
const isIdentifier = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name);
registerHooks({
  resolve: (specifier, context, nextResolve) => {
    const resolved = nextResolve(specifier, context);
    return mocked.has(resolved.url) ? { url: `${MOCK_PROTOCOL}${resolved.url}`, shortCircuit: true } : resolved;
  },
  load: (url, context, nextLoad) => {
    if (!url.startsWith(MOCK_PROTOCOL)) return nextLoad(url, context);
    const exports = mocked.get(url.slice(MOCK_PROTOCOL.length))!;
    const names = Object.keys(exports).filter(name => name !== 'default' && isIdentifier(name));
    const read = `globalThis[Symbol.for('expect-test.mocked')].get(${JSON.stringify(url.slice(MOCK_PROTOCOL.length))})`;
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

/** The URL of the module calling a function of this one, to resolve its relative specifiers. */
const callerUrl = () => {
  const site = getCallSites().find(({ scriptName }) => scriptName && scriptName !== import.meta.url && scriptName !== import.meta.filename);
  return site!.scriptName.startsWith('file:') ? site!.scriptName : new URL(`file://${site!.scriptName}`).href;
};

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
   * the modules importing other names of it still linking.
   */
  mock: async (
    specifier: string,
    exports: Record<string, unknown> | ((importOriginal: <T = Record<string, unknown>>() => Promise<T>) => unknown),
  ) => {
    const url = specifier.startsWith('.') ? new URL(specifier, callerUrl()).href : import.meta.resolve(specifier);
    const original = (await import(url)) as Record<string, unknown>;
    const given = (typeof exports === 'function' ? await exports(async <T>() => original as T) : exports) as Record<string, unknown>;
    mocked.set(url, { ...original, ...given });
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
test.afterEach(() => {
  extest.unstubAllEnvs();
  extest.unstubAllGlobals();
});
