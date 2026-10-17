/**
 * The `this` of mocha in the tests, the suites and the hooks (`this.skip()`, `this.timeout(ms)`), by the `mocha` of the
 * configuration (see config.ts), which the bin gives to the test files (see env.ts): for a migration from mocha or
 * esmocha, deprecated, each of them warning once.
 */
import { ENV } from './env.ts';

export const MOCHA = process.env[ENV.mocha] === 'true';

/** The `this` of a test, a suite or a hook, with the `mocha` configuration only. */
export type MochaThis = {
  /** @deprecated The context a test gets: `({ skip }) => skip()`. */
  skip: () => void;
  /** @deprecated The timeout of the test, of the hook or of the configuration; in a suite, the one of its tests. */
  timeout: (ms?: number) => void;
};

const INSTEAD = {
  skip: 'the context a test gets, ({ skip }) => skip()',
  timeout: 'the timeout of the test, of the hook or of the configuration (none in a test or a hook)',
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

/** The `this` of a test, a suite or a hook given what its skip and its timeout do, none without the `mocha` configuration. */
export const mochaThis = (skip: () => void, timeout: (ms?: number) => void = () => undefined): MochaThis | undefined =>
  MOCHA
    ? {
        skip: () => {
          deprecated('skip');
          skip();
        },
        timeout: ms => {
          deprecated('timeout');
          timeout(ms);
        },
      }
    : undefined;
