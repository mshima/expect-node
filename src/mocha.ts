/**
 * The `this` of mocha in the tests, the suites and the hooks (`this.skip()`, `this.timeout(ms)`), by the compatibility
 * mocha (see compatibility.ts): for a migration from mocha or esmocha, deprecated, each of them warning once.
 */
import { COMPATIBILITY } from './compatibility.ts';

export const MOCHA = COMPATIBILITY === 'mocha';

/** The `this` of a test, a suite or a hook, with the compatibility mocha only. */
export type MochaThis = {
  /** @deprecated The context a test gets: `({ skip }) => skip()`. */
  skip: () => void;
  /**
   * @deprecated The timeout of the test, of the hook or of the configuration. Its timeout from now, 0 for none, and
   * gives it; in a suite, the one of its tests and hooks.
   */
  timeout: (ms?: number) => number | undefined;
};

const INSTEAD = {
  skip: 'the context a test gets, ({ skip }) => skip()',
  timeout: 'the timeout of the test, of the hook or of the configuration',
};
const warned = new Set<string>();
const deprecated = (name: keyof typeof INSTEAD) => {
  if (warned.has(name)) return;
  warned.add(name);
  process.emitWarning(`this.${name}() of mocha is deprecated: use ${INSTEAD[name]}`, {
    type: 'DeprecationWarning',
    code: 'EXNODE_MOCHA_THIS',
  });
};

/** The `this` of a test, a suite or a hook given what its skip and its timeout do, none but with mocha. */
export const mochaThis = (skip: () => void, timeout: (ms?: number) => number | undefined): MochaThis | undefined =>
  MOCHA
    ? {
        skip: () => {
          deprecated('skip');
          skip();
        },
        timeout: ms => {
          deprecated('timeout');
          return timeout(ms);
        },
      }
    : undefined;

/**
 * Runs a test or a hook of mocha within its timeout, which `this.timeout(ms)` sets from then, like mocha (node:test
 * cannot change the timeout of a test running): the run given gets the timeout to set and to read.
 */
export const timed = (initial: number | undefined, run: (timeout: (ms?: number) => number | undefined) => Promise<void>) =>
  new Promise<void>((resolve, reject) => {
    let current = initial;
    let timer: NodeJS.Timeout | undefined;
    const set = (ms: number | undefined) => {
      clearTimeout(timer);
      current = ms;
      if (ms && Number.isFinite(ms)) timer = setTimeout(() => reject(new Error(`Timeout of ${ms}ms exceeded`)), ms);
    };
    set(initial);
    run(ms => {
      if (ms !== undefined) set(ms);
      return current;
    }).then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
