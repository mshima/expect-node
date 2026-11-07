/**
 * The inline snapshots written in the test files, without a parser of JavaScript: the call of the matcher found where
 * the stack of its call tells (the line and the column of its name, like Jest), its arguments read by a small reader of
 * the source (strings, templates, comments, regular expressions and brackets), the snapshot one replaced by a template
 * literal, or added, indented as the template it replaces, a new one as Prettier formats it. TypeScript stripped of its types by node keeps the positions of its source.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isOwn } from './caller.ts';
import { escapeBacktickString } from './snapshot-format.ts';

/** Where a matcher is called: the file, and the line and the column of the name of the matcher. */
export type InlineSite = { file: string; line: number; column: number };
export type InlineSnapshot = { site: InlineSite; snapshot: string };

const FRAME = /^\s*at (?:.* \()?(.+?):(\d+):(\d+)\)?$/;

/**
 * The site of the call of a matcher, by the stack of an error created by its call: its first frame out of expect-node,
 * of expect and of node.
 */
export const inlineSiteOf = (error: Error): InlineSite => {
  for (const frame of error.stack?.split('\n') ?? []) {
    const [, script, line, column] = FRAME.exec(frame) ?? [];
    if (!script || script.startsWith('node:') || script.includes('/node_modules/') || isOwn(script)) continue;
    // The query of a module imported again (see mocks.ts), not of its file.
    const file = script.startsWith('file:') ? fileURLToPath(script) : script;
    return { file, line: Number(line), column: Number(column) };
  }
  throw new Error("Couldn't infer stack frame for inline snapshot.");
};

const OPENING = '([{';
const CLOSING = ')]}';
/** The characters a regular expression can follow, where a slash is no division. */
const BEFORE_REGEX = '(,=:[!&|?{};+-*%<>~^';

/** The end of the token at an index: a string, a template, a comment, a regular expression, or a character. */
function tokenEnd(source: string, index: number, regexAllowed: boolean): number {
  const char = source[index];
  if (char === '"' || char === "'") {
    let i = index + 1;
    for (; i < source.length && source[i] !== char; i++) if (source[i] === '\\') i++;
    return i + 1;
  }
  if (char === '`') {
    let i = index + 1;
    for (; i < source.length && source[i] !== '`'; i++) {
      if (source[i] === '\\') i++;
      else if (source[i] === '$' && source[i + 1] === '{') i = closingOf(source, i + 2, '}');
    }
    return i + 1;
  }
  if (char === '/' && source[index + 1] === '/') {
    const end = source.indexOf('\n', index);
    return end === -1 ? source.length : end;
  }
  if (char === '/' && source[index + 1] === '*') return source.indexOf('*/', index + 2) + 2;
  if (char === '/' && regexAllowed) {
    let i = index + 1;
    let inClass = false;
    for (; i < source.length && (inClass || source[i] !== '/'); i++) {
      if (source[i] === '\\') i++;
      else if (source[i] === '[') inClass = true;
      else if (source[i] === ']') inClass = false;
    }
    for (i++; /\w/.test(source.charAt(i));) i++;
    return i;
  }
  return index + 1;
}

/** The index of a closing character at the depth of an index (a comma too, for a parenthesis): of an argument. */
function closingOf(source: string, index: number, closing: string): number {
  let depth = 0;
  let previous = '';
  for (let i = index; i < source.length;) {
    const char = source[i];
    if (depth === 0 && (char === closing || (closing === ')' && char === ','))) return i;
    if (OPENING.includes(char)) depth++;
    else if (CLOSING.includes(char)) depth--;
    const end = tokenEnd(source, i, previous === '' || BEFORE_REGEX.includes(previous));
    const comment = char === '/' && (source[i + 1] === '/' || source[i + 1] === '*');
    if (!comment && !/\s/.test(char)) previous = source[end - 1]!;
    i = end;
  }
  throw new Error('Unterminated call');
}

/** The span of the tokens between two indexes, without the whitespace and the comments around them, if any. */
const tokensIn = (source: string, start: number, end: number) => {
  let span: { start: number; end: number } | undefined;
  for (let i = start; i < end;) {
    const tokenStart = i;
    const char = source[i];
    i = tokenEnd(source, i, false);
    const comment = char === '/' && (source[tokenStart + 1] === '/' || source[tokenStart + 1] === '*');
    if (!comment && !/\s/.test(char)) span = { start: span?.start ?? tokenStart, end: i };
  }
  return span;
};

const MATCHER_NAME = /^\w*InlineSnapshot\b/;

/** The arguments of the call of the matcher at an offset of a source, by their spans, and where it closes. */
const argumentsAt = (source: string, offset: number) => {
  const name = MATCHER_NAME.exec(source.slice(offset));
  if (!name) return undefined;
  let open = offset + name[0].length;
  for (; open < source.length && source[open] !== '(';) {
    // Whitespace or a comment, between the name and its arguments.
    const end = tokenEnd(source, open, false);
    if (end === open + 1 && !/\s/.test(source[open])) return undefined;
    open = end;
  }
  const spans: { start: number; end: number }[] = [];
  let end = open;
  do {
    const start = end + 1;
    end = closingOf(source, start, ')');
    const span = tokensIn(source, start, end);
    if (span) spans.push(span);
  } while (source[end] === ',');
  return { spans, close: end };
};

/**
 * A snapshot of several lines indented: its lines one level more than its closing, the closing at an indentation, like
 * jest-snapshot with Prettier.
 */
