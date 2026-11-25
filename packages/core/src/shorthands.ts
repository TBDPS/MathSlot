import { COMMANDS_BY_ID } from './catalog';
import { MATH_FUNCTIONS, OPERATORNAME_FUNCTIONS } from './emitIr';
import type { CommandDef, CustomCommandDef, MathNode } from './types';
import type { UserCommandEntry } from './userLibraries';

export interface ShorthandSpec {
  readonly trigger: string;
  /**
   * 'punct': multi-char non-letter shorthand expanded immediately on keystroke (e.g. `->`, `<=`, `+-`, `~~`)
   * 'word': isolated alphabetic token recognized non-destructively at word-boundary level
   *         (e.g. `n pi x` -> `n \pi x`, `oo` -> `\infty`, while `spin`/`spi`/`foo` stay literal!)
   * 'direct': direct structural input trigger handled by MathSlotEngine.insertChar (e.g. `/`, `^`, `_`, `(`)
   */
  readonly kind: 'punct' | 'word' | 'direct';
  /** Built-in catalog commandId for UI badges, search, and AST SymbolNode creation */
  readonly commandId?: string;
  /** Canonical LaTeX emitted for word shorthands */
  readonly latex?: string;
  /** Semantic token role for word shorthands consumed directly by latex.ts */
  readonly role?: 'atom' | 'binop' | 'diff';
}

export interface ShorthandRule {
  readonly trigger: string;
  readonly commandId: string;
  readonly kind: 'punct' | 'word';
}

/**
 * Single source of truth for ALL built-in shorthands (punct, word atoms, word binops,
 * multi-letter differentials, and direct structural input triggers).
 * Every runtime lookup table (`AUTO_SHORTHANDS`, `SHORTHAND_BY_COMMAND_ID`,
 * `BARE_WORD_ATOMS`, `BARE_WORD_BINOPS`, `DIFFERENTIAL_WORDS`, and prefix upgrades)
 * is derived directly from this registry so behavior, badges, and docs never drift!
 */
