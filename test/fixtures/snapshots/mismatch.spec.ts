import { expect, it } from '../../../src/index.ts';

it('fails on snapshots that do not match', () => {
  expect({ value: 2 }).toMatchSnapshot();
  expect(() => {
    throw new Error('another');
  }).toThrowErrorMatchingSnapshot();
});

it('fails on a snapshot that does not match', () => {
  expect('one').toMatchSnapshot();
});
