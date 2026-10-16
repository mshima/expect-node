import { before, describe, expect, it } from '../../../src/index.ts';

it('fails', () => {
  expect(1).toBe(2);
});

describe('a hook failing by its callback', () => {
  before(done => done(new Error('the hook failed')));
  it('is not run', () => undefined);
});
