import { expect, it } from '../../../src/index.ts';

it('has the this of mocha', function () {
  expect(this.timeout()).toBeUndefined();
});
