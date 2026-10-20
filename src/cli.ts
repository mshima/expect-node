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
    coverage: { type: 'boolean' },
    config: { type: 'string' },
    'update-snapshot': { type: 'boolean' },
    updateSnapshot: { type: 'boolean' },
    reporter: { type: 'string', multiple: true },
    workers: { type: 'string' },
    watch: { type: 'boolean' },
    'forbid-only': { type: 'boolean' },
  },
  allowPositionals: true,
});
const CONFIG_FILES = ['expect-node.config.ts', 'expect-node.config.mts', 'expect-node.config.js', 'expect-node.config.mjs'];
const configFile = values.config ? resolve(values.config) : CONFIG_FILES.map(file => resolve(file)).find(file => existsSync(file));
const config: Config = configFile ? ((await import(pathToFileURL(configFile).href)) as { default: Config }).default : {};

await config.setup?.();

const { coverage = {} } = config;
/**
 * The test files given (a directory as its test files, see files.ts), else the ones of the configuration, else the
 * default patterns of node:test.
 */
const files = positionals.length > 0 ? givenFiles(positionals, config.files) : undefined;
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
// The durations written by a run when their file is not there, only read else (see durations.ts); a run watched never ends.
const writeDurations = durations !== undefined && !values.watch && !existsSync(resolve(durations));
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
  ...(values['update-snapshot'] || values.updateSnapshot ? { [ENV.updateSnapshot]: 'all' } : {}),
  ...(compatibility === 'node' ? {} : { [ENV.compatibility]: compatibility }),
  // The timeout of each test and hook but their own (see compatibility.ts).
  ...(config.timeout === undefined ? {} : { [ENV.timeout]: String(config.timeout) }),
  ...(config.reimport ? { [ENV.reimport]: 'true' } : {}),
  ...(values['forbid-only'] || config.forbidOnly ? { [ENV.forbidOnly]: 'true' } : {}),
  ...(setup ? { [ENV.setup]: JSON.stringify(setup) } : {}),
  ...workersPool?.env,
});
const setupImport = setup ? ['--import', ownModule('setup')] : [];
const stream = run({
  ...(workersPool?.options ?? {
    ...testFiles,
    concurrency: config.concurrency ?? true,
  }),
  ...(values.watch ? { watch: true } : {}),
  execArgv: [...(config.import ?? []).flatMap(module => ['--import', resolve(module)]), ...setupImport],
  ...(values.coverage
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
 * A reporter, `<name>[:<file>]`: one of node:test (spec, tap, dot, junit, lcov) or the path of a module of one (its
 * default export), to the terminal or to the file.
 */
const report = async (entry: string) => {
  const at = entry.indexOf(':');
  const [name, destination] = at === -1 ? [entry, undefined] : [entry.slice(0, at), entry.slice(at + 1)];
  const reporter =
    name in reporters
      ? reporters[name as keyof typeof reporters]
      : ((await import(pathToFileURL(resolve(name)).href)) as { default: unknown }).default;
  if (destination) mkdirSync(dirname(resolve(destination)), { recursive: true });
  stream
    .compose(reporter as Parameters<typeof stream.compose>[0])
    .pipe(destination ? createWriteStream(resolve(destination)) : process.stdout);
};
for (const entry of values.reporter ?? config.reporters ?? ['spec']) await report(entry);
