import { EventEmitter } from 'node:events';

import { mergeCoverageOf } from '../src/coverage.ts';
import { describe, expect, it } from '../src/index.ts';

type Entry = { line: number; count: number };
/** The coverage of an instance of a file, as node:test reports it, its counts not mattering to the merge. */
const instance = (path: string, functions: (Entry & { name: string })[], branches: Entry[], lines: Entry[]) => ({
  path,
  functions,
  branches,
  lines,
  totalLineCount: 0,
  totalBranchCount: 0,
  totalFunctionCount: 0,
  coveredLineCount: 0,
  coveredBranchCount: 0,
  coveredFunctionCount: 0,
  coveredLinePercent: 0,
  coveredBranchPercent: 0,
  coveredFunctionPercent: 0,
});

/** A run emitting the coverage of the files given, with the minimums given: the summary merged, the diagnostics told. */
const runOf = (files: ReturnType<typeof instance>[], minimums: Record<string, number>) => {
  const run = Object.assign(new EventEmitter(), { diagnostics: [] as string[] });
  const diagnostic = (_nesting: number, _loc: undefined, message: string) => run.diagnostics.push(message);
  mergeCoverageOf(Object.assign(run, { diagnostic }), minimums);
  const summary = { files, totals: {} as Record<string, number> };
  const exitCode = process.exitCode;
  try {
    run.emit('test:coverage', { summary });
    return { summary, diagnostics: run.diagnostics, failed: process.exitCode === 1 };
  } finally {
    process.exitCode = exitCode;
  }
};

describe('the coverage merged by file', () => {
  it('merges the instances of a file, a function covered by any of them', () => {
    const { summary, diagnostics, failed } = runOf(
      [
        instance(
          '/lib.ts',
          [
            { name: 'one', line: 3, count: 1 },
            { name: 'two', line: 4, count: 0 },
          ],
          [
            { line: 3, count: 1 },
            { line: 3, count: 0 },
          ],
          [
            { line: 3, count: 1 },
            { line: 4, count: 0 },
          ],
        ),
        instance(
          '/lib.ts',
          [
            { name: 'one', line: 3, count: 0 },
            { name: 'two', line: 4, count: 2 },
          ],
          [
            { line: 3, count: 0 },
            { line: 3, count: 1 },
          ],
          [
            { line: 3, count: 0 },
            { line: 4, count: 2 },
          ],
        ),
        instance('/empty.ts', [], [], []),
      ],
      { lines: 100, branches: 100, functions: 100 },
    );
    expect(summary.files).toHaveLength(2);
    expect(summary.files[0]).toMatchObject({
      functions: [
        { name: 'one', count: 1 },
        { name: 'two', count: 2 },
      ],
      branches: [
        { line: 3, count: 1 },
        { line: 3, count: 1 },
      ],
      totalFunctionCount: 2,
      coveredFunctionCount: 2,
      coveredFunctionPercent: 100,
      coveredBranchPercent: 100,
      coveredLinePercent: 100,
    });
    // A file of nothing to cover is covered.
    expect(summary.files[1]).toMatchObject({ coveredFunctionPercent: 100, totalFunctionCount: 0 });
    expect(summary.totals).toMatchObject({ totalFunctionCount: 2, coveredFunctionCount: 2, coveredFunctionPercent: 100 });
    expect({ diagnostics, failed }).toEqual({ diagnostics: [], failed: false });
  });

  it('counts a branch and a function on a line ignored as covered, as node', () => {
    const { summary } = runOf(
      [instance('/ignored.ts', [{ name: 'path', line: 2, count: 0 }], [{ line: 2, count: 0 }], [{ line: 1, count: 1 }])],
      {},
    );
    expect(summary.files[0]).toMatchObject({ coveredBranchPercent: 100, coveredFunctionPercent: 100 });
  });

  it('tells the minimums the merged coverage does not meet, failing the run', () => {
    const { summary, diagnostics, failed } = runOf(
      [instance('/lib.ts', [{ name: 'one', line: 1, count: 0 }], [], [{ line: 1, count: 1 }])],
      { lines: 100, functions: 50 },
    );
    expect(summary.totals).toMatchObject({ coveredLinePercent: 100, coveredBranchPercent: 100, coveredFunctionPercent: 0 });
    expect(diagnostics).toEqual(['Error: 0.00% function coverage does not meet threshold of 50%.']);
    expect(failed).toBe(true);
  });
});
