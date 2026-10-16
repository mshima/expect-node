import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from '../src/index.ts';

describe('the API of Jest and Vitest', () => {
  const calls: string[] = [];
  beforeAll(() => {
    calls.push('beforeAll');
  });
  beforeEach(() => {
    calls.push('beforeEach');
  }, 1000);
  afterEach(() => {
    calls.push('afterEach');
  });
  afterAll(() => {
    // Each test run between its hooks, the skipped ones not.
    expect(calls.slice(0, 3)).toEqual(['beforeAll', 'beforeEach', 'afterEach']);
    expect(calls.filter(call => call === 'beforeEach')).toHaveLength(calls.filter(call => call === 'afterEach').length);
  });

  it('runs the hooks around each test', () => {
    expect(calls).toEqual(['beforeAll', 'beforeEach']);
  });

  it('takes a timeout after the function, or options before it', { timeout: 1000 }, () => {
    expect(1).toBe(1);
  });

  it.each([
    [1, 2],
    [2, 4],
  ])('names a case by its values: %s doubled is %d', (value, doubled) => {
    expect(value * 2).toBe(doubled);
  });

  it.skipIf(true)('skips a test when told', () => {
    throw new Error('not run');
  });

  it.runIf(false)('runs a test only when told', () => {
    throw new Error('not run');
  });

  it('ends a test skipped from its context', ({ skip }) => {
    skip('not here');
    throw new Error('not run');
  });
});

describe.each(['a', 'b'])('a suite of each value %s', value => {
  it('has its value', () => {
    expect(['a', 'b']).toContain(value);
  });
});

describe('expect', () => {
  it('tells the message given before the failure of the matcher', async () => {
    expect(() => expect(1, 'the value').toBe(2)).toThrow(/^the value\n\n/);
    expect(() => expect(1, 'not').not.toBe(1)).toThrow(/^not\n\n/);
    await expect(expect(Promise.reject(new Error('no')), 'rejected').rejects.toThrow('yes')).rejects.toThrow(/^rejected\n\n/);
    expect(2, 'passing').toBe(2);
  });

  it('has the asymmetric matchers of Jest', () => {
    expect({ a: 1, b: [1, 2] }).toMatchObject({ b: expect.arrayContaining([2]) });
  });
});
