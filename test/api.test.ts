import {
  after,
  afterAll,
  afterEach,
  before,
  beforeAll,
  beforeEach,
  clearAllMocks,
  describe,
  exnode,
  expect,
  fn,
  isMockFunction,
  it,
  resetAllMocks,
  restoreAllMocks,
  spyOn,
  test,
} from '../src/index.ts';

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
    calls.push('afterAll');
  });

  it('runs the hooks around each test', () => {
    expect(calls).toEqual(['beforeAll', 'beforeEach']);
  });

  it('takes a timeout after the function, or options before it', { timeout: 1000 }, () => {
    // The hooks of the test before it, then the ones of this one.
    expect(calls).toEqual(['beforeAll', 'beforeEach', 'afterEach', 'beforeEach']);
  });

  it.each([
    [1, 2],
    [2, 4],
  ])('names a case by its values: %s doubled is %d', (value, doubled) => {
    expect(value * 2).toBe(doubled);
  });

  it('takes a timeout after the function', () => {
    expect(1).toBe(1);
  }, 1000);

  it.each([[1, 2]])('names a case with a %% and its values: %s', { timeout: 1000 }, (value, doubled) => {
    expect(value * 2).toBe(doubled);
  });

  it.skipIf(false)('runs a test not skipped, with its options', { timeout: 1000 }, () => {
    expect(1).toBe(1);
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

describe('test', () => {
  test('is it', () => {
    expect(test).toBe(it);
  });

  it.todo('reports a test to write');
});

describe('the names of mocha and esmocha', () => {
  it('has before and after, and the mock functions by themselves', () => {
    expect({ before, after }).toEqual({ before: beforeAll, after: afterAll });
    expect({ fn, spyOn, isMockFunction, clearAllMocks, resetAllMocks, restoreAllMocks }).toEqual({
      fn: exnode.fn,
      spyOn: exnode.spyOn,
      isMockFunction: exnode.isMockFunction,
      clearAllMocks: exnode.clearAllMocks,
      resetAllMocks: exnode.resetAllMocks,
      restoreAllMocks: exnode.restoreAllMocks,
    });
  });

  describe('a hook ending by its callback', () => {
    let done = false;
    before(end => {
      setTimeout(() => {
        done = true;
        end();
      }, 10);
    });
    it('runs after it', () => {
      expect(done).toBe(true);
    });
  });

  it('gives no this of mocha without its configuration', function () {
    expect(this).toBeUndefined();
  });
});
