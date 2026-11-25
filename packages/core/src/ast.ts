import { COMMANDS_BY_ID } from './catalog';
import {
  BINARY_RELATION_SYMBOLS,
  BUILTIN_GRID_META,
  COMMAND_CAPABILITIES,
  getOptionalSlots,
  getSlotPlacement,
  isCasesEnv,
} from './commandSpecs';
import type {
  BreadcrumbItem,
  CharNode,
  CommandDef,
  CustomCommandDef,
  Document,
  GridMeta,
  JumpTarget,
  MathNode,
  PersistedDraftV1,
  RawNode,
  SlotNode,
  StructNode,
  SymbolNode,
} from './types';

let idCounter = 0;

export function nextId(prefix = 'n'): string {
  idCounter += 1;
  return `${prefix}${idCounter}`;
}

export function resetIdCounter(value = 0): void {
  idCounter = value;
}

export function createSlot(label: string, children: MathNode[] = []): SlotNode {
  return {
    id: nextId('s'),
    label,
    children,
  };
}

export function createEmptyDocument(): Document {
  return {
    root: createSlot('公式', []),
  };
}

export function createCharNode(value: string, verbatim = false): CharNode {
  return verbatim
    ? { type: 'char', id: nextId('c'), value, verbatim: true }
    : { type: 'char', id: nextId('c'), value };
}

export function createSymbolNode(cmd: CommandDef): SymbolNode {
  return {
    type: 'symbol',
    id: nextId('y'),
    commandId: cmd.id,
    latex: cmd.latex,
    glyph: cmd.glyph,
  };
}

export function createStructNode(
  cmd: Pick<CommandDef, 'id' | 'slots' | 'latex'>,
  slotContents?: MathNode[][],
  customLatex?: string,
): StructNode {
  const slots = cmd.slots.map((label, idx) => createSlot(label, slotContents?.[idx] ?? []));
  return {
    type: 'struct',
    id: nextId('t'),
    commandId: cmd.id,
    slots,
    ...(customLatex ? { customLatex } : {}),
  };
}

export function createRawNode(latex: string): RawNode {
  return { type: 'raw', id: nextId('r'), latex };
}

export function textToCharNodes(text: string, verbatim = false): CharNode[] {
  return Array.from(text).map((ch) => createCharNode(ch, verbatim));
}

/**
 * Structural clone preserving IDs — intentionally used by undo/redo snapshots so restored
 * `Cursor.slotId` remains valid. To duplicate a node inside the SAME document, use `cloneNodeFresh`.
 */
export function cloneNode(node: MathNode): MathNode {
  switch (node.type) {
    case 'char':
      return { ...node };
    case 'symbol':
      return { ...node };
    case 'raw':
      return { ...node };
    case 'struct':
      return {
        ...node,
        slots: node.slots.map((s) => cloneSlot(s)),
        customLatex: node.customLatex,
        fillOrder: node.fillOrder ? [...node.fillOrder] : undefined,
        grid: node.grid
          ? {
              ...node.grid,
              ...(node.grid.rowGaps ? { rowGaps: [...node.grid.rowGaps] } : {}),
            }
          : undefined,
      };
  }
}

export function cloneSlot(slot: SlotNode): SlotNode {
  return {
    id: slot.id,
    label: slot.label,
    children: slot.children.map((n) => cloneNode(n)),
  };
}

export function cloneDocument(doc: Document): Document {
  return { root: cloneSlot(doc.root) };
}

/** Advances the global AST ID sequence past any numeric suffix present in a restored draft tree. */
export function syncIdCounterFromTree(slot: SlotNode): void {
  const bump = (id: string) => {
    const m = id.match(/(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= idCounter) {
        idCounter = n + 1;
      }
    }
  };
  bump(slot.id);
  for (const child of slot.children) {
    bump(child.id);
    if (child.type === 'struct') {
      for (const s of child.slots) {
        syncIdCounterFromTree(s);
      }
    }
  }
}

