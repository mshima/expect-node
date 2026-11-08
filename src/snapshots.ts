/**
 * The snapshots of Jest and esmocha, without jest-snapshot: the same files (`__snapshots__/<test file>.snap`), the same
 * names (the titles of the suites and of the test, by spaces), format and messages, by pretty-format, jest-diff and
 * jest-matcher-utils, the ones of expect (see snapshot-format.ts, snapshot-state.ts and inline-snapshots.ts). Updated by
 * `UPDATE_SNAPSHOT` (`all`, `new` or `none`, the `--update-snapshot` of the bin gives `all`): the new ones written by
 * default, none in CI.
 */
import { basename, dirname, join } from 'node:path';
import * as nodeTest from 'node:test';
import { styleText } from 'node:util';
import { types } from 'node:util';

import { getObjectSubset } from '@jest/expect-utils';
import { expect as jestExpect, type MatcherContext } from 'expect';
import { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diffLinesUnified, diffStringsRaw, diffStringsUnified, type Diff } from 'jest-diff';
import {
  BOLD_WEIGHT,
  EXPECTED_COLOR,
  getLabelPrinter,
  INVERTED_COLOR,
  matcherErrorMessage,
  matcherHint,
  type MatcherHintOptions,
  printWithType,
  RECEIVED_COLOR,
  replaceMatchedToAsymmetricMatcher,
  stringify,
} from 'jest-matcher-utils';
import { format, type Plugin } from 'pretty-format';

import { ENV } from './env.ts';
import { addSerializer, escapeBacktickString, deserializeString, minify, serialize } from './snapshot-format.ts';
import { SnapshotState, type SnapshotMigration, type UpdateSnapshot } from './snapshot-state.ts';

/** The tests filtered by their names or by only (see cli.ts). */
const FILTERED = process.env[ENV.filtered] === 'true';

type Color = (text: string) => string;
/** The colors of jest-snapshot, in a terminal of colors only, like the ones of jest-matcher-utils. */
const colored =
  (format: Parameters<typeof styleText>[0]): Color =>
  text =>
    styleText(format, text);
const snapshotColor = colored(['magenta', 'bgYellowBright']);
const receivedColor = colored(['cyan', 'bgWhiteBright']);
const trailingSpaceColor = colored('bgYellow');
const noColor: Color = text => text;

type Context = MatcherContext & {
  snapshotState?: SnapshotState;
  currentTestName?: string;
  /** The titles of the suites and of the test, by which Vitest names its snapshots. */
  currentTestTitles?: string[];
  error?: Error;
};
type Config = {
  context: Context;
  matcherName: string;
  isInline: boolean;
  received: unknown;
  hint?: string | undefined;
  inlineSnapshot?: string | undefined;
  properties?: object | undefined;
};

const PROPERTIES_ARG = 'properties';
const SNAPSHOT_ARG = 'snapshot';
const HINT_ARG = 'hint';
const NOT_SNAPSHOT_MATCHERS = `Snapshot matchers cannot be used with ${BOLD_WEIGHT('not')}`;
const MAX_DIFF_STRING_LENGTH = 20_000;

const printExpected = (value: unknown) => EXPECTED_COLOR(minify(value));
const printReceived = (value: unknown) => RECEIVED_COLOR(minify(value));

/** The hint of a matcher in a message: its arguments named, the properties first. */
const hintOf = ({ context: { isNot, promise }, hint, inlineSnapshot, matcherName, properties }: Config) => {
  let named: string | undefined;
  if (hint) named = HINT_ARG;
  else if (typeof inlineSnapshot === 'string') named = SNAPSHOT_ARG;
  if (typeof properties !== 'object') return matcherHint(matcherName, undefined, named ?? '', { isNot, promise });
  return matcherHint(matcherName, undefined, PROPERTIES_ARG, { isNot, promise, ...(named && { secondArgument: named }) });
};

/** The name of a snapshot in a message, as in its file, its hint in bold after a separator. */
const printSnapshotName = (names = '', hint = '', count: number, separator = ': ') =>
  `Snapshot name: \`${names ? escapeBacktickString(names) : ''}${names && hint ? separator : ''}${hint ? BOLD_WEIGHT(escapeBacktickString(hint)) : ''} ${count}\``;

const isLineDiffable = (received: unknown) => {
  if (received === null || (typeof received !== 'object' && typeof received !== 'function')) return typeof received === 'string';
  if (typeof received === 'function' || received instanceof Date || received instanceof RegExp || received instanceof Error) return false;
  return typeof (received as { asymmetricMatch?: unknown }).asymmetricMatch !== 'function';
};

