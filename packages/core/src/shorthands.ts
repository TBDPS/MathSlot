import { COMMANDS_BY_ID } from './catalog';
import type { CommandDef, MathNode } from './types';

export interface ShorthandRule {
  readonly trigger: string;
  readonly commandId: string;
  /**
   * 'none': match anywhere (e.g. `->`, `<=`, `+-`)
   * 'word': character before trigger must NOT be an ASCII letter (e.g. `oo`, `xx`)
   * 'coeff': allow 0 letters OR 1 single math coefficient letter before trigger (e.g. `npi` -> `n\pi`, `ipi` -> `i\pi`, `iomega` -> `i\omega`)
   */
  readonly boundary: 'none' | 'word' | 'coeff';
}

const PROTECTED_WORDS = new Set([
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'exp',
  'log',
  'lim',
  'max',
  'min',
  'sup',
  'inf',
  'det',
  'dim',
  'ker',
  'deg',
  'arg',
  'sum',
  'int',
  'mod',
  'gcd',
  'lcm',
  'hom',
  'beta',
  'zeta',
  'theta',
  'delta',
  'gamma',
  'sigma',
  'omega',
  'alpha',
  'kappa',
  'lambda',
  'epsilon',
  'upsilon',
  'partial',
  'approx',
  'simple',
  'spin',
  'spi',
  'api',
  'epi',
  'opt',
]);

export const AUTO_SHORTHANDS: readonly ShorthandRule[] = [
  // Multi-char operator / arrow / relation shorthands
  { trigger: '<=>', commandId: 'iff', boundary: 'none' },
  { trigger: '...', commandId: 'cdots', boundary: 'none' },
  { trigger: '->', commandId: 'to', boundary: 'none' },
  { trigger: '=>', commandId: 'implies', boundary: 'none' },
  { trigger: '<=', commandId: 'leq', boundary: 'none' },
  { trigger: '>=', commandId: 'geq', boundary: 'none' },
  { trigger: '<<', commandId: 'll', boundary: 'none' },
  { trigger: '>>', commandId: 'gg', boundary: 'none' },
  { trigger: '||', commandId: 'parallel', boundary: 'none' },
  { trigger: '!=', commandId: 'neq', boundary: 'none' },
  { trigger: '~=', commandId: 'approx', boundary: 'none' },
  { trigger: '~~', commandId: 'sim', boundary: 'none' },
  { trigger: '==', commandId: 'equiv', boundary: 'none' },
  { trigger: '+-', commandId: 'pm', boundary: 'none' },
  { trigger: '-+', commandId: 'mp', boundary: 'none' },
  { trigger: '**', commandId: 'cdot', boundary: 'none' },

  // Ultra-fast symbolic shorthands (strict word boundary so `foo` never triggers)
  { trigger: 'oo', commandId: 'infty', boundary: 'word' },
  { trigger: 'xx', commandId: 'times', boundary: 'word' },

  // Full symbol & Greek names
  { trigger: 'emptyset', commandId: 'emptyset', boundary: 'word' },
  { trigger: 'epsilon', commandId: 'epsilon', boundary: 'coeff' },
  { trigger: 'upsilon', commandId: 'upsilon', boundary: 'coeff' },
  { trigger: 'partial', commandId: 'partial', boundary: 'word' },
  { trigger: 'propto', commandId: 'propto', boundary: 'word' },
  { trigger: 'approx', commandId: 'approx', boundary: 'word' },
  { trigger: 'forall', commandId: 'forall', boundary: 'word' },
  { trigger: 'exists', commandId: 'exists', boundary: 'word' },
  { trigger: 'lambda', commandId: 'lambda', boundary: 'coeff' },
  { trigger: 'Lambda', commandId: 'cap_lambda', boundary: 'coeff' },
  { trigger: 'alpha', commandId: 'alpha', boundary: 'coeff' },
  { trigger: 'gamma', commandId: 'gamma', boundary: 'coeff' },
  { trigger: 'Gamma', commandId: 'cap_gamma', boundary: 'coeff' },
  { trigger: 'delta', commandId: 'delta', boundary: 'coeff' },
  { trigger: 'Delta', commandId: 'cap_delta', boundary: 'coeff' },
  { trigger: 'theta', commandId: 'theta', boundary: 'coeff' },
  { trigger: 'Theta', commandId: 'cap_theta', boundary: 'coeff' },
  { trigger: 'kappa', commandId: 'kappa', boundary: 'coeff' },
  { trigger: 'sigma', commandId: 'sigma', boundary: 'coeff' },
  { trigger: 'Sigma', commandId: 'cap_sigma', boundary: 'coeff' },
  { trigger: 'omega', commandId: 'omega', boundary: 'coeff' },
  { trigger: 'Omega', commandId: 'cap_omega', boundary: 'coeff' },
  { trigger: 'infty', commandId: 'infty', boundary: 'word' },
  { trigger: 'nabla', commandId: 'nabla', boundary: 'word' },
  { trigger: 'equiv', commandId: 'equiv', boundary: 'word' },
  { trigger: 'times', commandId: 'times', boundary: 'word' },
  { trigger: 'beta', commandId: 'beta', boundary: 'coeff' },
  { trigger: 'zeta', commandId: 'zeta', boundary: 'coeff' },
  { trigger: 'iota', commandId: 'iota', boundary: 'word' },
  { trigger: 'cdot', commandId: 'cdot', boundary: 'word' },
  { trigger: 'sim', commandId: 'sim', boundary: 'word' },
  { trigger: 'leq', commandId: 'leq', boundary: 'word' },
  { trigger: 'geq', commandId: 'geq', boundary: 'word' },
  { trigger: 'neq', commandId: 'neq', boundary: 'word' },
  { trigger: 'rho', commandId: 'rho', boundary: 'coeff' },
  { trigger: 'tau', commandId: 'tau', boundary: 'coeff' },
  { trigger: 'phi', commandId: 'phi', boundary: 'coeff' },
  { trigger: 'Phi', commandId: 'cap_phi', boundary: 'coeff' },
  { trigger: 'chi', commandId: 'chi', boundary: 'coeff' },
  { trigger: 'psi', commandId: 'psi', boundary: 'coeff' },
  { trigger: 'Psi', commandId: 'cap_psi', boundary: 'coeff' },
  { trigger: 'eta', commandId: 'eta', boundary: 'word' },
  { trigger: 'pi', commandId: 'pi', boundary: 'coeff' },
  { trigger: 'Pi', commandId: 'cap_pi', boundary: 'coeff' },
  { trigger: 'mu', commandId: 'mu', boundary: 'word' },
  { trigger: 'nu', commandId: 'nu', boundary: 'word' },
  { trigger: 'xi', commandId: 'xi', boundary: 'word' },
  { trigger: 'Xi', commandId: 'cap_xi', boundary: 'word' },
];