export const SHORTHAND_SPECS: readonly ShorthandSpec[] = [
  // 1. Direct-typing structural shorthands (handled by MathSlotEngine.insertChar)
  { trigger: '/', kind: 'direct', commandId: 'frac' },
  { trigger: '^', kind: 'direct', commandId: 'sup' },
  { trigger: '_', kind: 'direct', commandId: 'sub' },
  { trigger: '_ / ^', kind: 'direct', commandId: 'subsup' },
  { trigger: '(', kind: 'direct', commandId: 'paren' },
  { trigger: '[', kind: 'direct', commandId: 'bracket' },
  { trigger: '{', kind: 'direct', commandId: 'brace' },

  // 2. Multi-char punctuation / arrow / relation / negation / causality shorthands (longest first; prefix upgrades auto-derived!)
  { trigger: '!<=>', kind: 'punct', commandId: 'nLeftrightarrow' },
  { trigger: '<=>', kind: 'punct', commandId: 'iff' },
  { trigger: '<->', kind: 'punct', commandId: 'leftrightarrow' },
  { trigger: '|->', kind: 'punct', commandId: 'mapsto' },
  { trigger: '!=>', kind: 'punct', commandId: 'nRightarrow' },
  { trigger: '!->', kind: 'punct', commandId: 'nrightarrow' },
  { trigger: '!==', kind: 'punct', commandId: 'not_equiv' },
  { trigger: '!<=', kind: 'punct', commandId: 'nleq' },
  { trigger: '!>=', kind: 'punct', commandId: 'ngeq' },
  { trigger: '!~=', kind: 'punct', commandId: 'ncong' },
  { trigger: '!||', kind: 'punct', commandId: 'nparallel' },
  { trigger: '.:.', kind: 'punct', commandId: 'therefore' },
  { trigger: ':.:', kind: 'punct', commandId: 'because' },
  { trigger: '...', kind: 'punct', commandId: 'cdots' },
  { trigger: ':::', kind: 'punct', commandId: 'vdots' },
  { trigger: '->', kind: 'punct', commandId: 'to' },
  { trigger: '<-', kind: 'punct', commandId: 'leftarrow' },
  { trigger: '=>', kind: 'punct', commandId: 'implies' },
  { trigger: '<=', kind: 'punct', commandId: 'leq' },
  { trigger: '>=', kind: 'punct', commandId: 'geq' },
  { trigger: '<<', kind: 'punct', commandId: 'll' },
  { trigger: '>>', kind: 'punct', commandId: 'gg' },
  { trigger: '||', kind: 'punct', commandId: 'parallel' },
  { trigger: '|-', kind: 'punct', commandId: 'vdash' },
  { trigger: '|=', kind: 'punct', commandId: 'models' },
  { trigger: '!=', kind: 'punct', commandId: 'neq' },
  { trigger: '!<', kind: 'punct', commandId: 'nless' },
  { trigger: '!>', kind: 'punct', commandId: 'ngtr' },
  { trigger: '!~', kind: 'punct', commandId: 'nsim' },
  { trigger: '!|', kind: 'punct', commandId: 'nmid' },
  { trigger: '~=', kind: 'punct', commandId: 'cong' },
  { trigger: '~~', kind: 'punct', commandId: 'approx' },
  { trigger: '==', kind: 'punct', commandId: 'equiv' },
  { trigger: ':=', kind: 'punct', commandId: 'coloneqq' },
  { trigger: '+-', kind: 'punct', commandId: 'pm' },
  { trigger: '-+', kind: 'punct', commandId: 'mp' },
  { trigger: '**', kind: 'punct', commandId: 'cdot' },

  // 3. Isolated-word atomic shorthands (all Greek letters + TeX variants + symbolic atoms)
  { trigger: 'alpha', kind: 'word', role: 'atom', commandId: 'alpha', latex: '\\alpha' },
  { trigger: 'beta', kind: 'word', role: 'atom', commandId: 'beta', latex: '\\beta' },
  { trigger: 'gamma', kind: 'word', role: 'atom', commandId: 'gamma', latex: '\\gamma' },
  { trigger: 'delta', kind: 'word', role: 'atom', commandId: 'delta', latex: '\\delta' },
  { trigger: 'epsilon', kind: 'word', role: 'atom', commandId: 'epsilon', latex: '\\varepsilon' },
  { trigger: 'varepsilon', kind: 'word', role: 'atom', latex: '\\varepsilon' },
  { trigger: 'zeta', kind: 'word', role: 'atom', commandId: 'zeta', latex: '\\zeta' },
  { trigger: 'eta', kind: 'word', role: 'atom', commandId: 'eta', latex: '\\eta' },
  { trigger: 'theta', kind: 'word', role: 'atom', commandId: 'theta', latex: '\\theta' },
  { trigger: 'vartheta', kind: 'word', role: 'atom', commandId: 'vartheta', latex: '\\vartheta' },
  { trigger: 'iota', kind: 'word', role: 'atom', commandId: 'iota', latex: '\\iota' },
  { trigger: 'kappa', kind: 'word', role: 'atom', commandId: 'kappa', latex: '\\kappa' },
  { trigger: 'varkappa', kind: 'word', role: 'atom', latex: '\\varkappa' },
  { trigger: 'lambda', kind: 'word', role: 'atom', commandId: 'lambda', latex: '\\lambda' },
  { trigger: 'mu', kind: 'word', role: 'atom', commandId: 'mu', latex: '\\mu' },
  { trigger: 'nu', kind: 'word', role: 'atom', commandId: 'nu', latex: '\\nu' },
  { trigger: 'xi', kind: 'word', role: 'atom', commandId: 'xi', latex: '\\xi' },
  { trigger: 'pi', kind: 'word', role: 'atom', commandId: 'pi', latex: '\\pi' },
  { trigger: 'varpi', kind: 'word', role: 'atom', latex: '\\varpi' },
  { trigger: 'rho', kind: 'word', role: 'atom', commandId: 'rho', latex: '\\rho' },
  { trigger: 'varrho', kind: 'word', role: 'atom', latex: '\\varrho' },
  { trigger: 'sigma', kind: 'word', role: 'atom', commandId: 'sigma', latex: '\\sigma' },
  { trigger: 'varsigma', kind: 'word', role: 'atom', latex: '\\varsigma' },
  { trigger: 'tau', kind: 'word', role: 'atom', commandId: 'tau', latex: '\\tau' },
  { trigger: 'upsilon', kind: 'word', role: 'atom', commandId: 'upsilon', latex: '\\upsilon' },
  { trigger: 'phi', kind: 'word', role: 'atom', commandId: 'phi', latex: '\\phi' },
  { trigger: 'varphi', kind: 'word', role: 'atom', commandId: 'varphi', latex: '\\varphi' },
  { trigger: 'chi', kind: 'word', role: 'atom', commandId: 'chi', latex: '\\chi' },
  { trigger: 'psi', kind: 'word', role: 'atom', commandId: 'psi', latex: '\\psi' },
  { trigger: 'omega', kind: 'word', role: 'atom', commandId: 'omega', latex: '\\omega' },

  { trigger: 'Gamma', kind: 'word', role: 'atom', commandId: 'cap_gamma', latex: '\\Gamma' },
  { trigger: 'Delta', kind: 'word', role: 'atom', commandId: 'cap_delta', latex: '\\Delta' },
  { trigger: 'Theta', kind: 'word', role: 'atom', commandId: 'cap_theta', latex: '\\Theta' },
  { trigger: 'Lambda', kind: 'word', role: 'atom', commandId: 'cap_lambda', latex: '\\Lambda' },
  { trigger: 'Xi', kind: 'word', role: 'atom', commandId: 'cap_xi', latex: '\\Xi' },
  { trigger: 'Pi', kind: 'word', role: 'atom', commandId: 'cap_pi', latex: '\\Pi' },
  { trigger: 'Sigma', kind: 'word', role: 'atom', commandId: 'cap_sigma', latex: '\\Sigma' },
  { trigger: 'Upsilon', kind: 'word', role: 'atom', commandId: 'cap_upsilon', latex: '\\Upsilon' },
  { trigger: 'Phi', kind: 'word', role: 'atom', commandId: 'cap_phi', latex: '\\Phi' },
  { trigger: 'Psi', kind: 'word', role: 'atom', commandId: 'cap_psi', latex: '\\Psi' },
  { trigger: 'Omega', kind: 'word', role: 'atom', commandId: 'cap_omega', latex: '\\Omega' },

  { trigger: 'oo', kind: 'word', role: 'atom', commandId: 'infty', latex: '\\infty' },
  { trigger: 'infty', kind: 'word', role: 'atom', commandId: 'infty', latex: '\\infty' },
  { trigger: 'nabla', kind: 'word', role: 'atom', commandId: 'nabla', latex: '\\nabla' },
  { trigger: 'partial', kind: 'word', role: 'atom', commandId: 'partial', latex: '\\partial' },
  { trigger: 'forall', kind: 'word', role: 'atom', commandId: 'forall', latex: '\\forall' },
  { trigger: 'exists', kind: 'word', role: 'atom', commandId: 'exists', latex: '\\exists' },
  { trigger: 'nexists', kind: 'word', role: 'atom', commandId: 'nexists', latex: '\\nexists' },
  { trigger: 'therefore', kind: 'word', role: 'atom', commandId: 'therefore', latex: '\\therefore' },
  { trigger: 'because', kind: 'word', role: 'atom', commandId: 'because', latex: '\\because' },
  { trigger: 'neg', kind: 'word', role: 'atom', commandId: 'neg', latex: '\\neg' },
  { trigger: 'lnot', kind: 'word', role: 'atom', commandId: 'neg', latex: '\\neg' },
  { trigger: 'emptyset', kind: 'word', role: 'atom', commandId: 'emptyset', latex: '\\varnothing' },
  { trigger: 'hbar', kind: 'word', role: 'atom', commandId: 'hbar', latex: '\\hbar' },
  { trigger: 'ell', kind: 'word', role: 'atom', commandId: 'ell', latex: '\\ell' },
  { trigger: 'ldots', kind: 'word', role: 'atom', latex: '\\ldots' },
  { trigger: 'cdots', kind: 'word', role: 'atom', commandId: 'cdots', latex: '\\cdots' },
  { trigger: 'vdots', kind: 'word', role: 'atom', commandId: 'vdots', latex: '\\vdots' },
  { trigger: 'ddots', kind: 'word', role: 'atom', commandId: 'ddots', latex: '\\ddots' },
  { trigger: 'dots', kind: 'word', role: 'atom', latex: '\\ldots' },
  { trigger: 'quad', kind: 'word', role: 'atom', commandId: 'quad_space', latex: '\\quad' },
  { trigger: 'qquad', kind: 'word', role: 'atom', latex: '\\qquad' },
  { trigger: 'dd', kind: 'word', role: 'atom', latex: '\\mathrm{d}' },
  { trigger: 'ee', kind: 'word', role: 'atom', latex: '\\mathrm{e}' },
  { trigger: 'ii', kind: 'word', role: 'atom', latex: '\\mathrm{i}' },

  // 4. Isolated-word binary operators & relations
  { trigger: 'xx', kind: 'word', role: 'binop', commandId: 'times', latex: '\\times' },
  { trigger: 'times', kind: 'word', role: 'binop', commandId: 'times', latex: '\\times' },
  { trigger: 'cdot', kind: 'word', role: 'binop', commandId: 'cdot', latex: '\\cdot' },
  { trigger: 'div', kind: 'word', role: 'binop', commandId: 'div_op', latex: '\\div' },
  { trigger: 'oplus', kind: 'word', role: 'binop', commandId: 'oplus', latex: '\\oplus' },
  { trigger: 'otimes', kind: 'word', role: 'binop', commandId: 'otimes', latex: '\\otimes' },
  { trigger: 'wedge', kind: 'word', role: 'binop', commandId: 'wedge', latex: '\\wedge' },
  { trigger: 'star', kind: 'word', role: 'binop', commandId: 'star_op', latex: '\\star' },
  { trigger: 'dagger', kind: 'word', role: 'atom', commandId: 'dagger', latex: '\\dagger' },
  { trigger: 'pm', kind: 'word', role: 'binop', commandId: 'pm', latex: '\\pm' },
  { trigger: 'mp', kind: 'word', role: 'binop', commandId: 'mp', latex: '\\mp' },
  { trigger: 'in', kind: 'word', role: 'binop', commandId: 'in', latex: '\\in' },
  { trigger: 'notin', kind: 'word', role: 'binop', commandId: 'notin', latex: '\\notin' },
  { trigger: 'subset', kind: 'word', role: 'binop', commandId: 'subset', latex: '\\subset' },
  { trigger: 'subseteq', kind: 'word', role: 'binop', commandId: 'subseteq', latex: '\\subseteq' },
  { trigger: 'supset', kind: 'word', role: 'binop', commandId: 'supset', latex: '\\supset' },
  { trigger: 'supseteq', kind: 'word', role: 'binop', commandId: 'supseteq', latex: '\\supseteq' },
  { trigger: 'nsubseteq', kind: 'word', role: 'binop', commandId: 'nsubseteq', latex: '\\nsubseteq' },
  { trigger: 'models', kind: 'word', role: 'binop', commandId: 'models', latex: '\\models' },
  { trigger: 'vdash', kind: 'word', role: 'binop', commandId: 'vdash', latex: '\\vdash' },
  { trigger: 'lesssim', kind: 'word', role: 'binop', commandId: 'lesssim', latex: '\\lesssim' },
  { trigger: 'gtrsim', kind: 'word', role: 'binop', commandId: 'gtrsim', latex: '\\gtrsim' },
  { trigger: 'cup', kind: 'word', role: 'binop', commandId: 'cup', latex: '\\cup' },
  { trigger: 'cap', kind: 'word', role: 'binop', commandId: 'cap', latex: '\\cap' },
  { trigger: 'to', kind: 'word', role: 'binop', commandId: 'to', latex: '\\to' },
  { trigger: 'rightarrow', kind: 'word', role: 'binop', commandId: 'to', latex: '\\to' },
  { trigger: 'leftarrow', kind: 'word', role: 'binop', commandId: 'leftarrow', latex: '\\leftarrow' },
  { trigger: 'leftrightarrow', kind: 'word', role: 'binop', commandId: 'leftrightarrow', latex: '\\leftrightarrow' },
  { trigger: 'uparrow', kind: 'word', role: 'binop', commandId: 'uparrow', latex: '\\uparrow' },
  { trigger: 'downarrow', kind: 'word', role: 'binop', commandId: 'downarrow', latex: '\\downarrow' },
  { trigger: 'hookrightarrow', kind: 'word', role: 'binop', commandId: 'hookrightarrow', latex: '\\hookrightarrow' },
  { trigger: 'implies', kind: 'word', role: 'binop', commandId: 'implies', latex: '\\Rightarrow' },
  { trigger: 'iff', kind: 'word', role: 'binop', commandId: 'iff', latex: '\\Leftrightarrow' },
  { trigger: 'mapsto', kind: 'word', role: 'binop', commandId: 'mapsto', latex: '\\mapsto' },
  { trigger: 'approx', kind: 'word', role: 'binop', commandId: 'approx', latex: '\\approx' },
  { trigger: 'equiv', kind: 'word', role: 'binop', commandId: 'equiv', latex: '\\equiv' },
  { trigger: 'sim', kind: 'word', role: 'binop', commandId: 'sim', latex: '\\sim' },
  { trigger: 'cong', kind: 'word', role: 'binop', commandId: 'cong', latex: '\\cong' },
  { trigger: 'propto', kind: 'word', role: 'binop', commandId: 'propto', latex: '\\propto' },
  { trigger: 'leq', kind: 'word', role: 'binop', commandId: 'leq', latex: '\\le' },
  { trigger: 'le', kind: 'word', role: 'binop', commandId: 'leq', latex: '\\le' },
  { trigger: 'geq', kind: 'word', role: 'binop', commandId: 'geq', latex: '\\ge' },
  { trigger: 'ge', kind: 'word', role: 'binop', commandId: 'geq', latex: '\\ge' },
  { trigger: 'neq', kind: 'word', role: 'binop', commandId: 'neq', latex: '\\neq' },
  { trigger: 'ne', kind: 'word', role: 'binop', commandId: 'neq', latex: '\\neq' },
  { trigger: 'mid', kind: 'word', role: 'binop', commandId: 'mid_rel', latex: '\\mid' },
  { trigger: 'nmid', kind: 'word', role: 'binop', commandId: 'nmid', latex: '\\nmid' },
  { trigger: 'parallel', kind: 'word', role: 'binop', commandId: 'parallel', latex: '\\parallel' },
  { trigger: 'nparallel', kind: 'word', role: 'binop', commandId: 'nparallel', latex: '\\nparallel' },
  { trigger: 'perp', kind: 'word', role: 'binop', commandId: 'perp', latex: '\\perp' },
  { trigger: 'circ', kind: 'word', role: 'binop', commandId: 'circ', latex: '\\circ' },
  { trigger: 'land', kind: 'word', role: 'binop', commandId: 'land', latex: '\\land' },
  { trigger: 'lor', kind: 'word', role: 'binop', commandId: 'lor', latex: '\\lor' },
  { trigger: 'setminus', kind: 'word', role: 'binop', commandId: 'setminus', latex: '\\setminus' },
  { trigger: 'simeq', kind: 'word', role: 'binop', commandId: 'simeq', latex: '\\simeq' },
  { trigger: 'nimplies', kind: 'word', role: 'binop', commandId: 'nRightarrow', latex: '\\nRightarrow' },
  { trigger: 'notimplies', kind: 'word', role: 'binop', commandId: 'nRightarrow', latex: '\\nRightarrow' },
  { trigger: 'nRightarrow', kind: 'word', role: 'binop', commandId: 'nRightarrow', latex: '\\nRightarrow' },
  { trigger: 'niff', kind: 'word', role: 'binop', commandId: 'nLeftrightarrow', latex: '\\nLeftrightarrow' },
  { trigger: 'notiff', kind: 'word', role: 'binop', commandId: 'nLeftrightarrow', latex: '\\nLeftrightarrow' },
  { trigger: 'nLeftrightarrow', kind: 'word', role: 'binop', commandId: 'nLeftrightarrow', latex: '\\nLeftrightarrow' },
  { trigger: 'nto', kind: 'word', role: 'binop', commandId: 'nrightarrow', latex: '\\nrightarrow' },
  { trigger: 'nrightarrow', kind: 'word', role: 'binop', commandId: 'nrightarrow', latex: '\\nrightarrow' },
  { trigger: 'nless', kind: 'word', role: 'binop', commandId: 'nless', latex: '\\nless' },
  { trigger: 'ngtr', kind: 'word', role: 'binop', commandId: 'ngtr', latex: '\\ngtr' },
  { trigger: 'nleq', kind: 'word', role: 'binop', commandId: 'nleq', latex: '\\nleq' },
  { trigger: 'nle', kind: 'word', role: 'binop', commandId: 'nleq', latex: '\\nleq' },
  { trigger: 'ngeq', kind: 'word', role: 'binop', commandId: 'ngeq', latex: '\\ngeq' },
  { trigger: 'nge', kind: 'word', role: 'binop', commandId: 'ngeq', latex: '\\ngeq' },
  { trigger: 'nsim', kind: 'word', role: 'binop', commandId: 'nsim', latex: '\\nsim' },
  { trigger: 'ncong', kind: 'word', role: 'binop', commandId: 'ncong', latex: '\\ncong' },
  { trigger: 'nequiv', kind: 'word', role: 'binop', commandId: 'not_equiv', latex: '\\not\\equiv' },
  { trigger: 'nvdash', kind: 'word', role: 'binop', commandId: 'nvdash', latex: '\\nvdash' },
  { trigger: 'nmodels', kind: 'word', role: 'binop', commandId: 'nvDash', latex: '\\nvDash' },
  { trigger: 'nvDash', kind: 'word', role: 'binop', commandId: 'nvDash', latex: '\\nvDash' },
  { trigger: 'nsupseteq', kind: 'word', role: 'binop', commandId: 'nsupseteq', latex: '\\nsupseteq' },

  // 5. Differential word shorthands (note: generic `d` + single ASCII letter is also supported;
  //    explicit multi-letter Greek differentials live here alongside `dx` -> `diff` UI hint!)
  { trigger: 'dx', kind: 'word', role: 'diff', commandId: 'diff', latex: '\\mathrm{d}x' },
  { trigger: 'dt', kind: 'word', role: 'diff', latex: '\\mathrm{d}t' },
  { trigger: 'dy', kind: 'word', role: 'diff', latex: '\\mathrm{d}y' },
  { trigger: 'dz', kind: 'word', role: 'diff', latex: '\\mathrm{d}z' },
  { trigger: 'du', kind: 'word', role: 'diff', latex: '\\mathrm{d}u' },
  { trigger: 'dv', kind: 'word', role: 'diff', latex: '\\mathrm{d}v' },
  { trigger: 'dr', kind: 'word', role: 'diff', latex: '\\mathrm{d}r' },
  { trigger: 'ds', kind: 'word', role: 'diff', latex: '\\mathrm{d}s' },
  { trigger: 'dp', kind: 'word', role: 'diff', latex: '\\mathrm{d}p' },
  { trigger: 'dq', kind: 'word', role: 'diff', latex: '\\mathrm{d}q' },
  { trigger: 'dV', kind: 'word', role: 'diff', latex: '\\mathrm{d}V' },
  { trigger: 'dS', kind: 'word', role: 'diff', latex: '\\mathrm{d}S' },
  { trigger: 'dtheta', kind: 'word', role: 'diff', latex: '\\mathrm{d}\\theta' },
  { trigger: 'dphi', kind: 'word', role: 'diff', latex: '\\mathrm{d}\\phi' },
  { trigger: 'dtau', kind: 'word', role: 'diff', latex: '\\mathrm{d}\\tau' },
  { trigger: 'domega', kind: 'word', role: 'diff', latex: '\\mathrm{d}\\omega' },
  { trigger: 'dxi', kind: 'word', role: 'diff', latex: '\\mathrm{d}\\xi' },
];

