import { describe, expect, it } from '../../../src/index.ts';

const scope = globalThis as { setups?: number; eachs?: number };

describe('a test file after it', () => {
  it('has the module itself', async () => {
    expect((await import('./value.ts')).value()).toBe(1);
  });

  it('ran the setup', () => {
    expect(scope.eachs).toBeGreaterThan(0);
    process.stdout.write(`setups: ${scope.setups}\n`);
  });
});
