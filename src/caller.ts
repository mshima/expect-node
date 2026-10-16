import { getCallSites } from 'node:util';

/** The folder of expect-node (its sources or its build), whose modules are never the caller. */
const OWN = [import.meta.dirname, new URL('.', import.meta.url).href];

/** The URL of the module calling a function of expect-node, to resolve its relative specifiers. */
export const callerUrl = () => {
  const site = getCallSites().find(({ scriptName }) => scriptName && !OWN.some(own => scriptName.startsWith(own)));
  // A path instead of a URL, a CommonJS module calling.
  /* node:coverage ignore next */
  return site!.scriptName.startsWith('file:') ? site!.scriptName : new URL(`file://${site!.scriptName}`).href;
};

/** The URL of a module, a relative specifier from the module calling. */
export const urlOf = (specifier: string) =>
  specifier.startsWith('.') ? new URL(specifier, callerUrl()).href : import.meta.resolve(specifier);
