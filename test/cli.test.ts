import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from '../src/index.ts';

const cli = join(import.meta.dirname, '../src/cli.ts');
const project = join(import.meta.dirname, 'fixtures/project');
/** The run of the bin in a folder of the fixtures: its output, and its exit code. */
const runIn = async (folder: string, ...args: string[]) => {
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [cli, ...args], { cwd: join(import.meta.dirname, 'fixtures', folder) });
    return { code: 0, stdout };
  } catch (error) {
    const { code, stdout } = error as { code: number; stdout: string };
    return { code, stdout };
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
    expect(stdout).toMatch(/ℹ pass 3\nℹ fail 2\nℹ cancelled 0\nℹ skipped 4\n/);
    expect(stdout).toContain('Timeout of 1ms exceeded');
    expect(stdout).toContain('Timeout of 30ms exceeded');
    expect(stdout.match(/this\.skip\(\) of mocha is deprecated/g)).toHaveLength(1);
    expect(stdout.match(/this\.timeout\(\) of mocha is deprecated/g)).toHaveLength(1);
    // The compatibility mocha by its former option.
    expect(await runIn('mocha', '--config', 'legacy.config.ts')).toMatchObject({ code: 0 });
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
    const one = await runIn('pool', '--workers', '1', 'a.check.ts', 'b.check.ts', 'empty.check.ts');
    expect(one.code).toBe(0);
    expect(one.stdout.match(/setups: \d/g)).toEqual(['setups: 2', 'setups: 4']);
    expect(one.stdout).toContain('ℹ pass 5\n');
    // As many workers as the cores, the test files of the configuration.
    const all = await runIn('pool');
    expect(all.code).toBe(0);
    expect(all.stdout).toContain('ℹ pass 5\n');
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
