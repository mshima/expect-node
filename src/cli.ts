#!/usr/bin/env node
/**
 * Runs the tests with node:test: every test file of the configuration (see config.ts), or the ones given, `--coverage`
 * with the coverage of the files it includes, its minimum failing the run. A failed test fails the run.
 */
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { run } from 'node:test';
import * as reporters from 'node:test/reporters';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { ownModule } from './caller.ts';
import type { Config } from './config.ts';
import { mergeCoverageOf } from './coverage.ts';
import { DEFAULT_DURATIONS, longestFirst, recordDurations } from './durations.ts';
import { ENV } from './env.ts';
import { givenFiles, globFiles } from './files.ts';
import { pool } from './pool.ts';

// A runner, never a test file: run by a test (its own tests), node:test would take it for one of its files.
delete process.env.NODE_TEST_CONTEXT;

const { values, positionals } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h' },
    coverage: { type: 'boolean' },
    config: { type: 'string' },
    'update-snapshot': { type: 'boolean' },
    updateSnapshot: { type: 'boolean' },
    reporter: { type: 'string', multiple: true },
    workers: { type: 'string' },
    watch: { type: 'boolean' },
    'forbid-only': { type: 'boolean' },
    // The options of the runner of `node --test`, of the same names and meaning (see the README).
    'test-name-pattern': { type: 'string', multiple: true },
    'test-skip-pattern': { type: 'string', multiple: true },
    'test-only': { type: 'boolean' },
    'test-concurrency': { type: 'string' },
    'test-timeout': { type: 'string' },
    'test-reporter': { type: 'string', multiple: true },
    'test-reporter-destination': { type: 'string', multiple: true },
    'test-shard': { type: 'string' },
    'test-force-exit': { type: 'boolean' },
    'test-update-snapshots': { type: 'boolean' },
    'experimental-test-coverage': { type: 'boolean' },
    'test-coverage-include': { type: 'string', multiple: true },
    'test-coverage-exclude': { type: 'string', multiple: true },
    'test-coverage-lines': { type: 'string' },
    'test-coverage-branches': { type: 'string' },
    'test-coverage-functions': { type: 'string' },
    // Of the newer versions of node:test only (see NEWER).
    'test-global-setup': { type: 'string' },
    'test-randomize': { type: 'boolean' },
    'test-random-seed': { type: 'string' },
    'test-rerun-failures': { type: 'string' },
    'test-coverage-include-all': { type: 'boolean' },
    'experimental-test-tag-filter': { type: 'string', multiple: true },
  },
  allowPositionals: true,
});
if (values.help) {
  process.stdout.write(`Usage: exnode [options] [files or directories...]

Runs the test files of the configuration (expect-node.config.ts), or the ones given, by node:test.

Options:
  --config <file>                      the configuration, else expect-node.config.{ts,mts,js,mjs} of the cwd
  --workers <n>                        the test files by n processes reused, 0 for a process each
  --coverage                           the coverage, its minimums failing the run
  --update-snapshot                    every snapshot written again
  --forbid-only                        a test or a suite declared only failing
  --watch                              the test files run again when they change
  --reporter <name>[:<destination>]    a reporter, to a file, stdout or stderr (repeated)
  -h, --help                           this help

Options of node --test, of the same meaning:
  --test-name-pattern <regex>          the tests whose names match (repeated)
  --test-skip-pattern <regex>          the tests whose names do not match (repeated)
  --test-only                          the tests declared only
  --test-concurrency <n>               the test files run at once without workers
  --test-timeout <ms>                  the timeout of each test and hook
  --test-reporter <name>               a reporter (repeated)
  --test-reporter-destination <dest>   the destination of the reporter of the same order (repeated)
  --test-shard <index>/<total>         a share of the test files
  --test-force-exit                    the process ended once the tests ran
  --test-update-snapshots              --update-snapshot
  --experimental-test-coverage         --coverage
  --test-coverage-include <glob>       the files of the coverage (repeated)
  --test-coverage-exclude <glob>       the files out of the coverage (repeated)
  --test-coverage-lines <percent>      the minimum of the lines
  --test-coverage-branches <percent>   the minimum of the branches
  --test-coverage-functions <percent>  the minimum of the functions

Options of the newer versions of node --test, when the node running exnode takes them (else * fails, the others ignored):
  --test-global-setup <file>         * a module of globalSetup and globalTeardown, run once
  --test-randomize                     the tests in a random order
  --test-random-seed <n>               the seed of the random order
  --test-rerun-failures <file>         the file of the failed tests, run alone again
  --test-coverage-include-all        * the files never loaded in the coverage too
  --experimental-test-tag-filter <expr> * the tests of the tags matching (repeated)
`);
  process.exit(0);
}
/**
 * The options of the newer versions of node:test, which `run` takes from a version on: given to it when the node running
 * exnode takes them (its run declares them), else failing the run or ignored, telling it (see NEWER).
 */
