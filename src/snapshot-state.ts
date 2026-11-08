/**
 * The snapshots of a test file, as the SnapshotState of jest-snapshot (MIT, Meta Platforms) keeps them: read from its
 * file, matched by the names of the tests and their counts, written as the update says (`all`, `new` or `none`), the
 * ones no test checked removed by an update of all of them. The snapshots named by Vitest (the default) or by Jest
 * (see `names`), the ones of the other names read too; the files of Jest and of Vitest read, and written in the format
 * of expect-node once they change, or by an update of all of them.
 */
import { existsSync, unlinkSync } from 'node:fs';

import type { OptionsReceived } from 'pretty-format';

import { inlineSiteOf, writeInlineSnapshots, type InlineSnapshot } from './inline-snapshots.ts';
import {
  addExtraLineBreaks,
  keyToTestName,
  readSnapshotFile,
  removeExtraLineBreaks,
  serialize,
  testNameToKey,
  writeSnapshotFile,
} from './snapshot-format.ts';

export type UpdateSnapshot = 'all' | 'new' | 'none';

export type SnapshotMatch = {
  testName: string;
  /** The name of the test of the other names (see `names`): its snapshot of a file of them, taken as its own. */
  otherName?: string | undefined;
  received: unknown;
  isInline: boolean;
  inlineSnapshot?: string | undefined;
  /** The error created by the call of the matcher, whose stack tells where an inline snapshot is written. */
  error: Error;
};

export type SnapshotResult = { actual: string; count: number; expected: string | undefined; pass: boolean };

/** The names of the snapshots: of Vitest, its titles and its hint by ` > `; of Jest, by spaces and `: `. */
export type SnapshotNames = 'vitest' | 'jest';

/**
 * The snapshots of a file of Jest or of Vitest, or of the other names: `changed` written in the format of expect-node
 * once their file changes; `all`, every file of them so by a run that writes snapshots; `keep`, their names and the
 * header of their file kept.
 */
export type SnapshotMigration = 'changed' | 'all' | 'keep';

export class SnapshotState {
  /** The names of the snapshots of its file, by which its tests name them (see snapshots.ts). */
  readonly names: SnapshotNames;
  private readonly migration: SnapshotMigration;
  /** The header of its file, written again with `keep`. */
  private readonly header: string | undefined;
  private readonly snapshotPath: string;
  private readonly snapshotFormat: OptionsReceived;
  private readonly update: UpdateSnapshot;
  private readonly data: Record<string, string>;
  private dirty: boolean;
  private readonly unchecked: Set<string>;
  private readonly counters = new Map<string, number>();
  private readonly inlineSnapshots: InlineSnapshot[] = [];

  constructor(
    snapshotPath: string,
    options: { updateSnapshot: UpdateSnapshot; snapshotFormat: OptionsReceived; names?: SnapshotNames; migration?: SnapshotMigration },
  ) {
    this.snapshotPath = snapshotPath;
    this.update = options.updateSnapshot;
    this.snapshotFormat = options.snapshotFormat;
    this.names = options.names ?? 'vitest';
    this.migration = options.migration ?? 'changed';
    const { data, dirty, foreign, header } = readSnapshotFile(snapshotPath, this.update);
    this.data = data;
    this.header = this.migration === 'keep' && foreign && !dirty ? header : undefined;
    // A file of Jest or of Vitest written in the format of expect-node at once, by `all`.
    this.dirty = dirty || (foreign && this.migration === 'all' && this.update !== 'none');
    this.unchecked = new Set(Object.keys(data));
  }

  /** The snapshots of a test not run (skipped) kept, by its titles: checked, never removed as obsolete. */
  markSnapshotsAsCheckedForTest(titles: string[]) {
    // Of Jest, its titles by spaces and a hint after ': '; of Vitest, its titles and a hint by ' > '.
    const tests = [`${titles.join(' ')}: `, `${titles.join(' > ')} > `];
    for (const key of this.unchecked) {
      const name = `${keyToTestName(key)}${key.includes(' > ') ? ' > ' : ': '}`;
      if (tests.some(test => name.startsWith(test))) this.unchecked.delete(key);
    }
  }

