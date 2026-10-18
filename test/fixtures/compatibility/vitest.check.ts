import { beforeEach, describe, expect, it } from '../../../src/index.ts';

import { sleep } from './sleep.ts';

beforeEach(() => undefined, 1000);

it('takes the timeouts of Vitest, not the ones of hooks of node:test', { timeout: 1000 }, () => {
  expect(() => beforeEach(() => undefined, { timeout: 1000 })).toThrow(
    'The timeout of a hook as { timeout } after its function is not of the compatibility vitest, which takes a number after its function; it is of node',
  );
});

it('takes a timeout after the function', () => undefined, 1000);

// The timeout of each test: each runs within it, but the one longer than it.
describe('a suite of Vitest', () => {
  it('runs within the timeout of its suite', async () => {
    await sleep(100);
  });
  it('runs within it too', async () => {
    await sleep(100);
  });
  it('ends after the timeout of its suite', async () => {
    await sleep(300);
  });
}, 150);
