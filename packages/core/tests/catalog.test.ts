import { describe, expect, it } from 'vitest';
import {
  AUTO_SHORTHANDS,
  COMMANDS,
  COMMANDS_BY_ID,
  COMMANDS_BY_KEYS,
  DIRECT_COMMANDS,
  MathSlotEngine,
  PRESETS,
  SUBMENUS,
  commandPreviewLatex,
  getSubmenuCommands,
  importFormula,
  mergeCommands,
  mergePresets,
  parseUserCommandsJson,
  parseUserPresetsJson,
  searchCommands,
  serializeUserCommandsJson,
  serializeUserPresetsJson,
  toLatex,
} from '../src';

describe('MathSlot catalog & presets integrity', () => {
  it('contains 148 unique commands with unique ids, released u/d keys (b kept for subsup), and curated submenu defaults', () => {
    expect(COMMANDS.length).toBe(148);
    expect(COMMANDS_BY_ID.size).toBe(148);
    expect(COMMANDS_BY_KEYS.size).toBe(146);
    expect(DIRECT_COMMANDS.length).toBe(9);
    expect(COMMANDS_BY_KEYS.has('u')).toBe(false);
    expect(COMMANDS_BY_KEYS.has('d')).toBe(false);
    expect(COMMANDS_BY_KEYS.get('b')?.id).toBe('subsup');
    expect(SUBMENUS.length).toBe(7);

    // Every auto-shorthand must resolve to a real command in COMMANDS_BY_ID
    for (const rule of AUTO_SHORTHANDS) {
      expect(COMMANDS_BY_ID.has(rule.commandId), `shorthand ${rule.trigger} -> missing ${rule.commandId}`).toBe(true);
    }

    // Ensure no direct command key collides with any submenu prefix key
    const subKeys = new Set(SUBMENUS.map((s) => s.key));
    for (const cmd of DIRECT_COMMANDS) {
      expect(subKeys.has(cmd.keys[0])).toBe(false);
    }
    for (const sub of SUBMENUS) {
      expect(getSubmenuCommands(sub.key).length).toBeGreaterThan(0);
      expect(sub.defaultCommandId && COMMANDS_BY_ID.has(sub.defaultCommandId)).toBe(true);
    }
  });

  it('generates clean preview LaTeX for every command', () => {
    for (const cmd of COMMANDS) {
      const preview = commandPreviewLatex(cmd.latex);
      expect(preview.length).toBeGreaterThan(0);
      expect(preview).not.toContain('$1');
    }
  });

  it('searches commands by Chinese label, key sequence, id, and LaTeX', () => {
    expect(searchCommands('分数').some((c) => c.id === 'frac')).toBe(true);
    expect(searchCommands('gp').some((c) => c.id === 'pi')).toBe(true);
    expect(searchCommands('pmatrix').some((c) => c.id === 'matrix_2x2')).toBe(true);
  });

  it('imports all 89 presets cleanly into valid ASTs and clean canonical LaTeX', () => {
    expect(PRESETS.length).toBe(89);
    for (const preset of PRESETS) {
      const res = importFormula(preset.source);
      const errors = res.diagnostics.filter((d) => d.severity === 'error');
      expect(errors, `preset ${preset.id} had parse errors`).toEqual([]);
      const latex = toLatex(res.doc);
      expect(latex.length, `preset ${preset.id} emitted empty latex`).toBeGreaterThan(0);
      expect(latex, `preset ${preset.id} has escaped caret`).not.toContain('\\hat{}');
      expect(latex, `preset ${preset.id} has escaped underscore`).not.toContain('\\_');
      expect(latex, `preset ${preset.id} has raw oo`).not.toMatch(/(?<![a-zA-Z])oo(?![a-zA-Z])/);
      expect(latex, `preset ${preset.id} has raw <=`).not.toContain('<=');
      expect(latex, `preset ${preset.id} has raw >=`).not.toContain('>=');
      expect(latex, `preset ${preset.id} has raw +-`).not.toContain('+-');
    }
  });

  it('merges external presets.json and commands.json safely without recompile and executes new Tab chords live', () => {
    const pRaw = serializeUserPresetsJson([
      {
        id: 'user-fourier',
        category: '考研高数',
        name: '傅里叶展开',
        source: 'f(x) \\sim \\frac{a_0}{2} + \\sum_{n=1}^{\\infty} a_n \\cos nx',
      },
      { id: PRESETS[0].id, category: '', name: '', source: '', disabled: true },
    ]);
    const pParsed = parseUserPresetsJson(pRaw);
    expect(pParsed.warnings).toEqual([]);
    const mergedP = mergePresets(PRESETS, pParsed.entries);
    expect(mergedP.some((p) => p.id === 'user-fourier' && p.category === '考研高数')).toBe(true);
    expect(mergedP.some((p) => p.id === PRESETS[0].id)).toBe(false);

    const cRaw = serializeUserCommandsJson([
      {
        id: 'user-laplace',
        keys: ['c', 'z'],
        label: '拉普拉斯变换',
        category: 'calculus',
        latex: '\\mathcal{L}\\left\\{$1\\right\\}',
        slots: ['原函数'],
      },
    ]);
    const cParsed = parseUserCommandsJson(cRaw);
    expect(cParsed.warnings).toEqual([]);
    const mergedC = mergeCommands(COMMANDS, cParsed.entries);
    const engine = new MathSlotEngine();
    engine.setEffectiveCommands(mergedC);
    engine.triggerLeader();
    engine.handleLeaderKey('c');
    engine.handleLeaderKey('z');
    engine.insertText('f(t)');
    expect(engine.getSnapshot().latex).toBe('\\mathcal{L}\\left\\{f(t)\\right\\}');

    // Malformed JSON never throws
    const bad = parseUserPresetsJson('{ broken json');
    expect(bad.entries).toEqual([]);
    expect(bad.warnings.length).toBeGreaterThan(0);
  });
});
