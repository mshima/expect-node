import { describe, expect, it } from '../src/index.ts';

describe('snapshots', () => {
  it('matches a value against its snapshot, in the file of jest', () => {
    expect({ name: 'expect-node', list: [1, 2] }).toMatchSnapshot();
  });

  it('matches an inline snapshot', () => {
    expect('inline').toMatchInlineSnapshot(`"inline"`);
  });

  it('matches the error thrown against its snapshot', () => {
    expect(() => {
      throw new Error('thrown');
    }).toThrowErrorMatchingSnapshot();
  });

  it.skip('keeps the snapshots of a skipped test', () => {
    expect('skipped').toMatchSnapshot();
  });
});
