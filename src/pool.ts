/**
 * The pool of workers of the bin, like the one of mocha --parallel: node:test runs as many processes (see worker.ts),
 * each taking the next test file of a queue the bin serves by a socket, so a process imports the modules of the code
 * once for several test files instead of once per test file. The reporters, the summary and the coverage stay the ones
 * of node:test.
 */
import { globSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { availableParallelism, tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';

const EXTENSIONS = '{cjs,mjs,js,cts,mts,ts}';
/** The default patterns of node:test. */
const DEFAULT_PATTERNS = ['*.test', '*-test', '*_test', 'test-*', 'test', 'test/**/*'].map(name => `**/${name}.${EXTENSIONS}`);

/**
 * The workers of the test files given, else of the patterns, else of the default ones: as many as given, as the cores
 * for true, never more than the test files. Gives the options of run, and what to close once it ran.
 */
export const pool = (files: string[] | undefined, patterns: string[] | undefined, workers: number | true) => {
  const queue =
    files ??
    globSync(patterns ?? DEFAULT_PATTERNS)
      .filter(file => !file.split(sep).includes('node_modules'))
      .map(file => resolve(file))
      .sort();
  const count = Math.min(workers === true ? availableParallelism() : workers, queue.length);
  const folder = mkdtempSync(join(tmpdir(), 'exnode-'));
  // A named pipe on Windows.
  /* node:coverage ignore next */
  const socket = process.platform === 'win32' ? `\\\\?\\pipe\\${folder}` : join(folder, 'queue.sock');
  const server = createServer(connection => {
    createInterface({ input: connection }).on('line', () => connection.write(`${JSON.stringify(queue.shift() ?? null)}\n`));
  }).listen(socket);
  // The worker of the sources or of the build, as this module.
  const worker = new URL(`./worker${extname(import.meta.url)}`, import.meta.url).href;
  // Each worker its first test file, so that none runs none (node:test would count it as a test).
  const entries = queue.splice(0, count).map((first, index) => {
    const entry = join(folder, `worker-${index + 1}.mjs`);
    writeFileSync(
      entry,
      `import { work } from ${JSON.stringify(worker)};\n\nawait work(${JSON.stringify(socket)}, ${JSON.stringify(first)});\n`,
    );
    return entry;
  });
  // The workers, test processes, inherit the environment.
  process.env.EXNODE_WORKER = socket;
  return {
    options: { files: entries, concurrency: count },
    close: () => {
      server.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
};
