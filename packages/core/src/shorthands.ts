import { COMMANDS_BY_ID } from './catalog';
import type { CommandDef, MathNode } from './types';

export interface ShorthandRule {
  readonly trigger: string;
  readonly commandId: string;
  /** If true, character immediately before trigger must NOT be an ASCII letter (prevents mid-word false positives) */
  readonly wordBoundary: boolean;
}

/**
 * Natural instant auto-expansion shorthands.
 * Ordered longest-first within each trigger category so `<=>` matches before `=>`.
 */
export const AUTO_SHORTHANDS: readonly ShorthandRule[] = [
  // Multi-char operator / arrow / relation shorthands
  { trigger: '<=>', commandId: 'iff', wordBoundary: false },
  { trigger: '...', commandId: 'cdots', wordBoundary: false },
  { trigger: '->', commandId: 'to', wordBoundary: false },
  { trigger: '=>', commandId: 'implies', wordBoundary: false },
  { trigger: '<=', commandId: 'leq', wordBoundary: false },
  { trigger: '>=', commandId: 'geq', wordBoundary: false },
  { trigger: '<<', commandId: 'll', wordBoundary: false },
  { trigger: '>>', commandId: 'gg', wordBoundary: false },
  { trigger: '||', commandId: 'parallel', wordBoundary: false },
  { trigger: '!=', commandId: 'neq', wordBoundary: false },
  { trigger: '~=', commandId: 'approx', wordBoundary: false },
  { trigger: '==', commandId: 'equiv', wordBoundary: false },
  { trigger: '+-', commandId: 'pm', wordBoundary: false },
  { trigger: '-+', commandId: 'mp', wordBoundary: false },
  { trigger: '**', commandId: 'cdot', wordBoundary: false },

  // Ultra-fast symbolic shorthands (word-bounded so English words stay intact)
  { trigger: 'oo', commandId: 'infty', wordBoundary: true },
  { trigger: 'xx', commandId: 'times', wordBoundary: true },

  // Unambiguous full symbol & Greek names (word-bounded)
  { trigger: 'emptyset', commandId: 'emptyset', wordBoundary: true },
  { trigger: 'epsilon', commandId: 'epsilon', wordBoundary: true },
  { trigger: 'upsilon', commandId: 'upsilon', wordBoundary: true },
  { trigger: 'partial', commandId: 'partial', wordBoundary: true },
  { trigger: 'propto', commandId: 'propto', wordBoundary: true },
  { trigger: 'approx', commandId: 'approx', wordBoundary: true },
  { trigger: 'forall', commandId: 'forall', wordBoundary: true },
  { trigger: 'exists', commandId: 'exists', wordBoundary: true },
  { trigger: 'lambda', commandId: 'lambda', wordBoundary: true },
  { trigger: 'Lambda', commandId: 'cap_lambda', wordBoundary: true },
  { trigger: 'alpha', commandId: 'alpha', wordBoundary: true },
  { trigger: 'gamma', commandId: 'gamma', wordBoundary: true },
  { trigger: 'Gamma', commandId: 'cap_gamma', wordBoundary: true },
  { trigger: 'delta', commandId: 'delta', wordBoundary: true },
  { trigger: 'Delta', commandId: 'cap_delta', wordBoundary: true },
  { trigger: 'theta', commandId: 'theta', wordBoundary: true },
  { trigger: 'Theta', commandId: 'cap_theta', wordBoundary: true },
  { trigger: 'kappa', commandId: 'kappa', wordBoundary: true },
  { trigger: 'sigma', commandId: 'sigma', wordBoundary: true },
  { trigger: 'Sigma', commandId: 'cap_sigma', wordBoundary: true },
  { trigger: 'omega', commandId: 'omega', wordBoundary: true },
  { trigger: 'Omega', commandId: 'cap_omega', wordBoundary: true },
  { trigger: 'infty', commandId: 'infty', wordBoundary: true },
  { trigger: 'nabla', commandId: 'nabla', wordBoundary: true },
  { trigger: 'equiv', commandId: 'equiv', wordBoundary: true },
  { trigger: 'times', commandId: 'times', wordBoundary: true },
  { trigger: 'beta', commandId: 'beta', wordBoundary: true },
  { trigger: 'zeta', commandId: 'zeta', wordBoundary: true },
  { trigger: 'iota', commandId: 'iota', wordBoundary: true },
  { trigger: 'cdot', commandId: 'cdot', wordBoundary: true },
  { trigger: 'leq', commandId: 'leq', wordBoundary: true },
  { trigger: 'geq', commandId: 'geq', wordBoundary: true },
  { trigger: 'neq', commandId: 'neq', wordBoundary: true },
  { trigger: 'rho', commandId: 'rho', wordBoundary: true },
  { trigger: 'tau', commandId: 'tau', wordBoundary: true },
  { trigger: 'phi', commandId: 'phi', wordBoundary: true },
  { trigger: 'Phi', commandId: 'cap_phi', wordBoundary: true },
  { trigger: 'chi', commandId: 'chi', wordBoundary: true },
  { trigger: 'psi', commandId: 'psi', wordBoundary: true },
  { trigger: 'Psi', commandId: 'cap_psi', wordBoundary: true },
  { trigger: 'eta', commandId: 'eta', wordBoundary: true },
  { trigger: 'pi', commandId: 'pi', wordBoundary: true },
  { trigger: 'Pi', commandId: 'cap_pi', wordBoundary: true },
  { trigger: 'mu', commandId: 'mu', wordBoundary: true },
  { trigger: 'nu', commandId: 'nu', wordBoundary: true },
  { trigger: 'xi', commandId: 'xi', wordBoundary: true },
  { trigger: 'Xi', commandId: 'cap_xi', wordBoundary: true },
];

