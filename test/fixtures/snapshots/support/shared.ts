import { expect, it } from '../../../../src/index.ts';

// Tests a shared module declares for the test file calling it: their snapshots are of that test file.
export const sharedTests = () => {
  it('matches a snapshot of a shared module', () => {
    expect({ shared: true }).toMatchSnapshot();
  });
};
