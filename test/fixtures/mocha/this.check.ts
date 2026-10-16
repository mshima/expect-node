import { after, afterEach, before, beforeEach, describe, it } from '../../../src/index.ts';

describe('the this of mocha', function () {
  this.timeout(1);
  it('skips by this.skip()', function () {
    this.skip();
    throw new Error('not skipped');
  });
  it('has this.timeout, of no effect', function () {
    this.timeout(5);
  });
  describe('a suite in it', () => {
    it('times out by the timeout of its parent suite', async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });
});

describe('a suite skipping', function () {
  this.skip();
  it('is skipped', () => {
    throw new Error('not skipped');
  });
});

describe('a beforeAll skipping', () => {
  before(function () {
    this.skip();
  });
  it('is skipped', () => {
    throw new Error('not skipped');
  });
});

describe('a beforeEach skipping', () => {
  let first = true;
  beforeEach(function () {
    this.timeout(5);
    if (first) {
      first = false;
      this.skip();
    }
  });
  afterEach(function () {
    this.skip();
  });
  after(() => undefined);
  it('is skipped', () => {
    throw new Error('not skipped');
  });
  it('runs', () => undefined);
});
