<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { findSlotPath, type EditorSnapshot, type JumpTarget } from '@mathslot/core';
  import { renderLatexInteractive } from '../katexRenderer';

  interface Props {
    snapshot: EditorSnapshot;
    shiftedUp?: boolean;
    showHierarchyBoxes?: boolean;
    onKeyEvent: (e: KeyboardEvent) => void;
    onTextInput: (text: string) => void;
    onPaste: (text: string) => void;
    onClickSlot: (slotId: string, offset: number) => void;
    onDragSelect?: (slotId: string, anchorOffset: number, focusOffset: number) => void;
    onDoubleClickAtom?: (slotId: string, offset: number) => void;
    onJumpTarget: (label: string) => void;
    onFocusChange: (focused: boolean) => void;
    onAddGridRow?: () => void;
    onRemoveGridRow?: () => void;
    onAddGridCol?: () => void;
    onRemoveGridCol?: () => void;
  }

  let {
    snapshot,
    shiftedUp = false,
    showHierarchyBoxes = true,
    onKeyEvent,
    onTextInput,
    onPaste,
    onClickSlot,
    onDragSelect,
    onDoubleClickAtom,
    onJumpTarget,
    onFocusChange,
    onAddGridRow,
    onRemoveGridRow,
    onAddGridCol,
    onRemoveGridCol,
  }: Props = $props();

  let stageEl: HTMLDivElement | null = $state(null);
  let formulaEl: HTMLDivElement | null = $state(null);
  let inputEl: HTMLInputElement | null = $state(null);
  let isComposing = $state(false);
  let scale = $state(1);

  interface HierarchyBox {
    id: string;
    depth: number;
    left: number;
    top: number;
    width: number;
    height: number;
    isAncestor: boolean;
    isImmediateParent: boolean;
  }

  interface ActiveSlotBox {
    slotId: string;
    label: string;
    left: number;
    top: number;
    width: number;
    height: number;
  }

  interface PositionedJump extends JumpTarget {
    left: number;
    top: number;
    isActive: boolean;
  }

  let hierarchyBoxes = $state<HierarchyBox[]>([]);
  let activeSlotBox = $state<ActiveSlotBox | null>(null);
  let activeGridPos = $state<{ left: number; top: number } | null>(null);
  let jumpScopeBox = $state<{ left: number; top: number; width: number; height: number } | null>(null);
  let jumpPositions = $state<PositionedJump[]>([]);
  let dragAnchor = $state<{ slotId: string; offset: number } | null>(null);

  const rendered = $derived(renderLatexInteractive(snapshot.interactiveLatex));

  export function focus(): void {
    inputEl?.focus({ preventScroll: true });
  }

  /**
   * Computes the TRUE visual ink bounding rect of a KaTeX subtree, ignoring
   * KaTeX's hidden `.pstrut` / `.strut` vertical-alignment spacers and inline-span
   * 1em baseline clipping so tall fractions, integrals, and nested brackets get
   * crisp, pixel-accurate rectangular boxes!
   */
  function getTrueVisualRect(el: HTMLElement): DOMRect | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const includeRect = (r: DOMRect) => {
      if (r.width <= 0.5 && r.height <= 0.5) return;
      if (r.left < minX) minX = r.left;
      if (r.top < minY) minY = r.top;
      if (r.right > maxX) maxX = r.right;
      if (r.bottom > maxY) maxY = r.bottom;
    };

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      const parentEl = node.parentElement;
      if (parentEl?.closest('.ms-caret-anchor, .ms-empty-root')) continue;
      range.selectNodeContents(node);
      includeRect(range.getBoundingClientRect());
    }

    const drawn = el.querySelectorAll(
      'svg, .frac-line, .overline-line, .underline-line, .hline, .ms-empty-box, .ms-space-active',
    );
    for (const d of drawn) {
      includeRect(d.getBoundingClientRect());
    }

    if (!Number.isFinite(minX)) {
      const fallback = el.getBoundingClientRect();
      return fallback.width > 0.5 || fallback.height > 0.5 ? fallback : null;
    }
    return new DOMRect(minX, minY, maxX - minX, maxY - minY);
  }

  function measureOverlays(): void {
    if (!stageEl || !formulaEl || snapshot.isEmpty) {
      hierarchyBoxes = [];
      activeSlotBox = null;
      activeGridPos = null;
      jumpScopeBox = null;
      jumpPositions = [];
      return;
    }

    const stageRect = stageEl.getBoundingClientRect();

    // Determine active ancestor struct chain & active slot label from AST
    const activePath = findSlotPath(snapshot.doc.root, snapshot.cursor.slotId);
    const ancestorStructIds = new Set<string>();
    let immediateParentStructId: string | null = null;
    if (activePath && activePath.length > 1) {
      for (let i = 1; i < activePath.length; i += 1) {
        const ps = activePath[i].parentStruct;
        if (ps) ancestorStructIds.add(ps.id);
      }
      immediateParentStructId = activePath[activePath.length - 1].parentStruct?.id ?? null;
    }

    // 1. Always-visible nested dashed boxes around every semantic structure level
    if (showHierarchyBoxes) {
      const structEls = formulaEl.querySelectorAll('[data-struct-id]');
      const boxes: HierarchyBox[] = [];
      for (const el of structEls) {
        const htmlEl = el as HTMLElement;
        const id = htmlEl.getAttribute('data-struct-id');
        if (!id) continue;
        const isAncestor = ancestorStructIds.has(id);
        const boxFlag = htmlEl.getAttribute('data-struct-box');
        // Skip tiny flat single-arg function parens like `(x)` in `f(x)` unless cursor is inside it
        if (boxFlag === '0' && !isAncestor) continue;
        const depth = Number(htmlEl.getAttribute('data-struct-depth') ?? '1');
        const subtreeHeight = Number(htmlEl.getAttribute('data-struct-height') ?? '0');
        const r = getTrueVisualRect(htmlEl);
        if (!r) continue;

        // Progressive nesting padding: outer containers strictly wrap inner dashed boxes without border overlap!
        const padX = Math.round((3 + subtreeHeight * 4.5) * Math.max(0.75, scale));
        const padY = Math.round((2 + subtreeHeight * 4.5) * Math.max(0.75, scale));

        boxes.push({
          id,
          depth,
          left: r.left - stageRect.left - padX,
          top: r.top - stageRect.top - padY,
          width: r.width + padX * 2,
          height: r.height + padY * 2,
          isAncestor,
          isImmediateParent: id === immediateParentStructId,
        });
      }
      // Render shallow (outer) boxes first, deep (inner) boxes on top
      boxes.sort((a, b) => a.depth - b.depth);
      hierarchyBoxes = boxes;
    } else {
      hierarchyBoxes = [];
    }

    // 2. Full-height pixel-accurate highlight for the currently active nested slot
    if (activePath && activePath.length > 1) {
      const curEntry = activePath[activePath.length - 1];
      const slotEl = formulaEl.querySelector(
        `[data-slot-id="${CSS.escape(curEntry.slot.id)}"]`,
      ) as HTMLElement | null;
      if (slotEl) {
        const r = getTrueVisualRect(slotEl);
        if (r) {
          const padX = 4;
          const padY = 3;
          const crumb = snapshot.breadcrumbs[snapshot.breadcrumbs.length - 1];
          activeSlotBox = {
            slotId: curEntry.slot.id,
            label: crumb ? `${crumb.commandLabel}·${crumb.slotLabel}` : curEntry.slot.label,
            left: r.left - stageRect.left - padX,
            top: r.top - stageRect.top - padY,
            width: Math.max(14, r.width + padX * 2),
            height: Math.max(18, r.height + padY * 2),
          };
        } else {
          activeSlotBox = null;
        }
      } else {
        activeSlotBox = null;
      }
    } else {
      activeSlotBox = null;
    }

    // 2.5 Floating mini grid controls beside active matrix / cases
    if (snapshot.activeGrid && snapshot.mode.kind !== 'jump') {
      const gridEl = formulaEl.querySelector(
        `[data-struct-id="${CSS.escape(snapshot.activeGrid.structId)}"]`,
      ) as HTMLElement | null;
      const gr = gridEl ? getTrueVisualRect(gridEl) : null;
      if (gr) {
        activeGridPos = {
          left: Math.max(12, gr.left - stageRect.left + gr.width / 2),
          top: Math.min(stageRect.height - 34, gr.bottom - stageRect.top + 10),
        };
      } else {
        activeGridPos = null;
      }
    } else {
      activeGridPos = null;
    }

    // 3. Hierarchical jump badges when in Esc jump mode (including plain text terms like `+ 42 +`!)
    if (snapshot.mode.kind === 'jump') {
      const scopeEl = formulaEl.querySelector(
        `[data-slot-id="${CSS.escape(snapshot.mode.scopeSlotId)}"]`,
      ) as HTMLElement | null;
      const scopeRect = scopeEl ? getTrueVisualRect(scopeEl) ?? scopeEl.getBoundingClientRect() : null;

      if (snapshot.mode.scopePath.length > 0 && scopeRect) {
        jumpScopeBox = {
          left: scopeRect.left - stageRect.left - 6,
          top: scopeRect.top - stageRect.top - 5,
          width: scopeRect.width + 12,
          height: scopeRect.height + 10,
        };
      } else {
        jumpScopeBox = null;
      }

      const next: PositionedJump[] = [];
      for (let tIdx = 0; tIdx < snapshot.mode.targets.length; tIdx += 1) {
        const target = snapshot.mode.targets[tIdx];
        let r: DOMRect | null = null;

        if (target.anchorKind === 'scope-start' && scopeRect) {
          r = new DOMRect(scopeRect.left - 14, scopeRect.top, 12, scopeRect.height);
        } else if (target.anchorKind === 'scope-end' && scopeRect) {
          r = new DOMRect(scopeRect.right + 4, scopeRect.top, 12, scopeRect.height);
        } else if (
          target.anchorKind === 'text-term' &&
          target.termStart !== undefined &&
          target.termEnd !== undefined
        ) {
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          const atoms = formulaEl.querySelectorAll(
            `[data-atom-slot="${CSS.escape(target.slotId)}"]`,
          );
          for (const a of atoms) {
            const off = Number(a.getAttribute('data-offset') ?? '-1');
            if (off >= target.termStart && off < target.termEnd) {
              const ar = getTrueVisualRect(a as HTMLElement);
              if (ar) {
                if (ar.left < minX) minX = ar.left;
                if (ar.top < minY) minY = ar.top;
                if (ar.right > maxX) maxX = ar.right;
                if (ar.bottom > maxY) maxY = ar.bottom;
              }
            }
          }
          if (Number.isFinite(minX)) {
            r = new DOMRect(minX, minY, maxX - minX, maxY - minY);
          }
        } else {
          const el = formulaEl.querySelector(
            `[data-slot-id="${CSS.escape(target.slotId)}"]`,
          ) as HTMLElement | null;
          if (el) {
            r = getTrueVisualRect(el) ?? el.getBoundingClientRect();
          }
        }

        if (r) {
          const isBottom = target.placement === 'bottom';
          let left = Math.max(8, r.left - stageRect.left + r.width / 2 - 11);
          let top = isBottom
            ? Math.min(stageRect.height - 26, r.bottom - stageRect.top + 5)
            : Math.max(8, r.top - stageRect.top - 24);
          for (let tries = 0; tries < 6; tries += 1) {
            const clash = next.find(
              (prev) => Math.abs(prev.left - left) < 24 && Math.abs(prev.top - top) < 22,
            );
            if (!clash) break;
            left += 24;
          }
          next.push({ ...target, left, top, isActive: tIdx === snapshot.mode.activeIdx });
        }
      }
      jumpPositions = next;
    } else {
      jumpScopeBox = null;
      jumpPositions = [];
    }
  }

  async function recomputeLayout(): Promise<void> {
    if (!stageEl || !formulaEl) return;
    const stageWidth = stageEl.clientWidth - 88;
    const katexEl = formulaEl.querySelector('.katex') as HTMLElement | null;
    let nextScale = 1;
    if (katexEl && stageWidth > 120) {
      const naturalWidth = katexEl.scrollWidth;
      if (naturalWidth > stageWidth) {
        nextScale = Math.max(0.46, stageWidth / naturalWidth);
      }
    }
    if (Math.abs(nextScale - scale) > 0.002) {
      scale = nextScale;
      await tick();
    }
    measureOverlays();
  }

  $effect(() => {
    void rendered.html;
    void snapshot.mode;
    void snapshot.cursor;
    void showHierarchyBoxes;
    void shiftedUp;
    void tick().then(() => recomputeLayout());
  });

  onMount(() => {
    focus();
    const ro = new ResizeObserver(() => {
      void recomputeLayout();
    });
    if (stageEl) ro.observe(stageEl);
    return () => ro.disconnect();
  });

  function hitTestPoint(clientX: number, target: HTMLElement | null): { slotId: string; offset: number; atomOffset?: number } | null {
    if (!target || !formulaEl) return null;
    const atomEl = target.closest('[data-atom-slot]') as HTMLElement | null;
    if (atomEl && formulaEl.contains(atomEl)) {
      const slotId = atomEl.getAttribute('data-atom-slot');
      const offsetStr = atomEl.getAttribute('data-offset');
      const spanStr = atomEl.getAttribute('data-span');
      if (slotId && offsetStr !== null) {
        const offset = Number(offsetStr);
        const span = spanStr ? Math.max(1, Number(spanStr)) : 1;
        const rect = atomEl.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        return { slotId, offset: clientX >= midX ? offset + span : offset, atomOffset: offset };
      }
    }
    const slotEl = target.closest('[data-slot-id]') as HTMLElement | null;
    if (slotEl && formulaEl.contains(slotEl)) {
      const slotId = slotEl.getAttribute('data-slot-id');
      if (slotId) {
        const rect = slotEl.getBoundingClientRect();
        return { slotId, offset: clientX >= rect.left + rect.width / 2 ? 99999 : 0 };
      }
    }
    return { slotId: snapshot.doc.root.id, offset: snapshot.doc.root.children.length };
  }

  function handleStageMouseDown(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    if (target?.closest('button')) return;

    e.preventDefault();
    focus();

    const hit = hitTestPoint(e.clientX, target);
    if (!hit) return;
    dragAnchor = { slotId: hit.slotId, offset: hit.offset };
    onClickSlot(hit.slotId, hit.offset);
  }

  function handleStageMouseMove(e: MouseEvent): void {
    if (!dragAnchor || !(e.buttons & 1) || !onDragSelect) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const hit = hitTestPoint(e.clientX, el);
    if (hit && hit.slotId === dragAnchor.slotId && hit.offset !== dragAnchor.offset) {
      onDragSelect(dragAnchor.slotId, dragAnchor.offset, hit.offset);
    }
  }

  function handleStageMouseUp(): void {
    dragAnchor = null;
  }

  function handleStageDblClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    if (target?.closest('button') || !onDoubleClickAtom) return;
    const hit = hitTestPoint(e.clientX, target);
    if (hit && hit.atomOffset !== undefined) {
      onDoubleClickAtom(hit.slotId, hit.atomOffset);
    }
  }

  function handleInputKeyDown(e: KeyboardEvent): void {
    if (isComposing || e.isComposing || e.key === 'Process') return;
    onKeyEvent(e);
  }

  function handleNativeInput(e: Event): void {
    if (isComposing) return;
    const el = e.currentTarget as HTMLInputElement;
    const val = el.value;
    el.value = '';
    if (val) {
      onTextInput(val);
    }
  }

  function handleCompositionStart(): void {
    isComposing = true;
  }

  function handleCompositionEnd(e: CompositionEvent): void {
    isComposing = false;
    const el = e.currentTarget as HTMLInputElement;
    const text = el.value || e.data || '';
    el.value = '';
    if (text) {
      onTextInput(text);
    }
  }

  function handleNativePaste(e: ClipboardEvent): void {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (text) onPaste(text);
  }
