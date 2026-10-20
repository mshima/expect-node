/**
 * The pool of workers of the bin, like the one of mocha --parallel: node:test runs as many processes (see worker.ts),
 * each taking the next test file of a queue the bin serves by a socket, so a process imports the modules of the code
 * once for several test files instead of once per test file. The reporters, the summary and the coverage stay the ones
 * of node:test.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { ownModule } from './caller.ts';
import { longestFirst } from './durations.ts';
import { ENV } from './env.ts';
import { globFiles } from './files.ts';

/**
 * The workers of the test files given, else of the patterns, else of the default ones: as many as given, as the cores
 * for true, never more than the test files, the longest first by a file of their durations. Gives the options of run,
 * the environment of the workers, and what to
 * close once it ran.
 */
export const pool = (files: string[] | undefined, patterns: string[] | undefined, workers: number | true, durations?: string) => {
  // The longest test files first, by the durations of the project (see durations.ts).
  const given = files ?? globFiles(patterns);
  const queue = durations === undefined ? given : longestFirst(given, durations);
  const count = Math.min(workers === true ? availableParallelism() : workers, queue.length);
  const folder = mkdtempSync(join(tmpdir(), 'exnode-'));
  // A named pipe on Windows.
  /* node:coverage ignore next */
  const socket = process.platform === 'win32' ? `\\\\?\\pipe\\${folder}` : join(folder, 'queue.sock');
  const server = createServer(connection => {
    createInterface({ input: connection }).on('line', () => connection.write(`${JSON.stringify(queue.shift() ?? null)}\n`));
  }).listen(socket);
  const worker = ownModule('worker');
  // Each worker its first test file, so that none runs none (node:test would count it as a test).
  const entries = queue.splice(0, count).map((first, index) => {
    const entry = join(folder, `worker-${index + 1}.mjs`);
    writeFileSync(
      entry,
      `import { work } from ${JSON.stringify(worker)};\n\nawait work(${JSON.stringify(socket)}, ${JSON.stringify(first)});\n`,
    );
    return entry;
  });
  return {
    options: { files: entries, concurrency: count },
    env: { [ENV.worker]: socket },
    close: () => {
      server.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
};
