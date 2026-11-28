<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import {
    COMMANDS,
    DEFAULT_SETTINGS,
    MathSlotEngine,
    PRESETS,
    formatExport,
    formatFormulaWithWrapper,
    mergeCommands,
    mergePresets,
    normalizeSettings,
    parseUserCommandsJson,
    parseUserPresetsJson,
    serializeUserCommandsJson,
    serializeUserPresetsJson,
    type AppSettings,
    type CommandDef,
    type CustomCommandDef,
    type DelimiterStyle,
    type EditorSnapshot,
    type HistoryFormula,
    type MathWrapperKind,
    type PersistedDraftV1,
    type PresetFormula,
    type Snippet,
    type TreePoint,
    type UserCommandEntry,
    type UserPresetEntry,
  } from '@mathslot/core';
  import type { HostAdapter } from '../host';
  import { latexToMathML, renderLatexToPng, renderLatexToSvg } from '../exportUtils';
  import VisualCanvas from './VisualCanvas.svelte';
  import MathRibbon from './MathRibbon.svelte';
  import CommandDrawer from './CommandDrawer.svelte';
  import LatexDock from './LatexDock.svelte';
  import ImportModal from './ImportModal.svelte';
  import SaveSnippetModal from './SaveSnippetModal.svelte';
  import CustomStructureModal from './CustomStructureModal.svelte';
  import PresetEditorModal from './PresetEditorModal.svelte';
  import CommandEditorModal from './CommandEditorModal.svelte';
  import SettingsModal from './SettingsModal.svelte';
  import HelpModal from './HelpModal.svelte';
  import ExportModal from './ExportModal.svelte';

  interface Props {
    host: HostAdapter;
  }

  let { host }: Props = $props();

  const engine = new MathSlotEngine();

  let settings = $state<AppSettings>({ ...DEFAULT_SETTINGS });
  let snippets = $state<Snippet[]>([]);
  let customCommands = $state<CustomCommandDef[]>([]);
  let userPresets = $state<UserPresetEntry[]>([]);
  let userCommands = $state<UserCommandEntry[]>([]);
  let favoriteIds = $state<string[]>([]);
  let recentIds = $state<string[]>([]);
  let lastDraftLatex = $state('');
  let lastDraftV1 = $state<PersistedDraftV1 | null>(null);
  let configDir = $state('');
  let topbarEl = $state<HTMLElement | null>(null);
  let history = $state<HistoryFormula[]>([]);
  let pinned = $state(false);
  let snapshot = $state<EditorSnapshot>(engine.getSnapshot());
  let systemDark = $state(false);
  let sessionDelimiter = $state<DelimiterStyle | null>(
    untrack(() => host.initialDelimiter ?? null),
  );
  let sessionWrapper = $state<MathWrapperKind | null>(
    untrack(() => host.initialWrapper ?? null),
  );
  let persistChain: Promise<void> = Promise.resolve();
  let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let storeHydrated = false;

  const effectiveDelimiter = $derived<DelimiterStyle>(sessionDelimiter ?? settings.delimiter);

  const effectivePresets = $derived(mergePresets(PRESETS, userPresets));
  const effectiveCommands = $derived(mergeCommands(COMMANDS, userCommands));
  const presetCategories = $derived(Array.from(new Set(effectivePresets.map((p) => p.category))));

  $effect(() => {
    engine.setEffectiveCommands(effectiveCommands);
  });

  let drawerOpen = $state(false);
  let drawerTab = $state<'all' | 'commands' | 'presets' | 'snippets' | 'custom' | 'history'>('all');
  let importOpen = $state(false);
  let exportOpen = $state(false);
  let saveSnippetOpen = $state(false);
  let customModalOpen = $state(false);
  let editingCustom = $state<CustomCommandDef | null>(null);
  let presetModalOpen = $state(false);
  let editingPreset = $state<PresetFormula | null>(null);
  let commandModalOpen = $state(false);
  let editingCommand = $state<CommandDef | null>(null);
  let settingsOpen = $state(false);
  let helpOpen = $state(false);
  let moreMenuOpen = $state(false);
  let moreMenuWrapEl: HTMLDivElement | null = $state(null);
  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  let canvasRef = $state<{ focus: () => void } | null>(null);

  let hostDark = $state(false);

  const resolvedTheme = $derived<'light' | 'dark'>(
    settings.theme === 'system'
      ? (host.hostDarkMode ? hostDark : systemDark)
        ? 'dark'
        : 'light'
      : settings.theme,
  );

  function sync(): void {
    snapshot = engine.getSnapshot();
  }

  function scheduleDraftSave(nextLatex: string): void {
    if (!storeHydrated || host.compactToolbar || host.initialFormula) return;
    const nextDraft = nextLatex.trim() ? engine.exportDraftV1(sessionWrapper ?? undefined) : null;
    if (nextLatex === lastDraftLatex && JSON.stringify(nextDraft?.cursor) === JSON.stringify(lastDraftV1?.cursor)) {
      return;
    }
    lastDraftLatex = nextLatex;
    lastDraftV1 = nextDraft;
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      draftSaveTimer = null;
      void persist();
    }, 800);
  }

  function flushDraftNow(): void {
    if (!storeHydrated || host.compactToolbar || host.initialFormula) return;
    if (draftSaveTimer) {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
      lastDraftLatex = snapshot.latex;
      lastDraftV1 = snapshot.latex.trim() ? engine.exportDraftV1(sessionWrapper ?? undefined) : null;
      void persist();
    }
  }

  function recordRecent(itemKey: string): void {
    recentIds = [itemKey, ...recentIds.filter((k) => k !== itemKey)].slice(0, 16);
    void persist();
  }

  function handleToggleFavorite(favKey: string): void {
    const exists = favoriteIds.includes(favKey);
    favoriteIds = exists
      ? favoriteIds.filter((k) => k !== favKey)
      : [favKey, ...favoriteIds];
    void persist();
  }

  function flash(msg: string): void {
    toast = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = null;
    }, 1800);
  }

  async function persist(): Promise<void> {
    const payload = {
      settings: { ...settings },
      snippets: [...snippets],
      customCommands: [...customCommands],
      history: [...history],
      userPresets: [...userPresets],
      userCommands: [...userCommands],
      favoriteIds: [...favoriteIds],
      recentIds: [...recentIds],
      lastDraftLatex,
      lastDraftV1,
    };
    const next = persistChain.then(async () => {
      await host.saveStore(payload);
    });
    persistChain = next.catch(() => {});
    try {
      await next;
    } catch {
      flash('保存本地配置失败，请检查存储权限');
    }
  }

  async function persistUserLibraries(): Promise<void> {
    void persist();
    if (host.saveUserLibraries) {
      try {
        await host.saveUserLibraries(
          serializeUserPresetsJson(userPresets),
          serializeUserCommandsJson(userCommands),
        );
      } catch {
        flash('写入外部公式/命令配置文件失败，内存改动已保留');
      }
    }
  }

  async function loadExternalLibraries(silent = false): Promise<void> {
    if (!host.loadUserLibraries) return;
    try {
      const ext = await host.loadUserLibraries();
      configDir = ext.configDir;
      const pRes = parseUserPresetsJson(ext.presetsJson);
      const cRes = parseUserCommandsJson(ext.commandsJson);
      let needsSyncBack = false;

      if (!pRes.failed) {
        if (ext.presetsNewlyCreated) {
          // Only seed a freshly-created starter file from store presets; thereafter disk JSON is single source of truth!
          if (userPresets.length > 0) needsSyncBack = true;
        } else {
          userPresets = pRes.entries;
        }
      }

      if (!cRes.failed) {
        if (ext.commandsNewlyCreated) {
          if (userCommands.length > 0) needsSyncBack = true;
        } else {
          userCommands = cRes.entries;
        }
        engine.setEffectiveCommands(mergeCommands(COMMANDS, userCommands));
      }

      if (needsSyncBack && host.saveUserLibraries) {
        void host
          .saveUserLibraries(
            serializeUserPresetsJson(userPresets),
            serializeUserCommandsJson(userCommands),
          )
          .catch(() => {});
      }

      sync();
      const allWarnings = [...pRes.warnings, ...cRes.warnings];
      if (allWarnings.length > 0) {
        flash(
          pRes.failed || cRes.failed
            ? `${allWarnings[0]}（已保留上次有效配置）`
            : allWarnings[0],
        );
      } else if (!silent) {
        flash(`已重载配置（公式 ${userPresets.length} · 命令 ${userCommands.length}）`);
      }
    } catch {
      if (!silent) flash('读取外部配置文件失败，已保留当前配置');
    }
  }

  function handleSaveUserPreset(entry: UserPresetEntry): void {
    const exists = userPresets.some((p) => p.id === entry.id);
    userPresets = exists
      ? userPresets.map((p) => (p.id === entry.id ? entry : p))
      : [entry, ...userPresets];
    void persistUserLibraries();
    flash(`已保存公式「${entry.name}」`);
    canvasRef?.focus();
  }

  function handleDeleteUserPreset(id: string): void {
    const isBuiltin = PRESETS.some((p) => p.id === id);
    if (isBuiltin) {
      const exists = userPresets.some((p) => p.id === id);
      const disabledEntry: UserPresetEntry = {
        id,
        category: '',
        name: '',
        source: '',
        disabled: true,
      };
      userPresets = exists
        ? userPresets.map((p) => (p.id === id ? disabledEntry : p))
        : [...userPresets, disabledEntry];
    } else {
      userPresets = userPresets.filter((p) => p.id !== id);
    }
    void persistUserLibraries();
    flash('已移除公式条目');
  }

  function handleSaveUserCommand(entry: UserCommandEntry): void {
    const exists = userCommands.some((c) => c.id === entry.id);
    userCommands = exists
      ? userCommands.map((c) => (c.id === entry.id ? entry : c))
      : [...userCommands, entry];
    engine.setEffectiveCommands(mergeCommands(COMMANDS, userCommands));
    void persistUserLibraries();
    flash(`已保存命令「${entry.label}」`);
    canvasRef?.focus();
  }

  function handleResetUserLibraries(): void {
    userPresets = [];
    userCommands = [];
    engine.setEffectiveCommands(COMMANDS);
    void persistUserLibraries();
    flash('已恢复内置公式库与命令库');
  }

  function recordHistory(latex: string): void {
    const clean = latex.trim();
    if (!clean) return;
    if (history[0]?.latex === clean) return;
    const deduped = history.filter((h) => h.latex !== clean);
    history = [
      { id: `h-${Date.now()}`, latex: clean, timestamp: Date.now() },
      ...deduped,
    ].slice(0, 40);
    void persist();
  }

  async function togglePin(): Promise<void> {
    if (!host.setAlwaysOnTop) return;
    const next = !pinned;
    try {
      await host.setAlwaysOnTop(next);
      pinned = next;
      flash(next ? '已置顶窗口' : '已取消置顶');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('WAYLAND_UNSUPPORTED')) {
        flash('Wayland 限制应用自置顶：请右键窗口标题栏 → 保持在最前（或右键图标选 X11 模式启动）');
      } else {
        flash('当前环境不支持窗口置顶');
      }
    }
    canvasRef?.focus();
  }

  function updateSettings(patch: Partial<AppSettings>): void {
    settings = normalizeSettings({ ...settings, ...patch });
    engine.updateSettings(settings);
    sync();
    void persist();
  }

  function cycleDelimiter(): void {
    const order: DelimiterStyle[] = ['inline', 'block', 'none', 'codeblock'];
    const idx = order.indexOf(effectiveDelimiter);
    const next = order[(idx + 1) % order.length];
    sessionWrapper = null;
    if (sessionDelimiter !== null) {
      sessionDelimiter = next;
    } else {
      updateSettings({ delimiter: next });
    }
    canvasRef?.focus();
  }

  function toggleTheme(): void {
    updateSettings({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' });
    canvasRef?.focus();
  }

  async function handleCopy(): Promise<void> {
    const formatted = formatExport(snapshot.latex, effectiveDelimiter);
    if (!formatted) return;
    recordHistory(snapshot.latex);
    try {
      await host.copyText(formatted);
      flash('已复制');
    } catch {
      flash('复制失败，请从底部源码栏手动复制');
    }
    canvasRef?.focus();
  }

  async function handleCopyMathML(): Promise<void> {
    if (!snapshot.latex.trim()) return;
    recordHistory(snapshot.latex);
    try {
      const mathml = latexToMathML(snapshot.latex);
      await host.copyText(mathml);
      flash('已复制 Word 公式 (MathML)');
    } catch {
      flash('Word 公式 (MathML) 复制失败');
    }
    canvasRef?.focus();
  }

  async function handleCopyPng(): Promise<void> {
    if (!snapshot.latex.trim()) return;
    recordHistory(snapshot.latex);
    try {
      // Quick-copy PNG always uses crisp dark ink (`dark: false`) so pasting into Word/PPT/WeChat/Docs
      // on white/light pages stays 100% legible even when Studio is in dark mode!
      const rendered = await renderLatexToPng(snapshot.latex, {
        dark: false,
        scale: 3,
      });
      if (host.copyImagePng) {
        await host.copyImagePng(rendered.rgba, rendered.width, rendered.height, rendered.blob);
      } else if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': rendered.blob })]);
      } else {
        throw new Error('unsupported');
      }
      flash('已复制高清 PNG 图片');
    } catch {
      flash('PNG 复制失败，可点「导出」保存图片或复制 SVG');
    }
    canvasRef?.focus();
  }

  async function handleCopySvg(): Promise<void> {
    if (!snapshot.latex.trim()) return;
    recordHistory(snapshot.latex);
    try {
      const rendered = await renderLatexToSvg(snapshot.latex, {
        dark: false,
        embedFonts: true,
      });
      await host.copyText(rendered.svg);
      flash('已复制纯矢量 SVG 代码');
    } catch {
      flash('SVG 复制失败');
    }
    canvasRef?.focus();
  }

  async function handlePrimarySubmit(): Promise<void> {
    const formatted = sessionWrapper
      ? formatFormulaWithWrapper(snapshot.latex, sessionWrapper)
      : formatExport(snapshot.latex, effectiveDelimiter);
    if (!formatted) return;
    recordHistory(snapshot.latex);
    try {
      if (host.onPrimarySubmit) {
        const msg = await host.onPrimarySubmit(formatted, snapshot.latex);
        if (msg) flash(msg);
      } else {
        await host.copyText(formatted);
        flash('已复制');
      }
    } catch {
      flash('操作失败，请重试或从底部源码栏复制');
    }
    canvasRef?.focus();
  }

  function openSaveSnippetModal(): void {
    if (!snapshot.latex.trim()) return;
    saveSnippetOpen = true;
  }

  function handleSaveNamedSnippet(name: string, key?: string): void {
    const latex = snapshot.latex.trim();
    if (!latex) return;
    const next: Snippet = {
      id: `snip-${Date.now()}`,
      name,
      latex,
      ...(key ? { key } : {}),
      createdAt: Date.now(),
    };
    snippets = [next, ...snippets];
    engine.setSnippets(snippets);
    void persist();
    flash(`已保存「${name}」`);
    canvasRef?.focus();
  }

  function handleRenameSnippet(id: string, nextName: string): void {
    snippets = snippets.map((s) => (s.id === id ? { ...s, name: nextName } : s));
    engine.setSnippets(snippets);
    void persist();
  }

  function handleDeleteSnippet(id: string): void {
    snippets = snippets.filter((s) => s.id !== id);
    engine.setSnippets(snippets);
    void persist();
  }

  function handleSaveCustomCommand(cmd: CustomCommandDef): void {
    const exists = customCommands.some((c) => c.id === cmd.id);
    customCommands = exists
      ? customCommands.map((c) => (c.id === cmd.id ? cmd : c))
      : [...customCommands, cmd];
    engine.setCustomCommands(customCommands);
    void persist();
    flash(`已保存结构「${cmd.label}」`);
    canvasRef?.focus();
  }

  function handleDeleteCustomCommand(id: string): void {
    customCommands = customCommands.filter((c) => c.id !== id);
    engine.setCustomCommands(customCommands);
    void persist();
  }

  function handleLoadFormula(source: string, presetId?: string): boolean {
    const res = engine.loadFormula(source);
    const err = res.diagnostics.find((d) => d.severity === 'error');
    if (err) {
      flash(err.message);
      return false;
    }
    if (presetId) {
      recordRecent(`preset:${presetId}`);
    }
    sync();
    const warn = res.diagnostics.find((d) => d.severity === 'warning');
    if (warn) {
      flash(warn.message);
    } else if (res.hasRawNodes) {
      flash('已载入（含部分原生 LaTeX 片段，可在底部源码栏直接修改）');
    }
    canvasRef?.focus();
    return true;
  }

  async function handleCopySelection(): Promise<void> {
    const text =
      snapshot.selection || snapshot.gridSelection
        ? engine.getSelectedLatex()
        : formatExport(snapshot.latex, effectiveDelimiter);
    if (!text) return;
    try {
      await host.copyText(text);
      flash(snapshot.gridSelection ? '已复制子矩阵' : '已复制');
    } catch {
      flash('剪贴板写入失败');
    }
  }

  async function handleCutSelection(): Promise<void> {
    const sel = snapshot.selection ? { ...snapshot.selection } : null;
    const gsel = snapshot.gridSelection ? { ...snapshot.gridSelection } : null;
    if (!sel && !gsel) {
      flash('请先选中要剪切的内容');
      return;
    }
    const text = engine.getSelectedLatex();
    if (!text) return;
    try {
      await host.copyText(text);
    } catch {
      flash('剪贴板写入失败，已保留选中内容');
      return;
    }
    // Only delete selection AFTER clipboard write succeeds and selection is unchanged
    const curSnap = engine.getSnapshot();
    const curSel = curSnap.selection;
    const curGsel = curSnap.gridSelection;
    if (
      (sel && curSel && curSel.slotId === sel.slotId && curSel.start === sel.start && curSel.end === sel.end) ||
      (gsel && curGsel && curGsel.structId === gsel.structId && curGsel.r1 === gsel.r1 && curGsel.r2 === gsel.r2 && curGsel.c1 === gsel.c1 && curGsel.c2 === gsel.c2)
    ) {
      engine.backspace();
    }
    flash(gsel ? '已剪切子矩阵' : '已剪切');
  }

  async function handlePasteLiteral(): Promise<void> {
    try {
      const text = host.readText ? await host.readText() : await navigator.clipboard.readText();
      if (text) {
        engine.pasteLiteralText(text);
        sync();
        flash('已按原文粘贴');
      }
    } catch {
      flash('读取剪贴板失败');
    }
  }

  function handleKeyEvent(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key === 'Enter') {
      e.preventDefault();
      void handlePrimarySubmit();
      return;
    }

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) engine.redo();
      else engine.undo();
      sync();
      return;
    }

    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      engine.redo();
      sync();
      return;
    }

    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      engine.selectAll();
      sync();
      return;
    }

    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      void handleCopySelection();
      return;
    }

    if (mod && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      void handleCutSelection();
      return;
    }

    if (mod && e.shiftKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      void handlePasteLiteral();
      return;
    }

    // Jump mode key dispatch (supports hierarchical drill-down, Arrow roaming, Backspace step-up, Enter confirm)
    if (snapshot.mode.kind === 'jump') {
      if (e.key === 'Escape') {
        e.preventDefault();
        engine.exitMode();
        sync();
        return;
      }
      if (e.key === 'Backspace' || e.key === 'ArrowUp') {
        e.preventDefault();
        engine.stepJumpBack();
        sync();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        engine.confirmJumpSelection();
        sync();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        engine.moveJumpSelection(-1);
        sync();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        engine.moveJumpSelection(1);
        sync();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        engine.drillJumpSelection();
        sync();
        return;
      }
      if (!mod && !e.altKey && e.key.length === 1) {
        e.preventDefault();
        engine.handleJumpKey(e.key);
        sync();
        return;
      }
    }

    // Leader mode key dispatch
    if (snapshot.mode.kind === 'leader') {
      if (e.key === 'Escape') {
        e.preventDefault();
        engine.cancelLeader();
        sync();
        return;
      }
      if (e.key === 'Enter' && snapshot.mode.prefix !== '') {
        e.preventDefault();
        engine.acceptSubmenuDefault();
        sync();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        engine.stepLeaderBack();
        sync();
        return;
      }
      if (e.key === settings.leaderKey) {
        e.preventDefault();
        engine.triggerLeader();
        sync();
        return;
      }
      if (!mod && !e.altKey && e.key.length === 1) {
        e.preventDefault();
        engine.handleLeaderKey(e.key);
        sync();
        return;
      }
    }

    // Leader key trigger (Tab / / / \)
    if (!mod && !e.altKey && !e.shiftKey && e.key === settings.leaderKey) {
      e.preventDefault();
      engine.triggerLeader();
      sync();
      return;
    }

    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      engine.prevSlot();
      sync();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.altKey && snapshot.activeGrid) {
        if (e.shiftKey) engine.addGridCol();
        else engine.addGridRow();
      } else if (e.shiftKey) {
        engine.prevSlot();
      } else {
        engine.nextSlot();
      }
      sync();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (snapshot.selection) {
        engine.exitMode();
      } else if (!snapshot.isEmpty) {
        engine.enterJumpMode();
      }
      sync();
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      if (e.altKey && snapshot.activeGrid) {
        if (e.shiftKey && snapshot.activeGrid.canEditCols) engine.removeGridCol();
        else engine.removeGridRow();
      } else {
        engine.backspace();
      }
      sync();
      return;
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      engine.deleteForward();
      sync();
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if ((mod || e.altKey) && e.shiftKey && snapshot.activeGrid?.canEditCols) {
        engine.removeGridCol();
      } else if (e.altKey) {
        engine.jumpBack();
      } else if (e.shiftKey && snapshot.activeGrid?.canEditCols) {
        engine.addGridCol('left');
      } else {
        engine.moveLeft(e.shiftKey);
      }
      sync();
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if ((mod || e.altKey) && e.shiftKey && snapshot.activeGrid?.canEditCols) {
        engine.removeGridCol();
      } else if (e.altKey) {
        engine.jumpForward();
      } else if (e.shiftKey && snapshot.activeGrid?.canEditCols) {
        engine.addGridCol('right');
      } else {
        engine.moveRight(e.shiftKey);
      }
      sync();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if ((mod || e.altKey) && e.shiftKey && snapshot.activeGrid) {
        engine.removeGridRow();
      } else if (e.altKey || mod) {
        engine.escapeLevel();
      } else if (e.shiftKey && snapshot.activeGrid) {
        engine.addGridRow('above');
      } else {
        engine.moveUp();
      }
      sync();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if ((mod || e.altKey) && e.shiftKey && snapshot.activeGrid) {
        engine.removeGridRow();
      } else if (e.shiftKey && snapshot.activeGrid) {
        engine.addGridRow('below');
      } else {
        engine.moveDown();
      }
      sync();
      return;
    }

    if (e.altKey && (e.key === '\\' || e.key === '|') && snapshot.activeGrid?.canEditCols) {
      e.preventDefault();
      if (engine.toggleGridColBar()) {
        sync();
      }
      return;
    }

    // Alt+; inserts a literal semicolon inside nested slots even when `;` is bound to nextSlot!
    if (e.altKey && !mod && e.key === ';') {
      e.preventDefault();
      engine.pasteLiteralText(';');
      sync();
      return;
    }

    if (e.key === 'Home') {
      e.preventDefault();
      engine.moveHome(e.shiftKey);
      sync();
      return;
    }

    if (e.key === 'End') {
      e.preventDefault();
      engine.moveEnd(e.shiftKey);
      sync();
      return;
    }
  }

  function handleWindowKeyDown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    const anyOtherModalOpen =
      importOpen ||
      exportOpen ||
      saveSnippetOpen ||
      customModalOpen ||
      presetModalOpen ||
      commandModalOpen ||
      settingsOpen ||
      helpOpen;
    if (mod && e.key.toLowerCase() === 'k' && !anyOtherModalOpen) {
      e.preventDefault();
      moreMenuOpen = false;
      drawerTab = 'all';
      drawerOpen = !drawerOpen;
      return;
    }
    // Phase 4 P2-7: Standard keyboard focus escape (`Ctrl+M` or `F6`) so users can leave canvas even when `Tab` is Leader
    if ((e.key === 'F6' || (mod && e.key.toLowerCase() === 'm')) && !anyOtherModalOpen && !drawerOpen) {
      e.preventDefault();
      const inTopbar = topbarEl?.contains(document.activeElement) ?? false;
      if (inTopbar) {
        canvasRef?.focus();
      } else {
        const firstBtn = topbarEl?.querySelector<HTMLElement>('button:not([disabled])');
        firstBtn?.focus();
      }
      return;
    }
    if (e.key === 'Escape' && moreMenuOpen) {
      moreMenuOpen = false;
    }
  }

  onDestroy(() => {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (draftSaveTimer) {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
    }
  });

  function handleWindowPointerDown(e: PointerEvent): void {
    if (!moreMenuOpen || !moreMenuWrapEl) return;
    if (!moreMenuWrapEl.contains(e.target as Node)) {
      moreMenuOpen = false;
    }
  }

  onMount(() => {
    const cleanups: (() => void)[] = [];
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (mq) {
      systemDark = mq.matches;
      const listener = (ev: MediaQueryListEvent) => {
        systemDark = ev.matches;
      };
      mq.addEventListener('change', listener);
      cleanups.push(() => mq.removeEventListener('change', listener));
    }
    if (host.hostDarkMode) {
      hostDark = host.hostDarkMode();
    }
    if (host.subscribeDarkMode) {
      cleanups.push(
        host.subscribeDarkMode((dark) => {
          hostDark = dark;
        }),
      );
    }
    return () => {
      for (const fn of cleanups) fn();
    };
  });

  onMount(() => {
    const unsubscribe = engine.subscribe(() => {
      const nextSnap = engine.getSnapshot();
      snapshot = nextSnap;
      scheduleDraftSave(nextSnap.latex);
    });
    void host.loadStore().then((loaded) => {
      if (loaded.settings) {
        settings = normalizeSettings(loaded.settings);
        engine.updateSettings(settings);
      }
      if (Array.isArray(loaded.snippets)) {
        snippets = loaded.snippets;
        engine.setSnippets(snippets);
      }
      if (Array.isArray(loaded.customCommands)) {
        customCommands = loaded.customCommands;
        engine.setCustomCommands(customCommands);
      }
      if (Array.isArray(loaded.history)) {
        history = loaded.history;
      }
      if (Array.isArray(loaded.userPresets)) {
        userPresets = loaded.userPresets;
      }
      if (Array.isArray(loaded.userCommands)) {
        userCommands = loaded.userCommands;
        engine.setEffectiveCommands(mergeCommands(COMMANDS, userCommands));
      }
      if (Array.isArray(loaded.favoriteIds)) {
        favoriteIds = loaded.favoriteIds;
      }
      if (Array.isArray(loaded.recentIds)) {
        recentIds = loaded.recentIds;
      }
      if (typeof loaded.lastDraftLatex === 'string') {
        lastDraftLatex = loaded.lastDraftLatex;
      }
      if (loaded.lastDraftV1) {
        lastDraftV1 = loaded.lastDraftV1;
      }
      if (host.initialFormula && host.initialFormula.trim()) {
        const initRes = engine.loadFormulaWithRawFallback(host.initialFormula);
        const initErr = initRes.diagnostics.find((d) => d.severity === 'error');
        const initWarn = initRes.diagnostics.find((d) => d.severity === 'warning');
        if (initErr) {
          flash(`原公式语法有误（${initErr.message}），已按原文载入供底部源码栏修正`);
        } else if (initWarn) {
          flash(initWarn.message);
        }
      } else if (!host.compactToolbar) {
        const restoredV1 = lastDraftV1 ? engine.restoreDraftV1(lastDraftV1) : false;
        if (restoredV1) {
          const restoredWrapper = engine.getRestoredDraftWrapper();
          if (restoredWrapper) {
            sessionWrapper = restoredWrapper;
          }
        } else if (lastDraftLatex.trim()) {
          engine.loadFormulaWithRawFallback(lastDraftLatex);
        }
      }
      storeHydrated = true;
      if (host.loadUserLibraries) {
        void loadExternalLibraries(true);
      }
      sync();
    });
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushDraftNow();
    };
    const onPageHide = () => flushDraftNow();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
    };
  });
