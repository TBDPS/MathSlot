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
const CODE_FENCE_RE = /^([ \t]*)(`{3,}|~{3,})/;

function isDollarFenceLine(trimmed: string): boolean {
  if (trimmed === '$$') return true;
  if (trimmed.startsWith('$$$')) return false;
  if (trimmed.endsWith('$$$')) return false;
  const isSingleLineBlock =
    trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length >= 4;
  if (isSingleLineBlock) return false;
  return trimmed.startsWith('$$') || trimmed.endsWith('$$');
}

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

function isEscapedAt(text: string, idx: number): boolean {
  let backslashes = 0;
  for (let i = idx - 1; i >= 0 && text[i] === '\\'; i -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

/**
 * Scans a single Markdown line (with blockquote prefix already stripped) for inline `$...$`
 * or single-line `$$...$$` formulas while strictly skipping Markdown inline code spans
 * (`` `...` ``, ``` ``...`` ```), escaped `\$`, and `$$$`+ sequences.
 */
function findInlineFormulaOnLine(
  content: string,
  cursorOffset: number,
): { start: number; end: number; raw: string; delimiter: DelimiterStyle } | null {
  let i = 0;
  const n = content.length;

  while (i < n) {
    const ch = content[i];

    // Skip Markdown inline code spans (matching exact backtick run length)
    if (ch === '`' && !isEscapedAt(content, i)) {
      let tickLen = 1;
      while (i + tickLen < n && content[i + tickLen] === '`') tickLen += 1;
      let scan = i + tickLen;
      let closed = false;
      while (scan < n) {
        if (content[scan] === '`') {
          let closeLen = 1;
          while (scan + closeLen < n && content[scan + closeLen] === '`') closeLen += 1;
          if (closeLen === tickLen) {
            i = scan + closeLen;
            closed = true;
            break;
          }
          scan += closeLen;
          continue;
        }
        scan += 1;
      }
      if (!closed) {
        // Unclosed backtick run — treat as literal text and continue after the ticks
        i += tickLen;
      }
      continue;
    }

    if (ch === '$' && !isEscapedAt(content, i)) {
      let dollarCount = 1;
      while (i + dollarCount < n && content[i + dollarCount] === '$') dollarCount += 1;

      // Ignore `$$$` or longer runs
      if (dollarCount >= 3) {
        i += dollarCount;
        continue;
      }

      if (dollarCount === 2) {
        // Single-line `$$ ... $$`
        let scan = i + 2;
        let closeIdx = -1;
        while (scan < n) {
          if (content[scan] === '$' && !isEscapedAt(content, scan)) {
            let closeCount = 1;
            while (scan + closeCount < n && content[scan + closeCount] === '$') closeCount += 1;
            if (closeCount === 2) {
              closeIdx = scan;
              break;
            }
            scan += closeCount;
            continue;
          }
          scan += 1;
        }
        if (closeIdx > i + 2) {
          const end = closeIdx + 2;
          if (cursorOffset >= i && cursorOffset <= end) {
            return {
              start: i,
              end,
              raw: content.slice(i, end),
              delimiter: 'block',
            };
          }
          i = end;
          continue;
        }
        i += 2;
        continue;
      }

      // Single `$ ... $` inline math
      let scan = i + 1;
      let closeIdx = -1;
      while (scan < n) {
        if (content[scan] === '`' && !isEscapedAt(content, scan)) {
          // Do not cross an inline code span boundary when searching for closing `$`
          break;
        }
        if (content[scan] === '$' && !isEscapedAt(content, scan)) {
          let closeCount = 1;
          while (scan + closeCount < n && content[scan + closeCount] === '$') closeCount += 1;
          if (closeCount === 1) {
            closeIdx = scan;
            break;
          }
          scan += closeCount;
          continue;
        }
        scan += 1;
      }
      if (closeIdx > i + 1) {
        const end = closeIdx + 1;
        if (cursorOffset >= i && cursorOffset <= end) {
          return {
            start: i,
            end,
            raw: content.slice(i, end),
            delimiter: 'inline',
          };
        }
        i = end;
        continue;
      }
      i += 1;
      continue;
    }

    i += 1;
  }

  return null;
}

