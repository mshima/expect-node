import { expect, it } from '../../../src/index.ts';
import { sum } from './sum.ts';

it('has the environment of the setup and the modules imported', () => {
  expect(process.env.EXPECT_TEST_SETUP).toBe('from the runner');
  expect((globalThis as Record<string, unknown>).expectTestImported).toBe(true);
  expect(sum(1, 2)).toBe(3);
});
