import { parseStreamCode } from './streamCodec';
import type { ImportResult } from './types';
import { parseLatex } from './parser/parseLatex';

export { parseStreamCode } from './streamCodec';
export { stripOuterDelimiters } from './parser/delimitersAndEnvs';
export { parseLatex, parseLatexNodes } from './parser/parseLatex';

/**
 * Automatically detect MathSlot stream code vs standard LaTeX and import into Document AST.
 */
export function importFormula(input: string): ImportResult {
  if (input.includes('▸')) {
    return parseStreamCode(input);
  }
  return parseLatex(input);
}