export const SHORTHAND_BY_COMMAND_ID: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
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

export function matchTrailingShorthand(
  children: readonly MathNode[],
  offset: number,
): { start: number; command: CommandDef } | null {
  if (offset <= 0) return null;

  // Don't interfere with an active inline `\macro` being typed
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

  // Find full contiguous ASCII letter run ending at `offset` (for coeff check)
  let wordStart = offset;
  while (wordStart > 0) {
    const n = children[wordStart - 1];
    if (n.type === 'char' && isAsciiLetter(n.value)) {
      wordStart -= 1;
    } else {
      break;
    }
  }
  const fullWord = children
    .slice(wordStart, offset)
    .map((n) => (n.type === 'char' ? n.value : ''))
    .join('');

  for (const rule of AUTO_SHORTHANDS) {
    if (!tail.endsWith(rule.trigger)) continue;
    const matchStart = offset - rule.trigger.length;
    if (matchStart < charStart) continue;

    if (rule.boundary === 'word' && matchStart > 0) {
      const prev = children[matchStart - 1];
      if (prev.type === 'char' && isAsciiLetter(prev.value)) {
        continue;
      }
    } else if (rule.boundary === 'coeff' && matchStart > 0) {
      const prev = children[matchStart - 1];
      if (prev.type === 'char' && isAsciiLetter(prev.value)) {
        // Allow ONLY a single variable coefficient letter before the Greek name (e.g. `npi`, `ipi`, `dtheta`)
        const prefixLetters = matchStart - wordStart;
        if (prefixLetters !== 1) continue;
        if (PROTECTED_WORDS.has(fullWord.toLowerCase())) continue;
      }
    }

    const cmd = COMMANDS_BY_ID.get(rule.commandId);
    if (cmd) {
      return { start: matchStart, command: cmd };
    }
  }
  return null;
}
