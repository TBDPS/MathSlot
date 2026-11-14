import { invoke } from '@tauri-apps/api/core';
import {
  COMMANDS,
  COMMANDS_BY_ID,
  createDefaultAppSettings,
  formatLatexWithDelimiter,
  type AppEvent,
  type AppSettings,
  type CommandEntry,
  type DiagnosticSnapshot,
  type DispatchResponse,
  type Effect,
  type EngineClient,
  type EngineSnapshot,
  type LatexRustInvokeResult,
  type PreviewRenderRequest,
  type RecoveryStateSnapshot,
  type SlotSnapshot,
} from '@mathslot/ui';

export interface PresetDto {
  id: string;
  legacy_id: string;
  name: string;
  category: string;
  source: string;
  desc: string;
  tags: string[];
}

export interface FormulaEntryDto {
  id: string;
  name: string;
  category: string;
  source: string;
  desc: string;
  tags: string[];
  is_builtin: boolean;
  created_at: number;
}

export interface DesktopHostBridge extends EngineClient {
  isTauri(): boolean;
  renderLatexSvg(req: PreviewRenderRequest): Promise<LatexRustInvokeResult>;
  restoreBackup(backupPath: string | null): Promise<EngineSnapshot>;
  resetEmptyConfig(): Promise<EngineSnapshot>;
  exportConfigJson(): Promise<string>;
  importConfigJson(rawJson: string): Promise<EngineSnapshot>;
  copyToClipboard(text: string): Promise<void>;
  getUserFormulas(): Promise<FormulaEntryDto[]>;
  saveUserFormula(name: string, category: string, source: string, desc: string): Promise<FormulaEntryDto>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __MATHSLOT_DESKTOP_BRIDGE__?: Partial<DesktopHostBridge>;
  }
}

export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined';
}

function createTauriHostBridge(): DesktopHostBridge {
  return {
    isTauri: () => true,
    dispatch: (event: AppEvent) => invoke<DispatchResponse>('dispatch_event', { event }),
    snapshot: () => invoke<EngineSnapshot>('get_snapshot'),
    engineVersion: () => invoke<string>('engine_version'),
    renderLatexSvg: (req: PreviewRenderRequest) =>
      invoke<LatexRustInvokeResult>('render_latex_svg', {
        req: {
          generation: req.generation,
          latex: req.latex,
          previewLatex: req.previewLatex ?? null,
          theme: req.theme,
          scale: req.scale ?? 1.0,
          mode: req.mode ?? 'preview',
        },
      }),
    restoreBackup: (backupPath: string | null) =>
      invoke<EngineSnapshot>('restore_backup', { backupPath }),
    resetEmptyConfig: () => invoke<EngineSnapshot>('reset_empty_config'),
    exportConfigJson: () => invoke<string>('export_config_json'),
    importConfigJson: (rawJson: string) =>
      invoke<EngineSnapshot>('import_config_json', { rawJson }),
    copyToClipboard: (text: string) => invoke<void>('copy_to_clipboard', { text }),
    getUserFormulas: () => invoke<FormulaEntryDto[]>('get_user_formulas'),
    saveUserFormula: (name: string, category: string, source: string, desc: string) =>
      invoke<FormulaEntryDto>('save_user_formula', { name, category, source, desc }),
  };
}

interface HarnessHistoryFrame {
  source: string;
  latex: string;
  cursorChar: number;
}

function findCommandsByPrefix(prefix: string): CommandEntry[] {
  return COMMANDS.filter((cmd) => cmd.keys.join('').startsWith(prefix));
}

function findExactCommand(keySeq: string): CommandEntry | undefined {
  return COMMANDS.find((cmd) => cmd.keys.join('') === keySeq);
}