function isValidMathNode(raw: unknown, depth: number): raw is MathNode {
  if (depth > 64 || !raw || typeof raw !== 'object') return false;
  const n = raw as Record<string, unknown>;
  if (typeof n.id !== 'string' || !n.id) return false;
  if (n.type === 'char') return typeof n.value === 'string';
  if (n.type === 'raw') return typeof n.latex === 'string';
  if (n.type === 'symbol') {
    return typeof n.commandId === 'string' && typeof n.latex === 'string' && typeof n.glyph === 'string';
  }
  if (n.type === 'struct') {
    if (typeof n.commandId !== 'string' || !Array.isArray(n.slots)) return false;
    return n.slots.every((s) => isValidSlotNode(s, depth + 1));
  }
  return false;
}

function isValidSlotNode(raw: unknown, depth: number): raw is SlotNode {
  if (depth > 64 || !raw || typeof raw !== 'object') return false;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== 'string' || !s.id || typeof s.label !== 'string' || !Array.isArray(s.children)) {
    return false;
  }
  return s.children.every((c) => isValidMathNode(c, depth + 1));
}

/** Validates an untrusted persisted `PersistedDraftV1` payload before hydrating the editor AST. */
export function validatePersistedDraftV1(raw: unknown): PersistedDraftV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (d.schemaVersion !== 1) return null;
  if (!isValidSlotNode(d.root, 0)) return null;
  if (!d.cursor || typeof d.cursor !== 'object') return null;
  const cur = d.cursor as Record<string, unknown>;
  if (typeof cur.slotId !== 'string' || typeof cur.offset !== 'number' || !Number.isFinite(cur.offset)) {
    return null;
  }
  return {
    schemaVersion: 1,
    updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : Date.now(),
    root: cloneSlot(d.root),
    cursor: { slotId: cur.slotId, offset: Math.max(0, Math.floor(cur.offset)) },
    ...(typeof d.wrapper === 'string' ? { wrapper: d.wrapper as PersistedDraftV1['wrapper'] } : {}),
  };
}

/** Deep-clones a node with brand-new unique IDs for safely inserting a duplicate into the same document. */
export function cloneNodeFresh(node: MathNode): MathNode {
  switch (node.type) {
    case 'char':
      return { ...node, id: nextId('c') };
    case 'symbol':
      return { ...node, id: nextId('y') };
    case 'raw':
      return { ...node, id: nextId('r') };
    case 'struct':
      return {
        ...node,
        id: nextId('t'),
        slots: node.slots.map((s) => ({
          id: nextId('s'),
          label: s.label,
          children: s.children.map((ch) => cloneNodeFresh(ch)),
        })),
        fillOrder: node.fillOrder ? [...node.fillOrder] : undefined,
        grid: node.grid
          ? {
              ...node.grid,
              ...(node.grid.rowGaps ? { rowGaps: [...node.grid.rowGaps] } : {}),
            }
          : undefined,
      };
  }
}

export interface SlotPathEntry {
  slot: SlotNode;
  parentSlot: SlotNode | null;
  parentStruct: StructNode | null;
  nodeIndexInParent: number;
  slotIndexInStruct: number;
}

export function findSlotPath(root: SlotNode, targetSlotId: string): SlotPathEntry[] | null {
  if (root.id === targetSlotId) {
    return [
      {
        slot: root,
        parentSlot: null,
        parentStruct: null,
        nodeIndexInParent: -1,
        slotIndexInStruct: -1,
      },
    ];
  }

  for (let i = 0; i < root.children.length; i += 1) {
    const child = root.children[i];
    if (child.type !== 'struct') continue;
    for (let sIdx = 0; sIdx < child.slots.length; sIdx += 1) {
      const subSlot = child.slots[sIdx];
      const subPath = findSlotPath(subSlot, targetSlotId);
      if (subPath) {
        subPath[0] = {
          ...subPath[0],
          parentSlot: root,
          parentStruct: child,
          nodeIndexInParent: i,
          slotIndexInStruct: sIdx,
        };
        return [
          {
            slot: root,
            parentSlot: null,
            parentStruct: null,
            nodeIndexInParent: -1,
            slotIndexInStruct: -1,
          },
          ...subPath,
        ];
      }
    }
  }
  return null;
}