const diffOptions = (aAnnotation: string, bAnnotation: string, aColor: Color, bColor: Color, changeColor: Color) => ({
  aAnnotation,
  aColor,
  bAnnotation,
  bColor,
  changeLineTrailingSpaceColor: changeColor,
  commonLineTrailingSpaceColor: trailingSpaceColor,
  emptyFirstOrLastLinePlaceholder: '↵',
  expand: false,
  includeChangeCounts: true,
});

const printPropertiesAndReceived = (properties: object, received: object) => {
  const aAnnotation = 'Expected properties';
  const bAnnotation = 'Received value';
  if (isLineDiffable(properties) && isLineDiffable(received)) {
    const { replacedExpected, replacedReceived } = replaceMatchedToAsymmetricMatcher(properties, received, [], []);
    return diffLinesUnified(
      serialize(replacedExpected).split('\n'),
      serialize(getObjectSubset(replacedReceived, replacedExpected)).split('\n'),
      diffOptions(aAnnotation, bAnnotation, EXPECTED_COLOR, RECEIVED_COLOR, trailingSpaceColor),
    );
  }
  // Properties or a received value that print in one line.
  const printLabel = getLabelPrinter(aAnnotation, bAnnotation);
  return `${printLabel(aAnnotation) + printExpected(properties)}\n${printLabel(bAnnotation)}${printReceived(received)}`;
};

/** The common parts of a diff and the ones of an operation, these inverted when there are common ones. */
const joinDiffs = (diffs: Diff[], operation: number, hasCommon: boolean) =>
  diffs
    .map(diff => {
      if (diff[0] === DIFF_EQUAL) return diff[1];
      if (diff[0] !== operation) return '';
      return hasCommon ? INVERTED_COLOR(diff[1]) : diff[1];
    })
    .join('');

const printSnapshotAndReceived = (a: string, b: string, received: unknown) => {
  const aAnnotation = 'Snapshot';
  const bAnnotation = 'Received';
  const options = diffOptions(aAnnotation, bAnnotation, snapshotColor, receivedColor, noColor);
  if (typeof received === 'string') {
    if (a.length >= 2 && a.startsWith('"') && a.endsWith('"') && b === format(received)) {
      // A snapshot like a string printed, of a string printed so.
      if (!a.includes('\n') && !b.includes('\n')) {
        // Neither of several lines: labels and quoted strings.
        let aQuoted = a;
        let bQuoted = b;
        if (a.length - 2 <= MAX_DIFF_STRING_LENGTH && b.length - 2 <= MAX_DIFF_STRING_LENGTH) {
          const diffs = diffStringsRaw(a.slice(1, -1), b.slice(1, -1), true);
          const hasCommon = diffs.some(diff => diff[0] === DIFF_EQUAL);
          aQuoted = `"${joinDiffs(diffs, DIFF_DELETE, hasCommon)}"`;
          bQuoted = `"${joinDiffs(diffs, DIFF_INSERT, hasCommon)}"`;
        }
        const printLabel = getLabelPrinter(aAnnotation, bAnnotation);
        return `${printLabel(aAnnotation) + snapshotColor(aQuoted)}\n${printLabel(bAnnotation)}${receivedColor(bQuoted)}`;
      }
      // Of several lines: the strings unquoted.
      a = deserializeString(a);
      b = received;
    }
    return a.length <= MAX_DIFF_STRING_LENGTH && b.length <= MAX_DIFF_STRING_LENGTH
      ? diffStringsUnified(a, b, options)
      : diffLinesUnified(a.split('\n'), b.split('\n'), options);
  }
  if (isLineDiffable(received)) return diffLinesUnified(a.split('\n'), b.split('\n'), options);
  const printLabel = getLabelPrinter(aAnnotation, bAnnotation);
  return `${printLabel(aAnnotation) + snapshotColor(a)}\n${printLabel(bAnnotation)}${receivedColor(b)}`;
};

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isAnyOrAnything = (value: unknown) =>
  isObject(value) && value.$$typeof === Symbol.for('jest.asymmetricMatcher') && ['Any', 'Anything'].includes(value.constructor.name);

/**
 * The received value with the property matchers in it, which the snapshot prints instead of their values: the objects
 * and the arrays merged by their keys, a matcher Any or Anything of an array taking the place of its object.
 */