</script>

<svelte:window onmouseup={handleStageMouseUp} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="canvas-stage"
  bind:this={stageEl}
  onmousedown={handleStageMouseDown}
  onmousemove={handleStageMouseMove}
  ondblclick={handleStageDblClick}
>
  <input
    bind:this={inputEl}
    class="hidden-capture"
    type="text"
    autocomplete="off"
    autocapitalize="off"
    autocorrect="off"
    spellcheck="false"
    aria-label="数学公式输入区"
    onkeydown={handleInputKeyDown}
    oninput={handleNativeInput}
    oncompositionstart={handleCompositionStart}
    oncompositionend={handleCompositionEnd}
    onpaste={handleNativePaste}
    onfocus={() => onFocusChange(true)}
    onblur={() => onFocusChange(false)}
  />

  <!-- Always-visible pixel-accurate nested dashed hierarchy frames -->
  <div class="hierarchy-layer" aria-hidden="true">
    {#each hierarchyBoxes as box (box.id)}
      <div
        class={`h-box h-depth-${((box.depth - 1) % 4) + 1}`}
        class:is-ancestor={box.isAncestor}
        class:is-parent={box.isImmediateParent}
        style:left={`${box.left}px`}
        style:top={`${box.top}px`}
        style:width={`${box.width}px`}
        style:height={`${box.height}px`}
      ></div>
    {/each}

    {#if jumpScopeBox}
      <div
        class="jump-scope-box"
        style:left={`${jumpScopeBox.left}px`}
        style:top={`${jumpScopeBox.top}px`}
        style:width={`${jumpScopeBox.width}px`}
        style:height={`${jumpScopeBox.height}px`}
      ></div>
    {/if}

    {#if activeSlotBox && snapshot.mode.kind !== 'jump'}
      <div
        class="active-slot-box"
        style:left={`${activeSlotBox.left}px`}
        style:top={`${activeSlotBox.top}px`}
        style:width={`${activeSlotBox.width}px`}
        style:height={`${activeSlotBox.height}px`}
      >
        {#if !snapshot.activeGrid}
          <span class="active-slot-tag">{activeSlotBox.label}</span>
        {/if}
      </div>
    {/if}
  </div>

  <div class="formula-center" class:shifted={shiftedUp}>
    <div
      class="formula-render"
      class:is-empty={snapshot.isEmpty}
      style:transform={`scale(${scale})`}
      bind:this={formulaEl}
    >
      {@html rendered.html}
    </div>
  </div>

  {#if snapshot.activeGrid && activeGridPos && snapshot.mode.kind === 'edit' && !shiftedUp}
    <div
      class="grid-controls"
      style:left={`${activeGridPos.left}px`}
      style:top={`${activeGridPos.top}px`}
    >
      <span class="grid-dim">
        {snapshot.activeGrid.rows}×{snapshot.activeGrid.cols} · ({snapshot.activeGrid.row + 1},{snapshot.activeGrid.col + 1})
      </span>
      <button type="button" class="grid-btn" title="加一行（Shift+↓ 下方 / Shift+↑ 上方）" onmousedown={(e) => e.preventDefault()} onclick={() => onAddGridRow?.()}>+行</button>
      <button type="button" class="grid-btn" title="删除当前行" disabled={snapshot.activeGrid.rows <= 1} onmousedown={(e) => e.preventDefault()} onclick={() => onRemoveGridRow?.()}>−行</button>
      {#if snapshot.activeGrid.canEditCols}
        <button type="button" class="grid-btn" title="加一列（Shift+→ 右侧 / Shift+← 左侧）" onmousedown={(e) => e.preventDefault()} onclick={() => onAddGridCol?.()}>+列</button>
        <button type="button" class="grid-btn" title="删除当前列" disabled={snapshot.activeGrid.cols <= 1} onmousedown={(e) => e.preventDefault()} onclick={() => onRemoveGridCol?.()}>−列</button>
      {/if}
    </div>
  {/if}

  {#if snapshot.mode.kind === 'jump'}
    {#each jumpPositions as jp (`${jp.label}-${jp.slotId}-${jp.offset}`)}
      <button
        type="button"
        class="jump-badge"
        class:is-composite={jp.isComposite}
        class:is-active={jp.isActive}
        title={jp.isComposite ? `${jp.slotLabel}（展开子层级）` : jp.slotLabel}
        style:left={`${jp.left}px`}
        style:top={`${jp.top}px`}
        onclick={() => onJumpTarget(jp.label)}
      >
        {jp.isComposite ? `${jp.label}+` : jp.label}
      </button>
    {/each}
  {/if}
</div>

<style>
  .canvas-stage {
    position: relative;
    flex: 1 1 auto;
    min-height: 260px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    cursor: text;
    user-select: none;
    padding: 36px 28px;
  }

  .hidden-capture {
    position: fixed;
    top: 0;
    left: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
    border: 0;
    padding: 0;
    pointer-events: none;
  }

  .hierarchy-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1;
  }

  .h-box {
    position: absolute;
    border-radius: 6px;
    border: 1px dashed var(--ms-lvl-1);
    box-sizing: border-box;
    transition: border-color 110ms ease, background-color 110ms ease;
  }

  .h-depth-1 {
    border-color: var(--ms-lvl-1);
  }
  .h-depth-1.is-ancestor {
    border-color: var(--ms-lvl-1-active);
    border-width: 1.5px;
    background: var(--ms-lvl-1-fill);
  }

  .h-depth-2 {
    border-color: var(--ms-lvl-2);
  }
  .h-depth-2.is-ancestor {
    border-color: var(--ms-lvl-2-active);
    border-width: 1.5px;
    background: var(--ms-lvl-2-fill);
  }

  .h-depth-3 {
    border-color: var(--ms-lvl-3);
  }
  .h-depth-3.is-ancestor {
    border-color: var(--ms-lvl-3-active);
    border-width: 1.5px;
    background: var(--ms-lvl-3-fill);
  }

  .h-depth-4 {
    border-color: var(--ms-lvl-4);
  }
  .h-depth-4.is-ancestor {
    border-color: var(--ms-lvl-4-active);
    border-width: 1.5px;
    background: var(--ms-lvl-4-fill);
  }

  .active-slot-box {
    position: absolute;
    border-radius: 6px;
    border: 1.5px solid var(--ms-accent);
    background: var(--ms-accent-soft);
    box-sizing: border-box;
  }

  .active-slot-tag {
    position: absolute;
    left: -1px;
    top: -17px;
    padding: 1px 6px;
    border-radius: 4px 4px 4px 0;
    background: var(--ms-accent);
    color: var(--ms-accent-fg);
    font-size: 10px;
    font-weight: 600;
    line-height: 1.3;
    white-space: nowrap;
    letter-spacing: 0.01em;
    box-shadow: var(--ms-shadow-sm);
  }

  .formula-center {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    max-width: 100%;
    min-height: 92px;
  }

  .formula-center.shifted {
    transform: translateY(-102px);
  }

  .formula-render {
    font-size: clamp(1.75rem, 3.2vw, 2.45rem);
    line-height: 1.5;
    transform-origin: center center;
    color: var(--ms-fg);
  }

  .jump-scope-box {
    position: absolute;
    border-radius: 8px;
    border: 2px solid var(--ms-jump-border);
    background: color-mix(in srgb, var(--ms-jump-bg) 35%, transparent);
    box-sizing: border-box;
  }

  .grid-controls {
    position: absolute;
    z-index: 22;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 6px;
    border-radius: 999px;
    background: var(--ms-surface);
    border: 1px solid var(--ms-border);
    box-shadow: var(--ms-shadow-sm);
  }

  .grid-dim {
    font-family: var(--ms-font-mono);
    font-size: 10.5px;
    font-weight: 600;
    color: var(--ms-fg-muted);
    padding: 0 4px;
  }

  .grid-btn {
    height: 20px;
    padding: 0 6px;
    border: 1px solid var(--ms-border-subtle);
    border-radius: 999px;
    background: var(--ms-tile);
    color: var(--ms-fg);
    font-size: 11px;
    cursor: pointer;
  }

  .grid-btn:hover:not(:disabled) {
    border-color: var(--ms-accent);
    color: var(--ms-accent);
    background: var(--ms-accent-soft);
  }

  .grid-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .jump-badge {
    position: absolute;
    z-index: 25;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border-radius: 5px;
    border: 1.5px solid var(--ms-jump-border);
    background: var(--ms-jump-bg);
    color: var(--ms-jump-fg);
    font-family: var(--ms-font-mono);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    box-shadow: var(--ms-shadow-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .jump-badge.is-composite {
    border-color: var(--ms-accent);
    background: var(--ms-keycap-bg);
    color: var(--ms-keycap-fg);
  }

  .jump-badge.is-active {
    transform: scale(1.12);
    box-shadow: 0 0 0 2px var(--ms-accent-ring), var(--ms-shadow-sm);
  }

  .jump-badge:hover {
    transform: scale(1.12);
  }
</style>
