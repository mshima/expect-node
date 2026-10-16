import { expect, it } from '../../../src/index.ts';

import { sum } from './sum.ts';

it('sums', () => {
  expect(sum(2, 2)).toBe(4);
});
