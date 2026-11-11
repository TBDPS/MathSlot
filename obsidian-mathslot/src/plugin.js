"use strict";

const {
  Modal,
  MarkdownView,
  Notice,
  Plugin,
  finishRenderMath,
  loadMathJax,
  renderMath,
} = require("obsidian");

// 由 scripts/build.mjs 在构建时自动内联 mathslot-wasm 编译产物（零外部文件依赖）
const WASM_BASE64 = "__MATHSLOT_WASM_BASE64__";

function decodeBase64ToBytes(b64) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/**
 * UTF-16 code unit 下标 <-> Unicode 标量字符 (`char_idx`) 互转，保证含 `▸` 或特殊符号时光标零偏差
 */
function utf16OffsetToCharIdx(str, utf16Idx) {
  const clamped = Math.max(0, Math.min(utf16Idx, str.length));
  return Array.from(str.slice(0, clamped)).length;
}

function charIdxToUtf16Offset(str, charIdx) {
  if (charIdx <= 0) return 0;
  let count = 0;
  let u16 = 0;
  for (const ch of str) {
    if (count >= charIdx) break;
    u16 += ch.length;
    count += 1;
  }
  return u16;
}

class MathSlotWasmBridge {
  constructor(instance) {
    this.exports = instance.exports;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder("utf-8");
  }

  static async create() {
    const bytes = decodeBase64ToBytes(WASM_BASE64);
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new MathSlotWasmBridge(instance);
  }

  readRawStr(len) {
    const ptr = this.exports.out_ptr();
    const view = new Uint8Array(this.exports.memory.buffer, ptr, len);
    return this.decoder.decode(view);
  }

  readJson(len) {
    return JSON.parse(this.readRawStr(len));
  }

  withStr(str, fn) {
    const bytes = this.encoder.encode(str || "");
    if (bytes.length === 0) {
      return fn(0, 0);
    }
    const ptr = this.exports.wasm_alloc(bytes.length);
    try {
      new Uint8Array(this.exports.memory.buffer, ptr, bytes.length).set(bytes);
      return fn(ptr, bytes.length);
    } finally {
      this.exports.wasm_dealloc(ptr, bytes.length);
    }
  }

  catalog() {
    return this.readJson(this.exports.get_catalog_json());
  }

  reset() {
    return this.readJson(this.exports.editor_reset());
  }

  snapshot() {
    return this.readJson(this.exports.editor_snapshot_json());
  }

  syncText(text, cursorChar, recordUndo) {
    return this.withStr(text, (ptr, len) =>
      this.readJson(
        this.exports.editor_sync_text(ptr, len, cursorChar, recordUndo ? 1 : 0)
      )
    );
  }

  setCursor(cursorChar) {
    return this.readJson(this.exports.editor_set_cursor(cursorChar));
  }

  tab() {
    return this.readJson(this.exports.editor_tab());
  }

  enter() {
    return this.readJson(this.exports.editor_enter());
  }

  spaceDefault() {
    return this.readJson(this.exports.editor_space_default());
  }

  toggleEsc() {
    return this.readJson(this.exports.editor_toggle_esc());
  }

  escBackspace() {
    return this.readJson(this.exports.editor_esc_backspace());
  }

  escChar(ch) {
    return this.readJson(this.exports.editor_esc_char(ch.codePointAt(0)));
  }

  clickCard(code) {
    return this.withStr(code, (ptr, len) =>
      this.readJson(this.exports.editor_click_card(ptr, len))
    );
  }

  clickSub(ch) {
    return this.readJson(this.exports.editor_click_sub(ch.codePointAt(0)));
  }

  jumpSeq(seq) {
    return this.withStr(seq, (ptr, len) =>
      this.readJson(this.exports.editor_jump_seq(ptr, len))
    );
  }

  loadPreset(source, name) {
    return this.withStr(source, (sPtr, sLen) =>
      this.withStr(name, (nPtr, nLen) =>
        this.readJson(this.exports.editor_load_preset(sPtr, sLen, nPtr, nLen))
      )
    );
  }

  undo() {
    return this.readJson(this.exports.editor_undo());
  }

  redo() {
    return this.readJson(this.exports.editor_redo());
  }

  clear() {
    return this.readJson(this.exports.editor_clear());
  }

  arrowUp() {
    return this.readJson(this.exports.editor_arrow_up());
  }

  arrowDown() {
    return this.readJson(this.exports.editor_arrow_down());
  }

  arrowLeft() {
    const len = this.exports.editor_arrow_left();
    return len > 0 ? this.readJson(len) : null;
  }

  arrowRight() {
    const len = this.exports.editor_arrow_right();
    return len > 0 ? this.readJson(len) : null;
  }

  jumpBack() {
    return this.readJson(this.exports.editor_jump_back());
  }

  jumpStart() {
    return this.readJson(this.exports.editor_jump_start());
  }

  jumpEnd() {
    return this.readJson(this.exports.editor_jump_end());
  }

  libraryGetRaw() {
    return this.readRawStr(this.exports.library_get_json());
  }

  librarySetRaw(jsonStr) {
    return this.withStr(jsonStr, (p, l) =>
      this.readJson(this.exports.library_set_json(p, l))
    );
  }

  libraryResetDefault() {
    return this.readJson(this.exports.library_reset_default());
  }

  upsertCustom(key, label, glyph, rolesCsv, latexTpl, schemeA) {
    const cp = (key || " ").codePointAt(0);
    return this.withStr(label, (lp, ll) =>
      this.withStr(glyph, (gp, gl) =>
        this.withStr(rolesCsv, (rp, rl) =>
          this.withStr(latexTpl, (tp, tl) =>
            this.withStr(schemeA, (sp, sl) =>
              this.readJson(
                this.exports.library_upsert_custom(
                  cp,
                  lp,
                  ll,
                  gp,
                  gl,
                  rp,
                  rl,
                  tp,
                  tl,
                  sp,
                  sl
                )
              )
            )
          )
        )
      )
    );
  }

  removeCustom(key) {
    return this.readJson(
      this.exports.library_remove_custom((key || " ").codePointAt(0))
    );
  }

  saveSnippet(label, preferInner) {
    return this.withStr(label || "", (p, l) =>
      this.readJson(
        this.exports.library_save_snippet(p, l, preferInner ? 1 : 0)
      )
    );
  }

  upsertSnippet(key, label, streamSource) {
    const cp = (key || " ").codePointAt(0);
    return this.withStr(label, (lp, ll) =>
      this.withStr(streamSource, (sp, sl) =>
        this.readJson(
          this.exports.library_upsert_snippet(cp, lp, ll, sp, sl)
        )
      )
    );
  }

  removeSnippet(key) {
    return this.readJson(
      this.exports.library_remove_snippet((key || " ").codePointAt(0))
    );
  }
}

