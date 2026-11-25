import type { DelimiterStyle, MathWrapperKind } from './types';

export interface EditorPos {
  line: number;
  ch: number;
}

export interface DetectedEditorFormula {
  /** Pure formula text (with `$` / `$$` / `\(...\)` / `\[...\]` delimiters, stripped of any leading blockquote `>` prefixes) */
  raw: string;
  delimiter: DelimiterStyle;
  /** Exact source delimiter dialect so in-place Obsidian edits write back `\(...\)` or `\[...\]` faithfully */
  wrapper: MathWrapperKind;
  from: EditorPos;
  to: EditorPos;
  /** Canonical blockquote line prefix to re-prepend when writing multi-line replacements (e.g. `"> "`, `"> > "`, or `""`) */
  linePrefix: string;
  /** Whether the replacement range starts at column 0 (meaning line 0 also needs `linePrefix`) */
  includeFirstLinePrefix: boolean;
}

/** Infers the exact source wrapper dialect from a user-selected raw formula string. */
export function detectWrapperFromRaw(raw: string): MathWrapperKind | undefined {
  const s = raw.trim();
  if (s.startsWith('\\(') && s.endsWith('\\)') && s.length >= 4) return 'paren_inline';
  if (s.startsWith('\\[') && s.endsWith('\\]') && s.length >= 4) return 'bracket_block';
  if (s.startsWith('$$') && s.endsWith('$$') && s.length >= 4) return 'dollar_block';
  if (s.startsWith('$') && s.endsWith('$') && s.length >= 2 && !s.startsWith('$$')) return 'dollar_inline';
  if (s.startsWith('```') && s.endsWith('```')) return 'codeblock';
  return undefined;
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

function isBracketOpenLine(trimmed: string): boolean {
  if (!trimmed.startsWith('\\[')) return false;
  // Single-line `\[ ... \]` is handled by `findInlineFormulaOnLine`
  if (trimmed.endsWith('\\]') && trimmed.length >= 4) return false;
  return true;
}

function isBracketCloseLine(trimmed: string): boolean {
  if (!trimmed.endsWith('\\]')) return false;
  if (trimmed.startsWith('\\[') && trimmed.length >= 4) return false;
  return true;
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
): { start: number; end: number; raw: string; delimiter: DelimiterStyle; wrapper: MathWrapperKind } | null {
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
              wrapper: 'dollar_block',
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
            wrapper: 'dollar_inline',
          };
        }
        i = end;
        continue;
      }
      i += 1;
      continue;
    }

    // Inline `\(...\)` or single-line `\[...\]` LaTeX delimiters (skipping escaped `\\(` / `\\[`)
    if (ch === '\\' && !isEscapedAt(content, i) && i + 1 < n) {
      const nextCh = content[i + 1];
      if (nextCh === '(' || nextCh === '[') {
        const closeToken = nextCh === '(' ? '\\)' : '\\]';
        const delimiter: DelimiterStyle = nextCh === '(' ? 'inline' : 'block';
        const wrapper: MathWrapperKind = nextCh === '(' ? 'paren_inline' : 'bracket_block';
        let scan = i + 2;
        let closeIdx = -1;
        while (scan < n) {
          if (content[scan] === '`' && !isEscapedAt(content, scan)) {
            break;
          }
          if (
            content[scan] === '\\' &&
            !isEscapedAt(content, scan) &&
            content.startsWith(closeToken, scan)
          ) {
            closeIdx = scan;
            break;
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
              delimiter,
              wrapper,
            };
          }
          i = end;
          continue;
        }
        i += 2;
        continue;
      }
    }

    i += 1;
  }

  return null;
}

function stripNBlockquoteMarkers(line: string, count: number): string {
  let pos = 0;
  let stripped = 0;
  while (stripped < count && pos < line.length) {
    while (pos < line.length && (line[pos] === ' ' || line[pos] === '\t')) pos += 1;
    if (line[pos] !== '>') break;
    pos += 1;
    if (line[pos] === ' ' || line[pos] === '\t') pos += 1;
    stripped += 1;
  }
  return line.slice(pos);
}

