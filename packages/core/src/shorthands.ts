import { COMMANDS_BY_ID } from './catalog';
import type { CommandDef, MathNode } from './types';

export interface ShorthandRule {
  readonly trigger: string;
  readonly commandId: string;
  /**
   * 'punct': multi-char non-letter shorthand expanded immediately on keystroke (e.g. `->`, `<=`, `+-`, `~~`)
   * 'word': isolated alphabetic token recognized non-destructively at word-boundary level
   *         (e.g. `n pi x` -> `n \pi x`, `oo` -> `\infty`, while `spin`/`spi`/`foo` stay literal!)
   */
  readonly kind: 'punct' | 'word';
}

export const AUTO_SHORTHANDS: readonly ShorthandRule[] = [
  // Multi-char punctuation / arrow / relation shorthands (longest first; prefix overlaps handled via upgrades!)
  { trigger: '<=>', commandId: 'iff', kind: 'punct' },
  { trigger: '<->', commandId: 'leftrightarrow', kind: 'punct' },
  { trigger: '|->', commandId: 'mapsto', kind: 'punct' },
  { trigger: '...', commandId: 'cdots', kind: 'punct' },
  { trigger: ':::', commandId: 'vdots', kind: 'punct' },
  { trigger: '->', commandId: 'to', kind: 'punct' },
  { trigger: '<-', commandId: 'leftarrow', kind: 'punct' },
  { trigger: '=>', commandId: 'implies', kind: 'punct' },
  { trigger: '<=', commandId: 'leq', kind: 'punct' },
  { trigger: '>=', commandId: 'geq', kind: 'punct' },
  { trigger: '<<', commandId: 'll', kind: 'punct' },
  { trigger: '>>', commandId: 'gg', kind: 'punct' },
  { trigger: '||', commandId: 'parallel', kind: 'punct' },
  { trigger: '!=', commandId: 'neq', kind: 'punct' },
  { trigger: '~=', commandId: 'cong', kind: 'punct' },
  { trigger: '~~', commandId: 'approx', kind: 'punct' },
  { trigger: '==', commandId: 'equiv', kind: 'punct' },
  { trigger: '+-', commandId: 'pm', kind: 'punct' },
  { trigger: '-+', commandId: 'mp', kind: 'punct' },
  { trigger: '**', commandId: 'cdot', kind: 'punct' },

  // Isolated-word shorthands (recognized cleanly at word boundaries — never break `spin`, `spi`, `foo`, `sin`!)
  { trigger: 'oo', commandId: 'infty', kind: 'word' },
  { trigger: 'xx', commandId: 'times', kind: 'word' },
  { trigger: 'emptyset', commandId: 'emptyset', kind: 'word' },
  { trigger: 'epsilon', commandId: 'epsilon', kind: 'word' },
  { trigger: 'upsilon', commandId: 'upsilon', kind: 'word' },
  { trigger: 'partial', commandId: 'partial', kind: 'word' },
  { trigger: 'propto', commandId: 'propto', kind: 'word' },
  { trigger: 'approx', commandId: 'approx', kind: 'word' },
  { trigger: 'forall', commandId: 'forall', kind: 'word' },
  { trigger: 'exists', commandId: 'exists', kind: 'word' },
  { trigger: 'lambda', commandId: 'lambda', kind: 'word' },
  { trigger: 'Lambda', commandId: 'cap_lambda', kind: 'word' },
  { trigger: 'alpha', commandId: 'alpha', kind: 'word' },
  { trigger: 'gamma', commandId: 'gamma', kind: 'word' },
  { trigger: 'Gamma', commandId: 'cap_gamma', kind: 'word' },
  { trigger: 'delta', commandId: 'delta', kind: 'word' },
  { trigger: 'Delta', commandId: 'cap_delta', kind: 'word' },
  { trigger: 'theta', commandId: 'theta', kind: 'word' },
  { trigger: 'Theta', commandId: 'cap_theta', kind: 'word' },
  { trigger: 'kappa', commandId: 'kappa', kind: 'word' },
  { trigger: 'sigma', commandId: 'sigma', kind: 'word' },
  { trigger: 'Sigma', commandId: 'cap_sigma', kind: 'word' },
  { trigger: 'omega', commandId: 'omega', kind: 'word' },
  { trigger: 'Omega', commandId: 'cap_omega', kind: 'word' },
  { trigger: 'infty', commandId: 'infty', kind: 'word' },
  { trigger: 'nabla', commandId: 'nabla', kind: 'word' },
  { trigger: 'equiv', commandId: 'equiv', kind: 'word' },
  { trigger: 'times', commandId: 'times', kind: 'word' },
  { trigger: 'beta', commandId: 'beta', kind: 'word' },
  { trigger: 'zeta', commandId: 'zeta', kind: 'word' },
  { trigger: 'iota', commandId: 'iota', kind: 'word' },
  { trigger: 'cdot', commandId: 'cdot', kind: 'word' },
  { trigger: 'sim', commandId: 'sim', kind: 'word' },
  { trigger: 'leq', commandId: 'leq', kind: 'word' },
  { trigger: 'geq', commandId: 'geq', kind: 'word' },
  { trigger: 'neq', commandId: 'neq', kind: 'word' },
  { trigger: 'rho', commandId: 'rho', kind: 'word' },
  { trigger: 'tau', commandId: 'tau', kind: 'word' },
  { trigger: 'phi', commandId: 'phi', kind: 'word' },
  { trigger: 'Phi', commandId: 'cap_phi', kind: 'word' },
  { trigger: 'chi', commandId: 'chi', kind: 'word' },
  { trigger: 'psi', commandId: 'psi', kind: 'word' },
  { trigger: 'Psi', commandId: 'cap_psi', kind: 'word' },
  { trigger: 'eta', commandId: 'eta', kind: 'word' },
  { trigger: 'pi', commandId: 'pi', kind: 'word' },
  { trigger: 'Pi', commandId: 'cap_pi', kind: 'word' },
  { trigger: 'mu', commandId: 'mu', kind: 'word' },
  { trigger: 'nu', commandId: 'nu', kind: 'word' },
  { trigger: 'xi', commandId: 'xi', kind: 'word' },
  { trigger: 'Xi', commandId: 'cap_xi', kind: 'word' },
  { trigger: 'in', commandId: 'in', kind: 'word' },
  { trigger: 'notin', commandId: 'notin', kind: 'word' },
  { trigger: 'subset', commandId: 'subset', kind: 'word' },
  { trigger: 'subseteq', commandId: 'subseteq', kind: 'word' },
  { trigger: 'cup', commandId: 'cup', kind: 'word' },
  { trigger: 'cap', commandId: 'cap', kind: 'word' },
  { trigger: 'to', commandId: 'to', kind: 'word' },
  { trigger: 'cong', commandId: 'cong', kind: 'word' },
  { trigger: 'pm', commandId: 'pm', kind: 'word' },
  { trigger: 'mp', commandId: 'mp', kind: 'word' },
  { trigger: 'vdots', commandId: 'vdots', kind: 'word' },
  { trigger: 'ddots', commandId: 'ddots', kind: 'word' },
  { trigger: 'varphi', commandId: 'varphi', kind: 'word' },
  { trigger: 'vartheta', commandId: 'vartheta', kind: 'word' },
  { trigger: 'Upsilon', commandId: 'cap_upsilon', kind: 'word' },
  { trigger: 'hbar', commandId: 'hbar', kind: 'word' },
  { trigger: 'ell', commandId: 'ell', kind: 'word' },
  { trigger: 'quad', commandId: 'quad_space', kind: 'word' },
  { trigger: 'uparrow', commandId: 'uparrow', kind: 'word' },
  { trigger: 'downarrow', commandId: 'downarrow', kind: 'word' },
  { trigger: 'hookrightarrow', commandId: 'hookrightarrow', kind: 'word' },
  { trigger: 'mid', commandId: 'mid_rel', kind: 'word' },
  { trigger: 'leftarrow', commandId: 'leftarrow', kind: 'word' },
  { trigger: 'leftrightarrow', commandId: 'leftrightarrow', kind: 'word' },
];

