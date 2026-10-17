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
import { ENV } from './env.ts';
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
  },
  allowPositionals: true,
});
const CONFIG_FILES = ['expect-node.config.ts', 'expect-node.config.mts', 'expect-node.config.js', 'expect-node.config.mjs'];
const configFile = values.config ? resolve(values.config) : CONFIG_FILES.map(file => resolve(file)).find(file => existsSync(file));
const config: Config = configFile ? ((await import(pathToFileURL(configFile).href)) as { default: Config }).default : {};

await config.setup?.();

const { coverage = {} } = config;
/** The test files given, else the ones of the configuration, else the default patterns of node:test. */
const testFiles = () => {
  if (positionals.length > 0) return { files: positionals.map(file => resolve(file)) };
  return config.files ? { globPatterns: config.files } : {};
};
const workers = values.workers === undefined ? config.workers : Number(values.workers);
const workersPool = workers ? pool(testFiles().files, config.files, workers) : undefined;

// What the options and the configuration change in the test processes, which inherit the environment (see env.ts).
Object.assign(process.env, {
  // Every snapshot written again.
  ...(values['update-snapshot'] || values.updateSnapshot ? { [ENV.updateSnapshot]: 'all' } : {}),
  ...(config.mocha ? { [ENV.mocha]: 'true' } : {}),
  ...(config.setupFiles ? { [ENV.setupFiles]: JSON.stringify(config.setupFiles.map(file => resolve(file))) } : {}),
  ...workersPool?.env,
});
// The setup files, imported by the test processes only (see setup.ts).
const setup = config.setupFiles ? ['--import', ownModule('setup')] : [];
const stream = run({
  ...(workersPool?.options ?? { ...testFiles(), concurrency: config.concurrency ?? true }),
  execArgv: [...(config.import ?? []).flatMap(module => ['--import', resolve(module)]), ...setup],
  ...(config.timeout === undefined ? {} : { timeout: config.timeout }),
  ...(values.coverage
    ? {
        coverage: true,
        ...(coverage.include ? { coverageIncludeGlobs: coverage.include } : {}),
        ...(coverage.exclude ? { coverageExcludeGlobs: coverage.exclude } : {}),
        ...(coverage.lines === undefined ? {} : { lineCoverage: coverage.lines }),
        ...(coverage.branches === undefined ? {} : { branchCoverage: coverage.branches }),
        ...(coverage.functions === undefined ? {} : { functionCoverage: coverage.functions }),
      }
    : {}),
});
stream.on('test:fail', () => {
  process.exitCode = 1;
});
if (workersPool) stream.once('close', workersPool.close);
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
