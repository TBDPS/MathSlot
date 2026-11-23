import { describe, expect, it } from 'vitest';
import {
  AUTO_SHORTHANDS,
  COMMANDS,
  COMMANDS_BY_ID,
  COMMANDS_BY_KEYS,
  DIRECT_COMMANDS,
  PRESETS,
  SUBMENUS,
  commandPreviewLatex,
  getSubmenuCommands,
  importFormula,
  searchCommands,
  toLatex,
} from '../src';

describe('MathSlot catalog & presets integrity', () => {
  it('contains 126 unique commands with unique ids and key chords', () => {
    expect(COMMANDS.length).toBe(126);
    expect(COMMANDS_BY_ID.size).toBe(126);
    expect(COMMANDS_BY_KEYS.size).toBe(126);
    expect(DIRECT_COMMANDS.length).toBe(12);
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

  it('imports all 88 presets cleanly into valid ASTs and clean canonical LaTeX', () => {
    expect(PRESETS.length).toBe(88);
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
});