function parseSlotsFromLatex(latex: string, activeSlotId: number | null): SlotSnapshot[] {
  const matrixMatch = /\\begin\{(?:p|b|v|V)?matrix\}([\s\S]*?)\\end\{(?:p|b|v|V)?matrix\}/.exec(
    latex,
  );
  if (matrixMatch) {
    const body = matrixMatch[1] ?? '';
    const bodyStart = (matrixMatch.index ?? 0) + matrixMatch[0].indexOf(body);
    const rows = body.split('\\\\');
    const slots: SlotSnapshot[] = [];
    let runningOffset = bodyStart;
    let nextId = 1;
    for (let r = 0; r < rows.length; r++) {
      const rowText = rows[r] ?? '';
      const cols = rowText.split('&');
      let colOffset = runningOffset;
      for (let c = 0; c < cols.length; c++) {
        const cell = cols[c] ?? '';
        const trimmed = cell.trim();
        const cellStart = colOffset;
        const cellEnd = colOffset + cell.length;
        slots.push({
          id: nextId,
          role: `矩阵(${r + 1},${c + 1})`,
          label: `第 ${r + 1} 行 第 ${c + 1} 列`,
          is_empty: trimmed.length === 0,
          is_active: activeSlotId === nextId || (activeSlotId === null && nextId === 1),
          span: { start: cellStart, end: cellEnd },
          path: [r, c],
          depth: 2,
        });
        nextId += 1;
        colOffset += cell.length + 1;
      }
      runningOffset += rowText.length + 2;
    }
    return slots;
  }

  const slots: SlotSnapshot[] = [];
  let slotId = 1;
  for (let i = 0; i < latex.length; i++) {
    if (latex[i] === '{') {
      let depth = 1;
      let j = i + 1;
      while (j < latex.length && depth > 0) {
        if (latex[j] === '{') depth += 1;
        else if (latex[j] === '}') depth -= 1;
        j += 1;
      }
      if (depth === 0) {
        const inner = latex.slice(i + 1, j - 1);
        slots.push({
          id: slotId,
          role: `Slot ${slotId}`,
          label: `槽位 ${slotId}`,
          is_empty: inner.trim().length === 0,
          is_active: activeSlotId === slotId || (activeSlotId === null && slotId === 1),
          span: { start: i + 1, end: j - 1 },
          path: [0, slotId - 1],
          depth: 1,
        });
        slotId += 1;
      }
    }
  }
  return slots;
}

function expandTemplate(template: string, params: string[]): string {
  return template.replace(/\$(\d+)/g, (_m, idxStr: string) => {
    const idx = Number.parseInt(idxStr, 10) - 1;
    return params[idx] ?? '';
  });
}

function expandStreamSourceSimple(input: string): { latex: string; errors: string[] } {
  let out = '';
  const errors: string[] = [];
  let i = 0;

  while (i < input.length) {
    if (input[i] !== '▸') {
      out += input[i];
      i += 1;
      continue;
    }
    i += 1;
    let matched: CommandEntry | undefined;
    for (let len = 3; len >= 1; len--) {
      const candidateKey = input.slice(i, i + len);
      const found = findExactCommand(candidateKey);
      if (found) {
        matched = found;
        i += len;
        break;
      }
    }
    if (!matched) {
      errors.push(`未知命令前缀 ▸${input.slice(i, i + 2)}`);
      break;
    }
    const params: string[] = [];
    for (let s = 0; s < matched.slots.length; s++) {
      let arg = '';
      while (i < input.length && input[i] !== ';') {
        if (input[i] === '▸') {
          const rest = expandStreamSourceSimple(input.slice(i));
          arg += rest.latex;
          errors.push(...rest.errors);
          i = input.length;
          break;
        }
        arg += input[i];
        i += 1;
      }
      if (i < input.length && input[i] === ';') {
        i += 1;
      }
      params.push(arg);
    }
    out += expandTemplate(matched.latex, params);
  }
  return { latex: out, errors };
}

function checkBalancedLatex(latex: string): DiagnosticSnapshot | null {
  let braceDepth = 0;
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '{') braceDepth += 1;
    else if (ch === '}') {
      braceDepth -= 1;
      if (braceDepth < 0) {
        return {
          code: 'UNMATCHED_CLOSE_BRACE',
          severity: 'Error',
          message: '检测到多余的右花括号 }',
          summary: '[UNMATCHED_CLOSE_BRACE] 检测到多余的右花括号 }',
          source_excerpt: latex.slice(0, 200),
          truncated: latex.length > 200,
          detail: `在位置 ${i + 1} 发现未匹配的 }`,
          hint: '请补全或删除多余的花括号',
          span: { start: i, end: i + 1 },
        };
      }
    }
  }
  if (braceDepth > 0) {
    return {
      code: 'UNCLOSED_BRACE',
      severity: 'Error',
      message: `存在 ${braceDepth} 个未闭合的花括号 {`,
      summary: `[UNCLOSED_BRACE] 存在 ${braceDepth} 个未闭合的花括号 {`,
      source_excerpt: latex.slice(0, 200),
      truncated: latex.length > 200,
      detail: `源码末尾仍有 ${braceDepth} 个未闭合的 {`,
      hint: '请补全缺失的 } 后再导入',
      span: { start: Math.max(0, latex.length - 1), end: latex.length },
    };
  }
  return null;
}

