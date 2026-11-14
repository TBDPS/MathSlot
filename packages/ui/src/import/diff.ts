export type DiffSegmentKind = 'same' | 'removed' | 'added';

export interface DiffSegment {
  kind: DiffSegmentKind;
  text: string;
}

export interface LatexDiffResult {
  changed: boolean;
  inputSegments: DiffSegment[];
  outputSegments: DiffSegment[];
}

const LATEX_TOKEN_RE = /(\\[a-zA-Z]+|\\[^a-zA-Z\s]|\s+|[a-zA-Z0-9]+|.)/g;

export function tokenizeLatexForDiff(latex: string): string[] {
  if (!latex) return [];
  return latex.match(LATEX_TOKEN_RE) ?? [];
}

function coalesceSegments(raw: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const seg of raw) {
    if (!seg.text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.kind === seg.kind) {
      prev.text += seg.text;
    } else {
      out.push({ kind: seg.kind, text: seg.text });
    }
  }
  return out;
}

/**
 * Computes token-level LCS diff between pasted input LaTeX and parsed roundtrip LaTeX.
 */
export function computeLatexDiff(inputLatex: string, roundtripLatex: string): LatexDiffResult {
  if (inputLatex === roundtripLatex) {
    const seg: DiffSegment[] = inputLatex ? [{ kind: 'same', text: inputLatex }] : [];
    return {
      changed: false,
      inputSegments: seg,
      outputSegments: seg.map((s) => ({ ...s })),
    };
  }

  const a = tokenizeLatexForDiff(inputLatex);
  const b = tokenizeLatexForDiff(roundtripLatex);
  const m = a.length;
  const n = b.length;

  // Guard against extreme pathological token arrays in UI diff rendering
  if (m * n > 200_000) {
    return {
      changed: true,
      inputSegments: inputLatex ? [{ kind: 'removed', text: inputLatex }] : [],
      outputSegments: roundtripLatex ? [{ kind: 'added', text: roundtripLatex }] : [],
    };
  }

  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
      }
    }
  }

  const inRaw: DiffSegment[] = [];
  const outRaw: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      inRaw.push({ kind: 'same', text: a[i] });
      outRaw.push({ kind: 'same', text: b[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      inRaw.push({ kind: 'removed', text: a[i] });
      i++;
    } else {
      outRaw.push({ kind: 'added', text: b[j] });
      j++;
    }
  }
  while (i < m) {
    inRaw.push({ kind: 'removed', text: a[i++] });
  }
  while (j < n) {
    outRaw.push({ kind: 'added', text: b[j++] });
  }

  const inputSegments = coalesceSegments(inRaw);
  const outputSegments = coalesceSegments(outRaw);
  const changed =
    inputSegments.some((s) => s.kind !== 'same') || outputSegments.some((s) => s.kind !== 'same');

  return { changed, inputSegments, outputSegments };
}
