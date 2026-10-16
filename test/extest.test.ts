import { describe, expect, extest, it } from '../src/index.ts';

import type * as Double from './fixtures/double.ts';

await extest.mock('./fixtures/double.ts', { double: (value: number) => value * 3 });
// Imported once its modules are mocked.
const { quadruple } = await import('./fixtures/math.ts');

describe('extest', () => {
  it('mocks a module for the imports after it, its other exports kept', async () => {
    expect(quadruple(1)).toBe(9);
    expect((await import('./fixtures/double.ts')).half(4)).toBe(2);
  });

  it('gives a factory the exports of the module', async () => {
    await extest.mock('./fixtures/math.ts', async importOriginal => ({
      quadruple: (await importOriginal<{ quadruple: (value: number) => number }>()).quadruple,
    }));
    expect((await import('./fixtures/math.ts')).quadruple(2)).toBe(18);
  });

  it('has the mock functions of jest-mock', () => {
    const fn = extest.fn((value: number) => value + 1);
    expect(fn(1)).toBe(2);
    expect(fn).toHaveBeenCalledTimes(1);
    const object = { method: () => 'real' };
    extest.spyOn(object, 'method').mockReturnValue('spied');
    expect(object.method()).toBe('spied');
    extest.restoreAllMocks();
    expect(extest.isMockFunction(fn)).toBe(true);
    extest.clearAllMocks();
    expect(fn).not.toHaveBeenCalled();
    extest.resetAllMocks();
    expect(fn(1)).toBeUndefined();
    expect(object.method()).toBe('real');
  });

  it('stubs the environment and the globals for a test', () => {
    extest.stubEnv('EXPECT_TEST_STUBBED', 'yes');
    extest.stubEnv('PATH', undefined);
    extest.stubGlobal('expectTestStubbed', 1);
    extest.stubGlobal('setTimeout', 'stubbed');
    expect(process.env.EXPECT_TEST_STUBBED).toBe('yes');
    expect(process.env.PATH).toBeUndefined();
    expect((globalThis as Record<string, unknown>).expectTestStubbed).toBe(1);
  });

  it('gives them back after it', () => {
    expect(process.env.EXPECT_TEST_STUBBED).toBeUndefined();
    expect(process.env.PATH).toBeDefined();
    expect('expectTestStubbed' in globalThis).toBe(false);
    expect(typeof setTimeout).toBe('function');
  });
});

describe('the module mocks of extest', () => {
  it('mocks every export without exports given, and gives them', async () => {
    const mocked = await extest.mock<typeof Double>('./fixtures/double.ts');
    expect(extest.isMockFunction(mocked.double)).toBe(true);
    mocked.half.mockReturnValue(7);
    expect((await import('./fixtures/double.ts')).half(4)).toBe(7);
  });

  it('gives the module itself, mocked or not, and a value typed as its mock', async () => {
    await extest.doMock('./fixtures/double.ts', { half: () => 0 });
    expect((await extest.importActual<typeof Double>('./fixtures/double.ts')).half(4)).toBe(2);
    extest.doUnmock('./fixtures/double.ts');
    expect((await extest.importActual<typeof Double>('./fixtures/double.ts')).half(4)).toBe(2);
    const fn = extest.fn((value: number) => value);
    extest.mocked(fn).mockReturnValue(3);
    expect(fn(1)).toBe(3);
  });

  it('gives the module itself again', async () => {
    extest.unmock('./fixtures/double.ts');
    expect((await import('./fixtures/double.ts')).half(4)).toBe(2);
    await extest.mock('./fixtures/double.ts', { half: () => 0 });
    extest.resetModules();
    expect((await import('./fixtures/double.ts')).half(4)).toBe(2);
  });
});
