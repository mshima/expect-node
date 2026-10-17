import { beforeAll } from '../../../src/index.ts';

const scope = globalThis as { setups?: number };
// Of each test file: once per test file of a worker.
beforeAll(() => {
  scope.setups = (scope.setups ?? 0) + 1;
});
