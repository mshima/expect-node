import { after, afterEach, before, beforeEach, describe, expect, it } from '../../../src/index.ts';

describe('the this of mocha', function () {
  this.timeout(1);
  it('skips by this.skip()', function () {
    this.skip();
    throw new Error('not skipped');
  });
  it('takes a timeout of its own from then by this.timeout', async function () {
    expect(this.timeout(200)).toBe(200);
    await new Promise(resolve => setTimeout(resolve, 50));
  });
  it('fails a timeout of another compatibility', () => {
    expect(() => it('a test', () => undefined, 1000)).toThrow('which takes this.timeout(ms)');
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

describe('the timeout of the configuration', function () {
  expect(this.timeout()).toBe(30);
  // The timeout of a hook its own: 0, none.
  before(function () {
    expect(this.timeout()).toBe(30);
    this.timeout(0);
  });
  it('fails a test without its own after it', async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
  });
});