export const DIRECT_INPUT_SHORTHANDS: Readonly<Record<string, string>> = Object.fromEntries(
  SHORTHAND_SPECS.filter((s) => s.kind === 'direct' && s.commandId).map((s) => [
    s.commandId!,
    s.trigger,
  ]),
);

export const AUTO_SHORTHANDS: readonly ShorthandRule[] = SHORTHAND_SPECS.filter(
  (s): s is ShorthandSpec & { kind: 'punct' | 'word'; commandId: string } =>
    (s.kind === 'punct' || s.kind === 'word') && Boolean(s.commandId),
).map((s) => ({ trigger: s.trigger, commandId: s.commandId, kind: s.kind }));

export const BARE_WORD_ATOMS: Readonly<Record<string, string>> = Object.fromEntries(
  SHORTHAND_SPECS.filter((s) => s.kind === 'word' && s.role === 'atom' && s.latex).map((s) => [
    s.trigger,
    s.latex!,
  ]),
);

export const BARE_WORD_BINOPS: Readonly<Record<string, string>> = Object.fromEntries(
  SHORTHAND_SPECS.filter((s) => s.kind === 'word' && s.role === 'binop' && s.latex).map((s) => [
    s.trigger,
    s.latex!,
  ]),
);

export const DIFFERENTIAL_WORDS: Readonly<Record<string, string>> = Object.fromEntries(
  SHORTHAND_SPECS.filter((s) => s.kind === 'word' && s.role === 'diff' && s.latex).map((s) => [
    s.trigger,
    s.latex!,
  ]),
);

