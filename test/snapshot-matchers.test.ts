/* eslint-disable no-template-curly-in-string -- sources and snapshots of templates */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, fn, it } from '../src/index.ts';
import { keyToTestName, naturalCompare, testNameToKey } from '../src/snapshot-format.ts';
import { SnapshotState, type SnapshotMigration, type SnapshotNames, type UpdateSnapshot } from '../src/snapshot-state.ts';

/** The header of the files written; of the ones of Jest and of Vitest, read. */
const HEADER = '// expect-node Snapshot v1, https://github.com/mshima/expect-node#snapshots';
const JEST = '// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing';
const VITEST = '// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html';
const FORMAT = { escapeString: false, printBasicPrototype: false };

/**
 * Runs assertions on the snapshots of a file of their own, of a test named `t`: the file written first (its
 * snapshots by their keys, or its contents), the state saved after; gives the messages of the snapshots failed, and
 * the file.
 */
const withSnapshots = async (
  update: UpdateSnapshot,
  given: Record<string, string> | string | undefined,
  assertions: () => unknown,
  after?: (state: SnapshotState) => void,
  currentTestName: string | undefined = 't',
  currentTestTitles?: string[],
  options: { names?: SnapshotNames; migration?: SnapshotMigration } = {},
) => {
  const folder = await mkdtemp(join(tmpdir(), 'expect-node-snapshot-'));
  const path = join(folder, 'a.snap');
  try {
    if (typeof given === 'string') await writeFile(path, given);
    else if (given) {
      const entries = Object.entries(given).map(([key, value]) => `exports[\`${key}\`] = \`${value}\`;`);
      await writeFile(path, `${JEST}\n\n${entries.join('\n\n')}\n`);
    }
    const previous = expect.getState();
    const state = new SnapshotState(path, { updateSnapshot: update, snapshotFormat: FORMAT, ...options });
    expect.setState({ snapshotState: state, currentTestName, currentTestTitles, suppressedErrors: [] } as never);
    let errors: Error[];
    try {
      await assertions();
    } finally {
      errors = (expect.getState() as { suppressedErrors: Error[] }).suppressedErrors;
      expect.setState({ ...previous, suppressedErrors: [] });
    }
    after?.(state);
    state.save();
    return { messages: errors.map(({ message }) => message), file: existsSync(path) ? await readFile(path, 'utf8') : undefined };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
};

describe('the snapshot matchers', () => {
  it('writes the new snapshots in the format of Jest, by their keys in natural order', async () => {
    const { messages, file } = await withSnapshots('new', undefined, () => {
      expect({ b: [1, { c: 'two' }], a: undefined }).toMatchSnapshot();
      expect('a `quoted` ${string} \\ "here"').toMatchSnapshot('hint');
      expect('one line').toMatchSnapshot();
    });
    expect(messages).toEqual([]);
    expect(file).toBe(
      `${HEADER}\n\n` +
        'exports[`t 1`] = `\n{\n  "a": undefined,\n  "b": [\n    1,\n    {\n      "c": "two",\n    },\n  ],\n}\n`;\n\n' +
        'exports[`t 2`] = `"one line"`;\n\n' +
        'exports[`t: hint 1`] = `"a \\`quoted\\` \\${string} \\\\ "here""`;\n',
    );
  });

  it('fails the snapshots that do not match, with their diffs, and the new ones in CI', async () => {
    const { messages } = await withSnapshots(
      'none',
      { 't 1': '\n{\n  "a": 1,\n}\n', 't 2': '"one"', 't 3': '"one\ntwo"', 't 4': '1' },
      () => {
        expect({ a: 2 }).toMatchSnapshot();
        expect('another').toMatchSnapshot();
        expect('one\nthree').toMatchSnapshot();
        expect(2).toMatchSnapshot();
        expect('long'.repeat(6000)).toMatchSnapshot();
        expect({ new: true }).toMatchSnapshot('a hint');
      },
    );
    expect(messages).toHaveLength(6);
    expect(messages[0]).toContain('Snapshot name: `t 1`');
    expect(messages[0]).toContain('-   "a": 1,\n+   "a": 2,');
    expect(messages[1]).toContain('Snapshot: "one"\nReceived: "another"');
    expect(messages[2]).toContain('+ three');
    expect(messages[3]).toContain('Snapshot: 1\nReceived: 2');
    expect(messages[4]).toContain('New snapshot was not written');
    expect(messages[5]).toContain('Snapshot name: `t: a hint 1`');
    expect(messages[5]).toContain('Received:\n{\n  "new": true,\n}');
  });

  it('diffs by their lines the strings too long, and the ones of a serializer of their own', async () => {
    const long = 'a'.repeat(20_001);
    const { messages } = await withSnapshots(
      'none',
      { 't 1': `"${long}"`, 't 2': `\n"${long}\nx"\n`, 't 3': 'custom', 't 4': 'raw' },
      () => {
        expect(`${long}b`).toMatchSnapshot();
        expect(`${long}\ny`).toMatchSnapshot();
        expect({ custom: 'other' }).toMatchSnapshot();
        expect('other').toMatchSnapshot();
      },
    );
    expect(messages[0]).toContain(`Snapshot: "${long}"\nReceived: "${long}b"`);
    expect(messages[1]).toContain('+ y');
    expect(messages[2]).toContain('+ {');
    expect(messages[3]).toContain('- raw');
  });

  it('prints the values that do not diff by their lines, the snapshots of a test of no name', async () => {
    const values = {
      ' 1': '2000-01-01T00:00:00.000Z',
      ' 2': '/a/',
      ' 3': '[Error: a]',
      ' 4': '[Function named]',
      ' 5': '"abc"',
      ' 8': '"common a"',
    };
    const { messages } = await withSnapshots(
      'none',
      values,
      () => {
        expect(new Date(0)).toMatchSnapshot();
        expect(/b/).toMatchSnapshot();
        expect(new Error('b')).toMatchSnapshot();
        expect(() => undefined).toMatchSnapshot();
        expect('xyz').toMatchSnapshot();
        expect(new Error('b')).toMatchSnapshot({ message: 'c' });
        expect([1]).toMatchSnapshot({ length: 1 }, 'hint');
        expect('common b').toMatchSnapshot();
      },
      undefined,
      '',
    );
    expect(messages).toHaveLength(8);
    expect(messages[7]).toContain('Snapshot: "common a"\nReceived: "common b"');
    expect(messages[0]).toContain('Snapshot name: ` 1`');
    expect(messages[0]).toContain('Received: 1970-01-01T00:00:00.000Z');
    expect(messages[4]).toContain('Snapshot: "abc"\nReceived: "xyz"');
    expect(messages[5]).toContain('Expected properties: {"message": "c"}\nReceived value:      [Error: b]');
    // A hint of a test of no name, not in the name of its snapshot, like Jest.
    expect(messages[6]).toContain('Snapshot name: `hint 7`');
  });

  it('updates all of them, the ones of no test removed, the file removed with none', async () => {
    const updated = await withSnapshots(
      'all',
      { 't 1': '"before"', 'gone 1': '"gone"', 'skipped: with a hint 1': '"kept"' },
      () => expect('after').toMatchSnapshot(),
      state => {
        state.markSnapshotsAsCheckedForTest(['skipped']);
        state.removeUncheckedKeys();
      },
    );
    expect(updated.file).toBe(`${HEADER}\n\nexports[\`skipped: with a hint 1\`] = \`"kept"\`;\n\nexports[\`t 1\`] = \`"after"\`;\n`);
    const removed = await withSnapshots(
      'all',
      { 'gone 1': '"gone"' },
      () => undefined,
      state => state.removeUncheckedKeys(),
    );
    expect(removed.file).toBeUndefined();
  });

  it('fails on a file that is not of the snapshots of expect-node, Jest or Vitest v1 in CI, written again else', async () => {
    for (const given of ['exports[`t 1`] = `"a"`;\n', '// Jest Snapshot v2, https://jestjs.io/docs/snapshot-testing\n']) {
      await expect(withSnapshots('none', given, () => undefined)).rejects.toThrow(/Outdated/);
      expect((await withSnapshots('new', given, () => expect('a').toMatchSnapshot())).file).toBe(
        `${HEADER}\n\nexports[\`t 1\`] = \`"a"\`;\n`,
      );
    }
    // A file that is not a script.
    expect((await withSnapshots('new', `${HEADER}\n\nnot a script(`, () => expect('a').toMatchSnapshot())).file).toBe(
      `${HEADER}\n\nexports[\`t 1\`] = \`"a"\`;\n`,
    );
  });

  it('keeps a file of Jest or of Vitest as it is until it changes, then writes it in the format of expect-node', async () => {
    const jest = `${JEST}\n\nexports[\`t 1\`] = \`"a"\`;\n`;
    for (const given of [jest, `// Jest Snapshot v1, https://goo.gl/fbAQLP\n\nexports[\`t 1\`] = \`"a"\`;\n`]) {
      expect((await withSnapshots('none', given, () => expect('a').toMatchSnapshot())).file).toBe(given);
    }
    const vitest = [
      `${VITEST}\n`,
      'exports[`s > skipped 1`] = `"kept"`;\n',
      'exports[`s > t 1`] = `"a"`;\n',
      'exports[`s > t > hint 1`] = `"h"`;\n',
    ].join('\n');
    const run = (update: UpdateSnapshot, assertions: () => unknown, after?: (state: SnapshotState) => void) =>
      withSnapshots(update, vitest, assertions, after, 's t', ['s', 't'], { names: 'jest' });
    // Matched by the names of Vitest, its titles and its hint by ' > ', the file as it is.
    const matched = await run('none', () => {
      expect('a').toMatchSnapshot();
      expect('h').toMatchSnapshot('hint');
    });
    expect(matched).toEqual({ messages: [], file: vitest });
    // A new snapshot: the file written by the names of Jest, the ones of the tests not run as they are.
    const added = await run('new', () => {
      expect('a').toMatchSnapshot();
      expect('b').toMatchSnapshot();
      expect('h').toMatchSnapshot('hint');
    });
    expect(added.file).toBe(
      `${HEADER}\n\nexports[\`s > skipped 1\`] = \`"kept"\`;\n\nexports[\`s t 1\`] = \`"a"\`;\n\n` +
        'exports[`s t 2`] = `"b"`;\n\nexports[`s t: hint 1`] = `"h"`;\n',
    );
    // An update of all of them: a snapshot of a test skipped kept by its titles, a property failing on its own.
    const updated = await run(
      'all',
      () => {
        expect('changed').toMatchSnapshot();
        expect({ id: 'x' }).toMatchSnapshot({ id: expect.any(Number) }, 'hint');
      },
      state => {
        state.markSnapshotsAsCheckedForTest(['s', 'skipped']);
        state.removeUncheckedKeys();
      },
    );
    expect(updated.messages).toHaveLength(1);
    expect(updated.messages[0]).toContain('Snapshot name: `s t: hint 1`');
    expect(updated.file).toBe(
      `${HEADER}\n\nexports[\`s > skipped 1\`] = \`"kept"\`;\n\nexports[\`s t 1\`] = \`"changed"\`;\n\n` +
        'exports[`s t: hint 1`] = `"h"`;\n',
    );
  });

  it('names the snapshots as Vitest by default, the ones of Jest taken as theirs, and migrates them as configured', async () => {
    const jest = `${JEST}\n\nexports[\`s t 1\`] = \`"a"\`;\n\nexports[\`s t: hint 1\`] = \`"h"\`;\n`;
    const run = (update: UpdateSnapshot, assertions: () => unknown, migration?: SnapshotMigration) =>
      withSnapshots(update, jest, assertions, undefined, 's t', ['s', 't'], migration && { migration });
    const both = () => {
      expect('a').toMatchSnapshot();
      expect('h').toMatchSnapshot('hint');
    };
    const vitestNames = 'exports[`s > t > hint 1`] = `"h"`;\n\nexports[`s > t 1`] = `"a"`;\n';
    // Changed: the file as it is until it changes, then by the names of Vitest.
    expect((await run('new', both)).file).toBe(jest);
    const changed = await run('new', () => {
      both();
      expect('b').toMatchSnapshot('new');
    });
    expect(changed.file).toBe(
      `${HEADER}\n\nexports[\`s > t > hint 1\`] = \`"h"\`;\n\nexports[\`s > t > new 1\`] = \`"b"\`;\n\nexports[\`s > t 1\`] = \`"a"\`;\n`,
    );
    // All: every file at once by a run that writes snapshots, never in CI.
    expect((await run('none', both, 'all')).file).toBe(jest);
    expect((await run('new', both, 'all')).file).toBe(`${HEADER}\n\n${vitestNames}`);
    // Keep: the names of the snapshots and the header of the file kept, the new ones by the names of Vitest.
    const kept = await run(
      'new',
      () => {
        both();
        expect('c').toMatchSnapshot('new');
        expect('d').toMatchSnapshot();
      },
      'keep',
    );
    expect(kept.messages).toEqual([]);
    expect(kept.file).toBe(
      `${JEST}\n\nexports[\`s > t > new 1\`] = \`"c"\`;\n\nexports[\`s > t 2\`] = \`"d"\`;\n\nexports[\`s t 1\`] = \`"a"\`;\n\n` +
        'exports[`s t: hint 1`] = `"h"`;\n',
    );
    // A mismatch of a snapshot of Vitest names it so.
    const failed = await withSnapshots(
      'none',
      `${HEADER}\n\nexports[\`s > t 1\`] = \`"a"\`;\n`,
      () => expect('x').toMatchSnapshot(),
      undefined,
      's t',
      ['s', 't'],
    );
    expect(failed.messages[0]).toContain('Snapshot name: `s > t 1`');
  });

  it('matches the property matchers, the snapshot of the value printing them', async () => {
    const { messages, file } = await withSnapshots('new', undefined, () => {
      expect({
        id: 3,
        name: 'a',
        nested: { at: new Date(), keep: 1 },
        list: [{ id: 1 }, 2, 'x', { z: 1 }],
        added: undefined,
      }).toMatchSnapshot({
        id: expect.any(Number),
        nested: { at: expect.any(Date) },
        list: [{ id: expect.any(Number) }, expect.anything(), 'x', expect.any(Object)],
        added: undefined,
      });
      expect([[1], { a: 1 }]).toMatchSnapshot([[expect.any(Number)], { a: 1 }]);
      expect({ id: 'not a number' }).toMatchSnapshot({ id: expect.any(Number) }, 'a hint');
    });
    expect(file).toContain('"id": Any<Number>');
    expect(file).toContain('"at": Any<Date>');
    expect(file).toContain('Anything');
    expect(file).toContain('Any<Number>,\n  ],\n  {');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Snapshot name: `t: a hint 1`');
    expect(messages[0]).toContain('- Expected properties');
  });

  it('throws on the arguments it cannot take, with not, and without the state of a test', async () => {
    await withSnapshots('new', undefined, () => {
      expect(() => expect({}).toMatchSnapshot(1 as never)).toThrow('Expected properties must be an object');
      expect(() => expect({}).toMatchSnapshot(null as never, 'hint')).toThrow(
        "To provide a hint without properties: toMatchSnapshot('hint')",
      );
      expect(() => expect({}).toMatchSnapshot(1 as never, 'hint')).toThrow('Expected properties must be an object');
      const named = fn().mockName('named');
      named(1);
      expect(() => expect(named).toMatchSnapshot({})).toThrow('received value must be an object when the matcher has properties');
      expect(() => expect({}).not.toMatchSnapshot()).toThrow('Snapshot matchers cannot be used with not');
      expect(() => expect({}).toMatchInlineSnapshot(1 as never)).toThrow('Expected properties must be an object');
      expect(() => expect({}).toMatchInlineSnapshot({}, 1 as never)).toThrow('Inline snapshot must be a string');
      expect(() => expect({}).toMatchInlineSnapshot(null as never, '')).toThrow('Expected properties must be an object');
      expect(() => expect(() => undefined).toThrowErrorMatchingInlineSnapshot(1 as never)).toThrow('Inline snapshot must be a string');
      expect(() => expect(1).toThrowErrorMatchingSnapshot()).toThrow('received value must be a function');
      expect(() => expect(() => undefined).toThrowErrorMatchingSnapshot()).toThrow('Received function did not throw');
      expect(() =>
        expect(() => {
          throw new Error('thrown');
        }).not.toThrowErrorMatchingSnapshot(),
      ).toThrow('Snapshot matchers cannot be used with not');
    });
    const previous = expect.getState();
    expect.setState({ snapshotState: undefined } as never);
    try {
      expect(() => expect({}).toMatchSnapshot()).toThrow('Snapshot state must be initialized');
    } finally {
      expect.setState(previous);
    }
  });

  it('matches the message of the error thrown with its causes, of a promise rejected too', async () => {
    const { file } = await withSnapshots('new', undefined, async () => {
      expect(() => {
        throw new Error('outer', { cause: new Error('inner', { cause: 'a string' }) });
      }).toThrowErrorMatchingSnapshot();
      expect(() => {
        throw new Error('outer', { cause: 42 });
      }).toThrowErrorMatchingSnapshot();
      await expect(Promise.reject(new Error('rejected'))).rejects.toThrowErrorMatchingSnapshot('rejects');
    });
    expect(file).toContain('exports[`t 1`] = `\n"outer\nCause: inner\nCause: a string"\n`;');
    expect(file).toContain('exports[`t 2`] = `"outer"`;');
    expect(file).toContain('exports[`t: rejects 1`] = `"rejected"`;');
  });

  it('prints the mocks and the values of the serializers added', async () => {
    expect.addSnapshotSerializer({
      test: (value: unknown) => value instanceof URL,
      serialize: (value: unknown) => `URL<${(value as URL).href}>`,
    });
    const mock = fn().mockName('named');
    mock(1);
    const { file } = await withSnapshots('new', undefined, () => {
      expect({ mock, plain: fn(), url: new URL('https://example.com') }).toMatchSnapshot();
    });
    expect(file).toContain('"mock": [MockFunction named] {\n    "calls": [\n      [\n        1,\n      ],\n    ],\n    "results": [');
    expect(file).toContain('"plain": [MockFunction],');
    expect(file).toContain('"url": URL<https://example.com/>,');
  });

  it('matches the inline snapshots, indented or not', async () => {
    const { messages } = await withSnapshots('none', undefined, () => {
      expect({ a: 1 }).toMatchInlineSnapshot(`
        {
          "a": 1,

        }
      `);
      expect({ a: 1 }).toMatchInlineSnapshot(
        { a: expect.any(Number) },
        `
{
  "a": Any<Number>,
}
`,
      );
      expect('x').toMatchInlineSnapshot(`"x"`);
      expect('a\nb').toMatchInlineSnapshot(`
    "a
  b"
      `);
      expect('a').toMatchInlineSnapshot(`
          "a"`);
      expect(() => {
        throw new Error('thrown');
      }).toThrowErrorMatchingInlineSnapshot(`"thrown"`);
      expect({ a: 1 }).toMatchInlineSnapshot({ a: expect.any(Number) }, `"wrong"`);
      expect({ a: 'x' }).toMatchInlineSnapshot({ a: expect.any(Number) }, `"x"`);
    });
    expect(messages).toHaveLength(5);
    expect(messages[0]).toContain('"a": 1,');
    expect(messages[3]).toContain('- "wrong"');
    expect(messages[4]).toContain('Expected properties');
  });

  it('names the snapshots by the names of the tests, their line breaks escaped, in natural order', () => {
    expect(testNameToKey('a\nb\r\nc\rd', 2)).toBe(String.raw`a\nb\r\nc\rd 2`);
    expect(keyToTestName(String.raw`a\nb\r\nc\rd 2`)).toBe('a\nb\r\nc\rd');
    // The numbers by their values, the uppercase letters first.
    expect(naturalCompare('a 1', 'a 1')).toBe(0);
    expect(['a', '~'].sort(naturalCompare)).toEqual(['~', 'a']);
    expect(['t 10', 't 9', 't 1', 'T', 'a-b', 'a_b', 'é', 'a 1.5', 'a 1.25', 't', 't'].sort(naturalCompare)).toEqual([
      'T',
      'a 1.5',
      'a 1.25',
      'a_b',
      'a-b',
      't',
      't',
      't 1',
      't 9',
      't 10',
      'é',
    ]);
  });
});