const runOptions = run.toString();
/**
 * Each option, the one of run it is, its value (a path, a number, or as given), and whether a node not taking it fails
 * the run: when ignoring it would change what runs, is measured or written (a setup, a filter of the tests, the files of
 * the coverage); else only warns (an order, the failed tests alone, all of them run instead).
 */
const NEWER = [
  ['test-global-setup', 'globalSetupPath', 'path', 'fail'],
  ['test-randomize', 'randomize', 'given', 'warn'],
  ['test-random-seed', 'randomSeed', 'number', 'warn'],
  ['test-rerun-failures', 'rerunFailuresFilePath', 'path', 'warn'],
  ['test-coverage-include-all', 'coverageIncludeAll', 'given', 'fail'],
  ['experimental-test-tag-filter', 'testTagFilters', 'given', 'fail'],
] as const;
const newerOptions: Record<string, unknown> = {};
for (const [option, name, value, unsupported] of NEWER) {
  const given = values[option];
  if (given === undefined) continue;
  // Of the node running the tests of expect-node, which takes it or not.
  /* node:coverage disable */
  if (runOptions.includes(name)) {
    const VALUES = { path: () => resolve(given as string), number: () => Number(given), given: () => given };
    newerOptions[name] = VALUES[value]();
  } else if (unsupported === 'fail') {
    process.stderr.write(`--${option} needs a newer node: node:test of node ${process.version} does not take it\n`);
    process.exit(1);
  } else {
    process.stderr.write(`--${option} ignored: node:test of node ${process.version} does not take it, of a newer node\n`);
  }
  /* node:coverage enable */
}
/** A number of an option, or none. */
const numberOf = (value: string | undefined) => (value === undefined ? undefined : Number(value));
const CONFIG_FILES = ['expect-node.config.ts', 'expect-node.config.mts', 'expect-node.config.js', 'expect-node.config.mjs'];
const configFile = values.config ? resolve(values.config) : CONFIG_FILES.map(file => resolve(file)).find(file => existsSync(file));
const config: Config = configFile ? ((await import(pathToFileURL(configFile).href)) as { default: Config }).default : {};

await config.setup?.();

/** The coverage of the configuration, its options of `node --test` over it. */
const coverage = {
  ...config.coverage,
  ...(values['test-coverage-include'] ? { include: values['test-coverage-include'] } : {}),
  ...(values['test-coverage-exclude'] ? { exclude: values['test-coverage-exclude'] } : {}),
  ...(values['test-coverage-lines'] ? { lines: Number(values['test-coverage-lines']) } : {}),
  ...(values['test-coverage-branches'] ? { branches: Number(values['test-coverage-branches']) } : {}),
  ...(values['test-coverage-functions'] ? { functions: Number(values['test-coverage-functions']) } : {}),
};
const timeout = numberOf(values['test-timeout']) ?? config.timeout;
/** The share of the test files of `--test-shard=<index>/<total>`, as node:test: the ones of index % total + 1. */
const [shardIndex = 1, shardTotal = 1] = values['test-shard']?.split('/').map(Number) ?? [];
const shard = values['test-shard'] !== undefined;
const inShard = (all: string[]) => all.toSorted().filter((_, index) => index % shardTotal === shardIndex - 1);
/** The tests filtered by their names or by only: the snapshots of the others neither checked nor removed (see snapshots.ts). */
const filtered =
  values['test-name-pattern'] !== undefined ||
  values['test-skip-pattern'] !== undefined ||
  values['test-only'] === true ||
  values['experimental-test-tag-filter'] !== undefined ||
  // The failed tests of the previous run alone.
  (values['test-rerun-failures'] !== undefined && existsSync(resolve(values['test-rerun-failures'])));
/**
 * The test files given (a directory as its test files, see files.ts), else the ones of the configuration, else the
 * default patterns of node:test.
 */
const given = positionals.length > 0 ? givenFiles(positionals, config.files) : undefined;
const files = shard ? inShard(given ?? globFiles(config.files)) : given;
const workers = values.workers === undefined ? config.workers : Number(values.workers);
// Watched, the test files run again by node:test each in a process of its own: a worker keeps the modules it imported.
if (values.watch && workers) process.stderr.write('--watch runs each test file in a process of its own, not by the workers\n');
/** The file of the durations of the test files, the longest run first (see durations.ts). */
const durations = config.durations === true ? DEFAULT_DURATIONS : config.durations || undefined;
const workersPool = workers && !values.watch ? pool(files, config.files, workers, durations) : undefined;
/**
 * The test files of the processes of node:test without workers: the longest first by their durations, in the order
 * given to node:test, which starts them in it.
 */