function deepMerge(target: unknown, source: unknown): unknown {
  if (Array.isArray(target) && Array.isArray(source)) {
    const merged = [...target];
    for (const [index, value] of source.entries()) {
      const element = merged[index];
      const deep = (Array.isArray(element) && Array.isArray(value)) || (isObject(element) && !isAnyOrAnything(value));
      merged[index] = deep ? deepMerge(element, value) : value;
    }
    return merged;
  }
  if (isObject(target) && isObject(source)) {
    const merged: Record<string, unknown> = { ...target };
    for (const [key, value] of Object.entries(source)) {
      const deep = (isObject(value) && !value.$$typeof) || Array.isArray(value);
      merged[key] = deep ? deepMerge(target[key], value) : value;
    }
    return merged;
  }
  // Of another type: an array of the properties of an object, its length; properties not an object.
  return target;
}

const INDENTATION = /^([^\S\n]*)\S/m;

/** An inline snapshot without the indentation it is written with in its file. */
const stripAddedIndentation = (inlineSnapshot: string) => {
  const indentation = INDENTATION.exec(inlineSnapshot)?.[1];
  if (!indentation) return inlineSnapshot;
  const lines = inlineSnapshot.split('\n');
  if (lines.length <= 2 || lines[0].trim() !== '' || lines.at(-1)!.trim() !== '') return inlineSnapshot;
  for (let i = 1; i < lines.length - 1; i++) {
    if (lines[i] === '') continue;
    // A line less indented: the snapshot as it is.
    if (!lines[i].startsWith(indentation)) return inlineSnapshot;
    lines[i] = lines[i].slice(indentation.length);
  }
  lines[lines.length - 1] = '';
  return lines.join('\n');
};

const matchSnapshot = (config: Config) => {
  const { context, hint, inlineSnapshot, isInline, properties } = config;
  let { received } = config;
  // The errors given to expect, the test failed with them once it ran (see test.ts).
  context.dontThrow();
  const { isNot, snapshotState, currentTestName, currentTestTitles } = context;
  if (isNot) throw new Error(matcherErrorMessage(hintOf(config), NOT_SNAPSHOT_MATCHERS));
  if (!snapshotState) {
    throw new Error(
      `${hintOf(config)}\n\nSnapshot state must be initialized\n\n${printWithType('Snapshot state', snapshotState, stringify)}`,
    );
  }
  // The names of Jest, the titles by spaces and the hint after ': ', and of Vitest, the titles and the hint by ' > ':
  // the ones of the state, a snapshot of the others taken as its own.
  const jestName = currentTestName && hint ? `${currentTestName}: ${hint}` : currentTestName || '';
  const titles = currentTestTitles?.join(' > ');
  const vitestName = titles === undefined ? undefined : [titles, ...(hint ? [hint] : [])].join(' > ');
  const vitest = snapshotState.names === 'vitest' && vitestName !== undefined;
  const testName = vitest ? vitestName : jestName;
  const otherName = vitest ? jestName : vitestName;
  const nameOf = (count: number) =>
    vitest ? printSnapshotName(titles, hint, count, ' > ') : printSnapshotName(currentTestName, hint, count);
  if (typeof properties === 'object') {
    if (typeof received !== 'object' || received === null) {
      throw new Error(
        matcherErrorMessage(
          hintOf(config),
          `${RECEIVED_COLOR('received')} value must be an object when the matcher has ${EXPECTED_COLOR('properties')}`,
          printWithType('Received', received, printReceived),
        ),
      );
    }
    if (context.equals(received, properties, [context.utils.iterableEquality, context.utils.subsetEquality])) {
      received = deepMerge(received, properties);
    } else {
      const key = snapshotState.fail(testName, otherName);
      const count = Number(/(\d+)$/.exec(key)![1]);
      return {
        pass: false,
        message: () => `${hintOf(config)}\n\n${nameOf(count)}\n\n${printPropertiesAndReceived(properties, received as object)}`,
      };
    }
  }
  const { actual, count, expected, pass } = snapshotState.match({
    testName,
    otherName,
    received,
    isInline,
    inlineSnapshot,
    // Created by the call of the matcher: the stack of the call of an inline snapshot.
    error: context.error ?? new Error(),
  });
  // The message of a match, never printed: the snapshot matchers cannot be used with not.
  /* node:coverage ignore next */
  if (pass) return { pass: true, message: () => '' };
  const name = nameOf(count);
  return {
    pass: false,
    actual,
    expected,
    message:
      expected === undefined
        ? () =>
            `${hintOf(config)}\n\n${name}\n\nNew snapshot was ${BOLD_WEIGHT('not written')}. The update flag must be explicitly ` +
            'passed to write a new snapshot.\n\nThis is likely because this test is run in a continuous integration (CI) environment ' +
            `in which snapshots are not written by default.\n\nReceived:${actual.includes('\n') ? '\n' : ' '}${receivedColor(actual)}`
        : () => `${hintOf(config)}\n\n${name}\n\n${printSnapshotAndReceived(expected, actual, received)}`,
  };
};

