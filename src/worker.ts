/**
 * A worker of the pool of the bin (see pool.ts), like the ones of mocha --parallel: a test process of node:test running
 * its first test file, then the ones of the queue of the bin, one after the other, each in a suite of its own and its
 * module mocks and spies cleaned up and its snapshots saved after it, like esmocha. The modules they import are
 * imported once for all of them.
 */
import { connect } from 'node:net';
import { relative } from 'node:path';
import { createInterface } from 'node:readline';
import * as nodeTest from 'node:test';
import { pathToFileURL } from 'node:url';

import { declarations } from './caller.ts';
import { exnode } from './exnode.ts';
import { saveSnapshots } from './snapshots.ts';
import { rootHooks, running } from './test.ts';

/**
 * A test file, in a suite of its own (its relative path): imported first, its tests, its suites and its hooks held (see
 * caller.ts), then the suite of the root hooks of the setup files and of them, declared at once, then the cleanup,
 * before the next test file is imported.
 */
const testFile = async (file: string) => {
  running.file = file;
  const held: (() => unknown)[] = [];
  let failed: { error: unknown } | undefined;
  rootHooks.open = true;
  declarations.held = held;
  try {
    await import(pathToFileURL(file).href);
  } catch (error) {
    failed = { error };
  } finally {
    declarations.held = undefined;
  }
  try {
    await nodeTest.describe(relative(process.cwd(), file), () => {
      for (const declare of rootHooks.deferred) declare();
      for (const declare of held) declare();
      nodeTest.after(() => {
        exnode.resetModules();
        exnode.restoreAllMocks();
        saveSnapshots();
      });
      // A test file that fails to import fails its suite.
      if (failed) throw failed.error;
    });
  } finally {
    rootHooks.open = false;
  }
};

/** Runs its first test file, then the ones of the queue of the bin, by its socket, until it has none. */
export const work = async (queue: string, first: string): Promise<void> => {
  const socket = connect(queue);
  const lines = createInterface({ input: socket })[Symbol.asyncIterator]();
  const next = async () => {
    // The worker by its first test file, for the bin to name the ones it ran (see pool.ts).
    socket.write(`${JSON.stringify(first)}\n`);
    return JSON.parse((await lines.next()).value as string) as string | null;
  };
  try {
    for (let file: string | null = first; file; file = await next()) await testFile(file);
  } finally {
    socket.end();
  }
};
