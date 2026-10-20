import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { longestFirst } from '../src/durations.ts';
import { describe, expect, it } from '../src/index.ts';

describe('the test files longest first', () => {
  it('keeps the order of the test files without a file of durations, or of one not of them', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'expect-node-durations-'));
    try {
      const files = ['b.test.ts', 'a.test.ts'];
      expect(longestFirst(files, join(folder, 'none.json'))).toEqual(files);
      await writeFile(join(folder, 'other.json'), '{}');
      expect(longestFirst(files, join(folder, 'other.json'))).toEqual(files);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
