import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';

import { describe, exnode, expect, it } from '../../../src/index.ts';

const scope = globalThis as { setups?: number };
await exnode.mock('./value.ts', { value: () => 2 });

describe('a test file mocking', () => {
  it('is mocked', async () => {
    expect((await import('./value.ts')).value()).toBe(2);
  });

  it('has the setup files, not its worker threads nor its subprocesses', async () => {
    const worker = new Worker("require('node:worker_threads').parentPort.postMessage(globalThis.setups ?? 'none')", { eval: true });
    expect(await new Promise(resolve => worker.once('message', resolve))).toBe('none');
    await worker.terminate();
    const { stdout } = await promisify(execFile)(process.execPath, [...process.execArgv, '-p', "globalThis.setups ?? 'none'"]);
    expect(stdout).toBe('none\n');
  });

  it('ran the setup', () => {
    process.stdout.write(`setups: ${scope.setups}\n`);
  });
});
