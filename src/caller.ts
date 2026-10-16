import { fileURLToPath, pathToFileURL } from 'node:url';
import { getCallSites } from 'node:util';

/** The folder of expect-node (its sources or its build), whose modules are never the caller. */
const OWN = [import.meta.dirname, new URL('.', import.meta.url).href];

/** Where a function of expect-node is called from: the module (its URL and its path), the line and the column. */
export type Site = { url: string; file: string; line: number; column: number };

export const callerSite = (): Site => {
  const site = getCallSites().find(({ scriptName }) => scriptName && !OWN.some(own => scriptName.startsWith(own)))!;
  // A path instead of a URL, a CommonJS module calling.
  /* node:coverage ignore next */
  const url = site.scriptName.startsWith('file:') ? site.scriptName : pathToFileURL(site.scriptName).href;
  return { url, file: fileURLToPath(url), line: site.lineNumber, column: site.columnNumber };
};
