#!/usr/bin/env node
/**
 * Runs the tests with node:test: every test file of the configuration (see config.ts), or the ones given, `--coverage`
 * with the coverage of the files it includes, its minimum failing the run. A failed test fails the run.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import type { Config } from './config.ts';

// A runner, never a test file: run by a test (its own tests), node:test would take it for one of its files.
delete process.env.NODE_TEST_CONTEXT;

const { values, positionals } = parseArgs({
  options: { coverage: { type: 'boolean' }, config: { type: 'string' } },
  allowPositionals: true,
});

const CONFIG_FILES = ['expect-test.config.ts', 'expect-test.config.mts', 'expect-test.config.js', 'expect-test.config.mjs'];
const configFile = values.config ? resolve(values.config) : CONFIG_FILES.map(file => resolve(file)).find(file => existsSync(file));
const config: Config = configFile ? ((await import(pathToFileURL(configFile).href)) as { default: Config }).default : {};

await config.setup?.();

const { coverage = {} } = config;
const stream = run({
  ...(positionals.length > 0 ? { files: positionals.map(file => resolve(file)) } : config.files ? { globPatterns: config.files } : {}),
  execArgv: (config.import ?? []).flatMap(module => ['--import', resolve(module)]),
  ...(config.timeout === undefined ? {} : { timeout: config.timeout }),
  concurrency: config.concurrency ?? true,
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
stream.compose(spec).pipe(process.stdout);
