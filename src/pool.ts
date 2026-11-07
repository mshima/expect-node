/**
 * The pool of workers of the bin, like the one of mocha --parallel: node:test runs as many processes (see worker.ts),
 * each taking the next test file of a queue the bin serves by a socket, so a process imports the modules of the code
 * once for several test files instead of once per test file. The reporters, the summary and the coverage stay the ones
 * of node:test.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { availableParallelism, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
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
  // The test files each worker ran, by its first one, which it asks the next one with.
  const ran = new Map<string, string[]>();
  const server = createServer(connection => {
    createInterface({ input: connection }).on('line', line => {
      const file = queue.shift() ?? null;
      if (file) ran.get(JSON.parse(line) as string)!.push(file);
      connection.write(`${JSON.stringify(file)}\n`);
    });
  }).listen(socket);
  const worker = ownModule('worker');
  // Each worker its first test file, so that none runs none (node:test would count it as a test).
  const firsts = new Map<string, string>();
  const entries = queue.splice(0, count).map((first, index) => {
    const entry = join(folder, `worker-${index + 1}.mjs`);
    firsts.set(entry, first);
    ran.set(first, [first]);
    writeFileSync(
      entry,
      `import { work } from ${JSON.stringify(worker)};\n\nawait work(${JSON.stringify(socket)}, ${JSON.stringify(first)});\n`,
    );
    return entry;
  });
  return {
    options: { files: entries, concurrency: count },
    env: { [ENV.worker]: socket },
    /** The test files a worker ran, by its entry. */
    filesOf: (entry: string) => ran.get(firsts.get(entry)!)!,
    close: () => {
      server.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
};

type FileEvent = { name: string; nesting: number; file?: string };
type Run = { on: (type: string, listener: (event: FileEvent) => void) => unknown };

/**
 * The test files named in the report as by node --test, by their paths relative to the folder of the run: the test
 * of a file that reports none of its own (none of its tests run, by a filter), which node:test names by the path it
 * runs, its absolute one, or the entry of a worker (see worker.ts), whose test files are then named instead, the ones
 * of them that reported nothing. Its start, its end and its completion named alike, which the reporters pair.
 */
export const nameTestFiles = (run: Run, filesOf?: (entry: string) => string[]) => {
  const reported = new Map<string, Set<string>>();
  const names = new Map<string, string>();
  const name = (event: FileEvent) => {
    if (event.nesting !== 0 || !event.file) return;
    if (event.name !== event.file) {
      // A suite of a test file of a worker, named by its relative path, or a test of a test file.
      reported.set(event.file, (reported.get(event.file) ?? new Set()).add(event.name));
      return;
    }
    if (!names.has(event.file)) {
      const ofFile = reported.get(event.file);
      const files = (filesOf?.(event.file) ?? [event.file]).map(file => relative(process.cwd(), file));
      names.set(event.file, files.filter(file => !ofFile?.has(file)).join(', '));
    }
    event.name = names.get(event.file)!;
  };
  for (const type of ['test:start', 'test:pass', 'test:fail', 'test:complete']) run.on(type, name);
};
