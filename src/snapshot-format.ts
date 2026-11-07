/**
 * The format of the snapshots of Jest (v1), byte for byte the one of jest-snapshot and @jest/snapshot-utils (MIT,
 * Meta Platforms), whose behavior this follows: the values printed by pretty-format with the serializers of Jest, the
 * file `__snapshots__/<test file>.snap` of the snapshots by their keys, each one a template literal.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { format, plugins as formatPlugins, type NewPlugin, type OptionsReceived, type Plugin } from 'pretty-format';

/** The serializer of the mocks of jest-mock: their name, their calls and their results. */
const mockSerializer: NewPlugin = {
  test: (value: unknown) => typeof value === 'function' && '_isMockFunction' in value && value._isMockFunction === true,
  serialize: (
    value: { getMockName: () => string; mock: { calls: unknown[]; results: unknown[] } },
    config,
    indentation,
    depth,
    refs,
    printer,
  ) => {
    // A name given, even with printFunctionName false.
    const name = value.getMockName();
    const nameString = name === 'jest.fn()' ? '' : ` ${name}`;
    let calls = '';
    if (value.mock.calls.length > 0) {
      const next = indentation + config.indent;
      calls =
        ` {${config.spacingOuter}${next}"calls": ${printer(value.mock.calls, config, next, depth, refs)}${config.min ? ', ' : ','}` +
        `${config.spacingOuter}${next}"results": ${printer(value.mock.results, config, next, depth, refs)}${config.min ? '' : ','}` +
        `${config.spacingOuter}${indentation}}`;
    }
    return `[MockFunction${nameString}]${calls}`;
  },
};

const { DOMCollection, DOMElement, Immutable, ReactElement, ReactTestComponent, AsymmetricMatcher } = formatPlugins;
let serializers: Plugin[] = [ReactTestComponent, ReactElement, DOMElement, DOMCollection, Immutable, mockSerializer, AsymmetricMatcher];

/** A serializer of the snapshots (`expect.addSnapshotSerializer`), tested before the ones added before it. */
export const addSerializer = (serializer: Plugin) => {
  serializers = [serializer, ...serializers];
};

export const normalizeNewlines = (text: string) => text.replaceAll(/\r\n|\r/g, '\n');

/** A value as its snapshot prints it, by the serializers and the format of the snapshots. */
export const serialize = (value: unknown, indent = 2, snapshotFormat: OptionsReceived = {}) =>
  normalizeNewlines(format(value, { escapeRegex: true, indent, plugins: serializers, printFunctionName: false, ...snapshotFormat }));

/** A value printed in one line, for the messages. */
export const minify = (value: unknown) => format(value, { escapeRegex: true, min: true, plugins: serializers, printFunctionName: false });

/** The extra line breaks of a snapshot of several lines, easier to read, around it. */
export const addExtraLineBreaks = (text: string) => (text.includes('\n') ? `\n${text}\n` : text);
export const removeExtraLineBreaks = (text: string) =>
  text.length > 2 && text.startsWith('\n') && text.endsWith('\n') ? text.slice(1, -1) : text;

/** A string as pretty-format prints it, its quotes removed and its quotes and backslashes unescaped. */
export const deserializeString = (text: string) => text.slice(1, -1).replaceAll(/\\("|\\)/g, '$1');

export const escapeBacktickString = (text: string) => text.replaceAll(/`|\\|\${/g, '\\$&');
const printBacktickString = (text: string) => `\`${escapeBacktickString(text)}\``;

const NEWLINES = { '\r\n': String.raw`\r\n`, '\r': String.raw`\r`, '\n': String.raw`\n` } as Record<string, string>;
const NEWLINES_OF_KEY = Object.fromEntries(Object.entries(NEWLINES).map(([newline, key]) => [key, newline]));

/** The key of the snapshot of a test, its name and its count, the line breaks of the name escaped. */
export const testNameToKey = (testName: string, count: number) =>
  `${testName.replaceAll(/\r\n|\r|\n/g, newline => NEWLINES[newline])} ${count}`;

/** The name of the test of a key. */
export const keyToTestName = (key: string) => key.replace(/ \d+$/, '').replaceAll(/\\r\\n|\\r|\\n/g, newline => NEWLINES_OF_KEY[newline]);

/**
 * The order of the keys in the file, natural: the numbers of the names by their values (natural-compare of Lauri
 * Rooden, MIT, whose order this is).
 */
export const naturalCompare = (a: string, b: string): number => {
  let i = 0;
  const codeOf = (text: string, position: number, number?: number): number => {
    if (number) {
      for (i = position; ; ++i) {
        const code = codeOf(text, i);
        if (!(code < 76 && code > 65)) break;
      }
      return +text.slice(position - 1, i);
    }
    const code = text.charCodeAt(position) || 0;
    if (code < 45 || code > 127) return code;
    if (code < 46) return 65; // -
    if (code < 48) return code - 1;
    if (code < 58) return code + 18; // 0-9
    if (code < 65) return code - 11;
    if (code < 91) return code + 11; // A-Z
    if (code < 97) return code - 37;
    if (code < 123) return code + 5; // a-z
    return code - 63;
  };
  let positionA = 0;
  let positionB = 0;
  let codeA: number;
  let codeB = 1;
  while (codeB) {
    codeA = codeOf(a, positionA++);
    codeB = codeOf(b, positionB++);
    if (codeA < 76 && codeB < 76 && codeA > 66 && codeB > 66) {
      codeA = codeOf(a, positionA, positionA);
      codeB = codeOf(b, positionB, (positionA = i));
      positionB = i;
    }
    if (codeA !== codeB) return codeA < codeB ? -1 : 1;
  }
  return 0;
};

const HEADER = '// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing';

/** The error of a file whose header is not the one of the snapshots of Jest v1, none when it is. */
const headerError = (contents: string) => {
  const [header] = contents.split('\n', 1);
  if (header === HEADER) return undefined;
  return new Error(
    `Outdated snapshot: the header of the file is not the one of the snapshots of Jest v1, update all of them.\n\n` +
      `Expected: ${HEADER}\nReceived: ${header}\n\nBefore you upgrade snapshots, we recommend that you revert any local ` +
      'changes to tests or other code, to ensure that you do not store invalid state.',
  );
};

/**
 * The snapshots of a file by their keys, and whether it is to be written again (its header outdated, which fails the
 * tests when the snapshots are not written).
 */
export const readSnapshotFile = (snapshotPath: string, update: 'all' | 'new' | 'none') => {
  const data = Object.create(null) as Record<string, string>;
  let contents = '';
  if (existsSync(snapshotPath)) {
    try {
      contents = readFileSync(snapshotPath, 'utf8');
      // The file of Jest is a script setting its exports, run as such.

      new Function('exports', contents)(data);
    } catch {
      // A file that is not a script: its snapshots none, written again.
    }
  }
  const invalid = contents ? headerError(contents) : undefined;
  if (invalid && update === 'none') throw invalid;
  return { data, dirty: invalid !== undefined };
};

export const writeSnapshotFile = (data: Record<string, string>, snapshotPath: string) => {
  const snapshots = Object.keys(data)
    .sort(naturalCompare)
    .map(key => `exports[${printBacktickString(key)}] = ${printBacktickString(normalizeNewlines(data[key]))};`);
  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, `${HEADER}\n\n${snapshots.join('\n\n')}\n`);
};
