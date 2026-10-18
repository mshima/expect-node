/** The test files of a run: the ones of glob patterns, the directories given as their test files. */
import { globSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const EXTENSIONS = '{cjs,mjs,js,cts,mts,ts}';
/** The default patterns of node:test. */
const DEFAULT_PATTERNS = ['*.test', '*-test', '*_test', 'test-*', 'test', 'test/**/*'].map(name => `**/${name}.${EXTENSIONS}`);

/** The test files of patterns from a folder, the default ones of node:test when none, by their absolute path. */
export const globFiles = (patterns: string[] | undefined, cwd = process.cwd()): string[] =>
  globSync(patterns ?? DEFAULT_PATTERNS, { cwd })
    .filter(file => !file.split(sep).includes('node_modules'))
    .map(file => resolve(cwd, file))
    .sort();

/**
 * The test files given, a directory as its test files, like mocha: the ones of the patterns of the configuration in it,
 * else the default patterns of node:test from it.
 */
export const givenFiles = (given: string[], patterns: string[] | undefined): string[] =>
  given.flatMap(path => {
    const absolute = resolve(path);
    if (!statSync(absolute, { throwIfNoEntry: false })?.isDirectory()) return [absolute];
    return patterns ? globFiles(patterns).filter(file => !relative(absolute, file).startsWith('..')) : globFiles(undefined, absolute);
  });
