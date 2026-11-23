import type { DelimiterStyle } from './types';

export interface EditorPos {
  line: number;
  ch: number;
}

export interface DetectedEditorFormula {
  /** Pure formula text (with `$` / `$$` delimiters, stripped of any leading blockquote `>` prefixes) */
  raw: string;
  delimiter: DelimiterStyle;
  from: EditorPos;
  to: EditorPos;
  /** Canonical blockquote line prefix to re-prepend when writing multi-line replacements (e.g. `"> "`, `"> > "`, or `""`) */
  linePrefix: string;
  /** Whether the replacement range starts at column 0 (meaning line 0 also needs `linePrefix`) */
  includeFirstLinePrefix: boolean;
}

const BLOCKQUOTE_PREFIX_RE = /^([ \t]*(?:>[ \t]?)+)/;

/**
 * Splits a Markdown line into its leading blockquote prefix (e.g. `"> "`, `"> > "`, `"  > "`)
 * and the remaining content after the blockquote markers.
 */
export function extractBlockquotePrefix(line: string): { prefix: string; content: string } {
  const match = BLOCKQUOTE_PREFIX_RE.exec(line);
  if (!match) {
    return { prefix: '', content: line };
  }
  const prefix = match[1];
  return {
    prefix,
    content: line.slice(prefix.length),
  };
}

/** Counts blockquote nesting depth (`>` count) of a prefix string. */
export function blockquoteDepth(prefix: string): number {
  let count = 0;
  for (let i = 0; i < prefix.length; i += 1) {
    if (prefix[i] === '>') count += 1;
  }
  return count;
}

/** Normalizes a non-empty blockquote prefix so it ends with a single space (e.g. `">"` -> `"> "`). */
export function canonicalBlockquotePrefix(prefix: string): string {
  if (!prefix) return '';
  if (prefix.endsWith('>')) return `${prefix} `;
  return prefix;
}

/**
 * Strips leading blockquote prefixes from a user-selected multi-line string if all non-empty lines
 * share blockquote markers, returning the clean LaTeX and the canonical prefix for re-insertion.
 */
export function stripBlockquoteSelection(text: string): { clean: string; linePrefix: string } {
  const lines = text.split('\n');
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return { clean: text, linePrefix: '' };

  let minDepth = Infinity;
  let samplePrefix = '';
  for (const line of nonEmpty) {
    const { prefix } = extractBlockquotePrefix(line);
    const depth = blockquoteDepth(prefix);
    if (depth === 0) {
      return { clean: text, linePrefix: '' };
    }
    if (depth < minDepth) {
      minDepth = depth;
      samplePrefix = prefix;
    }
  }

  const stripped = lines.map((line) => {
    const { content } = extractBlockquotePrefix(line);
    return content;
  });

  return {
    clean: stripped.join('\n'),
    linePrefix: canonicalBlockquotePrefix(samplePrefix),
  };
}

/**
 * Formats a formula string for insertion/replacement inside an Obsidian Markdown editor,
 * preserving blockquote / callout `> ` prefixes across all lines.
 */
export function formatFormulaForEditorInsertion(
  formattedLatex: string,
  linePrefix: string,
  includeFirstLinePrefix: boolean,
): string {
  if (!linePrefix) return formattedLatex;
  const lines = formattedLatex.split('\n');
  return lines
    .map((line, idx) => {
      if (idx === 0 && !includeFirstLinePrefix) {
        return line;
      }
      return `${linePrefix}${line}`;
    })
    .join('\n');
}

/**
 * Detects an enclosing `$...$` (inline) or `$$...$$` (single/multi-line block) formula around
 * `cursor` in a Markdown document, properly handling blockquotes (`> ...`), nested blockquotes
 * (`> > ...`), and Obsidian Callouts (`> [!note] ...`).
 */
