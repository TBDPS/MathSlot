<script lang="ts">
  import { onMount } from 'svelte';
  import {
    COMMANDS,
    DEFAULT_SETTINGS,
    MathSlotEngine,
    PRESETS,
    formatExport,
    mergeCommands,
    mergePresets,
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
    type PresetFormula,
    type Snippet,
    type UserCommandEntry,
    type UserPresetEntry,
  } from '@mathslot/core';
  import type { HostAdapter } from '../host';
  import { latexToMathML, renderLatexToPng } from '../exportUtils';
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
  let configDir = $state('');
  let history = $state<HistoryFormula[]>([]);
  let pinned = $state(false);
  let snapshot = $state<EditorSnapshot>(engine.getSnapshot());
  let systemDark = $state(false);

  const effectivePresets = $derived(mergePresets(PRESETS, userPresets));
  const effectiveCommands = $derived(mergeCommands(COMMANDS, userCommands));
  const presetCategories = $derived(Array.from(new Set(effectivePresets.map((p) => p.category))));

  $effect(() => {
    engine.setEffectiveCommands(effectiveCommands);
  });

  let drawerOpen = $state(false);
  let drawerTab = $state<'commands' | 'presets' | 'snippets' | 'custom' | 'history'>('commands');
  let importOpen = $state(false);
  let saveSnippetOpen = $state(false);
  let customModalOpen = $state(false);
  let editingCustom = $state<CustomCommandDef | null>(null);
  let presetModalOpen = $state(false);
  let editingPreset = $state<PresetFormula | null>(null);
  let commandModalOpen = $state(false);
  let editingCommand = $state<CommandDef | null>(null);
  let settingsOpen = $state(false);
  let ribbonPopoverOpen = $state(false);
  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  let canvasRef = $state<{ focus: () => void } | null>(null);

  const resolvedTheme = $derived<'light' | 'dark'>(
    settings.theme === 'system'
      ? (host.hostDarkMode ? host.hostDarkMode() : systemDark)
        ? 'dark'
        : 'light'
      : settings.theme,
  );

  function sync(): void {
    snapshot = engine.getSnapshot();
  }

  function flash(msg: string): void {
    toast = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = null;
    }, 1800);
  }

  async function persist(): Promise<void> {
    try {
      await host.saveStore({
        settings,
        snippets,
        customCommands,
        history,
        userPresets,
        userCommands,
      });
    } catch {
      // Non-fatal persistence error
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
        // Non-fatal
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
      userPresets = pRes.entries;
      userCommands = cRes.entries;
      engine.setEffectiveCommands(mergeCommands(COMMANDS, userCommands));
      sync();
      const allWarnings = [...pRes.warnings, ...cRes.warnings];
      if (allWarnings.length > 0) {
        flash(allWarnings[0]);
      } else if (!silent) {
        flash(`已重载配置（公式 ${pRes.entries.length} · 命令 ${cRes.entries.length}）`);
      }
    } catch {
      if (!silent) flash('读取外部配置文件失败');
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
    } catch {
      flash('当前环境不支持窗口置顶');
    }
    canvasRef?.focus();
  }

  function updateSettings(patch: Partial<AppSettings>): void {
    settings = { ...settings, ...patch };
    engine.updateSettings(settings);
    sync();
    void persist();
  }

  function cycleDelimiter(): void {
    const order: DelimiterStyle[] = ['inline', 'block', 'none', 'codeblock'];
    const idx = order.indexOf(settings.delimiter);
    updateSettings({ delimiter: order[(idx + 1) % order.length] });
    canvasRef?.focus();
  }

  function toggleTheme(): void {
    updateSettings({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' });
    canvasRef?.focus();
  }

  async function handleCopy(): Promise<void> {
    const formatted = formatExport(snapshot.latex, settings.delimiter);
    if (!formatted) return;
    recordHistory(snapshot.latex);
    await host.copyText(formatted);
    flash('已复制');
    canvasRef?.focus();
  }

  async function handleCopyMathML(): Promise<void> {
    if (!snapshot.latex.trim()) return;
    recordHistory(snapshot.latex);
    const mathml = latexToMathML(snapshot.latex);
    await host.copyText(mathml);
    flash('已复制 Word 公式 (MathML)');
    canvasRef?.focus();
  }

  async function handleCopyPng(): Promise<void> {
    if (!snapshot.latex.trim()) return;
    recordHistory(snapshot.latex);
    try {
      const rendered = await renderLatexToPng(snapshot.latex, {
        dark: resolvedTheme === 'dark',
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
      flash('PNG 复制失败，请使用 LaTeX 或 Word 公式');
    }
    canvasRef?.focus();
  }

  async function handlePrimarySubmit(): Promise<void> {
    const formatted = formatExport(snapshot.latex, settings.delimiter);
    if (!formatted) return;
    recordHistory(snapshot.latex);
    if (host.onPrimarySubmit) {
      const msg = await host.onPrimarySubmit(formatted, snapshot.latex);
      if (msg) flash(msg);
    } else {
      await host.copyText(formatted);
      flash('已复制');
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

  function handleLoadFormula(source: string): void {
    const res = engine.loadFormula(source);
    if (res.diagnostics.some((d) => d.severity === 'error')) {
      flash(res.diagnostics[0].message);
      return;
    }
    sync();
    canvasRef?.focus();
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
      const text = snapshot.selection
        ? engine.getSelectedLatex()
        : formatExport(snapshot.latex, settings.delimiter);
      if (text) {
        void host.copyText(text);
        flash('已复制');
      }
      return;
    }

    if (mod && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      const text = engine.getSelectedLatex();
      if (text) {
        void host.copyText(text);
        if (snapshot.selection) {
          engine.backspace();
          sync();
        }
        flash('已剪切');
      }
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
      engine.backspace();
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
      if (e.altKey) engine.jumpBack();
      else engine.moveLeft(e.shiftKey);
      sync();
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (e.altKey) engine.jumpForward();
      else engine.moveRight(e.shiftKey);
      sync();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (e.altKey || mod) engine.escapeLevel();
      else engine.moveUp();
      sync();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      engine.moveDown();
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
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      drawerTab = 'commands';
      drawerOpen = !drawerOpen;
    }
  }

  onMount(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (mq) {
      systemDark = mq.matches;
      const listener = (ev: MediaQueryListEvent) => {
        systemDark = ev.matches;
      };
      mq.addEventListener('change', listener);
      return () => mq.removeEventListener('change', listener);
    }
  });

  onMount(() => {
    void host.loadStore().then((loaded) => {
      if (loaded.settings) {
        settings = { ...DEFAULT_SETTINGS, ...loaded.settings };
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
      if (host.loadUserLibraries) {
        void loadExternalLibraries(true);
      }
      if (host.initialFormula && host.initialFormula.trim()) {
        engine.loadFormula(host.initialFormula);
      }
      sync();
    });
  });
</script>

<svelte:window onkeydown={handleWindowKeyDown} />

<div class="ms-studio studio-shell" data-theme={resolvedTheme}>
  <header class="topbar">
    <div class="brand">
      <svg class="brand-mark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M7 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2" />
        <path d="M17 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2" />
        <path d="M9 12h6" />
        <path d="M12 9v6" />
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
          drawerTab = 'commands';
          drawerOpen = true;
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </button>

      <button
        type="button"
        class="icon-btn"
        title="预置公式"
        aria-label="预置公式"
        onclick={() => {
          drawerTab = 'presets';
          drawerOpen = true;
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      </button>

      <button
        type="button"
        class="text-btn"
        title="导入 LaTeX"
        aria-label="导入 LaTeX"
        onclick={() => (importOpen = true)}
      >
        导入 LaTeX
      </button>

      <button
        type="button"
        class="icon-btn"
        class:active={settings.showHierarchyBoxes}
        title="始终显示层级虚线框"
        aria-label="切换层级虚线框"
        onclick={() => {
          updateSettings({ showHierarchyBoxes: !settings.showHierarchyBoxes });
          canvasRef?.focus();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <rect x="7" y="7" width="10" height="10" rx="2" stroke-dasharray="none" />
        </svg>
      </button>

      <button
        type="button"
        class="icon-btn"
        class:active={snapshot.mode.kind === 'jump'}
        title="槽位跳转 (Esc)"
        aria-label="槽位跳转"
        disabled={snapshot.isEmpty}
        onclick={() => {
          if (snapshot.mode.kind === 'jump') engine.exitMode();
          else engine.enterJumpMode();
          sync();
          canvasRef?.focus();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="2.2" />
        </svg>
      </button>

      <button
        type="button"
        class="icon-btn"
        title="历史记录"
        aria-label="历史记录"
        onclick={() => {
          drawerTab = 'history';
          drawerOpen = true;
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>

      <button
        type="button"
        class="icon-btn"
        title="清空"
        aria-label="清空"
        disabled={snapshot.isEmpty}
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

      {#if host.setAlwaysOnTop}
        <button
          type="button"
          class="icon-btn"
          class:active={pinned}
          title={pinned ? '取消窗口置顶' : '窗口置顶'}
          aria-label="窗口置顶"
          onclick={() => void togglePin()}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
          </svg>
        </button>
      {/if}

      <span class="toolbar-sep"></span>

      <button
        type="button"
        class="icon-btn"
        title="切换浅色/深色"
        aria-label="切换主题"
        onclick={toggleTheme}
      >
        {#if resolvedTheme === 'dark'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
            <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
          </svg>
        {/if}
      </button>

      <button
        type="button"
        class="icon-btn"
        title="设置"
        aria-label="设置"
        onclick={() => (settingsOpen = true)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      <button
        type="button"
        class="primary-cta"
        disabled={snapshot.isEmpty}
        onclick={() => void handlePrimarySubmit()}
      >
        {host.primaryActionLabel}
      </button>
    </div>
  </header>

  <VisualCanvas
    bind:this={canvasRef}
    {snapshot}
    shiftedUp={ribbonPopoverOpen}
    showHierarchyBoxes={settings.showHierarchyBoxes}
    onKeyEvent={handleKeyEvent}
    onTextInput={(text) => {
      engine.insertText(text);
      sync();
    }}
    onPaste={(text) => {
      engine.pasteText(text);
      sync();
    }}
    onClickSlot={(slotId, offset) => {
      engine.setCursor(slotId, offset);
      sync();
    }}
    onDragSelect={(slotId, anchor, focus) => {
      engine.setSelection(slotId, anchor, focus);
      sync();
    }}
    onDoubleClickAtom={(slotId, offset) => {
      engine.selectWordOrAtomAt(slotId, offset);
      sync();
    }}
    onJumpTarget={(label) => {
      engine.handleJumpKey(label);
      sync();
      canvasRef?.focus();
    }}
    onFocusChange={(focused) => {
      engine.setFocused(focused);
      sync();
    }}
    onAddGridRow={() => {
      engine.addGridRow();
      sync();
      canvasRef?.focus();
    }}
    onRemoveGridRow={() => {
      engine.removeGridRow();
      sync();
      canvasRef?.focus();
    }}
    onAddGridCol={() => {
      engine.addGridCol();
      sync();
      canvasRef?.focus();
    }}
    onRemoveGridCol={() => {
      engine.removeGridCol();
      sync();
      canvasRef?.focus();
    }}
  />

  <MathRibbon
    leaderKey={settings.leaderKey}
    leaderActive={snapshot.mode.kind === 'leader'}
    leaderPrefix={snapshot.mode.kind === 'leader' ? snapshot.mode.prefix : ''}
    pendingDefaultId={snapshot.mode.kind === 'leader' ? snapshot.mode.pendingDefaultId : undefined}
    commands={effectiveCommands}
    {customCommands}
    {snippets}
    onPopoverChange={(open) => (ribbonPopoverOpen = open)}
    onInsertCommand={(id) => {
      engine.insertCommand(id);
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
      delimiter={settings.delimiter}
      onApplyRawLatex={handleLoadFormula}
      onCycleDelimiter={cycleDelimiter}
      onSaveSnippet={openSaveSnippetModal}
      onCopy={() => void handleCopy()}
      onCopyMathML={() => void handleCopyMathML()}
      onCopyPng={() => void handleCopyPng()}
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
      initialTab={drawerTab}
      onInsertCommand={(id) => {
        engine.insertCommand(id);
        sync();
        canvasRef?.focus();
      }}
      onInsertSnippet={(snip) => {
        engine.insertSnippetAtCursor(snip);
        sync();
        canvasRef?.focus();
      }}
      onLoadFormula={handleLoadFormula}
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
</div>

<style>
  .studio-shell {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 440px;
    overflow: hidden;
  }

  .topbar {
    height: 48px;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 0 14px;
    border-bottom: 1px solid var(--ms-border);
    background: var(--ms-chrome);
    flex-shrink: 0;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    user-select: none;
  }

  .brand-mark {
    color: var(--ms-accent);
  }

  .brand-name {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.02em;
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
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--ms-surface-muted);
    max-width: 100%;
    overflow: hidden;
  }

  .crumb-btn {
    border: none;
    background: transparent;
    color: var(--ms-fg-muted);
    font-size: 11.5px;
    padding: 1px 3px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }

  .crumb-btn:hover {
    color: var(--ms-accent);
  }

  .crumb-sep {
    color: var(--ms-fg-faint);
    font-size: 11px;
  }

  .crumb-up {
    border: 1px solid var(--ms-border);
    background: var(--ms-surface);
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
  }

  .crumb-up:hover {
    border-color: var(--ms-accent);
    color: var(--ms-accent);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .toolbar-sep {
    width: 1px;
    height: 16px;
    background: var(--ms-border);
    margin: 0 4px;
  }

  .text-btn {
    height: 28px;
    padding: 0 9px;
    margin: 0 2px;
    border: 1px solid var(--ms-border);
    border-radius: 7px;
    background: var(--ms-surface);
    color: var(--ms-fg-muted);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: border-color 80ms ease, color 80ms ease, background-color 80ms ease;
  }

  .text-btn:hover {
    border-color: var(--ms-accent);
    color: var(--ms-accent);
    background: var(--ms-accent-soft);
  }

  .icon-btn {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--ms-fg-muted);
    cursor: pointer;
    transition: background-color 80ms ease, color 80ms ease;
  }

  .icon-btn:hover:not(:disabled) {
    background: var(--ms-surface-muted);
    color: var(--ms-fg);
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
    height: 30px;
    margin-left: 6px;
    padding: 0 13px;
    border: none;
    border-radius: 7px;
    background: var(--ms-accent);
    color: var(--ms-accent-fg);
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 90ms ease;
  }

  .primary-cta:hover:not(:disabled) {
    background: var(--ms-accent-hover);
  }

  .primary-cta:disabled {
    opacity: 0.38;
    cursor: default;
  }

  .toast {
    position: absolute;
    top: 58px;
    left: 50%;
    transform: translateX(-50%);
    padding: 5px 12px;
    border-radius: 999px;
    background: var(--ms-fg);
    color: var(--ms-bg);
    font-size: 12px;
    font-weight: 500;
    box-shadow: var(--ms-shadow-md);
    pointer-events: none;
    z-index: 40;
  }
</style>
