import { COMMANDS_BY_ID } from './catalog';
import type {
  BreadcrumbItem,
  CharNode,
  CommandDef,
  Document,
  JumpTarget,
  MathNode,
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

export function createCharNode(value: string): CharNode {
  return { type: 'char', id: nextId('c'), value };
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

export function textToCharNodes(text: string): CharNode[] {
  return Array.from(text).map((ch) => createCharNode(ch));
}

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

export function getBreadcrumbs(root: SlotNode, slotId: string): BreadcrumbItem[] {
  const path = findSlotPath(root, slotId);
  if (!path || path.length <= 1) return [];
  const items: BreadcrumbItem[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const entry = path[i];
    const cmd = entry.parentStruct ? COMMANDS_BY_ID.get(entry.parentStruct.commandId) : undefined;
    items.push({
      commandLabel: cmd?.label ?? '结构',
      slotLabel: entry.slot.label,
      slotId: entry.slot.id,
    });
  }
  return items;
}

export function listAllSlots(root: SlotNode): SlotNode[] {
  const out: SlotNode[] = [root];
  const walk = (slot: SlotNode) => {
    for (const child of slot.children) {
      if (child.type === 'struct') {
        for (const sub of child.slots) {
          out.push(sub);
          walk(sub);
        }
      }
    }
  };
  walk(root);
  return out;
}

export function countEmptySlots(root: SlotNode): number {
  let count = 0;
  const walk = (slot: SlotNode, isRoot: boolean) => {
    if (!isRoot && slot.children.length === 0) {
      count += 1;
    }
    for (const child of slot.children) {
      if (child.type === 'struct') {
        for (const sub of child.slots) {
          walk(sub, false);
        }
      }
    }
  };
  walk(root, true);
  return count;
}

export function isStructEmpty(node: StructNode): boolean {
  return node.slots.every((s) => s.children.length === 0);
}

const JUMP_ALPHABET = 'asdfghjklqwertyuiopzxcvbnm';

function getSlotPlacement(commandId: string, slotIndex: number): 'top' | 'bottom' {
  if (
    (commandId === 'frac' || commandId === 'partial_frac' || commandId === 'total_frac' || commandId === 'binom') &&
    slotIndex === 1
  ) {
    return 'bottom';
  }
  if (
    (commandId === 'integral' || commandId === 'sum' || commandId === 'product' || commandId === 'limit') &&
    slotIndex === 0
  ) {
    return 'bottom';
  }
  if (commandId === 'limit' && slotIndex === 1) {
    return 'bottom';
  }
  if ((commandId === 'sub' || commandId === 'subsup') && slotIndex === 1) {
    return 'bottom';
  }
  return 'top';
}

export function buildJumpTargets(root: SlotNode): JumpTarget[] {
  const entries: { slot: SlotNode; placement: 'top' | 'bottom' }[] = [];

  const walk = (slot: SlotNode) => {
    for (const child of slot.children) {
      if (child.type === 'struct') {
        const isScript =
          child.commandId === 'sub' ||
          child.commandId === 'sup' ||
          child.commandId === 'subsup';
        for (let sIdx = 0; sIdx < child.slots.length; sIdx += 1) {
          const sub = child.slots[sIdx];
          // Avoid stacking a redundant badge on a simple 1-atom script base (e.g. `a` in `a_n`)
          const skipSimpleBase =
            isScript &&
            sIdx === 0 &&
            sub.children.length === 1 &&
            sub.children[0].type !== 'struct';
          if (!skipSimpleBase) {
            entries.push({
              slot: sub,
              placement: getSlotPlacement(child.commandId, sIdx),
            });
          }
          walk(sub);
        }
      }
    }
  };
  walk(root);
  entries.push({ slot: root, placement: 'top' });

  const labels = generateLabels(entries.length);
  return entries.map((entry, idx) => ({
    label: labels[idx],
    slotId: entry.slot.id,
    offset: entry.slot.children.length,
    slotLabel: entry.slot.label,
    placement: entry.placement,
  }));
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