export function detectFormulaInLines(
  lines: string[],
  cursor: EditorPos,
): DetectedEditorFormula | null {
  if (cursor.line < 0 || cursor.line >= lines.length) return null;

  const cursorLineText = lines[cursor.line];
  const cursorSplit = extractBlockquotePrefix(cursorLineText);
  const cursorPrefixLen = cursorSplit.prefix.length;
  const cursorCanonicalPrefix = canonicalBlockquotePrefix(cursorSplit.prefix);

  // 1. Check inline `$...$` or single-line `$$...$$` on the current line (after blockquote prefix)
  const inlineRegex = /(\$\$[\s\S]*?\$\$|\$(?!\$)(?:\\\$|[^$\n])+\$)/g;
  let match: RegExpExecArray | null;
  while ((match = inlineRegex.exec(cursorSplit.content)) !== null) {
    const start = cursorPrefixLen + match.index;
    const end = start + match[0].length;
    if (cursor.ch >= start && cursor.ch <= end) {
      const isBlock = match[0].startsWith('$$');
      return {
        raw: match[0],
        delimiter: isBlock ? 'block' : 'inline',
        from: { line: cursor.line, ch: start },
        to: { line: cursor.line, ch: end },
        linePrefix: cursorCanonicalPrefix,
        includeFirstLinePrefix: false,
      };
    }
  }

  // 2. Check multi-line `$$ ... $$` block surrounding cursor.line with exact blockquote-depth parity
  const targetDepth = blockquoteDepth(cursorSplit.prefix);
  let insideBlock = false;
  let openLine = -1;
  let openPrefix = '';

  for (let l = 0; l <= cursor.line; l += 1) {
    const split = extractBlockquotePrefix(lines[l]);
    const depth = blockquoteDepth(split.prefix);
    if (depth !== targetDepth) {
      // Crossed a blockquote / callout boundary — reset fence parity
      insideBlock = false;
      openLine = -1;
      openPrefix = '';
      continue;
    }

    const trimmed = split.content.trim();
    const isSingleLineBlock =
      trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length >= 4;
    if (isSingleLineBlock) continue;

    if (trimmed === '$$' || trimmed.startsWith('$$') || trimmed.endsWith('$$')) {
      if (!insideBlock) {
        insideBlock = true;
        openLine = l;
        openPrefix = canonicalBlockquotePrefix(split.prefix);
      } else {
        if (l === cursor.line) {
          // Cursor is on the closing `$$` fence of this open block
          const stripped: string[] = [];
          for (let k = openLine; k <= l; k += 1) {
            stripped.push(extractBlockquotePrefix(lines[k]).content);
          }
          return {
            raw: stripped.join('\n'),
            delimiter: 'block',
            from: { line: openLine, ch: 0 },
            to: { line: l, ch: lines[l].length },
            linePrefix: openPrefix,
            includeFirstLinePrefix: openPrefix.length > 0,
          };
        }
        insideBlock = false;
        openLine = -1;
        openPrefix = '';
      }
    }
  }

  if (insideBlock && openLine >= 0) {
    const maxLine = Math.min(lines.length - 1, cursor.line + 80);
    let closeLine = -1;
    for (let l = openLine + 1; l <= maxLine; l += 1) {
      const split = extractBlockquotePrefix(lines[l]);
      if (blockquoteDepth(split.prefix) !== targetDepth) {
        // Exited the blockquote before finding closing `$$`
        break;
      }
      const trimmed = split.content.trim();
      if (trimmed === '$$' || trimmed.endsWith('$$')) {
        closeLine = l;
        break;
      }
    }
    if (closeLine > openLine && cursor.line >= openLine && cursor.line <= closeLine) {
      const stripped: string[] = [];
      for (let l = openLine; l <= closeLine; l += 1) {
        stripped.push(extractBlockquotePrefix(lines[l]).content);
      }
      return {
        raw: stripped.join('\n'),
        delimiter: 'block',
        from: { line: openLine, ch: 0 },
        to: { line: closeLine, ch: lines[closeLine].length },
        linePrefix: openPrefix,
        includeFirstLinePrefix: openPrefix.length > 0,
      };
    }
  }

  return null;
}
