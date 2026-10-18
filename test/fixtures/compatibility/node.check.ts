import { beforeEach, describe, expect, it } from '../../../src/index.ts';

import { sleep } from './sleep.ts';

beforeEach(() => undefined, { timeout: 1000 });

it('takes the timeouts of node:test, not the ones of Vitest and Jest', { timeout: 1000 }, () => {
  expect(() => it('a test', () => undefined, 1000)).toThrow(
    'The timeout of a test as a number after its function is not of the compatibility node, which takes { timeout } before its function; it is of vitest and jest',
  );
  expect(() => beforeEach(() => undefined, 1000)).toThrow('The timeout of a hook as a number after its function');
});

// The timeout of the whole suite: its second test ends after it.
describe('a suite of node:test', { timeout: 150 }, () => {
  it('runs within the timeout of its suite', async () => {
    await sleep(100);
  });
  it('ends after the timeout of its suite', async () => {
    await sleep(100);
  });
});
