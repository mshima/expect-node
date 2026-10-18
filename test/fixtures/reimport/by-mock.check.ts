import { exnode, expect, it } from '../../../src/index.ts';

import type * as Dep from './dep.ts';
import { one } from './lib.ts';

it('imports again the module imported before a mock of reimport, while it is', async () => {
  // A mock without reimport: the module imported before keeps the module itself.
  await exnode.mock('./dep.ts', { dep: () => 3 });
  expect((await import('./lib.ts')).two()).toBe(2);
  await exnode.mock('./dep.ts', { dep: () => 5 }, { reimport: true });
  expect((await import('./lib.ts')).two()).toBe(6);
  expect(one()).toBe(1);
  // Once no module is mocked with reimport, the module imported before again.
  exnode.unmock('./dep.ts');
  expect((await import('./lib.ts')).two()).toBe(2);
  // An automatic mock with reimport: every export mocked.
  const mocked = await exnode.mock<typeof Dep>('./dep.ts', undefined, { reimport: true });
  mocked.dep.mockReturnValue(7);
  expect((await import('./lib.ts')).two()).toBe(8);
});
