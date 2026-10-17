import { exnode, expect, it } from '../../../src/index.ts';

import { one } from './lib.ts';

it('keeps the module imported before a mock, its coverage whole', async () => {
  expect(one()).toBe(1);
  await exnode.mock('./dep.ts', { dep: () => 5 });
  // The module imported before, which imported the module itself: the function the test did not run before is covered.
  expect((await import('./lib.ts')).two()).toBe(2);
  expect((await import('./dep.ts')).dep()).toBe(5);
});
