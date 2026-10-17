/**
 * The module mocks of exnode: an import of a module mocked resolves to a module of its own reading its exports, by
 * in-thread hooks. The module mocks of node (and quibble) run off-thread hooks, whose thread compiles the module and
 * records a coverage of zero under its URL, which node merges over the one of the tests (nodejs/node#65946).
 */
import { registerHooks } from 'node:module';

import { callerSite, OWN } from './caller.ts';

/**
 * The modules mocked, by URL: their exports, the ones of the module itself, and the generation of the mock, a URL of its
 * own (node keeps a module by its URL, a module mocked again is another one).
 */
const mocked = new Map<string, { exports: Record<string, unknown>; actual: Record<string, unknown>; generation: number }>();
/**
 * Each change of the mocks. While a module is mocked, the modules imported after a change are each a module of its own
 * again (but the packages and expect-node): the module under test imported again sees the mocks, even when the test
 * file imported it before, like quibble of esmocha.
 */
let generation = 0;
const MOCKED = Symbol.for('exnode.mocked');
const MOCK_PROTOCOL = 'exnode-mock:';
/** A specifier resolved from another module (`exnode-resolve:<[specifier, parent URL] as JSON>`). */
const RESOLVE_PROTOCOL = 'exnode-resolve:';
// Only while a module is mocked: once none is, the modules imported before any mock are the ones of the imports again.
const isFresh = (url: string) => mocked.size > 0 && url.startsWith('file:') && !url.startsWith(OWN) && !url.includes('/node_modules/');
(globalThis as Record<symbol, unknown>)[MOCKED] = mocked;
const isIdentifier = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name);
registerHooks({
  resolve: (specifier, context, nextResolve) => {
    if (specifier.startsWith(RESOLVE_PROTOCOL)) {
      const [of, parentURL] = JSON.parse(decodeURIComponent(specifier.slice(RESOLVE_PROTOCOL.length))) as [string, string];
      return { url: nextResolve(of, { ...context, parentURL }).url, shortCircuit: true };
    }
    const resolved = nextResolve(specifier, context);
    const mock = mocked.get(resolved.url);
    if (mock) return { url: `${MOCK_PROTOCOL}${mock.generation}:${resolved.url}`, shortCircuit: true };
    if (!isFresh(resolved.url)) return resolved;
    const url = new URL(resolved.url);
    url.searchParams.set('exnode', String(generation));
    return { ...resolved, url: url.href };
  },
  load: (url, context, nextLoad) => {
    if (!url.startsWith(MOCK_PROTOCOL)) return nextLoad(url, context);
    const of = url.slice(url.indexOf(':', MOCK_PROTOCOL.length) + 1);
    const { exports } = mocked.get(of)!;
    const names = Object.keys(exports).filter(name => name !== 'default' && isIdentifier(name));
    const read = `globalThis[Symbol.for(${JSON.stringify(MOCKED.description)})].get(${JSON.stringify(of)}).exports`;
    const source = [
      `const exports = ${read};`,
      ...(names.length > 0 ? [`export const { ${names.join(', ')} } = exports;`] : []),
      ...('default' in exports ? ['export default exports.default;'] : []),
    ].join('\n');
    return { format: 'module', source, shortCircuit: true };
  },
});

/** The URL of a module, its specifier resolved from the module calling (relative, a package, an import of its package). */
export const urlOf = (specifier: string) =>
  import.meta.resolve(`${RESOLVE_PROTOCOL}${encodeURIComponent(JSON.stringify([specifier, callerSite().url]))}`);

/** The module itself, not a mock of it: the import of a module mocked gives the mock. */
export const actualOf = async (url: string) => mocked.get(url)?.actual ?? ((await import(url)) as Record<string, unknown>);

/** Mocks a module: its exports, and the ones of the module itself. */
export const setMock = (url: string, exports: Record<string, unknown>, actual: Record<string, unknown>) => {
  mocked.set(url, { exports, actual, generation: ++generation });
};

/** The module itself again, of one or of every module mocked. */
export const removeMock = (url?: string) => {
  if (url === undefined) mocked.clear();
  else mocked.delete(url);
  generation++;
};