const propertiesError = (matcherName: string, options: MatcherHintOptions, value: unknown, extra = '') =>
  new Error(
    matcherErrorMessage(
      matcherHint(matcherName, undefined, PROPERTIES_ARG, options),
      `Expected ${EXPECTED_COLOR('properties')} must be an object`,
      printWithType('Expected properties', value, printExpected) + extra,
    ),
  );

function toMatchSnapshot(this: Context, received: unknown, propertiesOrHint?: object | string, hint?: string) {
  const matcherName = 'toMatchSnapshot';
  let properties: object | undefined;
  const length = arguments.length;
  if (length === 2 && typeof propertiesOrHint === 'string') hint = propertiesOrHint;
  else if (length >= 2) {
    if (typeof propertiesOrHint !== 'object' || propertiesOrHint === null) {
      const options: MatcherHintOptions = { isNot: this.isNot, promise: this.promise };
      let extra = '';
      if (length === 3) {
        options.secondArgument = HINT_ARG;
        options.secondArgumentColor = BOLD_WEIGHT;
        if (propertiesOrHint == null) extra = "\n\nTo provide a hint without properties: toMatchSnapshot('hint')";
      }
      throw propertiesError(matcherName, options, propertiesOrHint, extra);
    }
    properties = propertiesOrHint;
  }
  return matchSnapshot({ context: this, hint, isInline: false, matcherName, properties, received });
}

function toMatchInlineSnapshot(this: Context, received: unknown, propertiesOrSnapshot?: object | string, inlineSnapshot?: string) {
  const matcherName = 'toMatchInlineSnapshot';
  let properties: object | undefined;
  const length = arguments.length;
  if (length === 2 && typeof propertiesOrSnapshot === 'string') inlineSnapshot = propertiesOrSnapshot;
  else if (length >= 2) {
    const options: MatcherHintOptions = { isNot: this.isNot, promise: this.promise };
    if (length === 3) {
      options.secondArgument = SNAPSHOT_ARG;
      options.secondArgumentColor = noColor;
    }
    if (typeof propertiesOrSnapshot !== 'object' || propertiesOrSnapshot === null) {
      throw propertiesError(matcherName, options, propertiesOrSnapshot);
    }
    if (length === 3 && typeof inlineSnapshot !== 'string') {
      throw new Error(
        matcherErrorMessage(
          matcherHint(matcherName, undefined, PROPERTIES_ARG, options),
          'Inline snapshot must be a string',
          printWithType('Inline snapshot', inlineSnapshot, serialize),
        ),
      );
    }
    properties = propertiesOrSnapshot;
  }
  return matchSnapshot({
    context: this,
    inlineSnapshot: inlineSnapshot === undefined ? undefined : stripAddedIndentation(inlineSnapshot),
    isInline: true,
    matcherName,
    properties,
    received,
  });
}

const DID_NOT_THROW = 'Received function did not throw';

const matchThrown = (config: Config, fromPromise: boolean) => {
  const { context, matcherName, received } = config;
  if (!fromPromise && typeof received !== 'function') {
    throw new Error(
      matcherErrorMessage(
        matcherHint(matcherName, undefined, '', { isNot: context.isNot, promise: context.promise }),
        `${RECEIVED_COLOR('received')} value must be a function`,
        printWithType('Received', received, printReceived),
      ),
    );
  }
  if (context.isNot) throw new Error(matcherErrorMessage(hintOf(config), NOT_SNAPSHOT_MATCHERS));
  let error: unknown;
  if (fromPromise) error = received;
  else {
    try {
      (received as () => unknown)();
    } catch (thrown) {
      error = thrown;
    }
  }
  if (error === undefined) throw new Error(`${hintOf(config)}\n\n${DID_NOT_THROW}`);
  let message = (error as Error).message;
  // The causes of the error, after its message.
  while (typeof error === 'object' && error !== null && 'cause' in error) {
    error = error.cause;
    if (types.isNativeError(error)) message += `\nCause: ${error.message}`;
    else {
      if (typeof error === 'string') message += `\nCause: ${error}`;
      break;
    }
  }
  return matchSnapshot({ ...config, received: message });
};

