/**
 * A worker of the pool of the bin (see cli.ts), like the ones of mocha --parallel: a test process of node:test running
 * the test files the bin gives it, one after the other, each in a suite of its own and its module mocks and spies
 * cleaned after it, like esmocha. The modules they import are imported once for all of them.
 */
import { connect } from 'node:net';
import { createInterface } from 'node:readline';

import { exnode } from './exnode.ts';
import { testFile } from './test.ts';

/** Runs its first test file, then the ones of the queue of the bin, by its socket, until it has none. */
export const work = async (queue: string, first: string): Promise<void> => {
  const socket = connect(queue);
  const lines = createInterface({ input: socket })[Symbol.asyncIterator]();
  const next = async () => {
    socket.write('\n');
    return JSON.parse((await lines.next()).value as string) as string | null;
  };
  try {
    for (let file: string | null = first; file; file = await next()) {
      await testFile(file, () => {
        exnode.resetModules();
        exnode.restoreAllMocks();
      });
    }
  } finally {
    socket.end();
  }
};