/**
 * Detects an enclosing `$...$` (inline) or `$$...$$` (single/multi-line block) formula around
 * `cursor` in a Markdown document, properly handling blockquotes (`> ...`), nested blockquotes
 * (`> > ...`), Obsidian Callouts (`> [!note] ...`), fenced code blocks, inline code spans, and
 * escaped `\$` currency signs.
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
  const targetDepth = blockquoteDepth(cursorSplit.prefix);

  // 1. Track fenced code blocks AND multi-line `$$ ... $$` blocks from line 0..cursor.line FIRST
  //    so inline `$...$` inside fenced code blocks or multi-line blocks is NEVER misidentified!
  let insideBlock = false;
  let openLine = -1;
  let openPrefix = '';
  let codeFenceChar = '';
  let codeFenceLen = 0;
  let cursorIsCodeFenceLine = false;

  for (let l = 0; l <= cursor.line; l += 1) {
    const split = extractBlockquotePrefix(lines[l]);
    const depth = blockquoteDepth(split.prefix);
    if (depth !== targetDepth) {
      // Crossed a blockquote / callout boundary — reset fence parity
      insideBlock = false;
      openLine = -1;
      openPrefix = '';
      codeFenceChar = '';
      codeFenceLen = 0;
      continue;
    }

    const trimmed = split.content.trim();
    const fenceMatch = CODE_FENCE_RE.exec(trimmed);
    if (fenceMatch) {
      const ch = fenceMatch[2][0];
      const len = fenceMatch[2].length;
      if (!codeFenceChar) {
        codeFenceChar = ch;
        codeFenceLen = len;
        insideBlock = false;
        openLine = -1;
        openPrefix = '';
        if (l === cursor.line) cursorIsCodeFenceLine = true;
        continue;
      }
      if (ch === codeFenceChar && len >= codeFenceLen && trimmed.slice(fenceMatch[0].length).trim() === '') {
        codeFenceChar = '';
        codeFenceLen = 0;
        if (l === cursor.line) cursorIsCodeFenceLine = true;
        continue;
      }
    }
    if (codeFenceChar) continue;

    if (isDollarFenceLine(trimmed)) {
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

  // Never detect math on or inside a fenced code block!
  if (codeFenceChar || cursorIsCodeFenceLine) return null;

  // 2. If cursor is inside an open multi-line `$$ ... $$` block, resolve its closing fence
  if (insideBlock && openLine >= 0) {
    const maxLine = Math.min(lines.length - 1, cursor.line + 80);
    let closeLine = -1;
    for (let l = openLine + 1; l <= maxLine; l += 1) {
      const split = extractBlockquotePrefix(lines[l]);
      if (blockquoteDepth(split.prefix) !== targetDepth) {
        break;
      }
      const trimmed = split.content.trim();
      if (CODE_FENCE_RE.test(trimmed)) break;
      if (trimmed === '$$' || (trimmed.endsWith('$$') && !trimmed.endsWith('$$$'))) {
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

  // 3. Check inline `$...$` or single-line `$$...$$` on the current line (outside code spans & escapes)
  const cursorOffset = cursor.ch - cursorPrefixLen;
  if (cursorOffset >= 0) {
    const inlineHit = findInlineFormulaOnLine(cursorSplit.content, cursorOffset);
    if (inlineHit) {
      return {
        raw: inlineHit.raw,
        delimiter: inlineHit.delimiter,
        from: { line: cursor.line, ch: cursorPrefixLen + inlineHit.start },
        to: { line: cursor.line, ch: cursorPrefixLen + inlineHit.end },
        linePrefix: cursorCanonicalPrefix,
        includeFirstLinePrefix: false,
      };
    }
  }

  return null;
}