function toThrowErrorMatchingSnapshot(this: Context, received: unknown, hint?: string, fromPromise?: boolean) {
  return matchThrown({ context: this, hint, isInline: false, matcherName: 'toThrowErrorMatchingSnapshot', received }, !!fromPromise);
}

function toThrowErrorMatchingInlineSnapshot(this: Context, received: unknown, inlineSnapshot?: string, fromPromise?: boolean) {
  const matcherName = 'toThrowErrorMatchingInlineSnapshot';
  if (inlineSnapshot !== undefined && typeof inlineSnapshot !== 'string') {
    throw new Error(
      matcherErrorMessage(
        matcherHint(matcherName, undefined, SNAPSHOT_ARG, { expectedColor: noColor, isNot: this.isNot, promise: this.promise }),
        'Inline snapshot must be a string',
        printWithType('Inline snapshot', inlineSnapshot, serialize),
      ),
    );
  }
  return matchThrown(
    {
      context: this,
      inlineSnapshot: inlineSnapshot === undefined ? undefined : stripAddedIndentation(inlineSnapshot),
      isInline: true,
      matcherName,
      received,
    },
    !!fromPromise,
  );
}

jestExpect.extend({
  toMatchSnapshot,
  toMatchInlineSnapshot,
  toThrowErrorMatchingSnapshot,
  toThrowErrorMatchingInlineSnapshot,
});
Object.assign(jestExpect, { addSnapshotSerializer: (serializer: Plugin) => addSerializer(serializer) });

/** The snapshots of a test file, whether a test of it failed, and its tests skipped. */
type SnapshotFile = { state: SnapshotState; failed: boolean; skipped: string[][] };

const snapshotFiles = new Map<string, SnapshotFile>();

/** The snapshots of a test file. */
export const snapshotFileOf = (testPath: string): SnapshotFile => {
  let file = snapshotFiles.get(testPath);
  if (!file) {
    // By the environment of the run: in CI or not, the --update-snapshot of the bin.
    /* node:coverage ignore next */
    const updateSnapshot = (process.env[ENV.updateSnapshot] ?? (process.env.CI ? 'none' : 'new')) as UpdateSnapshot;
    const state = new SnapshotState(join(dirname(testPath), '__snapshots__', `${basename(testPath)}.snap`), {
      updateSnapshot,
      snapshotFormat: { escapeString: false, printBasicPrototype: false },
      // By `snapshotNames` of the configuration.
      names: process.env[ENV.snapshotNames] === 'jest' ? 'jest' : 'vitest',
      // By `snapshotMigration` of the configuration.
      migration: (process.env[ENV.snapshotMigration] ?? 'changed') as SnapshotMigration,
    });
    file = { state, failed: false, skipped: [] };
    snapshotFiles.set(testPath, file);
  }
  return file;
};

/**
 * The test the snapshot matchers are of (snapshotState, currentTestName and currentTestTitles of the state of expect),
 * or none.
 */
export const setSnapshotTest = (test?: { file: SnapshotFile; name: string; titles: string[] }) =>
  jestExpect.setState({
    snapshotState: test?.file.state,
    currentTestName: test?.name,
    currentTestTitles: test?.titles,
    suppressedErrors: [],
  } as never);

/**
 * The snapshots of a test that do not match: the matchers give their errors to expect (`suppressedErrors`) instead of
 * throwing them, for the test to fail with them once it ran, like Jest.
 */
export const snapshotErrors = (): Error[] => (jestExpect.getState() as { suppressedErrors: Error[] }).suppressedErrors;

/**
 * Saves the snapshots of the test files run, the ones of their tests not run removed (an update of all of them, none
 * failed): at the end of the test file of a process, or of each test file of a worker (see worker.ts), whose root hooks
 * run at the end of its first one.
 */
export const saveSnapshots = (): void => {
  // Cleared first: a file whose snapshots cannot be written fails its own run alone, not the next ones of a worker.
  const files = [...snapshotFiles.values()];
  snapshotFiles.clear();
  for (const { state, failed, skipped } of files) {
    for (const titles of skipped) state.markSnapshotsAsCheckedForTest(titles);
    // The tests filtered by their names or by only: the snapshots of the others, not run, kept as they are.
    if (!failed && !FILTERED) state.removeUncheckedKeys();
    state.save();
  }
};
nodeTest.after(saveSnapshots);
