import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run as nodeRun } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from '../src/index.ts';

const cli = join(import.meta.dirname, '../src/cli.ts');
const project = join(import.meta.dirname, 'fixtures/project');
/** The durations of the test files of the fixture pool (see durations.ts). */
const durations = join(import.meta.dirname, 'fixtures/pool/.expect-node.durations.json');
/** The run of the bin in a folder of the fixtures: its output, and its exit code. */
const runIn = async (folder: string, ...args: string[]) => {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [cli, ...args], {
      cwd: join(import.meta.dirname, 'fixtures', folder),
      // No snapshot written but by --update-snapshot.
      env: { ...process.env, CI: 'true' },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };
    return { code, stdout, stderr };
  }
};
/** The run of the bin in the project. */
const run = (...args: string[]) => runIn('project', ...args);

describe('the expect-node bin', () => {
  it('runs the test files of the configuration, with its setup and the modules it imports', async () => {
    expect(await run()).toMatchObject({ code: 0, stdout: expect.stringContaining('has the environment of the setup') });
  });

  it('fails the run on a failed test, of the files given, located in its file', async () => {
    const { code, stdout } = await run('failing.ts');
    expect(code).toBe(1);
    expect(stdout).toContain('test at failing.ts:3:1');
    expect(stdout).toContain('the hook failed');
  });

  it('gives the this of mocha to the test files by the compatibility mocha, each use deprecated', async () => {
    const { code, stdout } = await runIn('mocha');
    expect(code).toBe(1);
    expect(stdout).toMatch(/ℹ pass 4\nℹ fail 3\nℹ cancelled 0\nℹ skipped 5\n/);
    expect(stdout).toContain('given to done');
    expect(stdout).toContain('Timeout of 1ms exceeded');
    expect(stdout).toContain('Timeout of 30ms exceeded');
    expect(stdout.match(/this\.skip\(\) of mocha is deprecated/g)).toHaveLength(1);
    expect(stdout.match(/this\.timeout\(\) of mocha is deprecated/g)).toHaveLength(1);
    // The compatibility mocha by its former option.
    expect(await runIn('mocha', '--config', 'legacy.config.ts')).toMatchObject({ code: 0 });
  });

  it('gives the timeout of the configuration to each test and hook, not to a whole test file', async () => {
    for (const args of [[], ['--workers', '1']]) {
      const { code, stdout } = await runIn('timeouts', ...args);
      expect(code).toBe(1);
      expect(stdout).toMatch(/ℹ pass 3\nℹ fail 0\nℹ cancelled 1\n/);
      expect(stdout).toContain("'test timed out after 100ms'");
    }
  });

  it('takes the timeouts of the compatibility of the tests, node:test by default', async () => {
    // node:test: the timeout of a suite the one of the whole suite, its second test cancelled.
    const node = await runIn('compatibility', '--config', 'node.config.ts');
    expect(node.code).toBe(1);
    expect(node.stdout).toMatch(/ℹ pass 2\nℹ fail 0\nℹ cancelled 1\n/);
    expect(node.stdout).toContain("'test timed out after 150ms'");
    // Vitest: the timeout of a suite the one of each of its tests, the one longer than it cancelled.
    const vitest = await runIn('compatibility', '--config', 'vitest.config.ts');
    expect(vitest.code).toBe(1);
    expect(vitest.stdout).toMatch(/ℹ pass 4\nℹ fail 0\nℹ cancelled 1\n/);
    expect(await runIn('compatibility', '--config', 'jest.config.ts')).toMatchObject({ code: 0 });
  });

  it('runs the test files by workers, each one file after the other, the hooks of the setup files and the mocks of each', async () => {
    // One worker, the test files given in order: the hooks of the setup file and of the mocha hooks once per test file,
    // the mock of the first not of the second, the setup file not imported by a worker thread.
    await rm(durations, { force: true });
    const one = await runIn('pool', '--workers', '1', 'a.check.ts', 'b.check.ts', 'empty.check.ts');
    expect(one.code).toBe(0);
    expect(one.stdout.match(/setups: \d/g)).toEqual(['setups: 2', 'setups: 4']);
    expect(one.stdout).toContain('ℹ pass 5\n');
    // The durations not written by a run of test files given, the others of no duration then.
    await expect(readFile(durations)).rejects.toThrow('ENOENT');
    // As many workers as the cores, the test files of the configuration: the whole suite, its durations written by path.
    const all = await runIn('pool');
    expect(all.code).toBe(0);
    expect(all.stdout).toContain('ℹ pass 5\n');
    const written = JSON.parse(await readFile(durations, 'utf8')) as { files: Record<string, number> };
    expect(Object.keys(written.files)).toEqual(['a.check.ts', 'b.check.ts', 'empty.check.ts']);
  });

  it('fails the test files on a module of mocha hooks without them', async () => {
    const { code, stdout } = await runIn('no-hooks');
    expect(code).toBe(1);
    expect(stdout).toContain('./none.mjs exports no mochaHooks');
  });

  it('keeps the modules imported before a mock and their coverage, else imports them again by reimport', async () => {
    const keep = await runIn('reimport', '--coverage');
    expect(keep.code).toBe(0);
    expect(keep.stdout).toMatch(/lib\.ts +\| 100\.00 \| +100\.00 \| +100\.00/);
    expect(await runIn('reimport', '--config', 'reimport.config.ts')).toMatchObject({ code: 0 });
    // The reimport of a mock alone.
    expect(await runIn('reimport', '--config', 'by-mock.config.ts')).toMatchObject({ code: 0 });
  });

  it('fails a test or a suite declared only by --forbid-only or forbidOnly, at its site', async () => {
    expect(await runIn('only')).toMatchObject({ code: 0 });
    for (const args of [['--forbid-only'], ['--config', 'forbid.config.ts']]) {
      const { code, stdout } = await runIn('only', ...args);
      expect(code).toBe(1);
      expect(stdout).toContain('a test only is declared only, which --forbid-only forbids');
      expect(stdout).toContain('a suite only is declared only, which --forbid-only forbids');
      expect(stdout).toContain('test at only.check.ts:3:4\n');
      expect(stdout).toContain('test at only.check.ts:5:10\n');
      expect(stdout).toMatch(/ℹ pass 1\nℹ fail 2\n/);
    }
  });

  it('runs a test file again when it changes, by --watch, each in a process of its own', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'expect-node-watch-'));
    const file = join(folder, 'watched.test.ts');
    const index = pathToFileURL(join(import.meta.dirname, '../src/index.ts')).href;
    const write = (name: string) =>
      writeFile(file, `import { it } from ${JSON.stringify(index)};\n\nit(${JSON.stringify(name)}, () => undefined);\n`);
    await write('first');
    const child = spawn(process.execPath, [cli, '--watch', '--workers', '2', file], { cwd: folder });
    let output = '';
    child.stdout.on('data', (data: Buffer) => (output += String(data)));
    child.stderr.on('data', (data: Buffer) => (output += String(data)));
    const until = async (text: string) => {
      while (!output.includes(text)) await sleep(50);
    };
    try {
      await until('✔ first');
      await write('second');
      await until('✔ second');
      expect(output).toContain('--watch runs each test file in a process of its own, not by the workers');
    } finally {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGINT');
      expect(await exited).toBe(130);
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('runs the test files of a directory given, of the patterns of the configuration in it, else of the default ones', async () => {
    const { code, stdout } = await run('.');
    expect(code).toBe(0);
    expect(stdout).toContain('sums');
    expect(stdout).toContain('has the environment of the setup');
    expect(stdout).not.toContain('fails');
    expect((await runIn('defaults', '.')).stdout).toContain('runs by the default patterns');
  });

  it('fails a test on its snapshots that do not match, all of them, once it ran', async () => {
    const { code, stdout } = await runIn('snapshots', '--config', 'mismatch.config.ts');
    expect(code).toBe(1);
    expect(stdout).toContain('2 snapshots do not match');
    expect(stdout).toContain('-   "value": 1,');
    expect(stdout).toContain('Received: "another"');
    // A snapshot alone, its error.
    expect(stdout).toMatch(/✖ fails on a snapshot that does not match \([\d.]+ms\)\n {2}Error: expect\(received\)\.toMatchSnapshot\(\)/);
  });

  it('keeps the snapshots of the test file running, a test of a shared module too, with and without workers', async () => {
    for (const args of [[], ['--workers', '1']]) {
      expect(await runIn('snapshots', ...args)).toMatchObject({ code: 0, stdout: expect.stringContaining('ℹ pass 1\n') });
    }
  });

  it('runs by workers the test files of no duration first, then the longest first, their file only read', async () => {
    const given = `${JSON.stringify({ files: { 'b.check.ts': 1000, 'gone.check.ts': 1, 'a.check.ts': 10 } })}\n`;
    await writeFile(durations, given);
    try {
      const { code, stdout } = await runIn('pool', '--workers', '1', 'a.check.ts', 'b.check.ts', 'empty.check.ts');
      expect(code).toBe(0);
      // empty.check.ts of no duration first, then b.check.ts the longest, then a.check.ts.
      expect(stdout.match(/setups: \d/g)).toEqual(['setups: 4', 'setups: 6']);
      expect(stdout.indexOf('a test file after it')).toBeLessThan(stdout.indexOf('a test file mocking'));
      expect(await readFile(durations, 'utf8')).toBe(given);
      // Without workers, the processes of the test files in the same order.
      const processes = await runIn('pool', '--workers', '0', 'a.check.ts', 'b.check.ts', 'empty.check.ts');
      expect(processes.code).toBe(0);
      expect(processes.stdout.indexOf('a test file after it')).toBeLessThan(processes.stdout.indexOf('a test file mocking'));
      expect(await readFile(durations, 'utf8')).toBe(given);
    } finally {
      await rm(durations, { force: true });
    }
  });

  it('writes the durations of the test files of a run without workers, their file not there', async () => {
    await rm(durations, { force: true });
    try {
      expect(await runIn('pool', '--workers', '0')).toMatchObject({ code: 0 });
      const { files } = JSON.parse(await readFile(durations, 'utf8')) as { files: Record<string, number> };
      expect(Object.keys(files)).toEqual(['a.check.ts', 'b.check.ts', 'empty.check.ts']);
      expect(Object.values(files).every(duration => Number.isInteger(duration))).toBe(true);
    } finally {
      await rm(durations, { force: true });
    }
  });

  it('writes the snapshots of every test file of a worker, a shared module declaring their tests', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'expect-node-worker-snapshots-'));
    const index = pathToFileURL(join(import.meta.dirname, '../src/index.ts')).href;
    try {
      await writeFile(
        join(folder, 'shared.ts'),
        `import { expect, it } from ${JSON.stringify(index)};\n\nexport const shared = (name: string) => it('matches', () => expect({ name }).toMatchSnapshot());\n`,
      );
      for (const name of ['one', 'two', 'three']) {
        await writeFile(join(folder, `${name}.test.ts`), `import { shared } from './shared.ts';\n\nshared(${JSON.stringify(name)});\n`);
      }
      await promisify(execFile)(process.execPath, [cli, '--workers', '1', '--update-snapshot'], { cwd: folder });
      for (const name of ['one', 'two', 'three']) {
        expect(await readFile(join(folder, '__snapshots__', `${name}.test.ts.snap`), 'utf8')).toContain(`"name": "${name}"`);
      }
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('updates by a filter of the names the snapshots of the tests run only, with and without workers', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'expect-node-filters-'));
    const index = pathToFileURL(join(import.meta.dirname, '../src/index.ts')).href;
    const snapshots = () => readFile(join(folder, '__snapshots__', 'a.test.ts.snap'), 'utf8');
    const exnode = async (...args: string[]) => {
      await promisify(execFile)(process.execPath, [cli, ...args], { cwd: folder, env: { ...process.env, VALUE: args.join(' ') } });
      return snapshots();
    };
    try {
      await writeFile(
        join(folder, 'a.test.ts'),
        [
          `import { describe, expect, it } from ${JSON.stringify(index)};`,
          `describe('group a', () => it('one', () => expect({ one: process.env.VALUE }).toMatchSnapshot()));`,
          `describe('group b', () => it.only('two', () => expect({ two: process.env.VALUE }).toMatchSnapshot()));`,
          '',
        ].join('\n'),
      );
      for (const workers of ['0', '1']) {
        await exnode('--workers', workers, '--update-snapshot');
        const named = await exnode('--workers', workers, '--update-snapshot', '--test-name-pattern', 'group a');
        expect(named).toContain(`"one": "--workers ${workers} --update-snapshot --test-name-pattern group a"`);
        expect(named).toContain(`"two": "--workers ${workers} --update-snapshot"`);
        const skipped = await exnode('--workers', workers, '--test-update-snapshots', '--test-skip-pattern', 'group a');
        expect(skipped).toContain(`"one": "--workers ${workers} --update-snapshot --test-name-pattern group a"`);
        expect(skipped).toContain(`"two": "--workers ${workers} --test-update-snapshots --test-skip-pattern group a"`);
        const only = await exnode('--workers', workers, '--update-snapshot', '--test-only');
        expect(only).toContain(`"one": "--workers ${workers} --update-snapshot --test-name-pattern group a"`);
        expect(only).toContain(`"two": "--workers ${workers} --update-snapshot --test-only"`);
      }
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('takes the options of the newer versions of node --test when the node running it takes them, else fails or ignores them', async () => {
    const takes = (name: string) => nodeRun.toString().includes(name);
    const folder = await mkdtemp(join(tmpdir(), 'expect-node-newer-'));
    try {
      const runs = {
        globalSetupPath: () => run('plain.check.ts', '--test-global-setup', 'global-setup.mjs'),
        randomSeed: () => run('plain.check.ts', '--test-random-seed', '3'),
        randomize: () => run('plain.check.ts', '--test-randomize'),
        rerunFailuresFilePath: () => run('failing.ts', '--test-rerun-failures', join(folder, 'rerun.json')),
        coverageIncludeAll: () => runIn('defaults', '--coverage', '--test-coverage-include-all'),
        testTagFilters: () => runIn('tags', '--experimental-test-tag-filter', 'fast'),
      };
      for (const [name, of] of Object.entries(runs)) {
        const { code, stdout, stderr } = await of();
        if (!takes(name) && ['globalSetupPath', 'coverageIncludeAll', 'testTagFilters'].includes(name)) {
          // Failing the run: ignored, it would change what runs, is measured or written.
          expect({ name, code }).toEqual({ name, code: 1 });
          expect(stderr).toContain('needs a newer node: node:test of node');
        } else if (!takes(name)) {
          // Ignored, the run telling it: its tests run (the failing one failing).
          expect({ name, code }).toEqual({ name, code: name === 'rerunFailuresFilePath' ? 1 : 0 });
          expect(stderr).toContain('ignored: node:test of node');
        } else if (name === 'globalSetupPath') {
          expect(stdout).toContain('the global setup ran');
        } else if (name === 'randomSeed') {
          expect(stdout).toContain('Randomized test order seed: 3');
        } else if (name === 'rerunFailuresFilePath') {
          expect(existsSync(join(folder, 'rerun.json'))).toBe(true);
        } else if (name === 'testTagFilters') {
          expect(stdout).toMatch(/ℹ tests 1\n/);
          expect(stdout).toContain('is fast');
        } else {
          expect({ name, stderr }).toEqual({ name, stderr: expect.not.stringMatching(/ignored: node:test of node|needs a newer node/) });
        }
      }
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('tells its options by --help', async () => {
    for (const option of ['--help', '-h']) {
      const { code, stdout } = await run(option);
      expect(code).toBe(0);
      expect(stdout).toContain('Usage: exnode [options] [files or directories...]');
      expect(stdout).toContain('--test-name-pattern <regex>');
    }
  });

  it('takes the options of the runner of node --test', async () => {
    // A share of the test files, sorted: the first of plain.check.ts and sum.check.ts, then the second.
    const first = await run('--test-shard', '1/2');
    expect(first.stdout).toContain('✔ sums');
    expect(first.stdout).not.toContain('has the environment of the setup');
    expect((await run('--test-shard', '2/2')).stdout).toContain('has the environment of the setup');
    // The timeout of each test over the one of the configuration (100ms, a test of 150ms).
    expect(await runIn('timeouts', '--test-timeout', '1000')).toMatchObject({ code: 0, stdout: expect.stringContaining('ℹ pass 4\n') });
    // The coverage and its minimums over the ones of the configuration.
    const coverage = await run(
      '--experimental-test-coverage',
      '--test-coverage-include',
      '*.ts',
      '--test-coverage-exclude',
      '*.check.ts',
      '--test-coverage-lines',
      '0',
      '--test-coverage-branches',
      '0',
      '--test-coverage-functions',
      '0',
      '--test-concurrency',
      '1',
      '--test-force-exit',
    );
    expect(coverage).toMatchObject({ code: 0, stdout: expect.stringContaining('start of coverage report') });
    // The reporters, each of the destination of the same order: a file, the terminal.
    const folder = await mkdtemp(join(tmpdir(), 'expect-node-reporters-'));
    try {
      const report = join(folder, 'report.xml');
      const reported = await run(
        'plain.check.ts',
        '--test-reporter',
        'tap',
        '--test-reporter-destination',
        'stdout',
        '--test-reporter',
        'junit',
        '--test-reporter-destination',
        report,
        '--test-reporter',
        'dot',
        '--test-reporter-destination',
        'stderr',
      );
      expect(reported.stdout).toContain('ok 1 - sums');
      expect(reported.stderr).toContain('.');
      expect(await readFile(report, 'utf8')).toContain('<testcase name="sums"');
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('runs by workers the test files of the default patterns', async () => {
    expect((await runIn('defaults', '--workers', '2')).stdout).toContain('runs by the default patterns');
  });

  it('fails the run on a coverage under its minimum', async () => {
    const { code, stdout } = await run('--coverage');
    expect(code).toBe(1);
    expect(stdout).toContain('function coverage does not meet threshold of 100%');
  });

  it('updates every snapshot with --update-snapshot, given to the test files', async () => {
    expect(await run('--update-snapshot', 'plain.check.ts')).toMatchObject({ code: 0 });
  });

  it('runs the test files of the default patterns, the coverage without minimum', async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [cli, '--coverage'], {
      cwd: join(import.meta.dirname, 'fixtures/defaults'),
    });
    expect(stdout).toContain('runs by the default patterns');
  });

  it('reports by the reporters given, of node:test or of a module, to the terminal or to a file', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'expect-node-reporter-'));
    try {
      const { code, stdout } = await run(
        'plain.check.ts',
        '--reporter',
        'reporter.mjs',
        '--reporter',
        `junit:${join(folder, 'junit/report.xml')}`,
      );
      expect({ code, stdout }).toEqual({ code: 0, stdout: 'passed sums\n' });
      expect(await readFile(join(folder, 'junit/report.xml'), 'utf8')).toContain('<testcase name="sums"');
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('reports by the reporters of the configuration', async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [cli], { cwd: join(import.meta.dirname, 'fixtures/reporting') });
    expect(stdout).toContain('ok 1 - reports by the reporters of the configuration');
  });

  it('takes a configuration given, else none', async () => {
    expect(await run('--config', join(project, 'expect-node.config.ts'), 'sum.check.ts')).toMatchObject({ code: 0 });
    // Without a configuration: the file given alone, without the setup nor the modules of the project.
    const { stdout } = await promisify(execFile)(process.execPath, [cli, join(project, 'plain.check.ts')], { cwd: import.meta.dirname });
    expect(stdout).toContain('tests 1');
  });
});