export function findSlot(root: SlotNode, slotId: string): SlotNode | null {
  const path = findSlotPath(root, slotId);
  return path ? path[path.length - 1].slot : null;
}

export function getGridMeta(node: StructNode): GridMeta | null {
  if (node.grid) return node.grid;
  return BUILTIN_GRID_META[node.commandId] ?? null;
}

export function getBreadcrumbs(
  root: SlotNode,
  slotId: string,
  customCommands: readonly CustomCommandDef[] = [],
  effectiveCommands: readonly CommandDef[] = [],
): BreadcrumbItem[] {
  const path = findSlotPath(root, slotId);
  if (!path || path.length <= 1) return [];
  const items: BreadcrumbItem[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const entry = path[i];
    const cmdId = entry.parentStruct?.commandId;
    const cmd = cmdId
      ? (effectiveCommands.find((c) => c.id === cmdId) ?? COMMANDS_BY_ID.get(cmdId))
      : undefined;
    const custom = !cmd && cmdId ? customCommands.find((c) => c.id === cmdId) : undefined;
    const grid = entry.parentStruct ? getGridMeta(entry.parentStruct) : null;
    const dynGrid = entry.parentStruct?.grid;
    const formatGridLabel = (g: GridMeta): string => {
      if (isCasesEnv(g.env)) return '分段函数';
      if (g.colSpec?.includes('|')) return `${g.rows}×${g.cols} 增广矩阵`;
      if (g.env === 'array') return `${g.rows}×${g.cols} 数组`;
      return `${g.rows}×${g.cols} 矩阵`;
    };
    const commandLabel =
      (dynGrid ? formatGridLabel(dynGrid) : undefined) ??
      cmd?.label ??
      custom?.label ??
      (grid ? formatGridLabel(grid) : '结构');
    items.push({
      commandLabel,
      slotLabel: entry.slot.label,
      slotId: entry.slot.id,
    });
  }
  return items;
}

export interface NodeVisitor<R = void> {
  char: (node: CharNode) => R;
  symbol: (node: SymbolNode) => R;
  raw: (node: RawNode) => R;
  struct: (node: StructNode) => R;
}

export function visitNode<R>(node: MathNode, visitor: NodeVisitor<R>): R {
  switch (node.type) {
    case 'char':
      return visitor.char(node);
    case 'symbol':
      return visitor.symbol(node);
    case 'raw':
      return visitor.raw(node);
    case 'struct':
      return visitor.struct(node);
  }
}

export function forEachSlot(
  root: SlotNode,
  fn: (slot: SlotNode, parentStruct: StructNode | null, slotIndex: number) => void,
): void {
  fn(root, null, -1);
  const walk = (slot: SlotNode) => {
    for (const child of slot.children) {
      if (child.type === 'struct') {
        for (let i = 0; i < child.slots.length; i += 1) {
          fn(child.slots[i], child, i);
          walk(child.slots[i]);
        }
      }
    }
  };
  walk(root);
}

export function slotHasRawNodes(root: SlotNode): boolean {
  let found = false;
  forEachSlot(root, (slot) => {
    if (found) return;
    for (const n of slot.children) {
      if (
        n.type === 'raw' &&
        !/^\\\\(?:\*?\[[^\]]*\])?$/.test(n.latex.trim()) &&
        !/^(?:~|\\,|\\:|\\;|\\!|\\ |\\quad|\\qquad)$/.test(n.latex.trim())
      ) {
        found = true;
        return;
      }
    }
  });
  return found;
}

export function listAllSlots(root: SlotNode): SlotNode[] {
  const out: SlotNode[] = [];
  forEachSlot(root, (slot) => out.push(slot));
  return out;
}

