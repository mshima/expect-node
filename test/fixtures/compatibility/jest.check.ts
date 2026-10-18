import { beforeEach, describe, expect, it } from '../../../src/index.ts';

beforeEach(() => undefined, 1000);

it('takes the timeouts of Jest, a suite none', () => {
  expect(() => it('a test', { timeout: 1000 }, () => undefined)).toThrow(
    'The timeout of a test as { timeout } before its function is not of the compatibility jest, which takes a number after its function; it is of node and vitest',
  );
  expect(() => describe('a suite', () => undefined, 1000)).toThrow(
    'The timeout of a suite as a number after its function is not of the compatibility jest, which takes none; it is of vitest',
  );
}, 1000);

it.each([[1, 2]])(
  'takes the timeout of a case after its function, %s doubled is %s',
  (value, doubled) => {
    expect(value * 2).toBe(doubled);
  },
  1000,
);

it('ends by its callback', done => {
  setTimeout(done, 10);
});
