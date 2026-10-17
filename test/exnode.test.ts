import type * as Path from 'node:path';

import { describe, expect, exnode, it } from '../src/index.ts';

import { importLocal, mockLocal } from './fixtures/caller/local.ts';
import type * as Double from './fixtures/double.ts';

await exnode.mock('./fixtures/double.ts', { double: (value: number) => value * 3 });
// Imported once its modules are mocked.
const { quadruple } = await import('./fixtures/math.ts');

describe('exnode', () => {
  it('mocks a module for the imports after it, its other exports kept', async () => {
    expect(quadruple(1)).toBe(9);
    expect((await import('./fixtures/double.ts')).half(4)).toBe(2);
  });

  it('gives a factory the exports of the module', async () => {
    await exnode.mock('./fixtures/math.ts', async importOriginal => ({
      quadruple: (await importOriginal<{ quadruple: (value: number) => number }>()).quadruple,
    }));
    expect((await import('./fixtures/math.ts')).quadruple(2)).toBe(18);
  });

  it('has the mock functions of jest-mock', () => {
    const fn = exnode.fn((value: number) => value + 1);
    expect(fn(1)).toBe(2);
    expect(fn).toHaveBeenCalledTimes(1);
    const object = { method: () => 'real' };
    exnode.spyOn(object, 'method').mockReturnValue('spied');
    expect(object.method()).toBe('spied');
    exnode.restoreAllMocks();
    expect(exnode.isMockFunction(fn)).toBe(true);
    exnode.clearAllMocks();
    expect(fn).not.toHaveBeenCalled();
    exnode.resetAllMocks();
    expect(fn(1)).toBeUndefined();
    expect(object.method()).toBe('real');
  });

  it('stubs the environment and the globals for a test', () => {
    exnode.stubEnv('EXPECT_NODE_STUBBED', 'yes');
    exnode.stubEnv('PATH', undefined);
    exnode.stubGlobal('expectNodeStubbed', 1);
    exnode.stubGlobal('setTimeout', 'stubbed');
    expect(process.env.EXPECT_NODE_STUBBED).toBe('yes');
    expect(process.env.PATH).toBeUndefined();
    expect((globalThis as Record<string, unknown>).expectNodeStubbed).toBe(1);
  });

  it('gives them back after it', () => {
    expect(process.env.EXPECT_NODE_STUBBED).toBeUndefined();
    expect(process.env.PATH).toBeDefined();
    expect('expectNodeStubbed' in globalThis).toBe(false);
    expect(typeof setTimeout).toBe('function');
  });
});

describe('the module mocks of exnode', () => {
  it('mocks every export without exports given, and gives them', async () => {
    const mocked = await exnode.mock<typeof Double>('./fixtures/double.ts');
    expect(exnode.isMockFunction(mocked.double)).toBe(true);
    mocked.half.mockReturnValue(7);
    expect((await import('./fixtures/double.ts')).half(4)).toBe(7);
  });

  it('gives the module itself, mocked or not, and a value typed as its mock', async () => {
    await exnode.doMock('./fixtures/double.ts', { half: () => 0 });
    expect((await exnode.importActual<typeof Double>('./fixtures/double.ts')).half(4)).toBe(2);
    exnode.doUnmock('./fixtures/double.ts');
    expect((await exnode.importActual<typeof Double>('./fixtures/double.ts')).half(4)).toBe(2);
    const fn = exnode.fn((value: number) => value);
    exnode.mocked(fn).mockReturnValue(3);
    expect(fn(1)).toBe(3);
  });

  it('mocks a module of a default export only, and gives a module by a bare specifier', async () => {
    await exnode.mock('./fixtures/default.ts', { default: 7 });
    expect((await import('./fixtures/default.ts')).default).toBe(7);
    expect((await exnode.importActual<typeof Path>('node:path')).sep).toBe('/');
  });

  it('gives the module itself again', async () => {
    exnode.unmock('./fixtures/double.ts');
    expect((await import('./fixtures/double.ts')).half(4)).toBe(2);
    await exnode.mock('./fixtures/double.ts', { half: () => 0 });
    exnode.resetModules();
    expect((await import('./fixtures/double.ts')).half(4)).toBe(2);
  });
});

describe('the module mocks of exnode, from the module calling', () => {
  it('resolves a package from the module calling', async () => {
    await mockLocal();
    expect((await importLocal()).name()).toBe('mocked');
    exnode.reset();
    expect((await importLocal()).name()).toBe('real');
  });
});
