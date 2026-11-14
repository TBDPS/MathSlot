import type { SlotSnapshot } from '../client/engine';

export interface NavTreeNode {
  key: string;
  kind: 'group' | 'slot';
  label: string;
  depth: number;
  path: number[];
  slot?: SlotSnapshot;
  children: NavTreeNode[];
}

export interface FlattenedNavItem {
  key: string;
  node: NavTreeNode;
  depth: number;
  level: number;
  isExpandable: boolean;
  isExpanded: boolean;
  parentKey: string | null;
}

interface TrieNode {
  path: number[];
  slot?: SlotSnapshot;
  children: Map<number, TrieNode>;
}

function getSlotPath(slot: SlotSnapshot): number[] {
  if (slot.path && slot.path.length > 0) {
    return [...slot.path];
  }
  return [slot.id];
}

function getSlotDepth(slot: SlotSnapshot, path: number[]): number {
  return typeof slot.depth === 'number' ? slot.depth : path.length;
}

function collectDescendantSlots(trie: TrieNode, acc: SlotSnapshot[] = []): SlotSnapshot[] {
  if (trie.slot) acc.push(trie.slot);
  for (const child of trie.children.values()) {
    collectDescendantSlots(child, acc);
  }
  return acc;
}

function describeGroupLabel(trie: TrieNode): string {
  const directSlots = Array.from(trie.children.values())
    .map((c) => c.slot)
    .filter((s): s is SlotSnapshot => s !== undefined);

  if (
    directSlots.length > 0 &&
    directSlots.every((s) => s.role.startsWith('MatrixCell('))
  ) {
    const match = /^MatrixCell\((\d+),/.exec(directSlots[0]!.role);
    if (match) {
      return `第 ${Number(match[1]) + 1} 行`;
    }
  }

  const allSlots = collectDescendantSlots(trie);
  if (allSlots.length > 0 && allSlots.every((s) => s.role.startsWith('MatrixCell('))) {
    return `矩阵结构 (${allSlots.length} 槽位)`;
  }
  if (
    allSlots.some((s) => s.role === 'Numerator') &&
    allSlots.some((s) => s.role === 'Denominator')
  ) {
    return '分式结构';
  }
  if (allSlots.some((s) => s.role === 'Radicand' || s.role === 'RootIndex')) {
    return '根式结构';
  }
  return `复合结构 [${trie.path.join('.')}]`;
}

function convertTrieChildren(trie: TrieNode, depthOffset: number): NavTreeNode[] {
  const keys = Array.from(trie.children.keys()).sort((a, b) => a - b);
  const nodes: NavTreeNode[] = [];

  for (const k of keys) {
    let cur = trie.children.get(k)!;
    // Collapse redundant single-child empty wrapper nodes while preserving real slot depth
    while (!cur.slot && cur.children.size === 1) {
      const onlyChild = cur.children.values().next().value;
      if (!onlyChild) break;
      cur = onlyChild;
    }

    const childNodes = convertTrieChildren(cur, depthOffset + 1);
    if (cur.slot) {
      const path = getSlotPath(cur.slot);
      const depth = getSlotDepth(cur.slot, path);
      nodes.push({
        key: `slot-${cur.slot.id}`,
        kind: 'slot',
        label: cur.slot.label,
        depth,
        path,
        slot: cur.slot,
        children: childNodes,
      });
    } else if (childNodes.length > 0) {
      nodes.push({
        key: `group-${cur.path.join('-')}`,
        kind: 'group',
        label: describeGroupLabel(cur),
        depth: Math.max(0, cur.path.length - 1),
        path: [...cur.path],
        children: childNodes,
      });
    }
  }

  return nodes;
}

export function buildNavTree(slots: readonly SlotSnapshot[]): NavTreeNode[] {
  if (slots.length === 0) return [];

  const root: TrieNode = { path: [], children: new Map() };
  for (const slot of slots) {
    const path = getSlotPath(slot);
    let cur = root;
    for (let i = 0; i < path.length; i++) {
      const seg = path[i]!;
      let next = cur.children.get(seg);
      if (!next) {
        next = {
          path: path.slice(0, i + 1),
          children: new Map(),
        };
        cur.children.set(seg, next);
      }
      cur = next;
    }
    cur.slot = slot;
  }

  return convertTrieChildren(root, 0);
}

export function flattenNavTree(
  nodes: readonly NavTreeNode[],
  collapsedKeys: ReadonlySet<string>,
  parentKey: string | null = null,
  parentLevel = 0,
): FlattenedNavItem[] {
  const out: FlattenedNavItem[] = [];
  for (const node of nodes) {
    const isExpandable = node.children.length > 0;
    const isExpanded = isExpandable && !collapsedKeys.has(node.key);
    const level = Math.max(parentLevel + 1, node.kind === 'slot' ? node.depth : parentLevel + 1);

    out.push({
      key: node.key,
      node,
      depth: node.depth,
      level,
      isExpandable,
      isExpanded,
      parentKey,
    });

    if (isExpandable && isExpanded) {
      out.push(...flattenNavTree(node.children, collapsedKeys, node.key, level));
    }
  }
  return out;
}