/**
 * Direct-typing structural shorthands handled by MathSlotEngine.insertChar
 * (natural fraction, natural scripts, and auto-closing brackets).
 */
export const DIRECT_INPUT_SHORTHANDS: Readonly<Record<string, string>> = {
  frac: '/',
  sup: '^',
  sub: '_',
  subsup: '_ / ^',
  paren: '(',
  bracket: '[',
  brace: '{',
};

export const SHORTHAND_BY_COMMAND_ID: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [commandId, trigger] of Object.entries(DIRECT_INPUT_SHORTHANDS)) {
    map.set(commandId, trigger);
  }
  for (const rule of AUTO_SHORTHANDS) {
    const existing = map.get(rule.commandId);
    if (!existing || rule.trigger.length < existing.length) {
      map.set(rule.commandId, rule.trigger);
    }
  }
  return map;
})();

const PUNCT_RULES = AUTO_SHORTHANDS.filter((r) => r.kind === 'punct');

/**
 * Matches ONLY multi-character punctuation shorthands (`->`, `<=`, `+-`, `~~`, `~=`, etc.)
 * on immediate keystroke. Alphabetic words (`pi`, `oo`, `alpha`, `in`, ...) are recognized
 * non-destructively at word-token boundaries in `latex.ts`, so typing `spin`, `spi`, `pin`,
 * `foo`, or `n pi x` never gets corrupted mid-word!
 */
export function matchTrailingShorthand(
  children: readonly MathNode[],
  offset: number,
): { start: number; command: CommandDef } | null {
  if (offset <= 0) return null;

  const maxLen = Math.min(offset, 4);
  let tail = '';
  let charStart = offset;
  for (let i = offset - 1; i >= offset - maxLen; i -= 1) {
    const n = children[i];
    if (n.type !== 'char') break;
    tail = n.value + tail;
    charStart = i;
  }
  if (!tail) return null;

  for (const rule of PUNCT_RULES) {
    if (!tail.endsWith(rule.trigger)) continue;
    const matchStart = offset - rule.trigger.length;
    if (matchStart < charStart) continue;
    const cmd = COMMANDS_BY_ID.get(rule.commandId);
    if (cmd) {
      return { start: matchStart, command: cmd };
    }
  }
  return null;
}

/**
 * Upgrades an already-expanded prefix symbol when its completing character is typed next:
 * - `<=` (`leq`) + `>` -> `<=>` (`iff`)
 * - `<-` (`leftarrow`) + `>` -> `<->` (`leftrightarrow`)
 */
const SYMBOL_PREFIX_UPGRADES: Readonly<Record<string, string>> = {
  'leq:>': 'iff',
  'leftarrow:>': 'leftrightarrow',
};

export function matchShorthandUpgrade(
  children: readonly MathNode[],
  offset: number,
): { start: number; command: CommandDef } | null {
  if (offset < 2) return null;
  const last = children[offset - 1];
  const prev = children[offset - 2];
  if (last.type !== 'char' || prev.type !== 'symbol') return null;
  const upgradedId = SYMBOL_PREFIX_UPGRADES[`${prev.commandId}:${last.value}`];
  if (!upgradedId) return null;
  const cmd = COMMANDS_BY_ID.get(upgradedId);
  if (!cmd) return null;
  return { start: offset - 2, command: cmd };
}
