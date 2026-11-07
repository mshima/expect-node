/* eslint-disable no-template-curly-in-string -- sources and snapshots of templates */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from '../src/index.ts';
import { inlineSiteOf, writeInlineSnapshots, type InlineSite } from '../src/inline-snapshots.ts';

const cli = join(import.meta.dirname, '../src/cli.ts');

/** A temporary folder for a test, removed after it. */
const inFolder = async (run: (folder: string) => Promise<void>) => {
  const folder = await mkdtemp(join(tmpdir(), 'expect-node-inline-'));
  try {
    await run(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
};

/** The site of the name of a matcher in a line (from 1) of a source. */
const siteIn = (file: string, source: string, line: number, name = 'InlineSnapshot'): InlineSite => {
  const text = source.split('\n')[line - 1];
  const end = text.indexOf(name);
  return { file, line, column: /\w*$/.exec(text.slice(0, end))!.index + 1 };
};

describe('the inline snapshots', () => {
  it('writes each snapshot in the argument of its call, or adds it, the source read by its tokens', async () => {
    await inFolder(async folder => {
      const file = join(folder, 'a.test.ts');
      const source = [
        'expect(1).toMatchInlineSnapshot();',
        '  expect(2).toMatchInlineSnapshot(`old`);',
        String.raw`expect(3).toMatchInlineSnapshot('single \' quote');`,
        "expect(4).toMatchInlineSnapshot({ a: expect.stringMatching(/a)[/]\\/b/gi), b: ')', c: `\\`${ { x: '}' }.x }` /* ) */ }, \"old\",);",
        'expect(5).toMatchInlineSnapshot /* a comment */ (',
        '  { a: 1 / 2 }, // a comment )',
        ');',
        'expect(6).toThrowErrorMatchingInlineSnapshot("x");',
        '    expect(7).toMatchInlineSnapshot(`',
        '      "a"',
        '    `);',
        '',
      ].join('\n');
      await writeFile(file, source);
      const at = (line: number) => siteIn(file, source, line);
      writeInlineSnapshots([
        { site: at(1), snapshot: '"one"' },
        { site: at(1), snapshot: '"one"' },
        { site: at(2), snapshot: '\n{\n  "a": `2`,\n\n}\n' },
        { site: at(3), snapshot: '3' },
        { site: at(4), snapshot: '4' },
        { site: at(5), snapshot: '5' },
        { site: at(8), snapshot: '"6"' },
        { site: at(9), snapshot: '\n"b\n\nc"\n' },
      ]);
      expect(await readFile(file, 'utf8')).toBe(
        [
          'expect(1).toMatchInlineSnapshot(`"one"`);',
          '  expect(2).toMatchInlineSnapshot(`',
          '    {',
          '      "a": \\`2\\`,',
          '',
          '    }',
          '  `);',
          'expect(3).toMatchInlineSnapshot(`3`);',
          "expect(4).toMatchInlineSnapshot({ a: expect.stringMatching(/a)[/]\\/b/gi), b: ')', c: `\\`${ { x: '}' }.x }` /* ) */ }, `4`,);",
          'expect(5).toMatchInlineSnapshot /* a comment */ (',
          '  { a: 1 / 2 }, `5`, // a comment )',
          ');',
          'expect(6).toThrowErrorMatchingInlineSnapshot(`"6"`);',
          // Indented as the template it replaces.
          '    expect(7).toMatchInlineSnapshot(`',
          '      "b',
          '',
          '      c"',
          '    `);',
          '',
        ].join('\n'),
      );
    });
  });

  it('formats a new snapshot as Prettier does, from the start of its call, an existing one as it is', async () => {
    await inFolder(async folder => {
      const file = join(folder, 'a.test.ts');
      const source = [
        '      expect(a)',
        '        .not?.resolves',
        '        .toMatchInlineSnapshot();',
        '  const x = await expect(p).resolves.toMatchInlineSnapshot();',
        '\t\texpect(1).toMatchInlineSnapshot();',
        ' list[0].toMatchInlineSnapshot();',
        'x).toMatchInlineSnapshot();',
        '  (a].toMatchInlineSnapshot();',
        'expect(2).toMatchInlineSnapshot(`',
        '"a"',
        '`);',
        '',
      ].join('\n');
      await writeFile(file, source);
      const snapshot = '\n"b"\n';
      writeInlineSnapshots([3, 4, 5, 6, 7, 8, 9].map(line => ({ site: siteIn(file, source, line), snapshot })));
      expect(await readFile(file, 'utf8')).toBe(
        [
          '      expect(a)',
          '        .not?.resolves',
          '        .toMatchInlineSnapshot(`',
          '        "b"',
          '      `);',
          '  const x = await expect(p).resolves.toMatchInlineSnapshot(`',
          '              "b"',
          '            `);',
          '\t\texpect(1).toMatchInlineSnapshot(`',
          '\t\t\t"b"',
          '\t\t`);',
          ' list[0].toMatchInlineSnapshot(`',
          '    "b"',
          '  `);',
          // No start found: from the name of the matcher.
          'x).toMatchInlineSnapshot(`',
          '      "b"',
          '    `);',
          '  (a].toMatchInlineSnapshot(`',
          '        "b"',
          '      `);',
          // A template not indented, kept so.
          'expect(2).toMatchInlineSnapshot(`',
          '"b"',
          '`);',
          '',
        ].join('\n'),
      );
    });
  });

  it('keeps a file whose snapshots are written already, and fails on a call it cannot write', async () => {
    await inFolder(async folder => {
      const file = join(folder, 'a.test.ts');
      const source = [
        'expect(1).toMatchInlineSnapshot(`1`);',
        'notASnapshot();',
        'expect(2).toMatchInlineSnapshot x;',
        'expect(3).toMatchInlineSnapshot( // to the end',
      ].join('\n');
      await writeFile(file, source);
      const { mtimeMs } = await stat(file);
      writeInlineSnapshots([{ site: siteIn(file, source, 1), snapshot: '1' }]);
      expect((await stat(file)).mtimeMs).toBe(mtimeMs);
      expect(() => writeInlineSnapshots([{ site: { file, line: 2, column: 1 }, snapshot: '1' }])).toThrow(
        `Couldn't locate the inline snapshot of ${file}:2:1.`,
      );
      expect(() => writeInlineSnapshots([{ site: siteIn(file, source, 3), snapshot: '1' }])).toThrow("Couldn't locate");
      expect(() => writeInlineSnapshots([{ site: siteIn(file, source, 4), snapshot: '1' }])).toThrow('Unterminated call');
      expect(() =>
        writeInlineSnapshots([
          { site: siteIn(file, source, 1), snapshot: '1' },
          { site: siteIn(file, source, 1), snapshot: '2' },
        ]),
      ).toThrow('Multiple inline snapshots for the same call are not supported');
    });
  });

  it('finds the call of a matcher by its stack: out of node, of the packages and of expect-node', () => {
    const own = new URL('../src/caller.ts', import.meta.url).href;
    const error = new Error('of a call');
    error.stack = [
      'Error: of a call',
      '    at internal (node:internal/process/task_queues:1:1)',
      '    at matcher (/project/node_modules/expect/build/index.js:2:3)',
      `    at own (${own}:4:5)`,
      '    at file:///project/a.test.ts?exnode=1:6:7',
    ].join('\n');
    expect(inlineSiteOf(error)).toEqual({ file: '/project/a.test.ts', line: 6, column: 7 });
    error.stack = 'Error\n    at Object.<anonymous> (/project/a.test.cjs:8:9)';
    expect(inlineSiteOf(error)).toEqual({ file: '/project/a.test.cjs', line: 8, column: 9 });
    error.stack = undefined;
    expect(() => inlineSiteOf(error)).toThrow("Couldn't infer stack frame for inline snapshot.");
  });

  it('fails the test file whose inline snapshots cannot be written alone, the next ones of its worker written', async () => {
    const index = pathToFileURL(join(import.meta.dirname, '../src/index.ts')).href;
    await inFolder(async folder => {
      const header = `import { expect, it } from ${JSON.stringify(index)};\n\n`;
      await writeFile(
        join(folder, 'a.test.ts'),
        `${header}for (const value of [1, 2]) it(\`\${value}\`, () => expect(value).toMatchInlineSnapshot());\n`,
      );
      await writeFile(join(folder, 'b.test.ts'), `${header}it('b', () => expect('b').toMatchInlineSnapshot());\n`);
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [cli, '--workers', '1', '--update-snapshot', 'a.test.ts', 'b.test.ts'],
        {
          cwd: folder,
        },
      ).catch((error: unknown) => error as { stdout: string });
      expect(stdout).toContain('Multiple inline snapshots for the same call are not supported');
      expect(stdout).toContain('✔ b.test.ts');
      expect(await readFile(join(folder, 'b.test.ts'), 'utf8')).toContain('toMatchInlineSnapshot(`"b"`)');
    });
  });

  it('writes the inline snapshots of a run, of a promise too, matched then, with and without workers', async () => {
    const index = pathToFileURL(join(import.meta.dirname, '../src/index.ts')).href;
    for (const workers of ['0', '1']) {
      await inFolder(async folder => {
        const file = join(folder, 'a.test.ts');
        await writeFile(
          file,
          [
            `import { expect, it } from ${JSON.stringify(index)};`,
            '',
            "it('writes', async () => {",
            '  expect({ value: process.env.VALUE }).toMatchInlineSnapshot();',
            "  await expect(Promise.reject(new Error('rejected'))).rejects.toThrowErrorMatchingInlineSnapshot();",
            '});',
            '',
          ].join('\n'),
        );
        const exnode = async (value: string, ...args: string[]) => {
          try {
            await promisify(execFile)(process.execPath, [cli, '--workers', workers, ...args], {
              cwd: folder,
              env: { ...process.env, CI: 'true', VALUE: value },
            });
            return 0;
          } catch (error) {
            return (error as { code: number }).code;
          }
        };
        expect(await exnode('one', '--update-snapshot')).toBe(0);
        const written = await readFile(file, 'utf8');
        expect(written).toContain(
          '  expect({ value: process.env.VALUE }).toMatchInlineSnapshot(`\n    {\n      "value": "one",\n    }\n  `);',
        );
        expect(written).toContain('.rejects.toThrowErrorMatchingInlineSnapshot(`"rejected"`);');
        expect(await exnode('one')).toBe(0);
        expect(await exnode('two')).toBe(1);
        expect(await readFile(file, 'utf8')).toBe(written);
        expect(await exnode('two', '--update-snapshot')).toBe(0);
        expect(await readFile(file, 'utf8')).toContain('"value": "two",');
      });
    }
  });
});