class MathSlotModal extends Modal {
  constructor(app, bridge, catalog, initialDelim, targetEditor, onPersistLibrary) {
    super(app);
    this.bridge = bridge;
    this.catalog = catalog;
    this.delimStyle = initialDelim || "inline"; // "inline" | "display" | "none"
    this.targetEditor = targetEditor || null;
    this.onPersistLibrary = onPersistLibrary || null;
    this.presetIdx = 0;
    this.lastTypingUndoAt = 0;
    this.state = null;
    this.drawerMode = null; // null | "custom" | "snippets" | "help"
    this.altTapAt = 0;
    this.altCombo = false;
    this.navLeaderUntil = 0;

    // Escape 单一入口：抽屉打开时先收抽屉；导航中退出导航；其余情况交给 Modal 默认关闭。
    this.scope.register([], "Escape", (evt) => {
      if (this.drawerMode) {
        evt.preventDefault();
        this.setDrawer(null);
        this.focusStreamInput();
        return false;
      }
      if (this.state && this.state.escActive) {
        evt.preventDefault();
        this.applyState(this.bridge.toggleEsc(), false);
        return false;
      }
      return true;
    });

    // Modal 自身只保留 Shift+Esc 强制关闭；导航进入/退出统一在输入框 keydown 中处理，
    // 避免 scope 与 input 两套事件重复切换。
    this.scope.register(["Shift"], "Escape", (evt) => {
      evt.preventDefault();
      this.close();
      return false;
    });
    this.scope.register([], "F1", (evt) => {
      evt.preventDefault();
      this.setDrawer(this.drawerMode === "help" ? null : "help");
      return false;
    });
  }

  async onOpen() {
    this.modalEl.addClass("mathslot-modal");
    await loadMathJax();

    this.state = this.bridge.reset();
    this.buildDom();
    this.applyState(this.state, true);
  }

  onClose() {
    this.contentEl.empty();
  }

  formattedLatex() {
    const raw = (this.state && this.state.latex) || "";
    if (!raw) return "";
    if (this.delimStyle === "none") return raw;
    if (this.delimStyle === "display") return `$$\n${raw}\n$$`;
    return `$${raw}$`;
  }

  insertOrCopyLatex(forceCopyOnly) {
    const out = this.formattedLatex();
    if (!out) {
      new Notice("当前尚无公式内容可输出");
      return;
    }

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = this.targetEditor || (activeView && activeView.editor);

    if (!forceCopyOnly && editor) {
      editor.replaceSelection(out);
      new Notice("✓ 已将 LaTeX 公式插入当前笔记光标处");
      this.close();
      editor.focus();
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(out)
        .then(() => new Notice("✓ 已将 LaTeX 复制到剪贴板"))
        .catch((err) => {
          console.error("MathSlot: 剪贴板写入失败", err);
          new Notice("✗ 复制到剪贴板失败，请手动复制 LaTeX 面板内容。");
        });
    } else {
      new Notice("当前环境不支持剪贴板 API，请手动复制 LaTeX 面板内容。");
    }
    this.focusStreamInput();
  }

  focusStreamInput() {
    if (this.inputEl) {
      this.inputEl.focus();
    }
  }

  syncInputCursor(charIdx) {
    if (!this.inputEl) return;
    const u16 = charIdxToUtf16Offset(this.inputEl.value, charIdx);
    this.inputEl.setSelectionRange(u16, u16);
  }

