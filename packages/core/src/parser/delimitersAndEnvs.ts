import { createRawNode, createStructNode } from '../ast';
import { COMMANDS_BY_ID } from '../catalog';
import {
  SUPPORTED_MATRIX_ENVS,
  isCasesEnv,
  isSupportedColSpec,
} from '../commandSpecs';
import type { Diagnostic, MathNode } from '../types';

function isEscapedAt(text: string, idx: number): boolean {
  let backslashes = 0;
  for (let i = idx - 1; i >= 0 && text[i] === '\\'; i -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function hasUnescapedDollar(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '$' && !isEscapedAt(text, i)) return true;
  }
  return false;
}

function hasUnescapedDelimiter(text: string, delimiter: '\\(' | '\\)' | '\\[' | '\\]'): boolean {
  let from = 0;
  while (from <= text.length - delimiter.length) {
    const idx = text.indexOf(delimiter, from);
    if (idx === -1) return false;
    if (!isEscapedAt(text, idx)) return true;
    from = idx + 1;
  }
  return false;
}

export function stripOuterDelimiters(input: string): string {
  let s = input.trim();
  const fenceMatch = s.match(/^```(?:latex|tex|math)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenceMatch) {
    s = fenceMatch[1].trim();
  }
  if (s.startsWith('$$') && s.endsWith('$$') && s.length >= 4) {
    const inner = s.slice(2, -2);
    if (!hasUnescapedDollar(inner)) return inner.trim();
    return s;
  }
  if (s.startsWith('\\[') && s.endsWith('\\]') && s.length >= 4) {
    const inner = s.slice(2, -2);
    if (!hasUnescapedDelimiter(inner, '\\[') && !hasUnescapedDelimiter(inner, '\\]')) {
      return inner.trim();
    }
    return s;
  }
  if (s.startsWith('\\(') && s.endsWith('\\)') && s.length >= 4) {
    const inner = s.slice(2, -2);
    if (!hasUnescapedDelimiter(inner, '\\(') && !hasUnescapedDelimiter(inner, '\\)')) {
      return inner.trim();
    }
    return s;
  }
  if (s.startsWith('$') && s.endsWith('$') && s.length >= 2) {
    const inner = s.slice(1, -1);
    if (!hasUnescapedDollar(inner)) return inner.trim();
  }
  return s;
}

export function hasMultipleWrappedFormulas(input: string): boolean {
  const s = input.trim();
  if (s.startsWith('$$') && s.endsWith('$$') && s.length >= 4 && hasUnescapedDollar(s.slice(2, -2))) {
    return true;
  }
  if (
    s.startsWith('\\[') &&
    s.endsWith('\\]') &&
    s.length >= 4 &&
    (hasUnescapedDelimiter(s.slice(2, -2), '\\[') || hasUnescapedDelimiter(s.slice(2, -2), '\\]'))
  ) {
    return true;
  }
  if (
    s.startsWith('\\(') &&
    s.endsWith('\\)') &&
    s.length >= 4 &&
    (hasUnescapedDelimiter(s.slice(2, -2), '\\(') || hasUnescapedDelimiter(s.slice(2, -2), '\\)'))
  ) {
    return true;
  }
  if (s.startsWith('$') && !s.startsWith('$$') && s.endsWith('$') && s.length >= 2 && hasUnescapedDollar(s.slice(1, -1))) {
    return true;
  }
  return false;
}

export function stripTexComments(input: string): { cleaned: string; hadComments: boolean } {
  let out = '';
  let hadComments = false;
  let i = 0;
  while (i < input.length) {
    if (input[i] === '%') {
      let bs = 0;
      for (let k = i - 1; k >= 0 && input[k] === '\\'; k -= 1) bs += 1;
      if (bs % 2 === 0) {
        hadComments = true;
        while (i < input.length && input[i] !== '\n') i += 1;
        continue;
      }
    }
    out += input[i];
    i += 1;
  }
  return { cleaned: out, hadComments };
}

export function splitTopLevelInfixMacro(raw: string, macro: string): [string, string] | null {
  let depth = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '\\') {
      if (depth === 0 && raw.startsWith(macro, i)) {
        const after = raw[i + macro.length];
        if (!after || !/[A-Za-z]/.test(after)) {
          return [raw.slice(0, i).trim(), raw.slice(i + macro.length).trim()];
        }
      }
      i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
  }
  return null;
}

export function splitTopLevel(input: string, delimiter: '\\\\' | '&'): string[] {
  const parts: string[] = [];
  let braceDepth = 0;
  let envDepth = 0;
  let start = 0;
  let i = 0;
  while (i < input.length) {
    if (input.startsWith('\\begin{', i)) {
      envDepth += 1;
      i += 7;
      continue;
    }
    if (input.startsWith('\\end{', i)) {
      envDepth = Math.max(0, envDepth - 1);
      i += 5;
      continue;
    }
    if (input[i] === '\\' && delimiter === '&') {
      i += 2;
      continue;
    }
    if (input[i] === '{') {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (input[i] === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      i += 1;
      continue;
    }
    if (braceDepth === 0 && envDepth === 0 && input.startsWith(delimiter, i)) {
      parts.push(input.slice(start, i));
      i += delimiter.length;
      start = i;
      continue;
    }
    if (input[i] === '\\') {
      i += 2;
      continue;
    }
    i += 1;
  }
  parts.push(input.slice(start));
  return parts;
}

export function splitMatrixRows(input: string): {
  rows: string[];
  rowGaps: (string | undefined)[];
  hasGaps: boolean;
} {
  const rows: string[] = [];
  const rowGaps: (string | undefined)[] = [];
  let hasGaps = false;
  let braceDepth = 0;
  let envDepth = 0;
  let start = 0;
  let i = 0;
  while (i < input.length) {
    if (input.startsWith('\\begin{', i)) {
      envDepth += 1;
      i += 7;
      continue;
    }
    if (input.startsWith('\\end{', i)) {
      envDepth = Math.max(0, envDepth - 1);
      i += 5;
      continue;
    }
    if (input[i] === '{') {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (input[i] === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      i += 1;
      continue;
    }
    if (braceDepth === 0 && envDepth === 0 && input.startsWith('\\\\', i)) {
      rows.push(input.slice(start, i).trim());
      i += 2;
      if (input[i] === '*') i += 1;
      let scan = i;
      while (scan < input.length && (input[scan] === ' ' || input[scan] === '\t')) scan += 1;
      if (input[scan] === '[') {
        const closeBracket = input.indexOf(']', scan + 1);
        if (closeBracket !== -1 && !input.slice(scan + 1, closeBracket).includes('\n')) {
          const gap = input.slice(scan + 1, closeBracket).trim();
          rowGaps.push(gap || undefined);
          if (gap) hasGaps = true;
          i = closeBracket + 1;
        } else {
          rowGaps.push(undefined);
        }
      } else {
        rowGaps.push(undefined);
      }
      start = i;
      continue;
    }
    if (input[i] === '\\') {
      i += 2;
      continue;
    }
    i += 1;
  }
  rows.push(input.slice(start).trim());
  if (rows.length > 1 && rows[rows.length - 1] === '' && !rowGaps[rows.length - 2]) {
    rows.pop();
    rowGaps.pop();
  }
  return { rows, rowGaps, hasGaps };
}

export function splitTopLevelMiddle(bodyRaw: string): { parts: string[]; delims: string[] } {
  const parts: string[] = [];
  const delims: string[] = [];
  let lrDepth = 0;
  let braceDepth = 0;
  let partStart = 0;
  let i = 0;
  while (i < bodyRaw.length) {
    if (bodyRaw[i] === '\\') {
      if (bodyRaw.startsWith('\\left', i) && !/[a-zA-Z]/.test(bodyRaw[i + 5] ?? '')) {
        lrDepth += 1;
        i += 5;
        continue;
      }
      if (bodyRaw.startsWith('\\right', i) && !/[a-zA-Z]/.test(bodyRaw[i + 6] ?? '')) {
        lrDepth = Math.max(0, lrDepth - 1);
        i += 6;
        continue;
      }
      if (
        lrDepth === 0 &&
        braceDepth === 0 &&
        bodyRaw.startsWith('\\middle', i) &&
        !/[a-zA-Z]/.test(bodyRaw[i + 7] ?? '')
      ) {
        parts.push(bodyRaw.slice(partStart, i));
        let dPos = i + 7;
        while (dPos < bodyRaw.length && /\s/.test(bodyRaw[dPos])) dPos += 1;
        let delim = '';
        if (bodyRaw[dPos] === '\\') {
          const dStart = dPos;
          dPos += 1;
          if (dPos < bodyRaw.length && /[a-zA-Z]/.test(bodyRaw[dPos])) {
            while (dPos < bodyRaw.length && /[a-zA-Z]/.test(bodyRaw[dPos])) dPos += 1;
          } else if (dPos < bodyRaw.length) {
            dPos += 1;
          }
          delim = bodyRaw.slice(dStart, dPos);
        } else if (dPos < bodyRaw.length) {
          delim = bodyRaw[dPos];
          dPos += 1;
        }
        delims.push(delim);
        partStart = dPos;
        i = dPos;
        continue;
      }
      i += 2;
      continue;
    }
    if (bodyRaw[i] === '{') braceDepth += 1;
    else if (bodyRaw[i] === '}') braceDepth = Math.max(0, braceDepth - 1);
    i += 1;
  }
  parts.push(bodyRaw.slice(partStart));
  return { parts, delims };
}

function stripTopLevelAmpersands(bodyRaw: string): { cleaned: string; hasMultiColumn: boolean } {
  let out = '';
  let envDepth = 0;
  let braceDepth = 0;
  let rowTopLevelAmps = 0;
  let hasMultiColumn = false;
  let i = 0;
  while (i < bodyRaw.length) {
    if (bodyRaw[i] === '\\') {
      if (bodyRaw.startsWith('\\begin{', i)) {
        envDepth += 1;
        out += '\\begin{';
        i += 7;
        continue;
      }
      if (bodyRaw.startsWith('\\end{', i)) {
        envDepth = Math.max(0, envDepth - 1);
        out += '\\end{';
        i += 5;
        continue;
      }
      if (bodyRaw.startsWith('\\\\', i)) {
        if (envDepth === 0 && braceDepth === 0) {
          rowTopLevelAmps = 0;
        }
        out += '\\\\';
        i += 2;
        continue;
      }
      out += bodyRaw.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (bodyRaw[i] === '{') {
      braceDepth += 1;
      out += '{';
      i += 1;
      continue;
    }
    if (bodyRaw[i] === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      out += '}';
      i += 1;
      continue;
    }
    if (bodyRaw[i] === '&' && envDepth === 0 && braceDepth === 0) {
      rowTopLevelAmps += 1;
      const afterTrim = bodyRaw.slice(i + 1).trimStart();
      const beforeTrim = out.trimEnd();
      const relAfter =
        afterTrim.length === 0 ||
        afterTrim.startsWith('\\\\') ||
        /^(?:[=<>~]|\\(?:le|leq|ge|geq|neq|ne|approx|sim|simeq|cong|equiv|propto|to|rightarrow|leftarrow|Rightarrow|Leftrightarrow|mapsto|in|subset|subseteq)(?![a-zA-Z]))/.test(
          afterTrim,
        );
      const relBefore =
        beforeTrim.length === 0 ||
        beforeTrim.endsWith('\\\\') ||
        /(?:[=<>~]|\\(?:le|leq|ge|geq|neq|ne|approx|sim|simeq|cong|equiv|propto|to|rightarrow|leftarrow|Rightarrow|Leftrightarrow|mapsto|in|subset|subseteq))$/.test(
          beforeTrim,
        );
      if (rowTopLevelAmps > 1 || (!relAfter && !relBefore)) {
        hasMultiColumn = true;
        out += ' \\quad ';
      }
      i += 1;
      continue;
    }
    out += bodyRaw[i];
    i += 1;
  }
  return { cleaned: out, hasMultiColumn };
}

const MATRIX_ENV_MAP: Readonly<Record<string, { two: string; three?: string }>> = {
  pmatrix: { two: 'matrix_2x2', three: 'matrix_3x3' },
  bmatrix: { two: 'bmatrix_2x2', three: 'bmatrix_3x3' },
  vmatrix: { two: 'det_2x2', three: 'det_3x3' },
  smallmatrix: { two: 'smallmatrix' },
};

export function resolveLeftRightStructId(openDelim: string, closeDelim: string): string | null {
  if (openDelim === '(' && closeDelim === ')') return 'paren';
  if (openDelim === '|' && closeDelim === '|') return 'abs';
  if (openDelim === '[' && closeDelim === ']') return 'bracket';
  if (openDelim === '\\{' && closeDelim === '\\}') return 'brace';
  if (openDelim === '(' && closeDelim === ']') return 'interval_oc';
  if (openDelim === '[' && closeDelim === ')') return 'interval_co';
  if (
    (openDelim === '\\Vert' || openDelim === '\\|') &&
    (closeDelim === '\\Vert' || closeDelim === '\\|')
  ) {
    return 'norm';
  }
  if (openDelim === '\\langle' && closeDelim === '\\rangle') return 'angle';
  if (openDelim === '\\lfloor' && closeDelim === '\\rfloor') return 'floor';
  if (openDelim === '\\lceil' && closeDelim === '\\rceil') return 'ceil';
  if ((openDelim === '|' || openDelim === '\\vert') && closeDelim === '\\rangle' && COMMANDS_BY_ID.has('ket')) {
    return 'ket';
  }
  if (openDelim === '\\langle' && (closeDelim === '|' || closeDelim === '\\vert') && COMMANDS_BY_ID.has('bra')) {
    return 'bra';
  }
  return null;
}

export function parseMatchedLeftRight(
  openDelim: string,
  closeDelim: string,
  bodyRaw: string,
  readSubSup: () => { sub: MathNode[] | null; sup: MathNode[] | null },
  diagnostics: Diagnostic[],
  parseNested: (raw: string) => MathNode[],
): MathNode {
  const middleSplit = splitTopLevelMiddle(bodyRaw);
  if (middleSplit.delims.length > 0) {
    if (
      openDelim === '\\{' &&
      closeDelim === '\\}' &&
      middleSplit.delims.length === 1 &&
      (middleSplit.delims[0] === '|' || middleSplit.delims[0] === '\\vert')
    ) {
      const leftPart = middleSplit.parts[0].replace(/(?:\\,|\\;|\\:|\\ )*\s*$/, '').trim();
      const rightPart = middleSplit.parts[1].replace(/^\s*(?:\\,|\\;|\\:|\\ )*/, '').trim();
      return createStructNode(COMMANDS_BY_ID.get('set_builder')!, [
        parseNested(leftPart),
        parseNested(rightPart),
      ]);
    }
    if (
      openDelim === '\\langle' &&
      closeDelim === '\\rangle' &&
      middleSplit.delims.length === 1 &&
      (middleSplit.delims[0] === '|' || middleSplit.delims[0] === '\\vert') &&
      COMMANDS_BY_ID.has('braket')
    ) {
      const leftPart = middleSplit.parts[0].replace(/(?:\\,|\\;|\\:|\\ )*\s*$/, '').trim();
      const rightPart = middleSplit.parts[1].replace(/^\s*(?:\\,|\\;|\\:|\\ )*/, '').trim();
      return createStructNode(COMMANDS_BY_ID.get('braket')!, [
        parseNested(leftPart),
        parseNested(rightPart),
      ]);
    }
    diagnostics.push({
      severity: 'warning',
      message: `以原生 LaTeX 保留带 \\middle 的定界符 \\left${openDelim}...\\right${closeDelim}`,
    });
    return createRawNode(`\\left${openDelim}${bodyRaw}\\right${closeDelim}`);
  }

  if (openDelim === '.' && (closeDelim === '|' || closeDelim === '\\|')) {
    const { sub, sup } = readSubSup();
    return createStructNode(COMMANDS_BY_ID.get('eval_bar')!, [
      parseNested(bodyRaw),
      sub ?? [],
      sup ?? [],
    ]);
  }

  const cmdId = resolveLeftRightStructId(openDelim, closeDelim);
  if (cmdId) {
    const innerNodes = parseNested(bodyRaw);
    if (
      innerNodes.length === 1 &&
      innerNodes[0].type === 'struct' &&
      innerNodes[0].grid?.env === 'array'
    ) {
      const envForDelim: Record<string, string> = {
        paren: 'pmatrix',
        bracket: 'bmatrix',
        brace: 'Bmatrix',
        abs: 'vmatrix',
        norm: 'Vmatrix',
      };
      const mappedEnv = envForDelim[cmdId];
      if (mappedEnv) {
        innerNodes[0].grid.env = mappedEnv;
        if (mappedEnv === 'bmatrix' && innerNodes[0].grid.colSpec?.includes('|')) {
          innerNodes[0].commandId = 'aug_matrix';
        }
        return innerNodes[0];
      }
    }
    return createStructNode(COMMANDS_BY_ID.get(cmdId)!, [innerNodes]);
  }

  diagnostics.push({
    severity: 'warning',
    message: `保留自定义定界符 \\left${openDelim}...\\right${closeDelim}`,
  });
  return createRawNode(`\\left${openDelim}${bodyRaw}\\right${closeDelim}`);
}

export function parseEnvironmentBody(
  envName: string,
  body: string,
  depth: number,
  diagnostics: Diagnostic[],
  parseNested: (raw: string) => MathNode[],
): MathNode[] {
  if (
    envName === 'gathered' ||
    envName === 'aligned' ||
    envName === 'align' ||
    envName === 'align*' ||
    envName === 'equation' ||
    envName === 'equation*' ||
    envName === 'gather' ||
    envName === 'gather*'
  ) {
    if (/\\tag\*?(?![a-zA-Z])/.test(body)) {
      diagnostics.push({
        severity: 'warning',
        message: `公式包含 \\tag 编号，已保留原 ${envName} 环境（导出请使用 $$...$$ 块级模式）`,
      });
      const preservedEnv = envName === 'aligned' ? 'align' : envName;
      return [createRawNode(`\\begin{${preservedEnv}} ${body} \\end{${preservedEnv}}`)];
    }
    if (depth > 0) {
      const { rows, rowGaps, hasGaps } = splitMatrixRows(body);
      const isGather = envName === 'gathered' || envName === 'gather' || envName === 'gather*';
      if (isGather) {
        const slotLabels = rows.map((_, r) => `第 ${r + 1} 行`);
        const slotContents = rows.map((r) => parseNested(r.trim()));
        const struct = createStructNode({ id: 'aligned_2', slots: slotLabels, latex: '' }, slotContents);
        struct.grid = {
          env: 'gathered',
          rows: rows.length,
          cols: 1,
          ...(hasGaps ? { rowGaps } : {}),
        };
        return [struct];
      }
      const cells = rows.map((r) => splitTopLevel(r, '&').map((c) => c.trim()));
      const colCount = Math.max(...cells.map((r) => r.length), 1);
      if (rows.length >= 1 && colCount >= 1 && colCount <= 8) {
        const slotLabels: string[] = [];
        const slotContents: MathNode[][] = [];
        for (let r = 0; r < rows.length; r += 1) {
          for (let c = 0; c < colCount; c += 1) {
            slotLabels.push(`(${r + 1},${c + 1})`);
            slotContents.push(parseNested(cells[r][c] ?? ''));
          }
        }
        const struct = createStructNode({ id: 'aligned_2', slots: slotLabels, latex: '' }, slotContents);
        struct.grid = {
          env: 'aligned',
          rows: rows.length,
          cols: colCount,
          ...(hasGaps ? { rowGaps } : {}),
        };
        return [struct];
      }
      const katexEnv = envName === 'align' || envName === 'align*' ? 'aligned' : envName;
      return [createRawNode(`\\begin{${katexEnv}} ${body} \\end{${katexEnv}}`)];
    }

    const { cleaned, hasMultiColumn } = stripTopLevelAmpersands(body);
    if (hasMultiColumn) {
      const { rows, rowGaps, hasGaps } = splitMatrixRows(body);
      const cells = rows.map((r) => splitTopLevel(r, '&').map((c) => c.trim()));
      const colCount = Math.max(...cells.map((r) => r.length), 2);
      if (rows.length >= 1 && colCount >= 2 && colCount <= 8) {
        const slotLabels: string[] = [];
        const slotContents: MathNode[][] = [];
        for (let r = 0; r < rows.length; r += 1) {
          for (let c = 0; c < colCount; c += 1) {
            slotLabels.push(`(${r + 1},${c + 1})`);
            slotContents.push(parseNested(cells[r][c] ?? ''));
          }
        }
        const struct = createStructNode({ id: 'aligned_2', slots: slotLabels, latex: '' }, slotContents);
        struct.grid = {
          env: 'aligned',
          rows: rows.length,
          cols: colCount,
          ...(hasGaps ? { rowGaps } : {}),
        };
        return [struct];
      }
      diagnostics.push({
        severity: 'warning',
        message: `检测到 ${envName} 多列或非关系对齐，已按原生 LaTeX 整体保留以保证对齐语义`,
      });
      const katexEnv = envName === 'align' || envName === 'align*' ? 'aligned' : envName;
      return [createRawNode(`\\begin{${katexEnv}} ${body} \\end{${katexEnv}}`)];
    }
    return parseNested(cleaned);
  }

  if (envName === 'array') {
    const trimmedBody = body.trimStart();
    if (trimmedBody.startsWith('{')) {
      let bDepth = 1;
      let bPos = 1;
      while (bPos < trimmedBody.length && bDepth > 0) {
        if (trimmedBody[bPos] === '\\') {
          bPos += 2;
          continue;
        }
        if (trimmedBody[bPos] === '{') bDepth += 1;
        else if (trimmedBody[bPos] === '}') bDepth -= 1;
        if (bDepth > 0) bPos += 1;
      }
      const rawColSpec = trimmedBody.slice(1, bPos).trim();
      const arrayContent = trimmedBody.slice(bPos + (trimmedBody[bPos] === '}' ? 1 : 0)).trim();
      if (isSupportedColSpec(rawColSpec)) {
        const { rows, rowGaps, hasGaps } = splitMatrixRows(arrayContent);
        const cells = rows.map((r) => splitTopLevel(r, '&').map((c) => c.trim()));
        if (rows.length >= 1 && (rows.length > 1 || cells[0][0] !== '')) {
          const specCols = rawColSpec.replace(/[^lcr]/g, '').length;
          const colCount = Math.max(...cells.map((r) => r.length), specCols, 1);
          const slotLabels: string[] = [];
          const slotContents: MathNode[][] = [];
          for (let r = 0; r < rows.length; r += 1) {
            for (let c = 0; c < colCount; c += 1) {
              slotLabels.push(`(${r + 1},${c + 1})`);
              slotContents.push(parseNested(cells[r][c] ?? ''));
            }
          }
          const struct = createStructNode({ id: 'matrix_2x2', slots: slotLabels, latex: '' }, slotContents);
          struct.grid = {
            env: 'array',
            rows: rows.length,
            cols: colCount,
            colSpec: rawColSpec.replace(/\s+/g, ''),
            ...(hasGaps ? { rowGaps } : {}),
          };
          return [struct];
        }
      }
    }
    diagnostics.push({
      severity: 'warning',
      message: '复杂列格式 array 环境已按原生 LaTeX 保留',
    });
    return [createRawNode(`\\begin{array}${body}\\end{array}`)];
  }

  const { rows, rowGaps, hasGaps } = splitMatrixRows(body);
  const cells = rows.map((r) => splitTopLevel(r, '&').map((c) => c.trim()));

  if (isCasesEnv(envName) && rows.length >= 1 && (rows.length > 1 || cells[0][0] !== '')) {
    if (!hasGaps && rows.length === 2 && cells.every((r) => r.length <= 2)) {
      const twoId = envName === 'dcases' ? 'dcases_2' : envName === 'rcases' ? 'rcases_2' : 'cases_2';
      return [
        createStructNode(COMMANDS_BY_ID.get(twoId)!, [
          parseNested(cells[0][0] ?? ''),
          parseNested(cells[0][1] ?? ''),
          parseNested(cells[1][0] ?? ''),
          parseNested(cells[1][1] ?? ''),
        ]),
      ];
    }
    if (envName === 'cases' && !hasGaps && rows.length === 3 && cells.every((r) => r.length <= 2)) {
      return [
        createStructNode(COMMANDS_BY_ID.get('cases_3')!, [
          parseNested(cells[0][0] ?? ''),
          parseNested(cells[0][1] ?? ''),
          parseNested(cells[1][0] ?? ''),
          parseNested(cells[1][1] ?? ''),
          parseNested(cells[2][0] ?? ''),
          parseNested(cells[2][1] ?? ''),
        ]),
      ];
    }
    const colCount = Math.max(...cells.map((r) => r.length), 2);
    const slotLabels: string[] = [];
    const slotContents: MathNode[][] = [];
    for (let r = 0; r < rows.length; r += 1) {
      for (let c = 0; c < colCount; c += 1) {
        slotLabels.push(c === 0 ? `表达式${r + 1}` : c === 1 ? `条件${r + 1}` : `列${c + 1}(${r + 1})`);
        slotContents.push(parseNested(cells[r][c] ?? ''));
      }
    }
    const baseCasesId = envName === 'dcases' ? 'dcases_2' : envName === 'rcases' ? 'rcases_2' : 'cases_2';
    const struct = createStructNode({ id: baseCasesId, slots: slotLabels, latex: '' }, slotContents);
    struct.grid = {
      env: envName,
      rows: rows.length,
      cols: colCount,
      ...(hasGaps ? { rowGaps } : {}),
    };
    return [struct];
  }

  if (SUPPORTED_MATRIX_ENVS.has(envName) && rows.length >= 1 && (rows.length > 1 || cells[0][0] !== '')) {
    const colCount = Math.max(...cells.map((r) => r.length), 1);
    const matMap = MATRIX_ENV_MAP[envName];
    if (!hasGaps && matMap?.two && rows.length === 2 && colCount === 2) {
      return [
        createStructNode(
          COMMANDS_BY_ID.get(matMap.two)!,
          cells.flatMap((r) => [parseNested(r[0] ?? ''), parseNested(r[1] ?? '')]),
        ),
      ];
    }
    if (!hasGaps && matMap?.three && rows.length === 3 && colCount === 3) {
      return [
        createStructNode(
          COMMANDS_BY_ID.get(matMap.three)!,
          cells.flatMap((r) => [
            parseNested(r[0] ?? ''),
            parseNested(r[1] ?? ''),
            parseNested(r[2] ?? ''),
          ]),
        ),
      ];
    }
    const slotLabels: string[] = [];
    const slotContents: MathNode[][] = [];
    for (let r = 0; r < rows.length; r += 1) {
      for (let c = 0; c < colCount; c += 1) {
        slotLabels.push(`(${r + 1},${c + 1})`);
        slotContents.push(parseNested(cells[r][c] ?? ''));
      }
    }
    const baseCmdId = matMap ? matMap.two : 'matrix_2x2';
    const struct = createStructNode({ id: baseCmdId, slots: slotLabels, latex: '' }, slotContents);
    struct.grid = {
      env: envName,
      rows: rows.length,
      cols: colCount,
      ...(hasGaps ? { rowGaps } : {}),
    };
    return [struct];
  }

  diagnostics.push({ severity: 'warning', message: `以原生 LaTeX 保留环境 ${envName}` });
  return [createRawNode(`\\begin{${envName}}${body}\\end{${envName}}`)];
}
