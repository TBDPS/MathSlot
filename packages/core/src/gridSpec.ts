export const CASES_ENVS = new Set(['cases', 'dcases', 'rcases']);
export const SUPPORTED_MATRIX_ENVS = new Set([
  'pmatrix',
  'bmatrix',
  'vmatrix',
  'Bmatrix',
  'Vmatrix',
  'matrix',
  'smallmatrix',
]);

export function isCasesEnv(env: string): boolean {
  return CASES_ENVS.has(env);
}

export interface ParsedColSpec {
  leadingBar: string;
  aligns: ('l' | 'c' | 'r')[];
  rightBars: string[];
}

export function isSupportedColSpec(raw: string): boolean {
  const clean = raw.replace(/\s+/g, '');
  return clean.length > 0 && /^[lcr|]+$/.test(clean) && /[lcr]/.test(clean);
}

export function parseColSpec(spec: string | undefined, cols: number): ParsedColSpec {
  const safeCols = Math.max(1, cols);
  if (!spec || !isSupportedColSpec(spec)) {
    return {
      leadingBar: '',
      aligns: Array.from({ length: safeCols }, () => 'c'),
      rightBars: Array.from({ length: safeCols }, () => ''),
    };
  }
  const clean = spec.replace(/\s+/g, '');
  let i = 0;
  let leadingBar = '';
  while (i < clean.length && clean[i] === '|') {
    leadingBar += '|';
    i += 1;
  }
  const aligns: ('l' | 'c' | 'r')[] = [];
  const rightBars: string[] = [];
  while (i < clean.length) {
    const ch = clean[i];
    if (ch === 'l' || ch === 'c' || ch === 'r') {
      aligns.push(ch);
      i += 1;
      let bars = '';
      while (i < clean.length && clean[i] === '|') {
        bars += '|';
        i += 1;
      }
      rightBars.push(bars);
    } else {
      i += 1;
    }
  }
  while (aligns.length < safeCols) {
    aligns.push('c');
    rightBars.push('');
  }
  if (aligns.length > safeCols) {
    aligns.length = safeCols;
    rightBars.length = safeCols;
  }
  return { leadingBar, aligns, rightBars };
}

export function serializeColSpec(parsed: ParsedColSpec): string {
  let out = parsed.leadingBar;
  for (let i = 0; i < parsed.aligns.length; i += 1) {
    out += parsed.aligns[i] + (parsed.rightBars[i] ?? '');
  }
  return out;
}

export function hasCustomColSpec(colSpec: string | undefined, cols: number): boolean {
  if (!colSpec) return false;
  const parsed = parseColSpec(colSpec, cols);
  return (
    parsed.leadingBar.length > 0 ||
    parsed.aligns.some((a) => a !== 'c') ||
    parsed.rightBars.some((b) => b.length > 0)
  );
}

export function hasColRightBar(colSpec: string | undefined, cols: number, col: number): boolean {
  if (!colSpec || col < 0 || col >= cols - 1) return false;
  const parsed = parseColSpec(colSpec, cols);
  return (parsed.rightBars[col]?.length ?? 0) > 0;
}

export function insertColIntoSpec(
  colSpec: string | undefined,
  cols: number,
  insertAt: number,
  env: string,
): string | undefined {
  if (!colSpec && env !== 'array') return undefined;
  const parsed = parseColSpec(colSpec, cols);
  const idx = Math.max(0, Math.min(insertAt, parsed.aligns.length));
  parsed.aligns.splice(idx, 0, 'c');
  parsed.rightBars.splice(idx, 0, '');
  const next = serializeColSpec(parsed);
  return env === 'array' || hasCustomColSpec(next, cols + 1) ? next : undefined;
}

export function removeColFromSpec(
  colSpec: string | undefined,
  cols: number,
  removeAt: number,
  env: string,
): string | undefined {
  if (!colSpec && env !== 'array') return undefined;
  if (cols <= 1) return env === 'array' ? 'c' : undefined;
  const parsed = parseColSpec(colSpec, cols);
  const idx = Math.max(0, Math.min(removeAt, parsed.aligns.length - 1));
  const removedBar = parsed.rightBars[idx] ?? '';
  parsed.aligns.splice(idx, 1);
  parsed.rightBars.splice(idx, 1);
  if (removedBar && idx > 0 && idx <= parsed.rightBars.length && !parsed.rightBars[idx - 1]) {
    parsed.rightBars[idx - 1] = removedBar;
  }
  if (parsed.rightBars.length > 0 && env !== 'array') {
    parsed.rightBars[parsed.rightBars.length - 1] = parsed.rightBars[parsed.rightBars.length - 1] ?? '';
  }
  const next = serializeColSpec(parsed);
  return env === 'array' || hasCustomColSpec(next, cols - 1) ? next : undefined;
}

export function toggleColRightBar(
  colSpec: string | undefined,
  cols: number,
  col: number,
  env: string,
): string | undefined {
  if (col < 0 || col >= cols - 1) return colSpec;
  const parsed = parseColSpec(colSpec, cols);
  parsed.rightBars[col] = parsed.rightBars[col] ? '' : '|';
  const next = serializeColSpec(parsed);
  return env === 'array' || hasCustomColSpec(next, cols) ? next : undefined;
}

export function formatGridEnvironment(
  env: string,
  colSpec: string | undefined,
  cols: number,
  body: string,
): string {
  if (env === 'substack') {
    return `\\substack{${body}}`;
  }
  if (env === 'array') {
    const spec = colSpec && isSupportedColSpec(colSpec) ? colSpec.replace(/\s+/g, '') : 'c'.repeat(Math.max(1, cols));
    return `\\begin{array}{${spec}} ${body} \\end{array}`;
  }
  if (colSpec && hasCustomColSpec(colSpec, cols)) {
    const spec = serializeColSpec(parseColSpec(colSpec, cols));
    switch (env) {
      case 'pmatrix':
        return `\\left(\\begin{array}{${spec}} ${body} \\end{array}\\right)`;
      case 'bmatrix':
        return `\\left[\\begin{array}{${spec}} ${body} \\end{array}\\right]`;
      case 'Bmatrix':
        return `\\left\\{\\begin{array}{${spec}} ${body} \\end{array}\\right\\}`;
      case 'vmatrix':
        return `\\left|\\begin{array}{${spec}} ${body} \\end{array}\\right|`;
      case 'Vmatrix':
        return `\\left\\Vert\\begin{array}{${spec}} ${body} \\end{array}\\right\\Vert`;
      case 'matrix':
        return `\\begin{array}{${spec}} ${body} \\end{array}`;
    }
  }
  return `\\begin{${env}} ${body} \\end{${env}}`;
}