const ordered = durations === undefined ? files : longestFirst(files ?? globFiles(config.files), durations);
const testFiles = ordered ? { files: ordered } : { globPatterns: config.files };
// The durations written by a run of the whole suite when their file is not there, only read else (see durations.ts):
// not of test files given, the others then of no duration; nor watched, a run that never ends.
const writeDurations = durations !== undefined && files === undefined && !filtered && !values.watch && !existsSync(resolve(durations));
/** The compatibility of the tests (see compatibility.ts), `mocha: true` the one of mocha. */
const compatibility = config.compatibility ?? (config.mocha ? 'mocha' : 'node');
/** The setup files and the modules of mocha hooks, by the test processes only (see setup.ts). */
const setupFiles = (config.setupFiles ?? []).map(file => resolve(file));
const mochaHooks = config.mochaHooks ?? [];
const setup =
  setupFiles.length + mochaHooks.length > 0 ? { files: setupFiles, mochaHooks, cwd: pathToFileURL(`${process.cwd()}/`).href } : undefined;

// What the options and the configuration change in the test processes, which inherit the environment (see env.ts).
Object.assign(process.env, {
  // Every snapshot written again.
  ...(values['update-snapshot'] || values.updateSnapshot || values['test-update-snapshots'] ? { [ENV.updateSnapshot]: 'all' } : {}),
  ...(filtered ? { [ENV.filtered]: 'true' } : {}),
  ...(compatibility === 'node' ? {} : { [ENV.compatibility]: compatibility }),
  // The timeout of each test and hook but their own (see compatibility.ts).
  ...(timeout === undefined ? {} : { [ENV.timeout]: String(timeout) }),
  ...(config.reimport ? { [ENV.reimport]: 'true' } : {}),
  ...(values['forbid-only'] || config.forbidOnly ? { [ENV.forbidOnly]: 'true' } : {}),
  ...(setup ? { [ENV.setup]: JSON.stringify(setup) } : {}),
  ...workersPool?.env,
});
const setupImport = setup ? ['--import', ownModule('setup')] : [];
const stream = run({
  ...(workersPool?.options ?? {
    ...testFiles,
    concurrency: numberOf(values['test-concurrency']) ?? config.concurrency ?? true,
  }),
  ...(values.watch ? { watch: true } : {}),
  ...(values['test-name-pattern'] ? { testNamePatterns: values['test-name-pattern'] } : {}),
  ...(values['test-skip-pattern'] ? { testSkipPatterns: values['test-skip-pattern'] } : {}),
  ...(values['test-only'] ? { only: true } : {}),
  ...(values['test-force-exit'] ? { forceExit: true } : {}),
  ...newerOptions,
  execArgv: [...(config.import ?? []).flatMap(module => ['--import', resolve(module)]), ...setupImport],
  ...(values.coverage || values['experimental-test-coverage']
    ? {
        coverage: true,
        ...(coverage.include ? { coverageIncludeGlobs: coverage.include } : {}),
        ...(coverage.exclude ? { coverageExcludeGlobs: coverage.exclude } : {}),
      }
    : {}),
});
stream.on('test:fail', () => {
  process.exitCode = 1;
});
// The coverage merged by file before the reporters read it, its minimums checked on it (see coverage.ts).
mergeCoverageOf(stream as unknown as Parameters<typeof mergeCoverageOf>[0], coverage);
if (workersPool) stream.once('close', workersPool.close);
if (writeDurations) recordDurations(stream, durations, workersPool !== undefined);
// Watched until an interruption (Ctrl+C), which ends the run as an exit: its test processes closed, its coverage written.
if (values.watch) process.once('SIGINT', () => process.exit(130));
/**
 * A reporter: one of node:test (spec, tap, dot, junit, lcov) or the path of a module of one (its default export), to
 * the terminal (`stdout` or `stderr`, the terminal when none) or to a file.
 */
const report = async (name: string, destination?: string) => {
  const reporter =
    name in reporters
      ? reporters[name as keyof typeof reporters]
      : ((await import(pathToFileURL(resolve(name)).href)) as { default: unknown }).default;
  const terminal = { stdout: process.stdout, stderr: process.stderr }[destination ?? 'stdout'];
  if (!terminal) mkdirSync(dirname(resolve(destination!)), { recursive: true });
  stream.compose(reporter as Parameters<typeof stream.compose>[0]).pipe(terminal ?? createWriteStream(resolve(destination!)));
};
/** A reporter of `--reporter` or of the configuration, `<name>[:<destination>]`. */
const reporterOf = (entry: string): [string, string?] => {
  const at = entry.indexOf(':');
  return at === -1 ? [entry] : [entry.slice(0, at), entry.slice(at + 1)];
};
// The reporters of `--test-reporter`, each of the destination of the same order, the terminal when none, as node:test.
const testReporters = (values['test-reporter'] ?? []).map((name, index): [string, string?] => [
  name,
  values['test-reporter-destination']?.[index],
]);
const reported =
  values.reporter || testReporters.length > 0
    ? [...(values.reporter ?? []).map(reporterOf), ...testReporters]
    : (config.reporters ?? ['spec']).map(reporterOf);
for (const [name, destination] of reported) await report(name, destination);