  /**
   * The key of a snapshot of a test, the one of the other names (a file of Jest, of Vitest, or of the other names of
   * expect-node) taken as its own: renamed, written so once the file changes, as it is else.
   */
  private keyOf(testName: string, count: number, otherName?: string) {
    const key = testNameToKey(testName, count);
    const otherKey = otherName === undefined ? undefined : testNameToKey(otherName, count);
    if (otherKey === undefined || this.data[key] !== undefined || this.data[otherKey] === undefined) return key;
    // Kept by its name, with `keep`.
    if (this.migration === 'keep') return otherKey;
    this.data[key] = this.data[otherKey];
    delete this.data[otherKey];
    if (this.unchecked.delete(otherKey)) this.unchecked.add(key);
    // Renamed at once, with `all`, by a run that writes snapshots.
    if (this.migration === 'all' && this.update !== 'none') this.dirty = true;
    return key;
  }

  private count(testName: string) {
    const count = (this.counters.get(testName) ?? 0) + 1;
    this.counters.set(testName, count);
    return count;
  }

  private add(key: string, serialized: string, { isInline, error }: SnapshotMatch) {
    this.dirty = true;
    if (isInline) this.inlineSnapshots.push({ site: inlineSiteOf(error), snapshot: serialized });
    else this.data[key] = serialized;
  }

  match(match: SnapshotMatch): SnapshotResult {
    const { testName, otherName, received, isInline, inlineSnapshot } = match;
    const count = this.count(testName);
    const key = this.keyOf(testName, count, otherName);
    // An inline snapshot of a test that has one in the file too: the one of the file left unchecked, removed by an
    // update of all of them.
    if (!(isInline && this.data[key] !== undefined)) this.unchecked.delete(key);
    const serialized = addExtraLineBreaks(serialize(received, undefined, this.snapshotFormat));
    const expected = isInline ? inlineSnapshot : this.data[key];
    const pass = expected === serialized;
    const hasSnapshot = expected !== undefined;
    const persisted = isInline || existsSync(this.snapshotPath);
    // The one of the file written again as printed now, for an escaping lost by the script of the file.
    if (pass && !isInline) this.data[key] = serialized;
    const written = { actual: '', count, expected: '', pass: true };
    if (this.update === 'all' && hasSnapshot) {
      if (!pass) this.add(key, serialized, match);
      return written;
    }
    if ((!hasSnapshot || !persisted) && this.update !== 'none') {
      this.add(key, serialized, match);
      return written;
    }
    if (pass) return written;
    return {
      actual: removeExtraLineBreaks(serialized),
      count,
      expected: expected === undefined ? undefined : removeExtraLineBreaks(expected),
      pass: false,
    };
  }

  /** A snapshot of a test failed before it is matched (its properties): checked, its key given. */
  fail(testName: string, otherName?: string) {
    const key = this.keyOf(testName, this.count(testName), otherName);
    this.unchecked.delete(key);
    return key;
  }

  /** Removes the snapshots no test checked, by an update of all of them. */
  removeUncheckedKeys() {
    if (this.update === 'all' && this.unchecked.size > 0) {
      this.dirty = true;
      for (const key of this.unchecked) delete this.data[key];
      this.unchecked.clear();
    }
  }

  save() {
    const hasExternal = Object.keys(this.data).length > 0;
    const hasInline = this.inlineSnapshots.length > 0;
    // Written once changed only: a file of Jest or of Vitest kept as it is, its header too, until it changes.
    if (this.dirty && (hasExternal || hasInline)) {
      if (hasExternal) writeSnapshotFile(this.data, this.snapshotPath, this.header);
      if (hasInline) writeInlineSnapshots(this.inlineSnapshots);
    } else if (!hasExternal && this.update === 'all' && existsSync(this.snapshotPath)) {
      unlinkSync(this.snapshotPath);
    }
  }
}
