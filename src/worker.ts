/**
 * A worker of the pool of the bin (see pool.ts), like the ones of mocha --parallel: a test process of node:test running
 * its first test file, then the ones of the queue of the bin, one after the other, each in a suite of its own and its
 * module mocks and spies cleaned up and its snapshots saved after it, like esmocha. The modules they import are imported once for all of them.
 */
import { connect } from 'node:net';
import { relative } from 'node:path';
import { createInterface } from 'node:readline';
import * as nodeTest from 'node:test';
import { pathToFileURL } from 'node:url';

import { exnode } from './exnode.ts';
import { saveSnapshots } from './snapshots.ts';
import { rootHooks, running } from './test.ts';

/**
 * A test file, in a suite of its own (its relative path): the root hooks of the setup files and its tests, then the
 * cleanup, before the next test file is imported.
 */
const testFile = (file: string) =>
  nodeTest.describe(relative(process.cwd(), file), async () => {
    for (const declare of rootHooks.deferred) declare();
    rootHooks.open = true;
    running.file = file;
    try {
      await import(pathToFileURL(file).href);
    } finally {
      rootHooks.open = false;
      nodeTest.after(() => {
        exnode.resetModules();
        exnode.restoreAllMocks();
        saveSnapshots();
      });
    }
  });

/** Runs its first test file, then the ones of the queue of the bin, by its socket, until it has none. */
export const work = async (queue: string, first: string): Promise<void> => {
  const socket = connect(queue);
  const lines = createInterface({ input: socket })[Symbol.asyncIterator]();
  const next = async () => {
    socket.write('\n');
    return JSON.parse((await lines.next()).value as string) as string | null;
  };
  try {
    for (let file: string | null = first; file; file = await next()) await testFile(file);
  } finally {
    socket.end();
  }
};