export const OPTIONAL_SLOTS_BY_CMD: Readonly<Record<string, readonly number[]>> = Object.fromEntries(
  Array.from(COMMAND_CAPABILITIES.entries())
    .filter(([, caps]) => caps.optionalSlots.length > 0)
    .map(([id, caps]) => [id, caps.optionalSlots]),
);

export function isOptionalSlot(commandId: string, slotIndex: number): boolean {
  return getOptionalSlots(commandId).includes(slotIndex);
}

/**
 * Determines whether a slot of `node` is rendered in interactive KaTeX.
 * Required slots are always visible. Optional slots are visible when non-empty,
 * when directly focused, or when a paired sibling optional slot is focused
 * (e.g. seeing both lower & upper limits while filling limits of an integral/sum).
 */
export function isSlotVisibleInteractive(
  node: StructNode,
  slotIndex: number,
  activeSlotId: string,
): boolean {
  const slot = node.slots[slotIndex];
  if (!slot) return false;
  if (slot.children.length > 0) return true;
  if (!isOptionalSlot(node.commandId, slotIndex)) return true;
  if (slot.id === activeSlotId) return true;

  // For multi-integrals (\iint, \iiint, \oint), the upper bound is rarely used compared to
  // region/path subscript — keep it collapsed unless non-empty or directly focused!
  if (
    (node.commandId === 'double_integral' ||
      node.commandId === 'contour_integral' ||
      node.commandId === 'triple_integral') &&
    slotIndex === 1
  ) {
    return false;
  }

  const optList = OPTIONAL_SLOTS_BY_CMD[node.commandId];
  if (optList && optList.length >= 2) {
    return optList.some((idx) => node.slots[idx]?.id === activeSlotId);
  }
  return false;
}

export function countEmptySlots(root: SlotNode): number {
  let count = 0;
  const walk = (slot: SlotNode, isRoot: boolean, isOptional: boolean) => {
    if (!isRoot && !isOptional && slot.children.length === 0) {
      count += 1;
    }
    for (const child of slot.children) {
      if (child.type === 'struct') {
        for (let sIdx = 0; sIdx < child.slots.length; sIdx += 1) {
          walk(child.slots[sIdx], false, isOptionalSlot(child.commandId, sIdx));
        }
      }
    }
  };
  walk(root, true, false);
  return count;
}

export function isStructEmpty(node: StructNode): boolean {
  return node.slots.every((s) => s.children.length === 0);
}

const JUMP_ALPHABET = 'abcdefghiklmnopqrstuvwxyz';

export function slotHasNestedStruct(slot: SlotNode): boolean {
  return slot.children.some((c) => c.type === 'struct');
}

const TERM_SPLIT_CHARS = new Set(['+', '-', '=', '<', '>', '~', ',']);

function isTermSeparator(node: MathNode): boolean {
  if (node.type === 'char') return TERM_SPLIT_CHARS.has(node.value);
  if (node.type === 'symbol') return BINARY_RELATION_SYMBOLS.has(node.commandId);
  if (node.type === 'raw') return node.latex.trim() === '\\\\';
  return false;
}

/**
 * Builds hierarchical single-level jump targets (matching v0.8.1's `NavScope` model):
 * - `[a]` jumps to start of this scope
 * - Plain non-struct terms (e.g. `42` between two integrals, `f(x)`, `\cos`) each get their OWN Leaf jump target!
 * - Simple slots (no nested structs) get a direct Leaf target (1 keystroke teleports directly into them)
 * - Complex slots (containing nested structs) collapse into ONE Composite target (`+`) that drills down cleanly!
 * - `[;]` jumps to end of this scope
 */