export const SHORTHAND_BY_COMMAND_ID: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const spec of SHORTHAND_SPECS) {
    if (!spec.commandId) continue;
    const existing = map.get(spec.commandId);
    if (!existing || spec.trigger.length < existing.length) {
      map.set(spec.commandId, spec.trigger);
    }
  }
  return map;
})();

const PUNCT_RULES = AUTO_SHORTHANDS.filter((r) => r.kind === 'punct');

/**
 * Automatically derives prefix-overlapping upgrades from `PUNCT_RULES`!
 * Whenever punct rule A (`<=` -> `leq`) + 1 trailing char (`>`) matches punct rule B (`<=>` -> `iff`),
 * typing `>` right after `leq` automatically upgrades it to `iff` with zero hardcoded pairs!
 */
const SYMBOL_PREFIX_UPGRADES: Readonly<Record<string, string>> = (() => {
  const upgrades: Record<string, string> = {};
  for (const longer of PUNCT_RULES) {
    if (longer.trigger.length < 3) continue;
    const prefix = longer.trigger.slice(0, -1);
    const suffix = longer.trigger[longer.trigger.length - 1];
    const shorter = PUNCT_RULES.find((r) => r.trigger === prefix);
    if (shorter && shorter.commandId !== longer.commandId) {
      upgrades[`${shorter.commandId}:${suffix}`] = longer.commandId;
    }
  }
  return upgrades;
})();

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
 * Upgrades an already-expanded prefix symbol when its completing character is typed next
 * (auto-derived from `PUNCT_RULES`, e.g. `<=` + `>` -> `<=>`, `<-` + `>` -> `<->`).
 */
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

