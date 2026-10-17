/**
 * The coverage of a run, merged by file. node:test reports a file per module instance: a module imported again (by
 * `reimport`, see mocks.ts) is a second instance of it, and a function one of them did not run counted as not covered.
 * The bin merges them into one file before the reporters read the coverage, and checks the minimums on it (node:test
 * would check them on the instances).
 */
type Count = { line: number; count: number };
type FileCoverage = {
  path: string;
  functions: (Count & { name: string })[];
  branches: Count[];
  lines: Count[];
} & Record<`${'total' | 'covered'}${Kind}Count`, number> &
  Record<`covered${Kind}Percent`, number>;
type Kind = 'Line' | 'Branch' | 'Function';
type Summary = { files: FileCoverage[]; totals: Record<string, number> };

const KINDS = [
  ['Line', 'lines'],
  ['Branch', 'branches'],
  ['Function', 'functions'],
] as const;

type Minimums = Partial<Record<'lines' | 'branches' | 'functions', number>>;

const percent = (covered: number, total: number) => (total === 0 ? 100 : (covered / total) * 100);

/**
 * The entries of the instances of a file, the counts of the alike summed: alike by their key (a function by its line
 * and its name, a branch or a line by its line) and their order among the ones of the same key of their instance.
 */
const sum = <T extends Count>(instances: T[][], key: (entry: T) => string): T[] => {
  const merged = new Map<string, T>();
  for (const entries of instances) {
    const seen = new Map<string, number>();
    for (const entry of entries) {
      const id = key(entry);
      const order = seen.get(id) ?? 0;
      seen.set(id, order + 1);
      const at = `${id}#${order}`;
      const before = merged.get(at);
      merged.set(at, before ? { ...before, count: before.count + entry.count } : entry);
    }
  }
  return [...merged.values()];
};

/** The coverage of a file of its instances, its counts and percents of them. */
const mergeFile = (instances: FileCoverage[]): FileCoverage => {
  const file = {
    ...instances[0],
    functions: sum(
      instances.map(({ functions }) => functions),
      ({ line, name }) => `${line}:${name}`,
    ),
    branches: sum(
      instances.map(({ branches }) => branches),
      ({ line }) => String(line),
    ),
    lines: sum(
      instances.map(({ lines }) => lines),
      ({ line }) => String(line),
    ),
  };
  // A line ignored by a comment of node is not among the lines: a branch or a function on it is covered, as node counts.
  const counted = new Set(file.lines.map(({ line }) => line));
  for (const [kind, entries] of KINDS) {
    const total = file[entries].length;
    const covered = file[entries].filter(({ line, count }) => count > 0 || !counted.has(line)).length;
    Object.assign(file, {
      [`total${kind}Count`]: total,
      [`covered${kind}Count`]: covered,
      [`covered${kind}Percent`]: percent(covered, total),
    });
  }
  return file;
};

/** Merges the files of a summary of node:test in place, a file by its path, and its totals. */
export const mergeCoverage = (summary: Summary): void => {
  const byPath = new Map<string, FileCoverage[]>();
  for (const file of summary.files) byPath.set(file.path, [...(byPath.get(file.path) ?? []), file]);
  summary.files = [...byPath.values()].map(mergeFile);
  for (const [kind] of KINDS) {
    const total = summary.files.reduce((all, file) => all + file[`total${kind}Count`], 0);
    const covered = summary.files.reduce((all, file) => all + file[`covered${kind}Count`], 0);
    Object.assign(summary.totals, {
      [`total${kind}Count`]: total,
      [`covered${kind}Count`]: covered,
      [`covered${kind}Percent`]: percent(covered, total),
    });
  }
};

/** The minimums of the coverage a summary does not meet, as node:test tells them. */
export const unmetMinimums = (summary: Summary, minimums: Minimums) =>
  KINDS.flatMap(([kind, name]) => {
    const minimum = minimums[name];
    const actual = summary.totals[`covered${kind}Percent`];
    return minimum === undefined || actual >= minimum
      ? []
      : [`Error: ${actual.toFixed(2)}% ${kind.toLowerCase()} coverage does not meet threshold of ${minimum}%.`];
  });

/** The events of a run of node:test the bin reads: the coverage, and the diagnostic it tells an unmet minimum by. */
type Run = {
  on: (event: 'test:coverage', listener: (data: { summary: Summary }) => void) => unknown;
  diagnostic: (nesting: number, loc: undefined, message: string, level: string) => void;
};

/**
 * The coverage of a run merged by file before its reporters read it (node:test gives them the very summary it emits),
 * and its minimums checked on it: an unmet one told as node:test does, and failing the run.
 */
export const mergeCoverageOf = (run: Run, minimums: Minimums): void => {
  run.on('test:coverage', ({ summary }) => {
    mergeCoverage(summary);
    for (const message of unmetMinimums(summary, minimums)) {
      run.diagnostic(0, undefined, message, 'error');
      process.exitCode = 1;
    }
  });
};
