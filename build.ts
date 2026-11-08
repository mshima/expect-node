/**
 * The build of expect-node: its modules and the ones of expect, jest-mock and pretty-format bundled in dist, with no
 * dependencies to install (the types of Jest, a few megabytes, among them); each module of src a module of dist by its
 * name (loaded by its path, see ownModule of caller.ts), the modules shared by them in chunks next to them. The
 * declarations of the exports bundled too, and the licenses of the packages bundled.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { build } from 'esbuild';
import { rollup } from 'rollup';
import { dts } from 'rollup-plugin-dts';

const DIST = 'dist';
const TYPES = join(DIST, '.types');

rmSync(DIST, { recursive: true, force: true });

const { metafile } = await build({
  entryPoints: readdirSync('src')
    .filter(file => file.endsWith('.ts'))
    .map(file => join('src', file)),
  outdir: DIST,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // In the folder of the modules, which a module of expect-node is by its folder (see caller.ts).
  chunkNames: '[name]-[hash]',
  // The require of the CommonJS packages bundled, of the modules of node.
  banner: { js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);" },
  // Of jest-message-util only, which takes the folder two above its own for the packages of Jest, its frames hidden
  // in the stacks it prints: none.
  define: { __dirname: '"/"' },
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});

// The declarations of the exports, the ones of the packages bundled in them.
execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json', '--emitDeclarationOnly', '--outDir', TYPES], { stdio: 'inherit' });
// The types of chalk and of @jest/schemas, a CommonJS namespace and the schemas of typebox, by the ones that matter.
const STUBS: Record<string, string> = {
  chalk: 'export type Chalk = ((...text: unknown[]) => string) & { readonly [style: string]: Chalk };\n',
  '@jest/schemas': `export type SnapshotFormat = {
  callToJSON?: boolean;
  compareKeys?: null;
  escapeRegex?: boolean;
  escapeString?: boolean;
  highlight?: boolean;
  indent?: number;
  maxDepth?: number;
  maxWidth?: number;
  min?: boolean;
  printBasicPrototype?: boolean;
  printFunctionName?: boolean;
  theme?: { comment?: string; content?: string; prop?: string; tag?: string; value?: string };
};
`,
};
const stubs = Object.fromEntries(
  Object.entries(STUBS).map(([name, types]) => {
    const file = resolve(TYPES, 'stubs', `${name.replace('/', '-')}.d.ts`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, types);
    return [name, file];
  }),
);
const bundle = await rollup({
  input: { index: join(TYPES, 'index.d.ts'), config: join(TYPES, 'config.d.ts') },
  plugins: [{ name: 'stubs', resolveId: (id: string) => stubs[id] }, dts({ respectExternal: true })],
  external: id => id.startsWith('node:'),
});
await bundle.write({ dir: DIST, format: 'es', chunkFileNames: '[name]-[hash].d.ts' });
rmSync(TYPES, { recursive: true });
// The matchers of the snapshots, of expect once (`declare module 'expect'`), of the matchers bundled; those exported,
// for the matchers of a project (`declare module 'expect-node'`); the lib of the Disposable of jest-mock.
const index = join(DIST, 'index.d.ts');
const types = readFileSync(index, 'utf8')
  .replace(/^declare module 'expect' \{\n([\s\S]*?)\n\}\n/m, (_, body: string) => `${body.replaceAll(/^ {4}/gm, '')}\n`)
  .replace(/^export \{ /m, 'export { type AsymmetricMatchers, type BaseExpect, type Matchers, ');
writeFileSync(index, `/// <reference lib="esnext.disposable" />\n${types}`);

// The licenses of the packages bundled, by their package.json.
const packages = new Map<string, string>();
for (const input of Object.keys(metafile.inputs)) {
  const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (!match || packages.has(match[1])) continue;
  const { name, version, license } = JSON.parse(readFileSync(join(match[1], 'package.json'), 'utf8')) as Record<string, string>;
  const file = readdirSync(match[1]).find(entry => /^licen[cs]e/i.test(entry));
  const text = file ? readFileSync(join(match[1], file), 'utf8').trim() : license;
  packages.set(match[1], `## ${name}@${version}\n\n${text}\n`);
}
writeFileSync(
  join(DIST, 'THIRD-PARTY-LICENSES.md'),
  `# The licenses of the packages bundled in expect-node\n\n${[...packages.values()].sort().join('\n')}`,
);
process.stdout.write(`${DIST}: ${packages.size} packages bundled\n`);
