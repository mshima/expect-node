/**
 * The durations of the test files, by their path from the cwd, in a file of the project (`durations` of the
 * configuration): the workers run the longest first (longest processing time first), so that the longest ones are not
 * the last of a run, the others filling the workers around them, and so do the processes of the test files without
 * workers. A run writes it when it is not there, and only reads it else: the file is of the project, kept by git like the
 * snapshots, the order the same in every run; it is written again once removed.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

/** The file of the durations of `durations: true`. */
export const DEFAULT_DURATIONS = '.expect-node.durations.json';

type Durations = Record<string, number>;

/** The durations of a file of them, none when it is not there or not of them. */
const read = (file: string): Durations => {
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as { files?: Durations }).files ?? {};
  } catch {
    return {};
  }
};

/**
 * The test files in the order to run them: the ones of no duration first (a new test file is often a long one), in
 * their order, then the longest first.
 */
export const longestFirst = (files: string[], durationsFile: string): string[] => {
  const durations = read(resolve(durationsFile));
  const of = (file: string) => durations[relative(process.cwd(), file)] ?? Infinity;
  return files.toSorted((one, other) => of(other) - of(one) || 0);
};

/** The events of a run the durations are read from: the end of the suite of each test file, at nesting 0. */
type Event = { name: string; nesting: number; file?: string; details: { duration_ms: number } };
type Run = {
  on: (event: 'test:pass' | 'test:fail', listener: (data: Event) => void) => unknown;
  once: (event: 'close', listener: () => void) => unknown;
};

/**
 * Writes the durations of the test files of a run at its end, by their path: of a run of workers, the one of the suite
 * of each test file (its name its path); else, the sum of the ones of the tests and the suites of each test file out of
 * any suite, its process starting and importing its modules not counted.
 */
export const recordDurations = (run: Run, durationsFile: string, workers: boolean): void => {
  const durations: Durations = {};
  const record = ({ name, nesting, file, details }: Event) => {
    if (nesting !== 0) return;
    const path = workers ? name : relative(process.cwd(), file!);
    durations[path] = (durations[path] ?? 0) + details.duration_ms;
  };
  run.on('test:pass', record);
  run.on('test:fail', record);
  run.once('close', () => {
    const file = resolve(durationsFile);
    const files = Object.entries(durations)
      .map(([path, duration]) => [path, Math.round(duration)] as const)
      .toSorted(([one], [other]) => one.localeCompare(other));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ files: Object.fromEntries(files) }, undefined, 2)}\n`);
  });
};
