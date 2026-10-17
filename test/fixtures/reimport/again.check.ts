import { exnode, expect, it } from '../../../src/index.ts';

import { one } from './lib.ts';

it('imports again the module imported before a mock, the one before keeping the module itself', async () => {
  await exnode.mock('./dep.ts', { dep: () => 5 });
  expect((await import('./lib.ts')).two()).toBe(6);
  expect(one()).toBe(1);
  // Once no module is mocked, the module imported before again.
  exnode.unmock('./dep.ts');
  expect((await import('./lib.ts')).two()).toBe(2);
});