/** Primary display shorthand per commandId for UI tooltips / subtle badges */
export const SHORTHAND_BY_COMMAND_ID: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  // Prefer shortest intuitive trigger (e.g. `oo` over `infty`, `<=` over `leq`)
  for (const rule of AUTO_SHORTHANDS) {
    const existing = map.get(rule.commandId);
    if (!existing || rule.trigger.length < existing.length) {
      map.set(rule.commandId, rule.trigger);
    }
  }
  return map;
})();

function isAsciiLetter(ch: string): boolean {
  return /^[a-zA-Z]$/.test(ch);
}

/**
 * Checks whether the `CharNode`s immediately preceding `offset` in `children`
 * match an auto-shorthand rule.
 */
export function matchTrailingShorthand(
  children: readonly MathNode[],
  offset: number,
): { start: number; command: CommandDef } | null {
  if (offset <= 0) return null;

  // Don't interfere with an active inline `\macro` being typed (e.g. `\pi` -> wait for space)
  let scan = offset - 1;
  while (scan >= 0) {
    const n = children[scan];
    if (n.type === 'char' && isAsciiLetter(n.value)) {
      scan -= 1;
    } else {
      if (n.type === 'char' && n.value === '\\') {
        return null;
      }
      break;
    }
  }

  // Collect up to 10 trailing char nodes
  const maxLen = Math.min(offset, 10);
  let tail = '';
  let charStart = offset;
  for (let i = offset - 1; i >= offset - maxLen; i -= 1) {
    const n = children[i];
    if (n.type !== 'char') break;
    tail = n.value + tail;
    charStart = i;
  }
  if (!tail) return null;

  for (const rule of AUTO_SHORTHANDS) {
    if (!tail.endsWith(rule.trigger)) continue;
    const matchStart = offset - rule.trigger.length;
    if (matchStart < charStart) continue;

    if (rule.wordBoundary && matchStart > 0) {
      const prev = children[matchStart - 1];
      if (prev.type === 'char' && isAsciiLetter(prev.value)) {
        continue;
      }
    }

    const cmd = COMMANDS_BY_ID.get(rule.commandId);
    if (cmd) {
      return { start: matchStart, command: cmd };
    }
  }
  return null;
}
