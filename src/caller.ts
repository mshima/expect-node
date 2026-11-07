import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getCallSites } from 'node:util';
import { compileFunction } from 'node:vm';

/** The folder of expect-node (its sources or its build), whose modules are never the caller. */
export const OWN = new URL('.', import.meta.url).href;
const OWN_PATHS = [import.meta.dirname, OWN];

/** Whether a script, by its path or its URL, is a module of expect-node. */
export const isOwn = (scriptName: string) => OWN_PATHS.some(own => scriptName.startsWith(own));

/** The URL of a module of expect-node by its name, of its sources or of its build as this one. */
export const ownModule = (name: string) => new URL(`./${name}${extname(import.meta.url)}`, import.meta.url).href;

/** Where a function of expect-node is called from: the module (its URL and its path), the line and the column. */
export type Site = { url: string; file: string; line: number; column: number };

export const callerSite = (): Site => {
  const site = getCallSites().find(({ scriptName }) => scriptName && !isOwn(scriptName))!;
  // A path instead of a URL, a CommonJS module calling.
  /* node:coverage ignore next */
  const url = site.scriptName.startsWith('file:') ? site.scriptName : pathToFileURL(site.scriptName).href;
  return { url, file: fileURLToPath(url), line: site.lineNumber, column: site.columnNumber };
};

/**
 * A function of node:test called from a site, the location node gives a test or a hook (it takes the one of its
 * caller, else expect-node): by a function compiled at the line and the column of the site.
 */
type Call = (declare: unknown, args: unknown[]) => unknown;
const calls = new Map<string, Call>();

/**
 * The calls held while a worker imports a test file, made then at once in the suite of the file (see worker.ts): node
 * filtering the tests by their names drops a suite of a run started that has none of its tests when it starts.
 */
export const declarations: { held?: (() => unknown)[] } = {};

export const callAt = ({ file, line, column }: Site, declare: unknown, args: unknown[]) => {
  const key = `${file}:${line}:${column}`;
  let call = calls.get(key);
  if (!call) {
    // The path, not the URL: the coverage of node takes the modules of a file: URL only.
    call = compileFunction('return declare(...args)', ['declare', 'args'], {
      filename: file,
      lineOffset: line - 1,
      columnOffset: column - 1 - 'return '.length,
    }) as unknown as Call;
    calls.set(key, call);
  }
  if (declarations.held) {
    declarations.held.push(() => call(declare, args));
    return undefined;
  }
  return call(declare, args);
};
