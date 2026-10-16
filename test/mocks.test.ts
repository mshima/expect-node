import { describe, expect, it, mocks } from '../src/index.ts';

await mocks.mock('./fixtures/double.ts', { double: (value: number) => value * 3 });
// Imported once its modules are mocked.
const { quadruple } = await import('./fixtures/math.ts');

describe('mocks', () => {
  it('mocks a module for the imports after it, its other exports kept', async () => {
    expect(quadruple(1)).toBe(9);
    expect((await import('./fixtures/double.ts')).half(4)).toBe(2);
  });

  it('gives a factory the exports of the module', async () => {
    await mocks.mock('./fixtures/math.ts', async importOriginal => ({ quadruple: (await importOriginal<{ quadruple: (value: number) => number }>()).quadruple }));
    expect((await import('./fixtures/math.ts')).quadruple(2)).toBe(18);
  });

  it('has the mock functions of jest-mock', () => {
    const fn = mocks.fn((value: number) => value + 1);
    expect(fn(1)).toBe(2);
    expect(fn).toHaveBeenCalledTimes(1);
    const object = { method: () => 'real' };
    mocks.spyOn(object, 'method').mockReturnValue('spied');
    expect(object.method()).toBe('spied');
    mocks.restoreAllMocks();
    expect(object.method()).toBe('real');
  });

  it('stubs the environment and the globals for a test', () => {
    mocks.stubEnv('EXPECT_TEST_STUBBED', 'yes');
    mocks.stubEnv('PATH', undefined);
    mocks.stubGlobal('expectTestStubbed', 1);
    mocks.stubGlobal('setTimeout', 'stubbed');
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