export interface ShorthandConflict {
  readonly trigger: string;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly conflictsWith: string;
  readonly kind: 'builtin_shorthand' | 'math_function' | 'duplicate_user';
}

const BUILTIN_TRIGGER_MAP = new Map<string, string>(
  SHORTHAND_SPECS.map((s) => [s.trigger, s.commandId ?? s.latex ?? s.trigger]),
);

/**
 * Checks custom structures and external `commands.json` entries for shorthand collisions
 * against built-in `SHORTHAND_SPECS`, standard math functions (`sin`, `lim`, ...), and each other.
 */
export function detectShorthandConflicts(
  customCommands: readonly CustomCommandDef[] = [],
  userCommands: readonly UserCommandEntry[] = [],
): ShorthandConflict[] {
  const conflicts: ShorthandConflict[] = [];
  const seenUser = new Map<string, { id: string; label: string }>();

  const checkOne = (id: string, label: string, rawTrigger: string | undefined): void => {
    const trigger = rawTrigger?.trim();
    if (!trigger) return;

    const builtinHit = BUILTIN_TRIGGER_MAP.get(trigger);
    if (builtinHit) {
      conflicts.push({
        trigger,
        sourceId: id,
        sourceLabel: label,
        conflictsWith: `内置简写 (${builtinHit})`,
        kind: 'builtin_shorthand',
      });
    } else if (MATH_FUNCTIONS.has(trigger) || Boolean(OPERATORNAME_FUNCTIONS[trigger])) {
      conflicts.push({
        trigger,
        sourceId: id,
        sourceLabel: label,
        conflictsWith: `内置数学函数 (\\${trigger})`,
        kind: 'math_function',
      });
    }

    const prev = seenUser.get(trigger);
    if (prev && prev.id !== id) {
      conflicts.push({
        trigger,
        sourceId: id,
        sourceLabel: label,
        conflictsWith: `用户命令「${prev.label}」`,
        kind: 'duplicate_user',
      });
    } else {
      seenUser.set(trigger, { id, label });
    }
  };

  for (const c of customCommands) {
    checkOne(c.id, c.label, c.shorthand);
  }
  for (const u of userCommands) {
    if (!u.disabled) {
      checkOne(u.id, u.label || u.id, u.shorthand);
    }
  }
  return conflicts;
}
