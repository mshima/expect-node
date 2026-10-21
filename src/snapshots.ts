/**
 * The snapshots of Jest and esmocha, by jest-snapshot when it is installed: the same files (`__snapshots__/<test
 * file>.snap`), the same names (the titles of the suites and of the test, by spaces) and format. Updated by
 * `UPDATE_SNAPSHOT` (`all`, `new` or `none`, the `--update-snapshot` of the bin gives `all`): the new ones written
 * by default, none in CI.
 */
import { basename, dirname, join } from 'node:path';
import * as nodeTest from 'node:test';

import { expect as jestExpect } from 'expect';

import { ENV } from './env.ts';

// Without jest-snapshot, which its tests have.
/* node:coverage ignore next */
const snapshots = await import('jest-snapshot').catch(() => undefined);
const SNAPSHOT_MATCHERS = [
  'toMatchSnapshot',
  'toMatchInlineSnapshot',
  'toThrowErrorMatchingSnapshot',
  'toThrowErrorMatchingInlineSnapshot',
] as const;
if (snapshots) {
  jestExpect.extend(Object.fromEntries(SNAPSHOT_MATCHERS.map(name => [name, snapshots[name]])) as never);
  Object.assign(jestExpect, { addSnapshotSerializer: snapshots.addSerializer });
  // Without jest-snapshot, which its tests have.
  /* node:coverage disable */
} else {
  jestExpect.extend(
    Object.fromEntries(
      SNAPSHOT_MATCHERS.map(name => [
        name,
        () => {
          throw new Error(`${name} needs jest-snapshot, an optional peer dependency of expect-node: npm install --save-dev jest-snapshot`);
        },
      ]),
    ),
  );
}
/* node:coverage enable */

/** The snapshots of a test file, whether a test of it failed, and its tests skipped. */
type SnapshotFile = { state: object; failed: boolean; skipped: Set<string> };
type SnapshotState = InstanceType<NonNullable<typeof snapshots>['SnapshotState']>;

const snapshotFiles = new Map<string, SnapshotFile & { state: SnapshotState }>();

/** The snapshots of a test file, none without jest-snapshot. */
export const snapshotFileOf = (testPath: string): SnapshotFile | undefined => {
  // Without jest-snapshot, which its tests have.
  /* node:coverage ignore next */
  if (!snapshots) return undefined;
  let file = snapshotFiles.get(testPath);
  if (!file) {
    // By the environment of the run: in CI or not, the --update-snapshot of the bin.
    /* node:coverage ignore next */
    const updateSnapshot = (process.env[ENV.updateSnapshot] ?? (process.env.CI ? 'none' : 'new')) as 'all' | 'new' | 'none';
    const state = new snapshots.SnapshotState(join(dirname(testPath), '__snapshots__', `${basename(testPath)}.snap`), {
      updateSnapshot,
      snapshotFormat: { escapeString: false, printBasicPrototype: false },
      rootDir: process.cwd(),
    });
    file = { state, failed: false, skipped: new Set() };
    snapshotFiles.set(testPath, file);
  }
  return file;
};

/** The test the snapshot matchers are of (snapshotState, currentTestName, testPath of the state of expect), or none. */
export const setSnapshotTest = (test?: { file: SnapshotFile; name: string; testPath: string }) =>
  jestExpect.setState({
    snapshotState: test?.file.state,
    currentTestName: test?.name,
    testPath: test?.testPath,
    suppressedErrors: [],
  } as never);

/**
 * The snapshots of a test that do not match: jest-snapshot gives their errors to expect (`suppressedErrors`) instead of
 * throwing them, for the runner of Jest to fail the test with them once it ran.
 */
export const snapshotErrors = (): Error[] => (jestExpect.getState() as { suppressedErrors: Error[] }).suppressedErrors;

/**
 * Saves the snapshots of the test files run, the ones of their tests not run removed (an update of all of them, none
 * failed): at the end of the test file of a process, or of each test file of a worker (see worker.ts), whose root hooks
 * run at the end of its first one.
 */
export const saveSnapshots = (): void => {
  for (const { state, failed, skipped } of snapshotFiles.values()) {
    for (const name of skipped) state.markSnapshotsAsCheckedForTest(name);
    if (!failed) state.removeUncheckedKeys();
    state.save();
  }
  snapshotFiles.clear();
};
nodeTest.after(saveSnapshots);
