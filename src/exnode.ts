import * as nodeTest from 'node:test';

import { type Mocked, ModuleMocker } from 'jest-mock';

import { actualOf, removeMock, setMock, urlOf } from './mocks.ts';

const mocker = new ModuleMocker(globalThis);

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
   * vi.mock; a module imported before is imported again, the packages kept (see the generation of mocks.ts). Its
   * exports over the ones of the module itself (a factory gets them, like importOriginal), the modules importing other
   * names of it still linking; without them, every export mocked by jest-mock (its functions mock functions), like
   * esmocha. Gives the exports of the mock.
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
    setMock(url, module, original);
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
    removeMock(urlOf(specifier));
  },
  /** The module itself, mocked or not: the `requireActual` of Jest, the `importActual` of Vitest. */
  importActual: async <T = Record<string, unknown>>(specifier: string): Promise<T> => (await actualOf(urlOf(specifier))) as T,
  /** A value typed as its mock, like the `mocked` of Jest and Vitest. */
  mocked: mocker.mocked.bind(mocker),
  /** Every module mocked itself again, for the imports after it. */
  resetModules: () => {
    removeMock();
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