export function createBrowserHarnessBridge(): DesktopHostBridge {
  let source = '';
  let latex = '';
  let cursorChar = 0;
  let isNavMode = false;
  let activeSlotId: number | null = null;
  let settings: AppSettings = createDefaultAppSettings();
  settings.config_path = '~/.config/mathslot/library.json';
  let recovery: RecoveryStateSnapshot | null = null;
  let lastImport: EngineSnapshot['last_import'] = null;
  let renderSeq = 0;
  let pendingState:
    | { mode: 'root'; prefix: string }
    | { mode: 'sub'; prefix: string }
    | { mode: 'params'; cmd: CommandEntry; params: string[]; current: string; origin: HarnessHistoryFrame }
    | null = null;

  const undoStack: HarnessHistoryFrame[] = [];
  const redoStack: HarnessHistoryFrame[] = [];
  const userFormulas: FormulaEntryDto[] = [];
  const copiedTexts: string[] = [];

  function computeLatexAndPreview(): { canonical: string; preview: string; diags: DiagnosticSnapshot[] } {
    const diags: DiagnosticSnapshot[] = [];
    if (pendingState) {
      const pendingText =
        pendingState.mode === 'params'
          ? `▸${pendingState.cmd.keys[0] ?? pendingState.cmd.id}${pendingState.params.join(';')}${pendingState.params.length > 0 ? ';' : ''}${pendingState.current}`
          : `▸${pendingState.prefix}`;
      diags.push({
        code: 'PENDING_COMMAND',
        severity: 'Warning',
        message: `流式命令尚未完成: ${pendingText}`,
        summary: `[PENDING_COMMAND] 流式命令尚未完成: ${pendingText}`,
        source_excerpt: pendingText,
        truncated: false,
        detail: `请继续输入命令键或使用分号 ; 结束参数`,
        hint: '按 ; 推进槽位或按 Backspace 取消前缀',
      });
    }
    const canonical = latex.trim().length > 0 ? latex : source;
    const preview = canonical.replace(/\{\}/g, '{\\square}');
    return { canonical, preview, diags };
  }

  function buildSnapshot(): EngineSnapshot {
    const { canonical, preview, diags } = computeLatexAndPreview();
    const slots = parseSlotsFromLatex(canonical, activeSlotId);
    if (slots.length > 0 && activeSlotId === null) {
      activeSlotId = slots[0]?.id ?? null;
    } else if (slots.length === 0) {
      activeSlotId = null;
    }

    let state: EngineSnapshot['state'] = 'Idle';
    if (isNavMode) {
      const slot = slots.find((s) => s.id === activeSlotId);
      const path = slot?.path ? slot.path.map(String) : ['root'];
      state = { Nav: { path } };
    } else if (pendingState) {
      if (pendingState.mode === 'root') {
        state = 'PrefixRoot';
      } else if (pendingState.mode === 'sub') {
        state = { PrefixSub: { key: pendingState.prefix } };
      } else {
        state = { PrefixSub: { key: pendingState.cmd.keys[0] ?? pendingState.cmd.id } };
      }
    }

    return {
      state,
      latex: canonical,
      preview_latex: preview,
      copy_text: formatLatexWithDelimiter(canonical, settings.delimiter_style),
      source,
      cursor_char: cursorChar,
      has_pending_command: pendingState !== null,
      is_composing: false,
      is_nav_mode: isNavMode,
      can_undo: undoStack.length > 0,
      can_redo: redoStack.length > 0,
      slots,
      diagnostics: diags,
      active_slot_id: activeSlotId,
      settings: structuredClone(settings),
      recovery: recovery ? structuredClone(recovery) : null,
      last_import: lastImport ? structuredClone(lastImport) : null,
    };
  }

  function pushUndo(frame?: HarnessHistoryFrame): void {
    undoStack.push(frame ?? { source, latex, cursorChar });
    redoStack.length = 0;
  }

  function insertAtCursor(str: string): void {
    source = source.slice(0, cursorChar) + str + source.slice(cursorChar);
    cursorChar += str.length;
    if (!source.includes('\n') && pendingState === null) {
      latex = source;
    } else if (pendingState === null) {
      latex = source.replace(/\n+/g, ' ');
    }
  }

  async function dispatch(event: AppEvent): Promise<DispatchResponse> {
    const effects: Effect[] = [];

    if (typeof event === 'string') {
      switch (event) {
        case 'Undo': {
          const prev = undoStack.pop();
          if (prev) {
            redoStack.push({ source, latex, cursorChar });
            source = prev.source;
            latex = prev.latex;
            cursorChar = prev.cursorChar;
            pendingState = null;
          }
          break;
        }
        case 'Redo': {
          const next = redoStack.pop();
          if (next) {
            undoStack.push({ source, latex, cursorChar });
            source = next.source;
            latex = next.latex;
            cursorChar = next.cursorChar;
            pendingState = null;
          }
          break;
        }
        case 'Clear': {
          if (source.length > 0 || latex.length > 0) {
            pushUndo();
          }
          source = '';
          latex = '';
          cursorChar = 0;
          pendingState = null;
          activeSlotId = null;
          lastImport = null;
          break;
        }
        case 'EnterNavMode': {
          isNavMode = true;
          break;
        }
        case 'ExitNavMode': {
          isNavMode = false;
          break;
        }
        case 'RequestCopy': {
          const snap = buildSnapshot();
          copiedTexts.push(snap.copy_text);
          effects.push({ Clipboard: snap.copy_text });
          effects.push({ Status: { severity: 'Info', message: '已复制到剪贴板' } });
          break;
        }
        case 'ImportAcknowledge': {
          lastImport = null;
          break;
        }
        case 'ResetSettingsConfirmed': {
          const preservedPath = settings.config_path ?? null;
          settings = { ...createDefaultAppSettings(), config_path: preservedPath };
          effects.push({ Status: { severity: 'Info', message: '已恢复默认设置' } });
          break;
        }
        case 'RequestRestoreBackup': {
          recovery = null;
          effects.push({ Status: { severity: 'Info', message: '已从备份恢复配置' } });
          break;
        }
        case 'ConfirmResetEmptyConfig': {
          const preservedPath = settings.config_path ?? null;
          recovery = null;
          settings = { ...createDefaultAppSettings(), config_path: preservedPath };
          effects.push({ Status: { severity: 'Info', message: '已确认重置为空配置' } });
          break;
        }
        case 'RequestSaveSnippet': {
          const snippetSrc = source.trim().length > 0 ? source : latex;
          if (snippetSrc.trim().length > 0) {
            const entry: FormulaEntryDto = {
              id: `snippet-${Date.now()}`,
              name: `片段 ${snippetSrc.slice(0, 18)}`,
              category: '自定义',
              source: snippetSrc,
              desc: '从编辑器保存',
              tags: ['snippet'],
              is_builtin: false,
              created_at: Math.floor(Date.now() / 1000),
            };
            userFormulas.push(entry);
            effects.push({ Host: { SaveSnippet: { source, latex } } });
            effects.push({ Status: { severity: 'Info', message: '已保存为自定义片段' } });
          }
          break;
        }
        default:
          break;
      }
    } else if ('KeyInput' in event) {
      const ch = event.KeyInput;
      if (isNavMode) {
        const snapSlots = buildSnapshot().slots;
        if (snapSlots.length > 0) {
          const idx = Math.max(
            0,
            snapSlots.findIndex((s) => s.id === activeSlotId),
          );
          if (ch === 'j' || ch === 'n') {
            activeSlotId = snapSlots[(idx + 1) % snapSlots.length]?.id ?? null;
          } else if (ch === 'k' || ch === 'p') {
            activeSlotId = snapSlots[(idx - 1 + snapSlots.length) % snapSlots.length]?.id ?? null;
          }
        }
      } else if (pendingState === null && ch === '▸') {
        const origin = { source, latex, cursorChar };
        pendingState = { mode: 'root', prefix: '' };
        insertAtCursor('▸');
        void origin;
      } else if (pendingState && (pendingState.mode === 'root' || pendingState.mode === 'sub')) {
        const originBeforePending = {
          source: source.slice(0, Math.max(0, cursorChar - pendingState.prefix.length - 1)),
          latex,
          cursorChar: Math.max(0, cursorChar - pendingState.prefix.length - 1),
        };
        const nextPrefix = pendingState.prefix + ch;
        insertAtCursor(ch);
        const exact = findExactCommand(nextPrefix);
        const prefixMatches = findCommandsByPrefix(nextPrefix);
        if (exact && (prefixMatches.length <= 1 || exact.slots.length > 0)) {
          if (exact.slots.length === 0) {
            pushUndo(originBeforePending);
            const resolved = exact.latex;
            const prefixStart = Math.max(0, cursorChar - (nextPrefix.length + 1));
            source = source.slice(0, prefixStart) + resolved + source.slice(cursorChar);
            cursorChar = prefixStart + resolved.length;
            latex = source.includes('\n') ? source.replace(/\n+/g, ' ') : source;
            pendingState = null;
          } else {
            pendingState = {
              mode: 'params',
              cmd: exact,
              params: [],
              current: '',
              origin: originBeforePending,
            };
          }
        } else if (prefixMatches.length > 0) {
          pendingState = { mode: 'sub', prefix: nextPrefix };
        } else {
          pendingState = null;
        }
      } else if (pendingState && pendingState.mode === 'params') {
        insertAtCursor(ch);
        if (ch === ';') {
          pendingState.params.push(pendingState.current);
          pendingState.current = '';
          if (pendingState.params.length >= pendingState.cmd.slots.length) {
            pushUndo(pendingState.origin);
            const resolved = expandTemplate(pendingState.cmd.latex, pendingState.params);
            const rawLen =
              1 +
              pendingState.cmd.keys.join('').length +
              pendingState.params.join(';').length +
              1;
            const startIdx = Math.max(0, cursorChar - rawLen);
            source = source.slice(0, startIdx) + resolved + source.slice(cursorChar);
            cursorChar = startIdx + resolved.length;
            latex = source.includes('\n') ? source.replace(/\n+/g, ' ') : source;
            pendingState = null;
          }
        } else {
          pendingState.current += ch;
        }
      } else {
        pushUndo();
        const firstEmpty = latex.indexOf('{}');
        if (!source.includes('\n') && firstEmpty >= 0 && cursorChar === firstEmpty + 1) {
          source = source.slice(0, cursorChar) + ch + source.slice(cursorChar);
          cursorChar += 1;
          latex = source;
        } else {
          insertAtCursor(ch);
        }
      }
    } else if ('KeyDown' in event) {
      const key = event.KeyDown;
      if (key === 'Enter' && !isNavMode) {
        pushUndo();
        insertAtCursor('\n');
      } else if (key === 'Backspace' && cursorChar > 0) {
        pushUndo();
        const removed = source[cursorChar - 1];
        source = source.slice(0, cursorChar - 1) + source.slice(cursorChar);
        cursorChar -= 1;
        if (removed === '▸') {
          pendingState = null;
        }
        latex = source.includes('\n') ? source.replace(/\n+/g, ' ') : source;
      } else if (key === 'Delete' && cursorChar < source.length) {
        pushUndo();
        source = source.slice(0, cursorChar) + source.slice(cursorChar + 1);
        latex = source.includes('\n') ? source.replace(/\n+/g, ' ') : source;
      } else if (key === 'ArrowLeft' && cursorChar > 0) {
        cursorChar -= 1;
      } else if (key === 'ArrowRight' && cursorChar < source.length) {
        cursorChar += 1;
      }
    } else if ('Paste' in event || 'PasteText' in event) {
      const text = 'Paste' in event ? event.Paste : event.PasteText;
      pushUndo();
      pendingState = null;
      insertAtCursor(text);
    } else if ('ApplyCard' in event || 'PaletteCard' in event) {
      const cmdId = 'ApplyCard' in event ? event.ApplyCard : event.PaletteCard;
      const cmd = COMMANDS_BY_ID[cmdId];
      if (cmd) {
        pushUndo();
        pendingState = null;
        const expanded = expandTemplate(cmd.latex, new Array(cmd.slots.length).fill(''));
        const firstSlotIdx = expanded.indexOf('{}');
        const insertStart = cursorChar;
        insertAtCursor(expanded);
        if (firstSlotIdx >= 0) {
          cursorChar = insertStart + firstSlotIdx + 1;
        }
        const slots = parseSlotsFromLatex(latex || source, null);
        activeSlotId = slots[0]?.id ?? null;
      }
    } else if ('LoadStreamSource' in event) {
      pushUndo();
      pendingState = null;
      const { latex: expanded } = expandStreamSourceSimple(event.LoadStreamSource);
      source = expanded;
      latex = expanded;
      cursorChar = expanded.length;
      const slots = parseSlotsFromLatex(expanded, null);
      activeSlotId = slots[0]?.id ?? null;
    } else if ('ImportLatex' in event) {
      const errDiag = checkBalancedLatex(event.ImportLatex);
      if (errDiag) {
        lastImport = {
          lossless: false,
          empty_slots: 0,
          raw_nodes: 0,
          roundtrip_latex: latex,
          normalized_match: false,
          blocked: true,
          diagnostics: [errDiag],
        };
        effects.push({ Status: { severity: 'Error', message: errDiag.summary ?? errDiag.message } });
      } else {
        pushUndo();
        pendingState = null;
        source = event.ImportLatex;
        latex = event.ImportLatex;
        cursorChar = event.ImportLatex.length;
        const slots = parseSlotsFromLatex(event.ImportLatex, null);
        activeSlotId = slots[0]?.id ?? null;
        const emptyCount = slots.filter((s) => s.is_empty).length;
        lastImport = {
          lossless: true,
          empty_slots: emptyCount,
          raw_nodes: 0,
          roundtrip_latex: event.ImportLatex,
          normalized_match: true,
          blocked: false,
          diagnostics: [],
        };
        effects.push({ Status: { severity: 'Info', message: 'LaTeX 已无损导入' } });
      }
    } else if ('SelectSlot' in event) {
      activeSlotId = event.SelectSlot;
      const slots = parseSlotsFromLatex(latex || source, activeSlotId);
      const target = slots.find((s) => s.id === activeSlotId);
      if (target) {
        cursorChar = target.span.start;
      }
    } else if ('Navigate' in event) {
      if (event.Navigate === 'EnterNav') {
        isNavMode = true;
      } else if (event.Navigate === 'ExitNav') {
        isNavMode = false;
      } else {
        const slots = parseSlotsFromLatex(latex || source, activeSlotId);
        if (slots.length > 0) {
          const idx = Math.max(
            0,
            slots.findIndex((s) => s.id === activeSlotId),
          );
          if (event.Navigate === 'NextSlot' || event.Navigate === 'StepRight') {
            activeSlotId = slots[(idx + 1) % slots.length]?.id ?? null;
          } else {
            activeSlotId = slots[(idx - 1 + slots.length) % slots.length]?.id ?? null;
          }
          const sel = slots.find((s) => s.id === activeSlotId);
          if (sel) cursorChar = sel.span.start;
        }
      }
    } else if ('UpdateSettings' in event) {
      settings = structuredClone(event.UpdateSettings);
      effects.push({ Status: { severity: 'Info', message: '设置已保存' } });
    } else if ('SetRecoveryState' in event) {
      recovery = event.SetRecoveryState ? structuredClone(event.SetRecoveryState) : null;
    } else if ('RequestExport' in event) {
      const snap = buildSnapshot();
      if (event.RequestExport.strict && snap.diagnostics.length > 0) {
        effects.push({
          ExportResult: {
            Err: {
              StrictExportBlocked: [
                { PendingCommand: { prefix: '▸', message: snap.diagnostics[0]?.message ?? '存在未完成命令' } },
              ],
            },
          },
        });
      } else {
        effects.push({ ExportResult: { Ok: [snap.copy_text, []] } });
      }
    }

    renderSeq += 1;
    const snap = buildSnapshot();
    effects.push({
      Render: {
        request_id: renderSeq,
        generation: renderSeq,
        latex: snap.latex,
        preview_latex: snap.preview_latex,
        has_diagnostics: snap.diagnostics.length > 0,
      },
    });

    return { effects, snapshot: snap };
  }

  return {
    isTauri: () => false,
    dispatch,
    snapshot: async () => buildSnapshot(),
    engineVersion: async () => '0.7.0',
    renderLatexSvg: async (req: PreviewRenderRequest): Promise<LatexRustInvokeResult> => {
      const tex = (req.previewLatex && req.previewLatex.trim().length > 0 ? req.previewLatex : req.latex).trim();
      if (!tex) {
        return { svg: '', degraded: false, diagnostics: [] };
      }
      if (tex.includes('\\unknownFallbackTest')) {
        return {
          svg: '',
          degraded: true,
          diagnostics: [
            {
              code: 'LATEX_RUST_ERROR',
              severity: 'Error',
              summary: '[LATEX_RUST_ERROR] 离线 LaTeX-Rust 不支持测试宏，已自动降级',
              message: '离线 LaTeX-Rust 不支持测试宏',
              sourceExcerpt: tex.slice(0, 200),
              truncated: tex.length > 200,
              detail: `源码:\n${tex}`,
              hint: '已切换至离线兜底预览或 MathJax',
            },
          ],
        };
      }
      const escaped = tex.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      return {
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 48" role="img" aria-label="LaTeX-Rust Preview"><text x="8" y="30" fill="currentColor" font-family="serif" font-size="18">${escaped}</text></svg>`,
        degraded: false,
        diagnostics: [],
      };
    },
    restoreBackup: async () => {
      recovery = null;
      return buildSnapshot();
    },
    resetEmptyConfig: async () => {
      const preservedPath = settings.config_path ?? null;
      recovery = null;
      settings = { ...createDefaultAppSettings(), config_path: preservedPath };
      return buildSnapshot();
    },
    exportConfigJson: async () =>
      JSON.stringify(
        {
          schema_version: 3,
          custom_formats: [],
          snippets: [],
          user_formulas: userFormulas,
          overrides: [],
          settings,
        },
        null,
        2,
      ),
    importConfigJson: async (rawJson: string) => {
      const parsed = JSON.parse(rawJson) as {
        schema_version?: number;
        user_formulas?: Array<{ is_builtin?: boolean }>;
        settings?: Partial<AppSettings>;
      };
      if (parsed.schema_version !== 3) {
        throw new Error(`不支持的 schema_version: ${String(parsed.schema_version)}`);
      }
      if (parsed.user_formulas?.some((f) => f.is_builtin === true)) {
        throw new Error('禁止导入内置公式 (is_builtin: true)');
      }
      if (parsed.settings) {
        settings = { ...settings, ...parsed.settings };
      }
      recovery = null;
      return buildSnapshot();
    },
    copyToClipboard: async (text: string) => {
      copiedTexts.push(text);
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // Headless contexts may restrict navigator.clipboard; copiedTexts still tracks it
        }
      }
    },
    getUserFormulas: async () => [...userFormulas],
    saveUserFormula: async (name: string, category: string, formulaSource: string, desc: string) => {
      const entry: FormulaEntryDto = {
        id: `uf-${Date.now()}`,
        name,
        category,
        source: formulaSource,
        desc,
        tags: ['custom'],
        is_builtin: false,
        created_at: Math.floor(Date.now() / 1000),
      };
      userFormulas.push(entry);
      return entry;
    },
  };
}

export function createDesktopHostBridge(): DesktopHostBridge {
  const base = isTauriEnvironment() ? createTauriHostBridge() : createBrowserHarnessBridge();
  if (typeof window !== 'undefined' && window.__MATHSLOT_DESKTOP_BRIDGE__) {
    return {
      ...base,
      ...window.__MATHSLOT_DESKTOP_BRIDGE__,
    };
  }
  return base;
}
