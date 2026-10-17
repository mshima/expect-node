import { registerHooks } from 'node:module';
import * as nodeTest from 'node:test';

import { type Mocked, ModuleMocker } from 'jest-mock';

import { callerSite } from './caller.ts';

const mocker = new ModuleMocker(globalThis);

/**
 * The modules mocked, by URL: their exports. An import of one resolves to a module of its own reading them, by in-thread
 * hooks: the module mocks of node (and quibble) run off-thread hooks, whose thread compiles the module and records a
 * coverage of zero under its URL, which node merges over the one of the tests (nodejs/node#65946).
 */
const mocked = new Map<string, { exports: Record<string, unknown>; actual: Record<string, unknown>; version: number }>();
/** Each mock of a module a URL of its own: node keeps a module by its URL, a module mocked again is another one. */
let mocks = 0;
/**
 * While a module is mocked, the modules imported after a mock changed are each a module of its own again (but the
 * packages and expect-node): the module under test imported again sees the mocks, even when the test file imported it
 * before, like quibble of esmocha.
 */
let generation = 0;
const MOCKED = Symbol.for('exnode.mocked');
const MOCK_PROTOCOL = 'exnode-mock:';
/** A specifier resolved from another module (`exnode-resolve:<[specifier, parent URL] as JSON>`). */
const RESOLVE_PROTOCOL = 'exnode-resolve:';
const OWN = new URL('.', import.meta.url).href;
// Only while a module is mocked: once none is, the modules imported before any mock are the ones of the imports again.
const isFresh = (url: string) => mocked.size > 0 && url.startsWith('file:') && !url.startsWith(OWN) && !url.includes('/node_modules/');
(globalThis as Record<symbol, unknown>)[MOCKED] = mocked;
const isIdentifier = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name);
registerHooks({
  resolve: (specifier, context, nextResolve) => {
    if (specifier.startsWith(RESOLVE_PROTOCOL)) {
      const [of, parentURL] = JSON.parse(decodeURIComponent(specifier.slice(RESOLVE_PROTOCOL.length))) as [string, string];
      return { url: nextResolve(of, { ...context, parentURL }).url, shortCircuit: true };
    }
    const resolved = nextResolve(specifier, context);
    const mock = mocked.get(resolved.url);
    if (mock) return { url: `${MOCK_PROTOCOL}${mock.version}:${resolved.url}`, shortCircuit: true };
    if (!isFresh(resolved.url)) return resolved;
    const url = new URL(resolved.url);
    url.searchParams.set('exnode', String(generation));
    return { ...resolved, url: url.href };
  },
  load: (url, context, nextLoad) => {
    if (!url.startsWith(MOCK_PROTOCOL)) return nextLoad(url, context);
    const of = url.slice(url.indexOf(':', MOCK_PROTOCOL.length) + 1);
    const { exports } = mocked.get(of)!;
    const names = Object.keys(exports).filter(name => name !== 'default' && isIdentifier(name));
    const read = `globalThis[Symbol.for(${JSON.stringify(MOCKED.description)})].get(${JSON.stringify(of)}).exports`;
    const source = [
      `const exports = ${read};`,
      ...(names.length > 0 ? [`export const { ${names.join(', ')} } = exports;`] : []),
      ...('default' in exports ? ['export default exports.default;'] : []),
    ].join('\n');
    return { format: 'module', source, shortCircuit: true };
  },
});

/** The URL of a module, its specifier resolved from the module calling (relative, a package, an import of its package). */
const urlOf = (specifier: string) =>
  import.meta.resolve(`${RESOLVE_PROTOCOL}${encodeURIComponent(JSON.stringify([specifier, callerSite().url]))}`);

/** The module itself, not a mock of it: the import of a module mocked gives the mock. */
const actualOf = async (url: string) => mocked.get(url)?.actual ?? ((await import(url)) as Record<string, unknown>);

/** The environment and the globals as they were before a test stubbed them. */
const envs = new Map<string, string | undefined>();
const globals = new Map<string, { value: unknown; had: boolean }>();
const setEnv = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

// The mock functions of jest-mock, of exnode and by themselves like esmocha.
export const fn = mocker.fn.bind(mocker);
export const spyOn = mocker.spyOn.bind(mocker);
export const isMockFunction = mocker.isMockFunction.bind(mocker);
export const clearAllMocks = () => mocker.clearAllMocks();
export const resetAllMocks = () => mocker.resetAllMocks();
export const restoreAllMocks = () => mocker.restoreAllMocks();

/**
 * The mock functions of jest-mock, the module mocks, the environment and the globals stubbed for a test: the `vi` of
 * Vitest, the `jest` of Jest, the `esmocha` of esmocha.
 */
export const exnode = {
  fn,
  spyOn,
  isMockFunction,
  clearAllMocks,
  resetAllMocks,
  restoreAllMocks,
  /**
   * Mocks a module for the imports after it: import the module under test after it (`await import`), as Vitest hoists
   * vi.mock; a module imported before is imported again, the packages kept (see generation). Its exports over the ones
   * of the module itself (a factory gets them, like importOriginal), the modules importing other names of it still
   * linking; without them, every export mocked by jest-mock (its functions mock functions), like esmocha. Gives the
   * exports of the mock.
   */
  mock: (async <T extends Record<string, unknown> = Record<string, unknown>>(
    specifier: string,
    exports?: Partial<T> | ((importOriginal: <O = T>() => Promise<O>) => unknown),
  ): Promise<T> => {
    const url = urlOf(specifier);
    const original = await actualOf(url);
    const given =
      exports === undefined
        ? mocker.generateFromMetadata(mocker.getMetadata(original)!)
        : ((typeof exports === 'function' ? await exports(async <O>() => original as O) : exports) as Record<string, unknown>);
    const module = { ...original, ...given };
    mocked.set(url, { exports: module, actual: original, version: ++mocks });
    generation++;
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
    generation++;
  },
  /** The module itself, mocked or not: the `requireActual` of Jest, the `importActual` of Vitest. */
  importActual: async <T = Record<string, unknown>>(specifier: string): Promise<T> => (await actualOf(urlOf(specifier))) as T,
  /** A value typed as its mock, like the `mocked` of Jest and Vitest. */
  mocked: mocker.mocked.bind(mocker),
  /** Every module mocked itself again, for the imports after it. */
  resetModules: () => {
    mocked.clear();
    generation++;
  },
  /** The `reset` of esmocha: resetModules. */
  get reset() {
    return exnode.resetModules;
  },
  // The module mocks are never hoisted: doMock and doUnmock of Jest and Vitest are mock and unmock.
  get doMock() {
    return exnode.mock;
  },
  get doUnmock() {
    return exnode.unmock;
  },
  /** Sets a variable of the environment for the test, undefined deleting it: given back after it (see unstubAllEnvs). */
  stubEnv: (name: string, value: string | undefined) => {
    if (!envs.has(name)) envs.set(name, process.env[name]);
    setEnv(name, value);
  },
  unstubAllEnvs: () => {
    for (const [name, value] of envs) setEnv(name, value);
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
  exnode.unstubAllEnvs();
  exnode.unstubAllGlobals();
});