/**
 * Detects an enclosing `$...$` (inline) or `$$...$$` (single/multi-line block) formula around
 * `cursor` in a Markdown document, properly handling blockquotes (`> ...`), nested blockquotes
 * (`> > ...`), Obsidian Callouts (`> [!note] ...`), outer fenced code blocks containing `>`,
 * blockquotes containing fenced code blocks, inline code spans, and escaped `\$` currency signs.
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

  // 1. Container-first scan from line 0..cursor.line:
  //    An open fenced code block at depth `d` encloses ALL lines with blockquote depth `>= d`
  //    (so `~~~md` followed by `> $$` / `> x^2` / `> $$` / `~~~` is recognized as code, NEVER math!).
  let insideBlock = false;
  let blockKind: '$$' | '\\[' | null = null;
  let openLine = -1;
  let openPrefix = '';
  let fenceState: { depth: number; char: string; len: number } | null = null;
  let cursorIsCodeFenceLine = false;

  for (let l = 0; l <= cursor.line; l += 1) {
    const split = extractBlockquotePrefix(lines[l]);
    const depth = blockquoteDepth(split.prefix);

    if (fenceState !== null) {
      if (depth < fenceState.depth) {
        // Exited the blockquote container that owned this code fence
        fenceState = null;
      } else {
        // Still inside the container of `fenceState` — strip ONLY `fenceState.depth` `>` markers!
        const innerTrimmed = stripNBlockquoteMarkers(lines[l], fenceState.depth).trim();
        const closeMatch = CODE_FENCE_RE.exec(innerTrimmed);
        if (
          closeMatch &&
          closeMatch[2][0] === fenceState.char &&
          closeMatch[2].length >= fenceState.len &&
          innerTrimmed.slice(closeMatch[0].length).trim() === ''
        ) {
          fenceState = null;
          if (l === cursor.line) cursorIsCodeFenceLine = true;
        }
        continue;
      }
    }

    const trimmed = split.content.trim();
    const fenceMatch = CODE_FENCE_RE.exec(trimmed);
    if (fenceMatch) {
      fenceState = {
        depth,
        char: fenceMatch[2][0],
        len: fenceMatch[2].length,
      };
      if (depth <= targetDepth) {
        insideBlock = false;
        blockKind = null;
        openLine = -1;
        openPrefix = '';
      }
      if (l === cursor.line) cursorIsCodeFenceLine = true;
      continue;
    }

    if (depth !== targetDepth) {
      // Crossed a blockquote / callout boundary — reset block parity if shallower than targetDepth
      if (depth < targetDepth) {
        insideBlock = false;
        blockKind = null;
        openLine = -1;
        openPrefix = '';
      }
      continue;
    }

    if (!insideBlock && isBracketOpenLine(trimmed)) {
      insideBlock = true;
      blockKind = '\\[';
      openLine = l;
      openPrefix = canonicalBlockquotePrefix(split.prefix);
      continue;
    }

    if (insideBlock && blockKind === '\\[' && isBracketCloseLine(trimmed)) {
      if (l === cursor.line) {
        const stripped: string[] = [];
        for (let k = openLine; k <= l; k += 1) {
          stripped.push(extractBlockquotePrefix(lines[k]).content);
        }
        return {
          raw: stripped.join('\n'),
          delimiter: 'block',
          wrapper: 'bracket_block',
          from: { line: openLine, ch: 0 },
          to: { line: l, ch: lines[l].length },
          linePrefix: openPrefix,
          includeFirstLinePrefix: openPrefix.length > 0,
        };
      }
      insideBlock = false;
      blockKind = null;
      openLine = -1;
      openPrefix = '';
      continue;
    }

    if (isDollarFenceLine(trimmed) && (blockKind === null || blockKind === '$$')) {
      if (!insideBlock) {
        insideBlock = true;
        blockKind = '$$';
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
            wrapper: 'dollar_block',
            from: { line: openLine, ch: 0 },
            to: { line: l, ch: lines[l].length },
            linePrefix: openPrefix,
            includeFirstLinePrefix: openPrefix.length > 0,
          };
        }
        insideBlock = false;
        blockKind = null;
        openLine = -1;
        openPrefix = '';
      }
    }
  }

  // Never detect math on or inside a fenced code block!
  if (fenceState !== null || cursorIsCodeFenceLine) return null;

  // 2. If cursor is inside an open multi-line `$$ ... $$` or `\[ ... \]` block, resolve its closing fence
  if (insideBlock && openLine >= 0) {
    const maxLine = Math.min(lines.length - 1, cursor.line + 400);
    let closeLine = -1;
    for (let l = openLine + 1; l <= maxLine; l += 1) {
      const split = extractBlockquotePrefix(lines[l]);
      if (blockquoteDepth(split.prefix) !== targetDepth) {
        break;
      }
      const trimmed = split.content.trim();
      if (CODE_FENCE_RE.test(trimmed)) break;
      const isMatchClose =
        blockKind === '\\['
          ? isBracketCloseLine(trimmed)
          : trimmed === '$$' || (trimmed.endsWith('$$') && !trimmed.endsWith('$$$'));
      if (isMatchClose) {
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
        wrapper: blockKind === '\\[' ? 'bracket_block' : 'dollar_block',
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
        wrapper: inlineHit.wrapper,
        from: { line: cursor.line, ch: cursorPrefixLen + inlineHit.start },
        to: { line: cursor.line, ch: cursorPrefixLen + inlineHit.end },
        linePrefix: cursorCanonicalPrefix,
        includeFirstLinePrefix: false,
      };
    }
  }

  return null;
}

/**
 * Bounded-window variant of `detectFormulaInLines` for very long notes (e.g. 10,000+ lines).
 * Accepts a slice starting at `windowStartLine` and returns absolute document line coordinates.
 */
export function detectFormulaInWindow(
  windowLines: string[],
  windowStartLine: number,
  cursor: EditorPos,
  cursorInsideCodeBlock = false,
): DetectedEditorFormula | null {
  if (cursorInsideCodeBlock) return null;
  const relLine = cursor.line - windowStartLine;
  if (relLine < 0 || relLine >= windowLines.length) return null;
  const hit = detectFormulaInLines(windowLines, { line: relLine, ch: cursor.ch });
  if (!hit) return null;
  return {
    ...hit,
    from: { line: hit.from.line + windowStartLine, ch: hit.from.ch },
    to: { line: hit.to.line + windowStartLine, ch: hit.to.ch },
  };
}
