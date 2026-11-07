/**
 * The snapshots of a test file, as the SnapshotState of jest-snapshot (MIT, Meta Platforms) keeps them: read from its
 * file, matched by the names of the tests and their counts, written as the update says (`all`, `new` or `none`), the
 * ones no test checked removed by an update of all of them.
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
  received: unknown;
  isInline: boolean;
  inlineSnapshot?: string | undefined;
  /** The error created by the call of the matcher, whose stack tells where an inline snapshot is written. */
  error: Error;
};

export type SnapshotResult = { actual: string; count: number; expected: string | undefined; key: string; pass: boolean };

export class SnapshotState {
  readonly snapshotPath: string;
  readonly snapshotFormat: OptionsReceived;
  readonly expand = false;
  private readonly update: UpdateSnapshot;
  private readonly data: Record<string, string>;
  private dirty: boolean;
  private readonly unchecked: Set<string>;
  private readonly counters = new Map<string, number>();
  private readonly inlineSnapshots: InlineSnapshot[] = [];

  constructor(snapshotPath: string, options: { updateSnapshot: UpdateSnapshot; snapshotFormat: OptionsReceived }) {
    this.snapshotPath = snapshotPath;
    this.update = options.updateSnapshot;
    this.snapshotFormat = options.snapshotFormat;
    const { data, dirty } = readSnapshotFile(snapshotPath, this.update);
    this.data = data;
    this.dirty = dirty;
    this.unchecked = new Set(Object.keys(data));
  }

  /** The snapshots of a test not run (skipped) kept: checked, never removed as obsolete. */
  markSnapshotsAsCheckedForTest(testName: string) {
    for (const key of this.unchecked) {
      const name = keyToTestName(key);
      // The name of a snapshot with a hint is the one of its test, ': ' and the hint.
      if (name === testName || name.startsWith(`${testName}: `)) this.unchecked.delete(key);
    }
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
    const { testName, received, isInline, inlineSnapshot } = match;
    const count = this.count(testName);
    const key = testNameToKey(testName, count);
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
    const written = { actual: '', count, expected: '', key, pass: true };
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
      key,
      pass: false,
    };
  }

  /** A snapshot of a test failed before it is matched (its properties): checked, its key given. */
  fail(testName: string) {
    const key = testNameToKey(testName, this.count(testName));
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
    if ((this.dirty || this.unchecked.size > 0) && (hasExternal || hasInline)) {
      if (hasExternal) writeSnapshotFile(this.data, this.snapshotPath);
      if (hasInline) writeInlineSnapshots(this.inlineSnapshots);
    } else if (!hasExternal && this.update === 'all' && existsSync(this.snapshotPath)) {
      unlinkSync(this.snapshotPath);
    }
  }
}
