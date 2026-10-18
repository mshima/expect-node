import { describe, it } from '../../../src/index.ts';

it.only('a test only', () => undefined);

describe.only('a suite only', () => {
  it('runs in it', () => undefined);
});

it('a test of all', () => undefined);