export function buildJumpTargets(scopeSlot: SlotNode): JumpTarget[] {
  interface RawTarget {
    slotId: string;
    offset: number;
    slotLabel: string;
    anchorKind: 'scope-start' | 'scope-end' | 'slot' | 'text-term';
    termStart?: number;
    termEnd?: number;
    isComposite: boolean;
    placement?: 'top' | 'bottom';
  }

  const raw: RawTarget[] = [];

  if (scopeSlot.children.length > 0) {
    raw.push({
      slotId: scopeSlot.id,
      offset: 0,
      slotLabel: '行首',
      anchorKind: 'scope-start',
      isComposite: false,
      placement: 'top',
    });
  }

  const flushPlainRun = (runStart: number, runEnd: number) => {
    // Split plain runs by additive/relation operators so e.g. `+ 42 +` gives a crisp target right on `42`!
    let i = runStart;
    while (i < runEnd) {
      while (
        i < runEnd &&
        ((scopeSlot.children[i].type === 'char' && (scopeSlot.children[i] as CharNode).value === ' ') ||
          isTermSeparator(scopeSlot.children[i]))
      ) {
        i += 1;
      }
      if (i >= runEnd) break;
      const tStart = i;
      while (i < runEnd && !isTermSeparator(scopeSlot.children[i])) {
        i += 1;
      }
      let tEnd = i;
      while (
        tEnd > tStart &&
        scopeSlot.children[tEnd - 1].type === 'char' &&
        (scopeSlot.children[tEnd - 1] as CharNode).value === ' '
      ) {
        tEnd -= 1;
      }
      if (tEnd > tStart) {
        raw.push({
          slotId: scopeSlot.id,
          offset: tEnd,
          slotLabel: '文本项',
          anchorKind: 'text-term',
          termStart: tStart,
          termEnd: tEnd,
          isComposite: false,
          placement: 'top',
        });
      }
    }
  };

  let runStart: number | null = null;
  for (let i = 0; i < scopeSlot.children.length; i += 1) {
    const child = scopeSlot.children[i];
    if (child.type !== 'struct') {
      if (runStart === null) runStart = i;
      continue;
    }

    if (runStart !== null) {
      flushPlainRun(runStart, i);
      runStart = null;
    }

    const isScript =
      child.commandId === 'sub' || child.commandId === 'sup' || child.commandId === 'subsup';
    const cmdLabel = COMMANDS_BY_ID.get(child.commandId)?.label ?? '结构';

    for (let sIdx = 0; sIdx < child.slots.length; sIdx += 1) {
      const sub = child.slots[sIdx];
      // Skip collapsed empty optional slots (e.g. empty root index of `\sqrt{x}` or empty limits of `\int f dx`)
      if (sub.children.length === 0 && isOptionalSlot(child.commandId, sIdx)) {
        continue;
      }
      const skipSimpleBase =
        isScript &&
        sIdx === 0 &&
        sub.children.length === 1 &&
        sub.children[0].type !== 'struct';
      if (skipSimpleBase) continue;

      const composite = slotHasNestedStruct(sub);
      raw.push({
        slotId: sub.id,
        offset: sub.children.length,
        slotLabel: `${cmdLabel}·${sub.label}`,
        anchorKind: 'slot',
        isComposite: composite,
        placement: getSlotPlacement(child.commandId, sIdx),
      });
    }
  }

  if (runStart !== null) {
    flushPlainRun(runStart, scopeSlot.children.length);
  }

  const labels = generateLabels(raw.length);
  const targets: JumpTarget[] = raw.map((entry, idx) => ({
    ...entry,
    label: labels[idx],
  }));

  if (scopeSlot.children.length > 0) {
    targets.push({
      label: ';',
      slotId: scopeSlot.id,
      offset: scopeSlot.children.length,
      slotLabel: '末尾',
      anchorKind: 'scope-end',
      isComposite: false,
      placement: 'top',
    });
  }

  return targets;
}

function generateLabels(count: number): string[] {
  if (count <= JUMP_ALPHABET.length) {
    return Array.from(JUMP_ALPHABET.slice(0, count));
  }
  const labels: string[] = [];
  for (let i = 0; i < JUMP_ALPHABET.length && labels.length < count; i += 1) {
    for (let j = 0; j < JUMP_ALPHABET.length && labels.length < count; j += 1) {
      labels.push(JUMP_ALPHABET[i] + JUMP_ALPHABET[j]);
    }
  }
  return labels;
}
