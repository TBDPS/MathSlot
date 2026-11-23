import 'katex/dist/katex.min.css';
import '@mathslot/ui/styles.css';
import './obsidian.css';
import { Plugin, type Editor, type EditorPosition } from 'obsidian';
import type { PersistedStore } from '@mathslot/ui';
import type { DelimiterStyle } from '@mathslot/core';
import { MathSlotModal } from './MathSlotModal';

interface DetectedFormula {
  raw: string;
  delimiter: DelimiterStyle;
  from: EditorPosition;
  to: EditorPosition;
}

/**
 * Automatically detects an enclosing `$...$` (inline) or `$$...$$` (single/multi-line block)
 * formula around the Obsidian editor cursor so users can edit existing equations in-place!
 */
function detectFormulaAtCursor(editor: Editor): DetectedFormula | null {
  const cursor = editor.getCursor();
  const lineText = editor.getLine(cursor.line);

  // 1. Check inline `$...$` or single-line `$$...$$` on the current line
  const regex = /(\$\$[\s\S]*?\$\$|\$(?!\$)(?:\\\$|[^$\n])+\$)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(lineText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (cursor.ch >= start && cursor.ch <= end) {
      const isBlock = match[0].startsWith('$$');
      return {
        raw: match[0],
        delimiter: isBlock ? 'block' : 'inline',
        from: { line: cursor.line, ch: start },
        to: { line: cursor.line, ch: end },
      };
    }
  }

  // 2. Check multi-line `$$ ... $$` block surrounding cursor.line using exact fence parity!
  const totalLines = editor.lineCount();
  let insideBlock = false;
  let openLine = -1;
  for (let l = 0; l <= cursor.line; l += 1) {
    const trimmed = editor.getLine(l).trim();
    const isSingleLineBlock = trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length >= 4;
    if (isSingleLineBlock) continue;
    if (trimmed === '$$' || trimmed.startsWith('$$') || trimmed.endsWith('$$')) {
      if (!insideBlock) {
        insideBlock = true;
        openLine = l;
      } else {
        if (l === cursor.line) {
          // Cursor is right on the closing `$$` fence of an open block
          const lines: string[] = [];
          for (let k = openLine; k <= l; k += 1) lines.push(editor.getLine(k));
          return {
            raw: lines.join('\n'),
            delimiter: 'block',
            from: { line: openLine, ch: 0 },
            to: { line: l, ch: editor.getLine(l).length },
          };
        }
        insideBlock = false;
        openLine = -1;
      }
    }
  }
  if (insideBlock && openLine >= 0) {
    const maxLine = Math.min(totalLines - 1, cursor.line + 40);
    let closeLine = -1;
    for (let l = openLine + 1; l <= maxLine; l += 1) {
      const trimmed = editor.getLine(l).trim();
      if (trimmed === '$$' || trimmed.endsWith('$$')) {
        closeLine = l;
        break;
      }
    }
    if (closeLine > openLine && cursor.line >= openLine && cursor.line <= closeLine) {
      const lines: string[] = [];
      for (let l = openLine; l <= closeLine; l += 1) {
        lines.push(editor.getLine(l));
      }
      return {
        raw: lines.join('\n'),
        delimiter: 'block',
        from: { line: openLine, ch: 0 },
        to: { line: closeLine, ch: editor.getLine(closeLine).length },
      };
    }
  }

  return null;
}

export default class MathSlotPlugin extends Plugin {
  async onload(): Promise<void> {
    this.addRibbonIcon('sigma', 'MathSlot 公式编辑器', () => {
      const editor = this.app.workspace.activeEditor?.editor;
      this.openEditor(editor);
    });

    this.addCommand({
      id: 'open-mathslot-editor',
      name: '打开公式编辑器（自动识别光标处公式）',
      editorCallback: (editor: Editor) => {
        this.openEditor(editor);
      },
    });

    this.addCommand({
      id: 'open-mathslot-block',
      name: '插入块级公式 ($$...$$)',
      editorCallback: (editor: Editor) => {
        this.openEditor(editor, 'block');
      },
    });
  }

  private openEditor(editor?: Editor, forceDelimiter?: DelimiterStyle): void {
    const selected = editor?.getSelection()?.trim() ?? '';
    const detected = !selected && editor ? detectFormulaAtCursor(editor) : null;

    const modal = new MathSlotModal(this.app, {
      editor,
      initialFormula: selected || detected?.raw || undefined,
      replaceRange: detected ? { from: detected.from, to: detected.to } : undefined,
      forceDelimiter: forceDelimiter ?? detected?.delimiter,
      loadStore: async () => {
        const data = (await this.loadData()) as Partial<PersistedStore> | null;
        return {
          settings: data?.settings ?? {},
          snippets: Array.isArray(data?.snippets) ? data.snippets : [],
          customCommands: Array.isArray(data?.customCommands) ? data.customCommands : [],
          history: Array.isArray(data?.history) ? data.history : [],
          userPresets: Array.isArray(data?.userPresets) ? data.userPresets : [],
          userCommands: Array.isArray(data?.userCommands) ? data.userCommands : [],
        };
      },
      saveStore: async (store: PersistedStore) => {
        await this.saveData(store);
      },
    });
    modal.open();
  }
}