const indent = (snapshot: string, indentation: string, level: string) => {
  const lines = snapshot.split('\n');
  return lines
    .map((line, index) => {
      if (index === 0) return line;
      if (index === lines.length - 1) return indentation + line;
      return line === '' ? line : `${indentation}${level}${line}`;
    })
    .join('\n');
};

/**
 * The indentation of the closing of a template of several lines, the style its snapshot is written with: none when
 * it closes at the start of its line; undefined for a template of one line, of no style.
 */
const styleOf = (template: string) => {
  if (!template.includes('\n')) return undefined;
  const last = template.slice(template.lastIndexOf('\n') + 1, -1);
  return /^[ \t]+$/.test(last) ? last : '';
};

const BRACKETS: Record<string, string> = { ')': '(', ']': '[' };

/** The index of the opening of a closing parenthesis or bracket, backwards, by their depth; -1 if none. */
const openingBefore = (source: string, index: number) => {
  let depth = 0;
  for (let i = index; i >= 0; i--) {
    const char = source[i];
    if (char === ')' || char === ']') depth++;
    else if (char === '(' || char === '[') depth--;
    if (depth === 0) return BRACKETS[source[index]] === char ? i : -1;
  }
  return -1;
};

const skipWhitespaceBefore = (source: string, index: number) => {
  let i = index;
  while (i >= 0 && /\s/.test(source[i])) i--;
  return i;
};

/**
 * The start of the call of the matcher at an offset, where Prettier indents its snapshot from: the start of the
 * expression whose member it is (`expect(value)`, `.not`, `.resolves`, of several lines too), or of its await.
 */
const callStartOf = (source: string, offset: number) => {
  let start = offset;
  for (let i = skipWhitespaceBefore(source, offset - 1); source[i] === '.'; i = skipWhitespaceBefore(source, start - 1)) {
    i = skipWhitespaceBefore(source, source[i - 1] === '?' ? i - 2 : i - 1);
    while (source[i] === ')' || source[i] === ']') {
      const opening = openingBefore(source, i);
      if (opening === -1) return offset;
      i = skipWhitespaceBefore(source, opening - 1);
    }
    while (i >= 0 && /[\w$]/.test(source[i])) i--;
    start = i + 1;
  }
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const awaited = /await\s+$/.exec(source.slice(lineStart, start));
  return awaited ? lineStart + awaited.index : start;
};

/**
 * The indentation of a new snapshot by the column of its call, as Prettier does it: two spaces by level, the levels of
 * the column; the tabs of a call indented by tabs, a level more.
 */
const indentationAt = (source: string, offset: number) => {
  const start = callStartOf(source, offset);
  const prefix = source.slice(source.lastIndexOf('\n', start - 1) + 1, start);
  if (/^\t+$/.test(prefix)) return { indentation: prefix, level: '\t' };
  return { indentation: '  '.repeat(Math.ceil(prefix.length / 2)), level: '  ' };
};

/** The offset of a line and a column (from 1) in a source. */
const offsetOf = (source: string, line: number, column: number) => {
  let offset = 0;
  for (let current = 1; current < line; current++) offset = source.indexOf('\n', offset) + 1;
  return offset + column - 1;
};

/** Writes the inline snapshots in their files: each one in the snapshot argument of its call, or added to them. */
export const writeInlineSnapshots = (snapshots: InlineSnapshot[]) => {
  const byFile = new Map<string, InlineSnapshot[]>();
  for (const snapshot of snapshots) byFile.set(snapshot.site.file, [...(byFile.get(snapshot.site.file) ?? []), snapshot]);
  for (const [file, ofFile] of byFile) {
    const source = readFileSync(file, 'utf8');
    const edits = new Map<number, { start: number; end: number; text: string; snapshot: string }>();
    for (const { site, snapshot } of ofFile) {
      const offset = offsetOf(source, site.line, site.column);
      const previous = edits.get(offset);
      if (previous) {
        // The same call run again: the same snapshot, or one it cannot have.
        if (previous.snapshot === snapshot) continue;
        throw new Error(`Multiple inline snapshots for the same call are not supported (${file}:${site.line}:${site.column}).`);
      }
      const call = argumentsAt(source, offset);
      if (!call) throw new Error(`Couldn't locate the inline snapshot of ${file}:${site.line}:${site.column}.`);
      const literal = call.spans.find(({ start, end }) => '`"\''.includes(source[start]) && tokenEnd(source, start, false) === end);
      // Indented as the template of several lines it replaces, indented or not: the snapshots of Jest, esmocha and
      // Vitest written as they are. A new one, formatted as Prettier does it.
      const style = literal && styleOf(source.slice(literal.start, literal.end));
      const { indentation, level } = style === undefined ? indentationAt(source, offset) : { indentation: style, level: '  ' };
      const formatted = style === '' ? snapshot : indent(snapshot, indentation, level);
      const template = `\`${escapeBacktickString(formatted)}\``;
      if (literal) edits.set(offset, { ...literal, text: template, snapshot });
      else {
        const last = call.spans.at(-1);
        const at = last ? last.end : call.close;
        edits.set(offset, { start: at, end: at, text: last ? `, ${template}` : template, snapshot });
      }
    }
    const written = [...edits.values()]
      .sort((a, b) => b.start - a.start)
      .reduce((text, { start, end, text: replacement }) => text.slice(0, start) + replacement + text.slice(end), source);
    if (written !== source) writeFileSync(file, written);
  }
};
