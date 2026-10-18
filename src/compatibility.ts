/**
 * The compatibility of the tests (see config.ts), which the bin gives to the test files (see env.ts): the format of
 * their timeouts, of node:test by default, else of Vitest, Jest or mocha; the `this` of mocha with mocha.
 */
import { ENV } from './env.ts';

export type Compatibility = 'node' | 'vitest' | 'jest' | 'mocha';

export const COMPATIBILITY = (process.env[ENV.compatibility] ?? 'node') as Compatibility;

/** Where a timeout is given: before the function (`{ timeout }`) or after it (a number, or `{ timeout }` of a hook). */
export type Format = 'options before' | 'number after' | 'options after';
type Of = 'test' | 'suite' | 'hook';

/** The formats of a timeout of each compatibility; mocha gives its timeouts by `this.timeout(ms)`. */
const FORMATS: Record<Compatibility, Record<Of, Format[]>> = {
  node: { test: ['options before'], suite: ['options before'], hook: ['options after'] },
  vitest: { test: ['options before', 'number after'], suite: ['options before', 'number after'], hook: ['number after'] },
  jest: { test: ['number after'], suite: [], hook: ['number after'] },
  mocha: { test: [], suite: [], hook: [] },
};
const TOLD: Record<Format, string> = {
  'options before': '{ timeout } before its function',
  'number after': 'a number after its function',
  'options after': '{ timeout } after its function',
};

/**
 * Fails a timeout given in a format of another compatibility than the one of the tests: never ignored, which a
 * migration would not see.
 */
export const checkTimeout = (of: Of, format: Format): void => {
  if (FORMATS[COMPATIBILITY][of].includes(format)) return;
  const others = (Object.keys(FORMATS) as Compatibility[]).filter(compatibility => FORMATS[compatibility][of].includes(format));
  const takes = COMPATIBILITY === 'mocha' ? ['this.timeout(ms)'] : FORMATS[COMPATIBILITY][of].map(own => TOLD[own]);
  throw new TypeError(
    `The timeout of a ${of} as ${TOLD[format]} is not of the compatibility ${COMPATIBILITY}, which takes ` +
      `${takes.join(' or ') || 'none'}; it is of ${others.join(' and ')} (compatibility in the configuration).`,
  );
};
