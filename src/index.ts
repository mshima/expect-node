/**
 * expect-node: node:test with the API of Jest and Vitest. The runner, the coverage (of the subprocesses and the workers
 * too) and the timeouts are node's; the assertions are the expect of Jest (expect.ts, its snapshots snapshots.ts), the
 * mock functions jest-mock, the module mocks in-thread hooks of its own (exnode.ts). Run the tests with the expect-node
 * bin (see cli.ts).
 */
export { expect } from './expect.ts';
export { exnode } from './exnode.ts';
export { afterAll, afterEach, beforeAll, beforeEach, describe, it, test, type TestContext } from './test.ts';