  buildDom() {
    const root = this.contentEl.createDiv({ cls: "mathslot-root" });

    // 1. 顶部栏
    const topbar = root.createDiv({ cls: "mathslot-topbar" });
    const brand = topbar.createDiv({ cls: "mathslot-brand" });
    brand.createSpan({ cls: "mathslot-title", text: "MathSlot" });
    brand.createSpan({
      cls: "mathslot-subtitle",
      text: "流式简码公式编辑器 · Tab j 进导航 · Tab / Esc 退出 · Shift+Esc 关闭",
    });
    this.modeBadgeEl = brand.createSpan({ cls: "mathslot-mode-badge" });

    const actions = topbar.createDiv({ cls: "mathslot-actions" });
    const presetBtn = actions.createEl("button", {
      cls: "mathslot-btn",
      text: "示例 ↻",
    });
    presetBtn.addEventListener("click", () => {
      const presets = this.catalog.presets || [];
      if (!presets.length) return;
      const item = presets[this.presetIdx % presets.length];
      this.presetIdx = (this.presetIdx + 1) % presets.length;
      this.applyState(this.bridge.loadPreset(item.source, item.name), true);
    });

    this.undoBtn = actions.createEl("button", {
      cls: "mathslot-btn",
      text: "撤销",
    });
    this.undoBtn.addEventListener("click", () => {
      this.applyState(this.bridge.undo(), true);
    });

    this.redoBtn = actions.createEl("button", {
      cls: "mathslot-btn",
      text: "重做",
    });
    this.redoBtn.addEventListener("click", () => {
      this.applyState(this.bridge.redo(), true);
    });

    const clearBtn = actions.createEl("button", {
      cls: "mathslot-btn",
      text: "清空",
    });
    clearBtn.addEventListener("click", () => {
      this.applyState(this.bridge.clear(), true);
    });

    this.jumpBackBtn = actions.createEl("button", {
      cls: "mathslot-btn",
      text: "↶回原位",
      attr: { title: "返回上一个跳转位置（导航中 - 或 Alt+←，支持来回切换）" },
    });
    this.jumpBackBtn.addEventListener("click", () => {
      this.applyState(this.bridge.jumpBack(), true);
    });

    const saveSnipBtn = actions.createEl("button", {
      cls: "mathslot-btn",
      text: "+存片段",
      attr: {
        style: "color:#4ade80 !important",
        title: "将光标处子结构（或整行公式）保存为可复用片段模版 (Ctrl+Shift+S)",
      },
    });
    saveSnipBtn.addEventListener("click", () => this.quickSaveCurrentSnippet(true));

    const libBtn = actions.createEl("button", {
      cls: "mathslot-btn",
      text: "扩展/模版",
      attr: {
        style: "color:#fbbf24 !important",
        title: "无需改源码：管理自定义数学格式 [k▸] 与复用片段库 [t▸]",
      },
    });
    libBtn.addEventListener("click", () => {
      this.setDrawer(
        this.drawerMode === "custom" || this.drawerMode === "snippets"
          ? null
          : "custom"
      );
    });

    const helpBtn = actions.createEl("button", {
      cls: "mathslot-btn",
      text: "? 帮助",
      attr: {
        style: "color:#38bdf8 !important",
        title: "查看完整快捷键、前置包裹与扩展指南 (F1)",
      },
    });
    helpBtn.addEventListener("click", () => {
      this.setDrawer(this.drawerMode === "help" ? null : "help");
    });

    // 2. 严格固定高度菜单盒 + 可折叠扩展/帮助抽屉
    this.menuBoxEl = root.createDiv({ cls: "mathslot-menu-box" });
    this.drawerEl = root.createDiv({ cls: "mathslot-drawer is-hidden" });

    // 3. 线性流输入卡片
    const inputCard = root.createDiv({ cls: "mathslot-input-card" });
    this.breadcrumbRowEl = inputCard.createDiv({ cls: "mathslot-section-head" });

    this.inputEl = inputCard.createEl("input", {
      cls: "mathslot-stream-input",
      attr: {
        type: "text",
        spellcheck: "false",
        autocomplete: "off",
        placeholder:
          "直接输入如 x -> 0, oo, +-；按 Tab + f(分数) / r(根号) / l(极限:自动带→)，Enter(;) 推进下一槽…",
      },
    });

    this.inputEl.addEventListener("keydown", (evt) => this.onInputKeyDown(evt));
    this.inputEl.addEventListener("input", () => this.onInputChanged());
    this.inputEl.addEventListener("click", () => this.onSelectionMoved());
    this.inputEl.addEventListener("keyup", (evt) => {
      if (evt.key === "Alt") {
        if (!this.altCombo && performance.now() - this.altTapAt <= 500) {
          this.navLeaderUntil = performance.now() + 800;
          if (this.statusEl) {
            this.statusEl.setText("Alt 已就绪：按 j 进入导航");
          }
        }
        this.altCombo = false;
        return;
      }
      if (
        ["ArrowLeft", "ArrowRight", "Home", "End"].includes(evt.key) &&
        !this.state.escActive
      ) {
        this.onSelectionMoved();
      }
    });

    this.statusEl = inputCard.createDiv({ cls: "mathslot-status" });

    // 4. 窄幅居中实时公式预览 + 分层结构导航栏
    const visualStack = root.createDiv({ cls: "mathslot-visual-stack" });

    const previewHead = visualStack.createDiv({ cls: "mathslot-section-head" });
    previewHead.createSpan({
      cls: "mathslot-dot",
      attr: { style: "background:#4ade80" },
    });
    previewHead.createEl("strong", { text: "实时公式预览" });
    this.addLegend(previewHead, "#4ade80", "当前活跃槽位 & 光标 ∣");
    this.addLegend(previewHead, "#f87171", "待填槽位");
    this.previewSurfaceEl = visualStack.createDiv({ cls: "mathslot-surface" });

    this.navHeadEl = visualStack.createDiv({ cls: "mathslot-section-head" });
    this.navSurfaceEl = visualStack.createDiv({ cls: "mathslot-surface" });

    // 5. 底部双栏：左 线性函数展开形态 + 右 LaTeX 输出与插入按钮
    const bottomGrid = root.createDiv({ cls: "mathslot-bottom-grid" });

    const colA = bottomGrid.createDiv({ cls: "mathslot-out-col" });
    const headA = colA.createDiv({ cls: "mathslot-out-head" });
    const titleA = headA.createDiv();
    titleA.createEl("strong", {
      text: "展开形态 (线性函数调用) ",
      attr: { style: "color:#38bdf8;font-size:12.5px" },
    });
    titleA.createSpan({
      text: "层次核对",
      attr: { style: "color:#94a3b8;font-size:11px" },
    });
    const copyABtn = headA.createEl("button", {
      cls: "mathslot-btn",
      text: "复制函数式",
    });
    copyABtn.addEventListener("click", () => {
      if (this.state && this.state.schemeA) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard
            .writeText(this.state.schemeA)
            .then(() => new Notice("✓ 已复制线性函数展开式"))
            .catch((err) => {
              console.error("MathSlot: 剪贴板写入失败", err);
              new Notice("✗ 复制失败，请手动选择面板内容复制。");
            });
        } else {
          new Notice("当前环境不支持剪贴板 API，请手动复制展开式内容。");
        }
      }
      this.focusStreamInput();
    });
    this.schemeABoxEl = colA.createDiv({ cls: "mathslot-code-box" });

    const colLatex = bottomGrid.createDiv({ cls: "mathslot-out-col" });
    const headLatex = colLatex.createDiv({ cls: "mathslot-out-head" });
    headLatex.createEl("strong", {
      text: "LaTeX 输出",
      attr: { style: "color:#60a5fa;font-size:12.5px" },
    });

    const rightControls = headLatex.createDiv({ cls: "mathslot-actions" });
    const delimGroup = rightControls.createDiv({ cls: "mathslot-delim-group" });
    this.delimTabs = {};
    for (const [key, label] of [
      ["none", "裸代码"],
      ["inline", "$…$"],
      ["display", "$$…$$"],
    ]) {
      const tab = delimGroup.createEl("button", {
        cls: "mathslot-delim-tab",
        text: label,
      });
      tab.addEventListener("click", () => {
        this.delimStyle = key;
        this.refreshOutputBoxes();
        this.focusStreamInput();
      });
      this.delimTabs[key] = tab;
    }

    const insertBtn = rightControls.createEl("button", {
      cls: "mathslot-btn mathslot-btn-primary",
      text: "直接插入笔记 (Ctrl+Enter)",
    });
    insertBtn.addEventListener("click", () => this.insertOrCopyLatex(false));

    this.latexBoxEl = colLatex.createDiv({ cls: "mathslot-code-box" });
  }

  addLegend(parent, hex, label) {
    const item = parent.createSpan({ cls: "mathslot-legend" });
    item.createSpan({
      cls: "mathslot-dot",
      attr: { style: `background:${hex};width:7px;height:7px` },
    });
    item.createSpan({ text: label });
  }

  onInputKeyDown(evt) {
    // IME 组合窗口内（中文/日文候选词上屏）不处理任何编辑器快捷键，
    // 防止 Enter 确认候选词被误触为槽位推进
    if (evt.isComposing || evt.keyCode === 229) {
      return;
    }
    const mod = evt.ctrlKey || evt.metaKey;

    // Alt 轻按松开作为 leader：窗口内按 j 进入/退出导航，不要求按住 Alt。
    if (evt.key === "Alt") {
      this.altTapAt = performance.now();
      this.altCombo = false;
      return;
    }
    if (evt.altKey) {
      this.altCombo = true;
    }
    if (
      !mod &&
      !evt.altKey &&
      evt.key.toLowerCase() === "j" &&
      performance.now() <= this.navLeaderUntil
    ) {
      evt.preventDefault();
      this.navLeaderUntil = 0;
      this.applyState(this.bridge.toggleEsc(), false);
      return;
    }

    if (mod && evt.key === "Enter") {
      evt.preventDefault();
      this.insertOrCopyLatex(false);
      return;
    }
    if (mod && evt.shiftKey && evt.key.toLowerCase() === "c") {
      evt.preventDefault();
      this.insertOrCopyLatex(true);
      return;
    }
    if (mod && evt.shiftKey && evt.key.toLowerCase() === "s") {
      evt.preventDefault();
      this.quickSaveCurrentSnippet(true);
      return;
    }
    if (!mod && evt.altKey && evt.key === "ArrowLeft") {
      evt.preventDefault();
      this.applyState(this.bridge.jumpBack(), true);
      return;
    }
    if (
      (mod && evt.shiftKey && evt.key.toLowerCase() === "z") ||
      (mod && !evt.shiftKey && evt.key.toLowerCase() === "y")
    ) {
      evt.preventDefault();
      this.applyState(this.bridge.redo(), true);
      return;
    }
    if (mod && !evt.shiftKey && evt.key.toLowerCase() === "z") {
      evt.preventDefault();
      this.applyState(this.bridge.undo(), true);
      return;
    }

    // Tab j：先按 Tab 形成 `▸`，再按 j 直接进入导航（顺序按键，不是组合键）。
    if (
      !mod &&
      !evt.altKey &&
      this.state &&
      this.state.menuMode === "root" &&
      evt.key.toLowerCase() === "j"
    ) {
      evt.preventDefault();
      this.applyState(this.bridge.tab(), true);
      this.applyState(this.bridge.toggleEsc(), false);
      return;
    }

    // 选区 + 左括号：只包裹选中的字面文本
    if (
      !mod &&
      !evt.altKey &&
      !(this.state && this.state.escActive) &&
      /^[([{]$/.test(evt.key) &&
      this.inputEl.selectionStart !== this.inputEl.selectionEnd
    ) {
      evt.preventDefault();
      const open = evt.key;
      const close = open === "(" ? ")" : open === "[" ? "]" : "}";
      const start = this.inputEl.selectionStart;
      const end = this.inputEl.selectionEnd;
      const val = this.inputEl.value;
      const selected = val.slice(start, end);
      const nextVal = val.slice(0, start) + open + selected + close + val.slice(end);
      const cursorChar = utf16OffsetToCharIdx(
        nextVal,
        start + open.length + selected.length + close.length
      );
      this.applyState(this.bridge.syncText(nextVal, cursorChar, true), true);
      return;
    }

    if (this.state && this.state.escActive) {
      if (evt.key === "Backspace") {
        evt.preventDefault();
        this.applyState(this.bridge.escBackspace(), false);
        return;
      }
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        this.applyState(this.bridge.enter(), true);
        return;
      }
      if (evt.key === "Tab") {
        evt.preventDefault();
        this.applyState(this.bridge.tab(), false);
        return;
      }
      if (evt.key === "Home") {
        evt.preventDefault();
        this.applyState(this.bridge.jumpStart(), true);
        return;
      }
      if (evt.key === "End") {
        evt.preventDefault();
        this.applyState(this.bridge.jumpEnd(), true);
        return;
      }
      if (evt.key === "ArrowUp") {
        evt.preventDefault();
        this.applyState(this.bridge.arrowUp(), true);
        return;
      }
      if (evt.key === "ArrowDown") {
        evt.preventDefault();
        this.applyState(this.bridge.arrowDown(), true);
        return;
      }
      if (evt.key === "ArrowLeft") {
        evt.preventDefault();
        const next = this.bridge.arrowLeft();
        if (next) this.applyState(next, true);
        return;
      }
      if (evt.key === "ArrowRight") {
        evt.preventDefault();
        const next = this.bridge.arrowRight();
        if (next) this.applyState(next, true);
        return;
      }
      if (!mod && !evt.altKey && /^[a-zA-Z0;.\$\-`()]$/.test(evt.key)) {
        evt.preventDefault();
        const next = this.bridge.escChar(evt.key.toLowerCase());
        this.applyState(next, evt.key === "(" || evt.key === ")" || !next.escActive);
        return;
      }
      return;
    }

    if (
      this.state &&
      this.state.menuMode === "submenu" &&
      !mod &&
      evt.key === " "
    ) {
      evt.preventDefault();
      this.applyState(this.bridge.spaceDefault(), true);
      return;
    }

    if (
      this.state &&
      this.state.menuMode === "idle" &&
      !mod &&
      !evt.altKey &&
      !evt.shiftKey
    ) {
      if (evt.key === "ArrowUp") {
        evt.preventDefault();
        this.applyState(this.bridge.arrowUp(), true);
        return;
      }
      if (evt.key === "ArrowDown") {
        evt.preventDefault();
        this.applyState(this.bridge.arrowDown(), true);
        return;
      }
      const noSelection =
        this.inputEl.selectionStart === this.inputEl.selectionEnd;
      if (noSelection && evt.key === "ArrowLeft") {
        const next = this.bridge.arrowLeft();
        if (next) {
          evt.preventDefault();
          this.applyState(next, true);
          return;
        }
      }
      if (noSelection && evt.key === "ArrowRight") {
        const next = this.bridge.arrowRight();
        if (next) {
          evt.preventDefault();
          this.applyState(next, true);
          return;
        }
      }
    }

    if (!mod && !evt.shiftKey && evt.key === "Tab") {
      evt.preventDefault();
      this.applyState(this.bridge.tab(), true);
      return;
    }

    if (!mod && !evt.shiftKey && evt.key === "Enter") {
      evt.preventDefault();
      this.applyState(this.bridge.enter(), true);
    }
  }

  onInputChanged() {
    const val = this.inputEl.value;
    const curChar = utf16OffsetToCharIdx(
      val,
      this.inputEl.selectionStart || 0
    );
    const now = performance.now();
    const prevLen = Array.from((this.state && this.state.source) || "").length;
    const curLen = Array.from(val).length;
    const recordUndo =
      now - this.lastTypingUndoAt > 450 || Math.abs(curLen - prevLen) > 1;
    if (recordUndo) {
      this.lastTypingUndoAt = now;
    }
    const next = this.bridge.syncText(val, curChar, recordUndo);
    const mutatedByEngine = next.source !== val || next.cursorChar !== curChar;
    this.applyState(next, mutatedByEngine);
  }

  onSelectionMoved() {
    if (!this.inputEl || (this.state && this.state.escActive)) return;
    const curChar = utf16OffsetToCharIdx(
      this.inputEl.value,
      this.inputEl.selectionStart || 0
    );
    if (!this.state || curChar !== this.state.cursorChar) {
      this.applyState(this.bridge.setCursor(curChar), false);
    }
  }

  quickSaveCurrentSnippet(preferInner) {
    const next = this.bridge.saveSnippet("", preferInner);
    this.persistAndRefreshCatalog();
    this.applyState(next, false);
    if (this.drawerMode === "snippets") {
      this.renderDrawer();
    }
  }

  persistAndRefreshCatalog() {
    this.catalog = this.bridge.catalog();
    if (this.onPersistLibrary) {
      this.onPersistLibrary(this.bridge.libraryGetRaw());
    }
  }

  setDrawer(mode) {
    this.drawerMode = mode;
    if (!this.drawerEl) return;
    if (!mode) {
      this.drawerEl.empty();
      this.drawerEl.addClass("is-hidden");
      this.focusStreamInput();
      return;
    }
    this.drawerEl.removeClass("is-hidden");
    this.renderDrawer();
  }

  applyState(state, syncInputValueAndCursor) {
    this.state = state;

    if (syncInputValueAndCursor && this.inputEl) {
      if (this.inputEl.value !== state.source) {
        this.inputEl.value = state.source;
      }
      this.syncInputCursor(state.cursorChar);
    }

    this.undoBtn.disabled = !state.canUndo;
    this.redoBtn.disabled = !state.canRedo;
    if (this.jumpBackBtn) {
      this.jumpBackBtn.disabled = !state.canJumpBack;
    }
    this.statusEl.setText(state.status);

    this.renderModeBadge(state);
    this.renderMenuBox(state);
    this.renderBreadcrumbs(state);
    this.renderMathPanels(state);
    this.refreshOutputBoxes();
    if (!this.drawerMode) {
      this.focusStreamInput();
    }
  }

  renderModeBadge(state) {
    let text = "● 流式输入态";
    let color = "#4ade80";
    if (state.escActive) {
      if (state.escPath.length > 0) {
        text = `● 子式导航 [${state.escPath.join(" › ")}]`;
        color = "#a78bfa";
      } else {
        text = "● 导航直达态 (Tab j)";
        color = "#60a5fa";
      }
    } else if (state.menuMode === "root") {
      text = "● 已按 Tab(▸)：请按键";
      color = "#fbbf24";
    } else if (state.menuMode === "submenu") {
      text = `● 子菜单 ▸${state.menuSubKey}`;
      color = "#fbbf24";
    } else if (state.menuMode === "jump") {
      text = `● 内联跳转 ▸j${state.menuJumpSeq}`;
      color = "#38bdf8";
    } else if (state.menuMode === "invalid") {
      text = `● 未知键 ▸${state.menuInvalidKey}`;
      color = "#f87171";
    }
    this.modeBadgeEl.setText(text);
    this.modeBadgeEl.style.color = color;
  }

  renderMenuBox(state) {
    const box = this.menuBoxEl;
    box.empty();
    box.className = "mathslot-menu-box";

    if (state.escActive || state.menuMode === "jump") {
      box.addClass(state.escActive ? "is-esc" : "is-jump");
      const head = box.createDiv({ cls: "mathslot-row-label" });
      head.style.color = "#60a5fa";
      if (state.navViewPath.length === 0) {
        head.setText(
          state.escActive
            ? "Tab j 导航直达 · [a] 行首 · [;/.] 行尾 · [-] 回上一位置 · 字母直达槽位 · ( ) 括号内/外 · ↑↓←→ 漫游（Tab / Esc / Alt j 退出）"
            : `内联跳转 ▸j${state.menuJumpSeq}：按字母直达，. 行尾，- 回上一位置（自动擦除跳转码）`
        );
      } else {
        head.setText(
          `子式导航 [${state.navViewPath.join(" › ")}+]（${state.navStageTitle}）：按字母或 ; 定位子式，Enter 停在该槽末尾，Backspace/↑ 返回上层`
        );
      }

      const row = box.createDiv({ cls: "mathslot-menu-row" });
      if (state.enclosingBracket) {
        for (const [ch, label, close] of [
          ["(", "括号内", false],
          [")", "括号外", true],
        ]) {
          const pill = row.createEl("span", {
            cls: "mathslot-pill",
            attr: {
              title: `跳到 ${state.enclosingBracket.openChar} 配对括号的${close ? "外侧" : "内侧"}`,
            },
          });
          pill.createSpan({
            cls: "mathslot-pill-key",
            text: `[${ch}]`,
            attr: { style: "color:#22d3ee" },
          });
          pill.createSpan({ text: label });
          pill.addEventListener("mousedown", (ev) => {
            ev.preventDefault();
            this.applyState(this.bridge.jumpSeq(ch), true);
          });
        }
      }
      if (state.canJumpBack && !state.menuJumpSeq) {
        const backPill = row.createEl("span", {
          cls: "mathslot-pill",
          attr: { title: "按 - 或 Alt+← 跳回上一个跳转位置" },
        });
        backPill.createSpan({
          cls: "mathslot-pill-key",
          text: "[↶ -]",
          attr: { style: "color:#fbbf24" },
        });
        backPill.createSpan({ text: "上一位置" });
        backPill.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          this.applyState(this.bridge.jumpSeq("-"), true);
        });
      }
      for (const e of state.navEntries) {
        const pill = row.createEl("span", { cls: "mathslot-pill" });
        const keyColor =
          e.kind === "start" || e.kind === "end"
            ? "#38bdf8"
            : e.kind === "empty"
              ? "#f87171"
              : e.kind === "composite"
                ? "#a78bfa"
                : "#60a5fa";
        const tag = e.kind === "composite" ? `[${e.label}+]` : `[${e.label}]`;
        pill.createSpan({
          cls: "mathslot-pill-key",
          text: tag,
          attr: { style: `color:${keyColor}` },
        });
        if (e.role) {
          pill.createSpan({ text: e.role });
        }
        pill.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          this.applyState(this.bridge.jumpSeq(e.fullSeq), true);
        });
      }
      return;
    }

    if (state.menuMode === "submenu") {
      box.addClass("is-armed");
      const sub = (this.catalog.subCategories || []).find(
        (s) => s.key === state.menuSubKey
      );
      if (!sub) return;
      const headRow = box.createDiv({ cls: "mathslot-menu-row" });
      const head = headRow.createSpan({ cls: "mathslot-row-label" });
      head.style.color = "#fbbf24";
      const defHint = sub.defaultKey
        ? `Enter/空格 选默认 [★${sub.defaultKey}: ${sub.defaultLabel}]`
        : "暂无条目";
      head.setText(
        `▸${sub.key} · ${sub.title} — 按单字母即选；${defHint}（Backspace 退回）`
      );
      if (sub.key === "k" || sub.key === "t") {
        const mgrPill = headRow.createEl("span", { cls: "mathslot-pill" });
        mgrPill.createSpan({
          cls: "mathslot-pill-key",
          text: sub.key === "k" ? "[+ 新增/管理格式]" : "[+ 管理片段库]",
          attr: { style: "color:#4ade80" },
        });
        mgrPill.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          this.setDrawer(sub.key === "k" ? "custom" : "snippets");
        });
      }
      const row = box.createDiv({ cls: "mathslot-menu-row" });
      for (const entry of sub.entries) {
        const pill = row.createEl("span", {
          cls: `mathslot-pill ${entry.isDefault ? "is-default" : "is-armed"}`,
          attr: { title: `▸${entry.code} | ${entry.detail}` },
        });
        pill.createSpan({
          cls: "mathslot-pill-key",
          text: entry.isDefault ? `[★${entry.itemKey}]` : `[${entry.itemKey}]`,
        });
        pill.createSpan({ text: entry.label });
        if (entry.glyph) {
          pill.createSpan({ cls: "mathslot-pill-glyph", text: entry.glyph });
        }
        pill.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          this.applyState(this.bridge.clickCard(entry.code), true);
        });
      }
      return;
    }

    const armed =
      state.menuMode === "root" || state.menuMode === "invalid";
    if (state.menuMode === "root") box.addClass("is-armed");
    if (state.menuMode === "invalid") box.addClass("is-invalid");

    // 第一行：11 个单字母高频直达
    const row1 = box.createDiv({ cls: "mathslot-menu-row" });
    const l1 = row1.createSpan({ cls: "mathslot-row-label" });
    if (state.menuMode === "invalid") {
      l1.setText(`未知 \`${state.menuInvalidKey}\`(退格重按):`);
      l1.style.color = "#f87171";
    } else {
      l1.setText("单字母直达:");
      if (armed) l1.style.color = "#fbbf24";
    }
    for (const d of this.catalog.directEntries || []) {
      const pill = row1.createEl("span", {
        cls: `mathslot-pill ${armed ? "is-armed" : ""}`,
        attr: { title: `Tab + ${d.key} (${d.glyph}) | ${d.detail}` },
      });
      pill.createSpan({ cls: "mathslot-pill-key", text: `[${d.key}]` });
      pill.createSpan({ text: d.label });
      if (d.glyph) {
        pill.createSpan({ cls: "mathslot-pill-glyph", text: d.glyph });
      }
      pill.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        this.applyState(this.bridge.clickCard(d.key), true);
      });
    }

    // 第二行：5 个分组子菜单（均带 ★默认项） + [j] 跳转
    const row2 = box.createDiv({ cls: "mathslot-menu-row" });
    const l2 = row2.createSpan({
      cls: "mathslot-row-label",
      text: "二级子菜单:",
    });
    if (armed) l2.style.color = "#fbbf24";

    for (const sub of this.catalog.subCategories || []) {
      const pill = row2.createEl("span", {
        cls: `mathslot-pill ${armed ? "is-armed" : ""}`,
        attr: {
          title: `Tab + ${sub.key} 展开；再按 Enter/空格 直接选默认「${sub.defaultLabel} (${sub.defaultGlyph})」`,
        },
      });
      pill.createSpan({ cls: "mathslot-pill-key", text: `[${sub.key}▸]` });
      pill.createSpan({ text: sub.title });
      pill.createSpan({
        cls: "mathslot-pill-glyph",
        text: `★${sub.defaultGlyph}`,
      });
      pill.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        this.applyState(this.bridge.clickSub(sub.key), true);
      });
    }

    const jumpPill = row2.createEl("span", {
      cls: "mathslot-pill",
      attr: { title: "Tab 后按 j 进入导航：a 行首 · ;/. 行尾 · p 上一步历史 · n 下一步历史 · - 上一位置 · 字母直达槽位 · ( ) 括号内/外 · ↑↓←→ 穿梭" },
    });
    jumpPill.createSpan({ cls: "mathslot-pill-key", text: "[j]" });
    jumpPill.createSpan({ text: "跳转(Tab j)" });
    jumpPill.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      this.applyState(this.bridge.clickSub("j"), true);
    });

    // 第三行：自定义结构直达（直接外显，支持未占用单字母与 k+单字母）
    const row3 = box.createDiv({ cls: "mathslot-menu-row" });
    const l3 = row3.createSpan({
      cls: "mathslot-row-label",
      text: "自定义/扩展:",
    });
    if (armed) l3.style.color = "#fbbf24";

    const customList = this.catalog.customFormats || [];
    const directKeys = new Set((this.catalog.directEntries || []).map((d) => d.key));
    const subKeys = new Set((this.catalog.subCategories || []).map((s) => s.key));

    for (const fmt of customList) {
      const isFree = !directKeys.has(fmt.key) && !subKeys.has(fmt.key);
      const keyStr = isFree ? fmt.key : `k${fmt.key}`;
      const pill = row3.createEl("span", {
        cls: `mathslot-pill ${armed ? "is-armed" : ""}`,
        attr: { title: `自定义：Tab + ${keyStr} (${fmt.glyph || ""}) | ${fmt.latex || ""}` },
      });
      pill.createSpan({ cls: "mathslot-pill-key", text: `[${keyStr}]` });
      pill.createSpan({ text: fmt.label });
      if (fmt.glyph) {
        pill.createSpan({ cls: "mathslot-pill-glyph", text: fmt.glyph });
      }
      pill.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        this.applyState(this.bridge.clickCard(keyStr), true);
      });
    }

    const addPill = row3.createEl("span", {
      cls: "mathslot-pill",
      attr: { title: "打开自定义格式设计器" },
    });
    addPill.createSpan({
      cls: "mathslot-pill-key",
      text: "[+ 新增]",
      attr: { style: "color:#4ade80" },
    });
    addPill.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      this.setDrawer("custom");
    });
  }

  renderBreadcrumbs(state) {
    const row = this.breadcrumbRowEl;
    row.empty();
    row.createSpan({
      cls: "mathslot-dot",
      attr: { style: "background:#4ade80" },
    });
    row.createEl("strong", { text: "线性流输入栏" });
    row.createSpan({ cls: "mathslot-bc-sep", text: "|" });

    if (!state.breadcrumbs.length) {
      row.createSpan({
        cls: "mathslot-bc-slot",
        text: state.cursorChar === 0 ? "当前位置：行首 [a]" : "当前层级：最外层序列",
      });
    } else {
      state.breadcrumbs.forEach((bc, idx) => {
        if (idx > 0) row.createSpan({ cls: "mathslot-bc-sep", text: "›" });
        row.createSpan({
          cls: "mathslot-bc-struct",
          text: `${bc.label}(▸${bc.code})`,
        });
        row.createSpan({ cls: "mathslot-bc-sep", text: "[" });
        bc.roles.forEach((role, sIdx) => {
          if (sIdx > 0) row.createSpan({ cls: "mathslot-bc-sep", text: ";" });
          row.createSpan({
            cls:
              sIdx === bc.slotIndex
                ? "mathslot-bc-slot-cur"
                : "mathslot-bc-slot",
            text: `${sIdx + 1}.${role}`,
          });
        });
        row.createSpan({ cls: "mathslot-bc-sep", text: "]" });
      });
    }

    row.createSpan({
      cls: "mathslot-shorthand-hint",
      text: "简写: -> 趋向 · oo 无穷 · +- 正负 · <= >=",
    });
  }

  renderMathPanels(state) {
    // Preview
    this.previewSurfaceEl.empty();
    try {
      const el = renderMath(state.previewLatex, true);
      this.previewSurfaceEl.appendChild(el);
    } catch (e) {
      this.previewSurfaceEl.setText(String(e));
    }

    // Nav Header & Surface
    this.navHeadEl.empty();
    this.navHeadEl.createSpan({
      cls: "mathslot-dot",
      attr: { style: "background:#60a5fa" },
    });
    this.navHeadEl.createEl("strong", { text: "结构同步导航栏" });
    this.addLegend(this.navHeadEl, "#38bdf8", "[a]首/[;]尾");
    this.addLegend(this.navHeadEl, "#60a5fa", "已填");
    this.addLegend(this.navHeadEl, "#f87171", "待填");
    this.addLegend(this.navHeadEl, "#a78bfa", "[+] 嵌套子式");
    this.addLegend(this.navHeadEl, "#4ade80", "焦点");
    if (state.navViewPath.length > 0) {
      this.navHeadEl.createSpan({
        text: `当前展开: [${state.navViewPath.join(" › ")}]`,
        attr: { style: "color:#a78bfa;font-weight:600;font-size:11.5px" },
      });
    }

    this.navSurfaceEl.className = "mathslot-surface";
    if (state.escActive) {
      this.navSurfaceEl.addClass("is-esc");
    } else if (state.navViewPath.length > 0) {
      this.navSurfaceEl.addClass("is-composite");
    }

    this.navSurfaceEl.empty();
    try {
      const navEl = renderMath(state.navLatex, true);
      this.navSurfaceEl.appendChild(navEl);
    } catch (e) {
      this.navSurfaceEl.setText(String(e));
    }

    finishRenderMath();
  }

  renderDrawer() {
    const d = this.drawerEl;
    d.empty();

    const head = d.createDiv({ cls: "mathslot-drawer-head" });
    const tabGroup = head.createDiv({ cls: "mathslot-delim-group" });

    const btnCustom = tabGroup.createEl("button", {
      cls: `mathslot-delim-tab ${this.drawerMode === "custom" ? "is-active" : ""}`,
      text: `[k▸] 自定义格式 (${(this.catalog.customFormats || []).length})`,
    });
    btnCustom.addEventListener("click", () => this.setDrawer("custom"));

    const btnSnip = tabGroup.createEl("button", {
      cls: `mathslot-delim-tab ${this.drawerMode === "snippets" ? "is-active" : ""}`,
      text: `[t▸] 片段模版 (${(this.catalog.snippets || []).length})`,
    });
    btnSnip.addEventListener("click", () => this.setDrawer("snippets"));

    const btnHelp = tabGroup.createEl("button", {
      cls: `mathslot-delim-tab ${this.drawerMode === "help" ? "is-active" : ""}`,
      text: "? 帮助指南",
    });
    btnHelp.addEventListener("click", () => this.setDrawer("help"));

    const closeBtn = head.createEl("button", {
      cls: "mathslot-btn",
      text: "收起 ✕",
    });
    closeBtn.addEventListener("click", () => this.setDrawer(null));

    if (this.drawerMode === "custom") {
      this.renderCustomDrawer(d);
    } else if (this.drawerMode === "snippets") {
      this.renderSnippetsDrawer(d);
    } else if (this.drawerMode === "help") {
      this.renderHelpDrawer(d);
    }
  }

  renderCustomDrawer(container) {
    const formBox = container.createDiv({ cls: "mathslot-input-card" });
    formBox.createDiv({
      cls: "mathslot-row-label",
      text: "新增/编辑自定义格式（用 $1, $2… 作为槽位占位符）：",
      attr: { style: "color:#fbbf24" },
    });

    const formGrid = formBox.createDiv({ cls: "mathslot-form-grid" });
    const inKey = formGrid.createEl("input", {
      cls: "mathslot-mini-input",
      attr: {
        placeholder: `按键 (如 ${this.catalog.nextCustomKey || "g"})`,
        value: this.catalog.nextCustomKey || "",
        maxlength: "1",
      },
    });
    const inLabel = formGrid.createEl("input", {
      cls: "mathslot-mini-input",
      attr: { placeholder: "名称 (如 同余式)" },
    });
    const inGlyph = formGrid.createEl("input", {
      cls: "mathslot-mini-input",
      attr: { placeholder: "缩略提示 (如 a≡b(m))" },
    });
    const inRoles = formGrid.createEl("input", {
      cls: "mathslot-mini-input",
      attr: { placeholder: "槽位角色 (;分隔 如 左;右;模)" },
    });
    const inLatex = formGrid.createEl("input", {
      cls: "mathslot-mini-input",
      attr: { placeholder: "LaTeX模板 ($1 \\equiv $2 \\pmod{$3})" },
    });
    const inScheme = formGrid.createEl("input", {
      cls: "mathslot-mini-input",
      attr: { placeholder: "函数别名 (如 cong / binom)" },
    });

    const btnRow = formBox.createDiv({ cls: "mathslot-menu-row" });
    const saveBtn = btnRow.createEl("button", {
      cls: "mathslot-btn mathslot-btn-primary",
      text: "保存自定义格式",
    });
    saveBtn.addEventListener("click", () => {
      const k = (inKey.value || "").trim().toLowerCase();
      if (!k) return;
      const next = this.bridge.upsertCustom(
        k,
        inLabel.value,
        inGlyph.value,
        inRoles.value,
        inLatex.value,
        inScheme.value
      );
      this.persistAndRefreshCatalog();
      this.applyState(next, false);
      this.renderDrawer();
    });

    const resetBtn = btnRow.createEl("button", {
      cls: "mathslot-btn",
      text: "恢复默认预置",
    });
    resetBtn.addEventListener("click", () => {
      const next = this.bridge.libraryResetDefault();
      this.persistAndRefreshCatalog();
      this.applyState(next, false);
      this.renderDrawer();
    });

    const list = container.createDiv({ cls: "mathslot-lib-list" });
    for (const fmt of this.catalog.customFormats || []) {
      const row = list.createDiv({ cls: "mathslot-lib-row" });
      const info = row.createDiv();
      info.createEl("strong", {
        text: `[k${fmt.key}] `,
        attr: { style: "color:#fbbf24;font-family:monospace" },
      });
      info.createSpan({ text: `${fmt.label} ` });
      info.createSpan({
        text: fmt.glyph ? `(${fmt.glyph}) ` : "",
        attr: { style: "color:#38bdf8" },
      });
      info.createSpan({
        text: `→ ${fmt.latex}`,
        attr: { style: "color:#94a3b8;font-family:monospace" },
      });

      const acts = row.createDiv({ cls: "mathslot-actions" });
      const ins = acts.createEl("button", {
        cls: "mathslot-btn",
        text: "插入",
        attr: { style: "color:#4ade80" },
      });
      ins.addEventListener("click", () => {
        this.setDrawer(null);
        this.applyState(this.bridge.clickCard(`k${fmt.key}`), true);
      });
      const del = acts.createEl("button", {
        cls: "mathslot-btn",
        text: "删除",
        attr: { style: "color:#f87171" },
      });
      del.addEventListener("click", () => {
        const next = this.bridge.removeCustom(fmt.key);
        this.persistAndRefreshCatalog();
        this.applyState(next, false);
        this.renderDrawer();
      });
    }
  }

  renderSnippetsDrawer(container) {
    const quickRow = container.createDiv({ cls: "mathslot-menu-row" });
    const btnInner = quickRow.createEl("button", {
      cls: "mathslot-btn mathslot-btn-primary",
      text: "+ 保存光标处子结构",
      attr: { title: "若光标位于内层根号/分式/积分中，仅提取该子式为模版" },
    });
    btnInner.addEventListener("click", () => this.quickSaveCurrentSnippet(true));

    const btnWhole = quickRow.createEl("button", {
      cls: "mathslot-btn",
      text: "+ 保存整行公式",
    });
    btnWhole.addEventListener("click", () => this.quickSaveCurrentSnippet(false));

    const formBox = container.createDiv({ cls: "mathslot-input-card" });
    formBox.createDiv({
      cls: "mathslot-row-label",
      text: "新建 / 编辑片段模版（留空槽如 `▸i-oo;oo;;dx` 展开时会自动定位到空槽）：",
      attr: { style: "color:#fbbf24" },
    });

    const formGrid = formBox.createDiv({ cls: "mathslot-form-grid" });
    const inKey = formGrid.createEl("input", {
      cls: "mathslot-mini-input",
      attr: {
        placeholder: `按键 (如 ${this.catalog.nextSnippetKey || "d"})`,
        value: this.catalog.nextSnippetKey || "",
        maxlength: "1",
      },
    });
    const inLabel = formGrid.createEl("input", {
      cls: "mathslot-mini-input",
      attr: { placeholder: "名称 (如 高斯积分)" },
    });
    const inSource = formGrid.createEl("input", {
      cls: "mathslot-mini-input",
      attr: { placeholder: "流式源码 (如 ▸rb^2 - 4ac;)" },
    });

    const btnRow = formBox.createDiv({ cls: "mathslot-menu-row" });
    const fillBtn = btnRow.createEl("button", {
      cls: "mathslot-btn",
      text: "填入当前公式",
    });
    fillBtn.addEventListener("click", () => {
      inSource.value = (this.state && this.state.source) || "";
    });

    const saveBtn = btnRow.createEl("button", {
      cls: "mathslot-btn mathslot-btn-primary",
      text: "保存片段",
    });
    saveBtn.addEventListener("click", () => {
      const k = (inKey.value || "").trim().toLowerCase();
      if (!k || !inSource.value) return;
      const next = this.bridge.upsertSnippet(k, inLabel.value, inSource.value);
      this.persistAndRefreshCatalog();
      this.applyState(next, false);
      this.renderDrawer();
    });

    const list = container.createDiv({ cls: "mathslot-lib-list" });
    for (const snip of this.catalog.snippets || []) {
      const row = list.createDiv({ cls: "mathslot-lib-row" });
      const info = row.createDiv();
      info.createEl("strong", {
        text: `[t${snip.key}] `,
        attr: { style: "color:#fbbf24;font-family:monospace" },
      });
      info.createSpan({ text: `${snip.label} ` });
      info.createSpan({
        text: `→ ${snip.source}`,
        attr: { style: "color:#38bdf8;font-family:monospace" },
      });

      const acts = row.createDiv({ cls: "mathslot-actions" });
      const ins = acts.createEl("button", {
        cls: "mathslot-btn",
        text: "插入复用",
        attr: { style: "color:#4ade80" },
      });
      ins.addEventListener("click", () => {
        this.setDrawer(null);
        this.applyState(this.bridge.clickCard(`t${snip.key}`), true);
      });
      const del = acts.createEl("button", {
        cls: "mathslot-btn",
        text: "删除",
        attr: { style: "color:#f87171" },
      });
      del.addEventListener("click", () => {
        const next = this.bridge.removeSnippet(snip.key);
        this.persistAndRefreshCatalog();
        this.applyState(next, false);
        this.renderDrawer();
      });
    }
  }

  renderHelpDrawer(container) {
    const grid = container.createDiv({ cls: "mathslot-help-grid" });

    const c1 = grid.createDiv({ cls: "mathslot-help-card" });
    c1.createEl("h4", { text: "1. 线性流高效书写（免记复杂语法）" });
    c1.createEl("p", {
      text: "• Tab + 单字母：f 分数 · r 根号 · n N次根 · u/d/b 上下标 · p 括号 · v 绝对值 · i 积分 · s 求和 · l 极限",
    });
    c1.createEl("p", {
      text: "• Tab + 分类键：c 扩展积分 · m 矩阵 · a 标注 · g 希腊 · o 符号 · k 自定义 · t 片段（Enter/空格直接选★默认项）",
    });
    c1.createEl("p", {
      text: "• Enter (或 ;)：智能推进下一槽位；跨过已闭合分号绝不重复插入。",
    });
    c1.createEl("p", {
      text: "• 简写直输：-> 转 \\to，oo 转 \\infty，+- 转 \\pm，<= >= != 自动转符号。",
    });
    c1.createEl("p", {
      text: "• 括号：输入 ( [ { 自动补右半；输入配对右括号直接跳过；空配对 Backspace 一次删两边；导航中按 ( / ) 跳到括号内/外。",
    });

    const c2 = grid.createDiv({ cls: "mathslot-help-card" });
    c2.createEl("h4", { text: "2. 前置主体包裹（跳回行首补加结构）" });
    c2.createEl("p", {
      text: "• 场景：先写了复杂分式 \\frac{\\sin x}{x} = 1，想补上极限 \\lim。",
    });
    c2.createEl("p", {
      text: "• 做法：Tab j 进导航 → 按 a 跳到行首 → Tab l 插入极限：自动把 \\frac{\\sin x}{x} 放进极限主体槽，光标留在条件槽填 x 0！",
    });
    c2.createEl("p", {
      text: "• 同样适用：前置积分 Tab i / 求和 Tab s 自动包裹主体；前置分数 Tab f 自动作分子！若不满意 Ctrl+Z 一步解包。",
    });

    const c3 = grid.createDiv({ cls: "mathslot-help-card" });
    c3.createEl("h4", { text: "3. 增强导航（行首/行尾/回上一位置）" });
    c3.createEl("p", {
      text: "• 先 Tab j 进导航，再按 a (或 0) 跳到行首、按 ; (或 .) 跳到行尾。",
    });
    c3.createEl("p", {
      text: "• 导航中按 - (或 Alt+←)：跳回上一个跳转位置，再按乒乓切回（编辑位移自动跟踪！）。",
    });
    c3.createEl("p", {
      text: "• 导航中的 [+] 复合槽：按对应字母逐级展开子式（如 c 然后 b），Backspace/↑ 返回。",
    });

    const c4 = grid.createDiv({ cls: "mathslot-help-card" });
    c4.createEl("h4", { text: "4. 2D 方向键穿槽与自定义扩展" });
    c4.createEl("p", {
      text: "• ↑/↓ 方向键：分子↔分母、上限↔下限、上下标、极限主体↔条件、矩阵上下行、嵌套根号翻层！",
    });
    c4.createEl("p", {
      text: "• ←/→ 方向键：遇到 ▸f、▸ma 等结构前缀原子跳过，不卡半截。",
    });
    c4.createEl("p", {
      text: "• [k▸] 自定义格式：用 $1, $2 定义任意 LaTeX 宏，零改源码永久保存。",
    });
    c4.createEl("p", {
      text: "• [t▸] 片段模版：点击「+存片段」一键保存复杂子式或填空模版随时复用！",
    });
  }

  refreshOutputBoxes() {
    if (!this.state) return;

    const aStr = this.state.schemeA || "";
    this.schemeABoxEl.setText(aStr || "（尚无内容）");
    this.schemeABoxEl.toggleClass("is-empty", !aStr);

    const lStr = this.formattedLatex();
    this.latexBoxEl.setText(lStr || "（尚无内容）");
    this.latexBoxEl.toggleClass("is-empty", !lStr);

    for (const [k, btn] of Object.entries(this.delimTabs || {})) {
      btn.toggleClass("is-active", k === this.delimStyle);
    }
  }
}

