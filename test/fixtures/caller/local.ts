// A package only this folder resolves: its mock resolved from the module calling, not from expect-node.
import { exnode } from '../../../src/index.ts';

export const mockLocal = () => exnode.mock('local-pkg', { name: () => 'mocked' });
export const importLocal = async () => (await import('local-pkg')) as { name: () => string };