</script>

<svelte:window onkeydown={handleWindowKeyDown} onpointerdown={handleWindowPointerDown} />

<div class="ms-studio studio-shell" class:compact-obsidian={!!host.compactToolbar} data-theme={resolvedTheme}>
  <header class="topbar ms-topbar" bind:this={topbarEl}>
    <div class="brand">
      <svg class="brand-mark" width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="msBrandBg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1E3A7A" />
            <stop offset="100%" stop-color="#0B1325" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="30" height="30" rx="8" fill="url(#msBrandBg)" />
        <rect x="1.5" y="1.5" width="29" height="29" rx="7.5" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1" />
        <path
          d="M 6.5 8.5 H 16.5 L 16.9 11.7 H 15.5 C 15.2 10.6 14.6 10.2 13.4 10.2 H 9.7 L 14.2 15.6 V 16.3 L 9.5 21.8 H 13.7 C 14.9 21.8 15.5 21.3 15.9 20.1 H 17.2 L 16.6 23.8 H 6.5 V 22.6 L 11.6 16.8 L 6.5 9.8 Z"
          fill="#F8FAFC"
        />
        <rect
          x="18.6"
          y="10.8"
          width="7.8"
          height="10.4"
          rx="2.2"
          fill="rgba(56,189,248,0.22)"
          stroke="#7DD3FC"
          stroke-width="1.4"
          stroke-dasharray="2.4 1.6"
        />
        <rect x="21.8" y="13.2" width="1.4" height="5.6" rx="0.7" fill="#FBBF24" />
      </svg>
      <span class="brand-name">MathSlot</span>
    </div>

    <div class="breadcrumb-area">
      {#if snapshot.mode.kind === 'jump'}
        <nav class="breadcrumbs" aria-label="跳转层级">
          <span class="crumb-btn">跳转</span>
          {#each snapshot.mode.scopePath as sc (sc.slotId)}
            <span class="crumb-sep">›</span>
            <span class="crumb-btn">{sc.label}</span>
          {/each}
          {#if snapshot.mode.scopePath.length > 0}
            <button
              type="button"
              class="crumb-up"
              title="返回上一层级 (Backspace)"
              aria-label="返回上一跳转层级"
              onclick={() => {
                engine.stepJumpBack();
                sync();
                canvasRef?.focus();
              }}
            >
              ↑
            </button>
          {/if}
        </nav>
      {:else if snapshot.breadcrumbs.length > 0}
        <nav class="breadcrumbs" aria-label="当前层级">
          <button
            type="button"
            class="crumb-btn"
            onclick={() => {
              engine.setCursor(snapshot.doc.root.id, snapshot.doc.root.children.length);
              sync();
              canvasRef?.focus();
            }}
          >
            公式
          </button>
          {#each snapshot.breadcrumbs as crumb (crumb.slotId)}
            <span class="crumb-sep">›</span>
            <button
              type="button"
              class="crumb-btn"
              onclick={() => {
                engine.setCursor(crumb.slotId, 99999);
                sync();
                canvasRef?.focus();
              }}
            >
              {crumb.commandLabel}·{crumb.slotLabel}
            </button>
          {/each}
          {#if snapshot.inputContext === 'raw'}
            <span class="crumb-sep">·</span>
            <span class="crumb-btn" style="color: var(--ms-accent); font-weight: 600;">
              原生 TeX（Enter / Tab 跳出）
            </span>
          {/if}
          <button
            type="button"
            class="crumb-up"
            title="跳出当前层级 (Alt+↑)"
            aria-label="跳出当前层级"
            onclick={() => {
              engine.escapeLevel();
              sync();
              canvasRef?.focus();
            }}
          >
            ↑
          </button>
        </nav>
      {/if}
    </div>

    <div class="toolbar">
      <button
        type="button"
        class="icon-btn"
        title="命令与公式库 (Ctrl+K)"
        aria-label="命令与公式库"
        onclick={() => {
          moreMenuOpen = false;
          drawerTab = 'all';
          drawerOpen = true;
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </button>

      {#if !host.compactToolbar}
        <button
          type="button"
          class="icon-btn"
          title="历史公式记录"
          aria-label="历史公式记录"
          onclick={() => {
            drawerTab = 'history';
            drawerOpen = true;
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l3 2" />
          </svg>
        </button>
      {/if}

      <button
        type="button"
        class="text-btn"
        title="导入 LaTeX"
        aria-label="导入 LaTeX"
        onclick={() => {
          moreMenuOpen = false;
          importOpen = true;
        }}
      >
        导入
      </button>

      {#if !host.compactToolbar}
        <span class="toolbar-sep" aria-hidden="true"></span>
        {#if host.setAlwaysOnTop}
          <button
            type="button"
            class="icon-btn"
            class:active={pinned}
            title={pinned ? '取消窗口置顶' : '窗口置顶'}
            aria-label="切换窗口置顶"
            onclick={() => void togglePin()}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
            </svg>
          </button>
        {/if}

        <button
          type="button"
          class="icon-btn"
          title={resolvedTheme === 'dark' ? '切换浅色外观' : '切换深色外观'}
          aria-label="切换外观"
          onclick={toggleTheme}
        >
          {#if resolvedTheme === 'dark'}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          {:else}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          {/if}
        </button>
      {/if}

      <button
        type="button"
        class="icon-btn"
        title="使用文档与快速开始"
        aria-label="使用文档"
        onclick={() => {
          moreMenuOpen = false;
          helpOpen = true;
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <circle cx="12" cy="17" r="0.6" fill="currentColor" />
        </svg>
      </button>

      {#if !host.compactToolbar}
        <button
          type="button"
          class="icon-btn"
          title="偏好设置"
          aria-label="偏好设置"
          onclick={() => (settingsOpen = true)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      {:else}
        <div class="more-wrap" bind:this={moreMenuWrapEl}>
          <button
            type="button"
            class="icon-btn"
            class:active={moreMenuOpen}
            title="更多功能与设置"
            aria-label="更多功能"
            aria-expanded={moreMenuOpen}
            onclick={() => (moreMenuOpen = !moreMenuOpen)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="5" cy="12" r="1.4" fill="currentColor" />
              <circle cx="12" cy="12" r="1.4" fill="currentColor" />
              <circle cx="19" cy="12" r="1.4" fill="currentColor" />
            </svg>
          </button>

          {#if moreMenuOpen}
            <div class="more-menu" role="menu" aria-label="更多功能">
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                onclick={() => {
                  moreMenuOpen = false;
                  drawerTab = 'presets';
                  drawerOpen = true;
                }}
              >
                <span>预置公式库</span>
                <span class="menu-hint">{effectivePresets.length}</span>
              </button>

              <button
                type="button"
                class="menu-item"
                role="menuitem"
                onclick={() => {
                  moreMenuOpen = false;
                  drawerTab = 'history';
                  drawerOpen = true;
                }}
              >
                <span>历史记录</span>
                <span class="menu-hint">{history.length}</span>
              </button>

              <div class="menu-sep"></div>

              <button
                type="button"
                class="menu-item"
                role="menuitem"
                onclick={() => {
                  moreMenuOpen = false;
                  toggleTheme();
                }}
              >
                <span>切换外观</span>
                <span class="menu-hint">{resolvedTheme === 'dark' ? '深色' : '浅色'}</span>
              </button>

              <button
                type="button"
                class="menu-item"
                role="menuitem"
                onclick={() => {
                  moreMenuOpen = false;
                  helpOpen = true;
                }}
              >
                <span>使用文档与快速开始</span>
              </button>

              <button
                type="button"
                class="menu-item"
                role="menuitem"
                onclick={() => {
                  moreMenuOpen = false;
                  settingsOpen = true;
                }}
              >
                <span>偏好设置</span>
              </button>
            </div>
          {/if}
        </div>
      {/if}

      <button
        type="button"
        class="primary-cta"
        disabled={snapshot.isEmpty}
        onclick={() => {
          moreMenuOpen = false;
          void handlePrimarySubmit();
        }}
      >
        {host.primaryActionLabel}
      </button>
    </div>
  </header>

  <div class="canvas-wrap">
    <div class="left-edit-dock" role="toolbar" aria-label="画布编辑工具">
      <button
        type="button"
        class="dock-tool-btn"
        title="撤销 (Ctrl+Z)"
        aria-label="撤销"
        disabled={!snapshot.canUndo}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => {
          engine.undo();
          sync();
          canvasRef?.focus();
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        </svg>
      </button>

      <button
        type="button"
        class="dock-tool-btn"
        title="重做 (Ctrl+Y)"
        aria-label="重做"
        disabled={!snapshot.canRedo}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => {
          engine.redo();
          sync();
          canvasRef?.focus();
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
          <path d="m15 14 5-5-5-5" />
          <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
        </svg>
      </button>

      <span class="dock-sep"></span>

      <button
        type="button"
        class="dock-tool-btn"
        class:active={snapshot.mode.kind === 'jump'}
        title="槽位跳转 (Esc)"
        aria-label="槽位跳转"
        disabled={snapshot.isEmpty}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => {
          if (snapshot.mode.kind === 'jump') engine.exitMode();
          else engine.enterJumpMode();
          sync();
          canvasRef?.focus();
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
          <circle cx="12" cy="12" r="7" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        </svg>
      </button>

      <button
        type="button"
        class="dock-tool-btn"
        class:active={settings.showHierarchyBoxes}
        title={settings.showHierarchyBoxes ? '隐藏层级虚线框' : '显示层级虚线框'}
        aria-label="切换层级虚线框"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => {
          updateSettings({ showHierarchyBoxes: !settings.showHierarchyBoxes });
          canvasRef?.focus();
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
          <rect x="3" y="4" width="18" height="16" rx="2.5" stroke-dasharray="3 2.5" />
          <rect x="7" y="8" width="10" height="8" rx="1.5" />
        </svg>
      </button>

      <span class="dock-sep"></span>

      <button
        type="button"
        class="dock-tool-btn danger"
        title="清空画布"
        aria-label="清空画布"
        disabled={snapshot.isEmpty}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => {
          recordHistory(snapshot.latex);
          engine.clear();
          sync();
          canvasRef?.focus();
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
          <path d="M3 6h18" />
          <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </svg>
      </button>
    </div>

    <VisualCanvas
      bind:this={canvasRef}
      {snapshot}
      shiftedUp={false}
      showHierarchyBoxes={settings.showHierarchyBoxes}
      onKeyEvent={handleKeyEvent}
      onTextInput={(text) => {
        engine.insertText(text);
      }}
      onPaste={(text) => {
        engine.pasteText(text);
      }}
      onClickSlot={(slotId, offset) => {
        engine.setCursor(slotId, offset);
      }}
      onDragSelect={(slotId, anchor, focus) => {
        engine.setSelection(slotId, anchor, focus);
      }}
      onCrossSlotDragSelect={(anchor: TreePoint, focus: TreePoint) => {
        engine.selectBetweenPoints(anchor, focus);
      }}
      onDoubleClickAtom={(slotId, offset) => {
        engine.selectWordOrAtomAt(slotId, offset);
      }}
      onJumpTarget={(label) => {
        engine.handleJumpKey(label);
        canvasRef?.focus();
      }}
      onFocusChange={(focused) => {
        engine.setFocused(focused);
      }}
      onAddGridRow={() => {
        engine.addGridRow();
        canvasRef?.focus();
      }}
      onRemoveGridRow={() => {
        engine.removeGridRow();
        canvasRef?.focus();
      }}
      onAddGridCol={() => {
        engine.addGridCol();
        canvasRef?.focus();
      }}
      onRemoveGridCol={() => {
        engine.removeGridCol();
        canvasRef?.focus();
      }}
      onToggleGridBar={() => {
        engine.toggleGridColBar();
        canvasRef?.focus();
      }}
    />
  </div>

  <MathRibbon
    leaderKey={settings.leaderKey}
    leaderActive={snapshot.mode.kind === 'leader'}
    leaderPrefix={snapshot.mode.kind === 'leader' ? snapshot.mode.prefix : ''}
    pendingDefaultId={snapshot.mode.kind === 'leader' ? snapshot.mode.pendingDefaultId : undefined}
    commands={effectiveCommands}
    {customCommands}
    {snippets}
    onInsertCommand={(id) => {
      if (engine.insertCommand(id)) recordRecent(`cmd:${id}`);
      sync();
      canvasRef?.focus();
    }}
    onInsertSnippet={(snip) => {
      engine.insertSnippetAtCursor(snip);
      sync();
      canvasRef?.focus();
    }}
    onSelectSubmenuKey={(key) => {
      engine.handleLeaderKey(key);
      sync();
      canvasRef?.focus();
    }}
    onLeaderBack={() => {
      engine.stepLeaderBack();
      sync();
      canvasRef?.focus();
    }}
    onCreateCustom={() => {
      editingCustom = null;
      customModalOpen = true;
    }}
    onSaveSnippet={openSaveSnippetModal}
  />

  {#if settings.showLatexDock}
    <LatexDock
      latex={snapshot.latex}
      delimiter={effectiveDelimiter}
      hasRawNodes={Boolean(snapshot.hasRawNodes)}
      onApplyRawLatex={handleLoadFormula}
      onCycleDelimiter={cycleDelimiter}
      onSaveSnippet={openSaveSnippetModal}
      onCopy={() => void handleCopy()}
      onCopyMathML={() => void handleCopyMathML()}
      onCopyPng={() => void handleCopyPng()}
      onCopySvg={() => void handleCopySvg()}
      onOpenExport={() => {
        moreMenuOpen = false;
        exportOpen = true;
      }}
    />
  {/if}

  {#if toast}
    <div class="toast" role="status" aria-live="polite">{toast}</div>
  {/if}

  {#if drawerOpen}
    <CommandDrawer
      leaderKey={settings.leaderKey}
      commands={effectiveCommands}
      presets={effectivePresets}
      {snippets}
      {customCommands}
      {history}
      {favoriteIds}
      {recentIds}
      initialTab={drawerTab}
      onInsertCommand={(id) => {
        if (engine.insertCommand(id)) recordRecent(`cmd:${id}`);
        sync();
        canvasRef?.focus();
      }}
      onInsertSnippet={(snip) => {
        engine.insertSnippetAtCursor(snip);
        sync();
        canvasRef?.focus();
      }}
      onLoadFormula={handleLoadFormula}
      onToggleFavorite={handleToggleFavorite}
      onCreatePreset={() => {
        editingPreset = null;
        presetModalOpen = true;
      }}
      onEditPreset={(preset) => {
        editingPreset = preset;
        presetModalOpen = true;
      }}
      onDeletePreset={handleDeleteUserPreset}
      onCreateCommand={() => {
        editingCommand = null;
        commandModalOpen = true;
      }}
      onEditCommand={(cmd) => {
        editingCommand = cmd;
        commandModalOpen = true;
      }}
      onOpenConfigDir={host.openConfigDir ? () => void host.openConfigDir?.() : undefined}
      onReloadLibraries={host.loadUserLibraries ? () => void loadExternalLibraries(false) : undefined}
      onRenameSnippet={handleRenameSnippet}
      onDeleteSnippet={handleDeleteSnippet}
      onCreateCustom={() => {
        editingCustom = null;
        customModalOpen = true;
      }}
      onEditCustom={(cmd) => {
        editingCustom = cmd;
        customModalOpen = true;
      }}
      onDeleteCustom={handleDeleteCustomCommand}
      onClearHistory={() => {
        history = [];
        void persist();
      }}
      onClose={() => {
        drawerOpen = false;
        canvasRef?.focus();
      }}
    />
  {/if}

  {#if importOpen}
    <ImportModal
      onReadClipboard={host.readText}
      onImport={handleLoadFormula}
      onClose={() => {
        importOpen = false;
        canvasRef?.focus();
      }}
    />
  {/if}

  {#if exportOpen}
    <ExportModal
      latex={snapshot.latex}
      delimiter={effectiveDelimiter}
      isDark={resolvedTheme === 'dark'}
      onCopyText={host.copyText}
      onCopyImagePng={host.copyImagePng}
      onSaveExportFile={host.saveExportFile}
      onOpenDownloadsDir={host.openDownloadsDir}
      onNotify={(msg) => flash(msg)}
      onClose={() => {
        exportOpen = false;
        canvasRef?.focus();
      }}
    />
  {/if}

  {#if saveSnippetOpen}
    <SaveSnippetModal
      latex={snapshot.latex}
      defaultName={`片段 ${snippets.length + 1}`}
      leaderKey={settings.leaderKey}
      usedKeys={snippets.map((s) => s.key).filter((k): k is string => Boolean(k))}
      onSave={handleSaveNamedSnippet}
      onClose={() => {
        saveSnippetOpen = false;
        canvasRef?.focus();
      }}
    />
  {/if}

  {#if customModalOpen}
    <CustomStructureModal
      leaderKey={settings.leaderKey}
      editing={editingCustom}
      existingCommands={customCommands}
      onSave={handleSaveCustomCommand}
      onClose={() => {
        customModalOpen = false;
        editingCustom = null;
        canvasRef?.focus();
      }}
    />
  {/if}

  {#if presetModalOpen}
    <PresetEditorModal
      editing={editingPreset}
      categories={presetCategories}
      currentCanvasLatex={snapshot.latex}
      onSave={handleSaveUserPreset}
      onClose={() => {
        presetModalOpen = false;
        editingPreset = null;
        canvasRef?.focus();
      }}
    />
  {/if}

  {#if commandModalOpen}
    <CommandEditorModal
      leaderKey={settings.leaderKey}
      editing={editingCommand}
      onSave={handleSaveUserCommand}
      onClose={() => {
        commandModalOpen = false;
        editingCommand = null;
        canvasRef?.focus();
      }}
    />
  {/if}

  {#if settingsOpen}
    <SettingsModal
      {settings}
      {configDir}
      userPresetCount={userPresets.length}
      userCommandCount={userCommands.length}
      onUpdate={updateSettings}
      onOpenConfigDir={host.openConfigDir ? () => void host.openConfigDir?.() : undefined}
      onReloadLibraries={host.loadUserLibraries ? () => void loadExternalLibraries(false) : undefined}
      onResetUserLibraries={handleResetUserLibraries}
      onClose={() => {
        settingsOpen = false;
        canvasRef?.focus();
      }}
    />
  {/if}

  {#if helpOpen}
    <HelpModal
      {configDir}
      onOpenConfigDir={host.openConfigDir ? () => void host.openConfigDir?.() : undefined}
      onClose={() => {
        helpOpen = false;
        canvasRef?.focus();
      }}
    />
  {/if}
</div>

<style>
  .studio-shell {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .topbar {
    height: 46px;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 0 14px;
    border-bottom: 1px solid var(--ms-border-subtle);
    background: var(--ms-chrome);
    flex-shrink: 0;
  }

  /* Reserve dedicated top-right space for Obsidian's native modal close button (×) */
  .studio-shell.compact-obsidian .topbar {
    position: relative;
    padding-right: 52px;
  }

  .studio-shell.compact-obsidian .topbar::after {
    content: '';
    position: absolute;
    right: 43px;
    top: 13px;
    bottom: 13px;
    width: 1px;
    background: var(--ms-border);
    pointer-events: none;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    user-select: none;
  }

  .brand-mark {
    display: block;
    flex-shrink: 0;
    filter: drop-shadow(0 1px 2px rgba(15, 23, 42, 0.18));
  }

  .brand-name {
    font-size: 14px;
    font-weight: 650;
    letter-spacing: -0.025em;
    color: var(--ms-fg);
  }

  .breadcrumb-area {
    display: flex;
    justify-content: center;
    min-width: 0;
    overflow: hidden;
  }

  .breadcrumbs {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 9px;
    border-radius: 999px;
    background: var(--ms-surface);
    border: 1px solid var(--ms-border-subtle);
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    max-width: 100%;
    overflow: hidden;
  }

  .crumb-btn {
    border: none;
    background: transparent;
    color: var(--ms-fg-muted);
    font-size: 11.5px;
    padding: 1px 4px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
    transition: color 120ms ease, background-color 120ms ease;
  }

  .crumb-btn:hover {
    color: var(--ms-accent);
    background: var(--ms-accent-soft);
  }

  .crumb-sep {
    color: var(--ms-fg-faint);
    font-size: 11px;
  }

  .crumb-up {
    border: 1px solid var(--ms-border-subtle);
    background: var(--ms-tile);
    color: var(--ms-fg-muted);
    font-size: 11px;
    width: 20px;
    height: 18px;
    margin-left: 3px;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: border-color 120ms ease, color 120ms ease, transform 120ms var(--ms-ease-out);
  }

  .crumb-up:hover {
    border-color: var(--ms-accent);
    color: var(--ms-accent);
  }

  .crumb-up:active {
    transform: scale(0.94);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  .toolbar-sep {
    width: 1px;
    height: 16px;
    background: var(--ms-border);
    margin: 0 4px;
    flex-shrink: 0;
  }

  .more-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .more-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 186px;
    padding: 5px;
    border-radius: var(--ms-radius-md);
    background: var(--ms-surface);
    border: 1px solid var(--ms-border);
    box-shadow: var(--ms-shadow-lg), var(--ms-inset-specular);
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 45;
  }

  .menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--ms-fg);
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    transition: background-color 100ms ease;
  }

  .menu-item:hover:not(:disabled) {
    background: var(--ms-surface-muted);
  }

  .menu-item:disabled {
    opacity: 0.36;
    cursor: default;
  }

  .menu-hint {
    font-family: var(--ms-font-mono);
    font-size: 11px;
    color: var(--ms-fg-muted);
  }

  .menu-sep {
    height: 1px;
    background: var(--ms-border-subtle);
    margin: 3px 6px;
  }

  .text-btn {
    height: 29px;
    padding: 0 10px;
    border: 1px solid var(--ms-border);
    border-radius: 7px;
    background: var(--ms-surface);
    color: var(--ms-fg-muted);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
    transition: border-color 120ms ease, color 120ms ease, background-color 120ms ease, transform 120ms var(--ms-ease-out);
  }

  .text-btn:hover {
    border-color: var(--ms-accent);
    color: var(--ms-accent);
    background: var(--ms-accent-soft);
  }

  .text-btn:active {
    transform: scale(0.97);
  }

  .icon-btn {
    width: 30px;
    height: 30px;
    padding: 0;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--ms-fg-muted);
    cursor: pointer;
    transition: background-color 110ms ease, color 110ms ease, transform 120ms var(--ms-ease-out);
  }

  .icon-btn:hover:not(:disabled) {
    background: var(--ms-surface-muted);
    color: var(--ms-fg);
  }

  .icon-btn:active:not(:disabled) {
    transform: scale(0.94);
  }

  .icon-btn.active {
    background: var(--ms-accent-soft);
    color: var(--ms-accent);
  }

  .icon-btn:disabled {
    opacity: 0.32;
    cursor: default;
  }

  .primary-cta {
    height: 29px;
    margin-left: 6px;
    padding: 0 13px;
    border: none;
    border-radius: 7px;
    background: var(--ms-accent);
    color: var(--ms-accent-fg);
    font-size: 12.5px;
    font-weight: 550;
    cursor: pointer;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 1px 3px rgba(15, 23, 42, 0.14);
    transition: background-color 120ms ease, transform 120ms var(--ms-ease-out), box-shadow 120ms ease;
  }

  .primary-cta:hover:not(:disabled) {
    background: var(--ms-accent-hover);
  }

  .primary-cta:active:not(:disabled) {
    transform: scale(0.97);
  }

  .primary-cta:disabled {
    opacity: 0.38;
    cursor: default;
    box-shadow: none;
  }

  .canvas-wrap {
    position: relative;
    flex: 1 1 auto;
    min-height: 110px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .left-edit-dock {
    position: absolute;
    left: 14px;
    top: 14px;
    z-index: 16;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border-radius: 11px;
    background: var(--ms-surface-glass);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid var(--ms-border);
    box-shadow: var(--ms-shadow-sm), var(--ms-inset-specular);
    opacity: 0.92;
    transition: opacity 120ms ease, box-shadow 120ms ease;
  }

  .left-edit-dock:hover {
    opacity: 1;
    box-shadow: var(--ms-shadow-md), var(--ms-inset-specular);
  }

  .dock-tool-btn {
    width: 30px;
    height: 30px;
    padding: 0;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--ms-fg-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 100ms ease, color 100ms ease, transform 120ms var(--ms-ease-out);
  }

  .dock-tool-btn:hover:not(:disabled) {
    background: var(--ms-surface-muted);
    color: var(--ms-fg);
  }

  .dock-tool-btn:active:not(:disabled) {
    transform: scale(0.93);
  }

  .dock-tool-btn.active {
    background: var(--ms-accent-soft);
    color: var(--ms-accent);
  }

  .dock-tool-btn.danger:hover:not(:disabled) {
    background: var(--ms-danger-soft);
    color: var(--ms-danger);
  }

  .dock-tool-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .dock-sep {
    width: 16px;
    height: 1px;
    background: var(--ms-border-subtle);
    margin: 3px 0;
  }

  .toast {
    position: absolute;
    top: 56px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 14px;
    border-radius: 999px;
    background: var(--ms-fg);
    color: var(--ms-bg);
    font-size: 12px;
    font-weight: 500;
    box-shadow: var(--ms-shadow-md);
    pointer-events: none;
    z-index: 40;
  }

  /* Narrow/mobile viewport safeguard (e.g. 390×844 Obsidian mobile & 560×420 min desktop window) */
  @media (max-width: 540px) {
    .topbar {
      height: 44px;
      gap: 6px;
      padding: 0 8px;
      grid-template-columns: auto 1fr auto;
    }

    .studio-shell.compact-obsidian .topbar {
      padding-right: 44px;
    }

    .studio-shell.compact-obsidian .topbar::after {
      right: 38px;
    }

    .brand-name,
    .breadcrumb-area {
      display: none;
    }

    .toolbar {
      gap: 2px;
      margin-left: auto;
    }

    .icon-btn {
      width: 28px;
      height: 28px;
    }

    .text-btn {
      height: 28px;
      padding: 0 7px;
      font-size: 11.5px;
    }

    .primary-cta {
      height: 28px;
      margin-left: 2px;
      padding: 0 9px;
      font-size: 12px;
      white-space: nowrap;
    }
  }
</style>