class MathSlotPlugin extends Plugin {
  async onload() {
    this.data = (await this.loadData()) || {};
    this.bridgePromise = MathSlotWasmBridge.create();

    this.addRibbonIcon("sigma", "打开 MathSlot 流式公式编辑器", () => {
      this.openFormulaModal("inline", null);
    });

    this.addCommand({
      id: "open-mathslot-inline",
      name: "打开流式数学公式编辑器 (行内 $...$)",
      editorCallback: (editor) => this.openFormulaModal("inline", editor),
    });

    this.addCommand({
      id: "open-mathslot-display",
      name: "插入块级数学公式 (块级 $$...$$)",
      editorCallback: (editor) => this.openFormulaModal("display", editor),
    });
  }

  async openFormulaModal(delimStyle, editorOverride) {
    let bridge;
    try {
      bridge = await this.bridgePromise;
    } catch (err) {
      console.error("MathSlot: WASM bridge 初始化失败", err);
      new Notice(
        "MathSlot 加载失败（WASM 初始化错误），请重启 Obsidian 或重装插件。"
      );
      // 允许下次重试，而不是永久复用 rejected promise
      this.bridgePromise = MathSlotWasmBridge.create();
      return;
    }
    if (this.data.libraryJson) {
      try {
        bridge.librarySetRaw(this.data.libraryJson);
      } catch (err) {
        console.error("MathSlot: libraryJson 解析失败，回退默认库", err);
        new Notice("MathSlot 自定义库数据损坏，已回退默认格式库。");
        delete this.data.libraryJson;
        await this.saveData(this.data);
      }
    }
    const catalog = bridge.catalog();
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = editorOverride || (activeView && activeView.editor) || null;
    const onPersist = async (newRaw) => {
      this.data.libraryJson = newRaw;
      await this.saveData(this.data);
    };
    new MathSlotModal(this.app, bridge, catalog, delimStyle, editor, onPersist).open();
  }
}

module.exports = MathSlotPlugin;
