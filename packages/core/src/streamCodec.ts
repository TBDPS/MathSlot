import {
  createCharNode,
  createEmptyDocument,
  createRawNode,
  createSlot,
  createStructNode,
  createSymbolNode,
  slotHasRawNodes,
  textToCharNodes,
} from './ast';
import {
  COMMANDS,
  COMMANDS_BY_ID,
  COMMANDS_BY_KEYS,
  SUBMENU_KEYS,
  getSubmenuDefaultCommandId,
} from './catalog';
import { MATH_FUNCTIONS } from './emitIr';
import type {
  CommandDef,
  Diagnostic,
  Document,
  GridMeta,
  ImportResult,
  MathNode,
  SlotNode,
  StructNode,
} from './types';

const STREAM_SYMBOL_BY_LATEX = new Map<string, CommandDef>();
for (const cmd of COMMANDS) {
  if (cmd.slots.length === 0) {
    STREAM_SYMBOL_BY_LATEX.set(cmd.latex.trim(), cmd);
  }
}

const STREAM_SYMBOL_ALIASES: Readonly<Record<string, string>> = {
  '\\le': 'leq',
  '\\ge': 'geq',
  '\\ne': 'neq',
  '\\rightarrow': 'to',
  '\\Rightarrow': 'implies',
  '\\Leftrightarrow': 'iff',
  '\\iff': 'iff',
  '\\implies': 'implies',
  '\\lor': 'lor',
  '\\vee': 'lor',
  '\\land': 'land',
  '\\lnot': 'neg',
};

function lookupStreamSymbol(macro: string): CommandDef | undefined {
  const direct = STREAM_SYMBOL_BY_LATEX.get(macro);
  if (direct) return direct;
  const aliasId = STREAM_SYMBOL_ALIASES[macro];
  return aliasId ? COMMANDS_BY_ID.get(aliasId) : undefined;
}

function encodeBracketPayload(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/\]/g, '\\]').replace(/;/g, '\\;');
}

function decodeBracketPayload(encoded: string): string {
  let out = '';
  for (let i = 0; i < encoded.length; i += 1) {
    if (encoded[i] === '\\' && i + 1 < encoded.length) {
      out += encoded[i + 1];
      i += 1;
    } else {
      out += encoded[i];
    }
  }
  return out;
}

function readBracketTag(chars: readonly string[], startPos: number): { content: string; nextPos: number } | null {
  if (chars[startPos] !== '[') return null;
  let i = startPos + 1;
  let buf = '';
  while (i < chars.length) {
    if (chars[i] === '\\' && i + 1 < chars.length) {
      buf += chars[i] + chars[i + 1];
      i += 2;
      continue;
    }
    if (chars[i] === ']') {
      return { content: buf, nextPos: i + 1 };
    }
    buf += chars[i];
    i += 1;
  }
  return null;
}

/**
 * Checks whether `chars[startPos..]` has a balanced second slot terminated by `;` at the current nesting depth.
 * Allows `▸r` to support both concise legacy 1-slot `▸rx;` and full 2-slot `▸r3;8;` / `▸r;▸f1;2;;`.
 */
function hasSecondSqrtSlot(chars: readonly string[], startPos: number): boolean {
  let i = startPos;
  let nestedSemis = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (c === '▸') {
      i += 1;
      if (i >= chars.length) return false;
      if (chars[i] === ';' || chars[i] === '▸') {
        i += 1;
        continue;
      }
      if (chars[i] === '[') {
        const tag = readBracketTag(chars, i);
        if (!tag) return false;
        i = tag.nextPos;
        const parts = tag.content.split(':');
        const kind = parts[0];
        if (kind === 'struct') {
          const slotCount = Number(parts[2] ?? COMMANDS_BY_ID.get(parts[1])?.slots.length ?? 0);
          nestedSemis += slotCount;
        } else if (kind === 'grid') {
          const [rStr, cStr] = (parts[3] ?? '0x0').split('x');
          nestedSemis += Number(rStr) * Number(cStr);
        } else if (kind === 'custom') {
          nestedSemis += Number(parts[2] ?? 0);
        }
        continue;
      }
      const k1 = chars[i];
      i += 1;
      let cmd: CommandDef | undefined;
      if (k1 === 'n') {
        cmd = COMMANDS_BY_ID.get('sqrt');
      } else if (SUBMENU_KEYS.has(k1)) {
        if (i < chars.length) {
          const k2 = chars[i];
          cmd = COMMANDS_BY_KEYS.get(k1 + k2);
          if (cmd) i += 1;
        }
        if (!cmd) {
          const defId = getSubmenuDefaultCommandId(k1);
          if (defId) cmd = COMMANDS_BY_ID.get(defId);
        }
      }
      if (!cmd) {
        if (k1 === 'u') cmd = COMMANDS_BY_ID.get('sup');
        else if (k1 === 'd') cmd = COMMANDS_BY_ID.get('sub');
        else if (k1 === 'b') cmd = COMMANDS_BY_ID.get('subsup');
        else if (k1 === 'p') cmd = COMMANDS_BY_ID.get('paren');
        else cmd = COMMANDS_BY_KEYS.get(k1);
      }
      if (cmd) {
        nestedSemis += cmd.slots.length;
      }
      continue;
    }
    if (c === ';') {
      if (nestedSemis === 0) return true;
      nestedSemis -= 1;
    }
    i += 1;
  }
  return false;
}

/**
 * Parse MathSlot stream code (e.g. `▸lx;0;▸fsin x;x;;`, `▸ue;i▸gp;; + 1 = 0`)
 * directly into a `Document` AST, including extended lossless metadata tags `▸[...]`.
 */
export function parseStreamCode(source: string): ImportResult {
  const chars = Array.from(source);
  let pos = 0;
  const diagnostics: Diagnostic[] = [];

  const parseNodes = (stopAtSemicolon: boolean): MathNode[] => {
    const out: MathNode[] = [];
    while (pos < chars.length) {
      const ch = chars[pos];
      if (stopAtSemicolon && ch === ';') {
        pos += 1;
        return out;
      }
      if (ch === '▸') {
        pos += 1;
        if (pos >= chars.length) break;

        // Escaped literal `;` or `▸`
        if (chars[pos] === ';') {
          pos += 1;
          out.push(createCharNode(';', true));
          continue;
        }
        if (chars[pos] === '▸') {
          pos += 1;
          out.push(createCharNode('▸', true));
          continue;
        }

        // Extended lossless bracket tags: `▸[v:...]`, `▸[raw:...]`, `▸[sym:id]`, `▸[struct:...]`, `▸[grid:...]`, `▸[custom:...]`
        if (chars[pos] === '[') {
          const tag = readBracketTag(chars, pos);
          if (tag) {
            pos = tag.nextPos;
            const colonIdx = tag.content.indexOf(':');
            const kind = colonIdx === -1 ? tag.content : tag.content.slice(0, colonIdx);
            const restPayload = colonIdx === -1 ? '' : tag.content.slice(colonIdx + 1);

            if (kind === 'v') {
              out.push(...textToCharNodes(decodeBracketPayload(restPayload), true));
              continue;
            }
            if (kind === 'raw') {
              out.push(createRawNode(decodeBracketPayload(restPayload)));
              continue;
            }
            if (kind === 'sym') {
              const symCmd = COMMANDS_BY_ID.get(decodeBracketPayload(restPayload));
              if (symCmd) out.push(createSymbolNode(symCmd));
              continue;
            }
            if (kind === 'struct') {
              const parts = restPayload.split(':');
              const cmdId = parts[0];
              const slotCount = Number(parts[1] ?? COMMANDS_BY_ID.get(cmdId)?.slots.length ?? 1);
              const flags = new Set((parts[2] ?? '').split(',').filter(Boolean));
              const baseCmd = COMMANDS_BY_ID.get(cmdId);
              const slotLabels = baseCmd?.slots.length === slotCount
                ? [...baseCmd.slots]
                : Array.from({ length: slotCount }, (_, idx) => `槽${idx + 1}`);
              const slotContents: MathNode[][] = [];
              for (let s = 0; s < slotCount; s += 1) {
                slotContents.push(parseNodes(true));
              }
              const struct = createStructNode({ id: cmdId, slots: slotLabels, latex: baseCmd?.latex ?? '' }, slotContents);
              if (flags.has('auto')) struct.autoSized = true;
              if (flags.has('limits')) struct.limitsMode = 'limits';
              if (flags.has('nolimits')) struct.limitsMode = 'nolimits';
              out.push(struct);
              continue;
            }
            if (kind === 'grid') {
              const parts = restPayload.split(':');
              const cmdId = parts[0] || 'matrix_2x2';
              const env = decodeBracketPayload(parts[1] ?? 'pmatrix');
              const [rStr, cStr] = (parts[2] ?? '2x2').split('x');
              const rows = Math.max(1, Number(rStr) || 2);
              const cols = Math.max(1, Number(cStr) || 2);
              const colSpec = parts[3] ? decodeBracketPayload(parts[3]) : undefined;
              const gapsRaw = parts[4] ? decodeBracketPayload(parts[4]) : '';
              const rowGaps = gapsRaw
                ? gapsRaw.split('|').map((g) => (g ? g : undefined))
                : undefined;
              const total = rows * cols;
              const slotLabels: string[] = [];
              const slotContents: MathNode[][] = [];
              for (let idx = 0; idx < total; idx += 1) {
                const r = Math.floor(idx / cols);
                const c = idx % cols;
                slotLabels.push(`(${r + 1},${c + 1})`);
                slotContents.push(parseNodes(true));
              }
              const struct = createStructNode({ id: cmdId, slots: slotLabels, latex: '' }, slotContents);
              struct.grid = {
                env,
                rows,
                cols,
                ...(colSpec ? { colSpec } : {}),
                ...(rowGaps && rowGaps.some(Boolean) ? { rowGaps } : {}),
              };
              out.push(struct);
              continue;
            }
            if (kind === 'custom') {
              const parts = restPayload.split(':');
              const cmdId = decodeBracketPayload(parts[0] ?? 'custom');
              const slotCount = Math.max(0, Number(parts[1]) || 0);
              const customLatex = decodeBracketPayload(parts.slice(2).join(':'));
              const slotLabels = Array.from({ length: slotCount }, (_, idx) => `参数${idx + 1}`);
              const slotContents: MathNode[][] = [];
              for (let s = 0; s < slotCount; s += 1) {
                slotContents.push(parseNodes(true));
              }
              out.push(
                createStructNode(
                  { id: cmdId, slots: slotLabels, latex: customLatex },
                  slotContents,
                  customLatex,
                ),
              );
              continue;
            }
          }
        }

        const k1 = chars[pos];
        pos += 1;
        let cmd: CommandDef | undefined;
        let legacySingleSqrt = false;
        if (k1 === 'n') {
          cmd = COMMANDS_BY_ID.get('sqrt');
        } else if (SUBMENU_KEYS.has(k1)) {
          if (pos < chars.length) {
            const k2 = chars[pos];
            cmd = COMMANDS_BY_KEYS.get(k1 + k2);
            if (cmd) {
              pos += 1;
            }
          }
          if (!cmd) {
            const defId = getSubmenuDefaultCommandId(k1);
            if (defId) cmd = COMMANDS_BY_ID.get(defId);
          }
        }
        if (!cmd) {
          if (k1 === 'u') cmd = COMMANDS_BY_ID.get('sup');
          else if (k1 === 'd') cmd = COMMANDS_BY_ID.get('sub');
          else if (k1 === 'b') cmd = COMMANDS_BY_ID.get('subsup');
          else if (k1 === 'p') cmd = COMMANDS_BY_ID.get('paren');
          else cmd = COMMANDS_BY_KEYS.get(k1);
          if (k1 === 'r' && cmd?.id === 'sqrt') {
            legacySingleSqrt = true;
          }
        }
        if (!cmd) {
          diagnostics.push({ severity: 'warning', message: `未识别简码 ▸${k1}` });
          continue;
        }
        if (cmd.slots.length === 0) {
          out.push(createSymbolNode(cmd));
        } else if (legacySingleSqrt) {
          const first = parseNodes(true);
          if (hasSecondSqrtSlot(chars, pos)) {
            const second = parseNodes(true);
            out.push(createStructNode(cmd, [first, second]));
          } else {
            out.push(createStructNode(cmd, [[], first]));
          }
        } else {
          const slotContents: MathNode[][] = [];
          for (let s = 0; s < cmd.slots.length; s += 1) {
            const parsedSlot = parseNodes(true);
            if (cmd.id === 'raw_latex') {
              slotContents.push(
                parsedSlot.map((n) => (n.type === 'char' ? createCharNode(n.value, true) : n)),
              );
            } else {
              slotContents.push(parsedSlot);
            }
          }
          out.push(createStructNode(cmd, slotContents));
        }
      } else if (ch === '\\') {
        const start = pos;
        pos += 1;
        let name = '';
        while (pos < chars.length && /[a-zA-Z]/.test(chars[pos])) {
          name += chars[pos];
          pos += 1;
        }
        if (name.length > 0) {
          const macro = `\\${name}`;
          const sym = lookupStreamSymbol(macro);
          if (sym) {
            out.push(createSymbolNode(sym));
          } else if (MATH_FUNCTIONS.has(name)) {
            out.push(...textToCharNodes(name));
          } else if (name === 'mathrm' && chars[pos] === '{') {
            pos += 1;
            let inner = '';
            let depth = 1;
            while (pos < chars.length && depth > 0) {
              if (chars[pos] === '{') depth += 1;
              else if (chars[pos] === '}') depth -= 1;
              if (depth > 0) inner += chars[pos];
              pos += 1;
            }
            out.push(createRawNode(`\\mathrm{${inner}}`));
          } else {
            out.push(createRawNode(macro));
          }
        } else {
          out.push(createCharNode(chars[start]));
        }
      } else {
        out.push(createCharNode(ch));
        pos += 1;
      }
    }
    return out;
  };

  const doc = createEmptyDocument();
  doc.root.children = parseNodes(false);
  return {
    doc,
    diagnostics,
    lossless: diagnostics.length === 0,
    hasRawNodes: slotHasRawNodes(doc.root),
  };
}

function serializeGridTag(node: StructNode, grid: GridMeta): string {
  const specPart = grid.colSpec ? encodeBracketPayload(grid.colSpec) : '';
  const gapsPart =
    grid.rowGaps && grid.rowGaps.some(Boolean)
      ? encodeBracketPayload(
          Array.from({ length: Math.max(0, grid.rows - 1) }, (_, idx) => grid.rowGaps?.[idx] ?? '').join('|'),
        )
      : '';
  const base = `grid:${node.commandId}:${encodeBracketPayload(grid.env)}:${grid.rows}x${grid.cols}`;
  if (gapsPart) return `▸[${base}:${specPart}:${gapsPart}]`;
  if (specPart) return `▸[${base}:${specPart}]`;
  return `▸[${base}]`;
}

function serializeStructStream(node: StructNode): string {
  const isRawSlot = node.commandId === 'raw_latex';
  const slotParts = node.slots.map((s) => serializeSlotStream(s, true, isRawSlot)).join('');

  if (node.customLatex) {
    return `▸[custom:${encodeBracketPayload(node.commandId)}:${node.slots.length}:${encodeBracketPayload(node.customLatex)}]${slotParts}`;
  }

  if (node.grid) {
    return `${serializeGridTag(node, node.grid)}${slotParts}`;
  }

  const flags: string[] = [];
  if (node.autoSized) flags.push('auto');
  if (node.limitsMode) flags.push(node.limitsMode);

  if (flags.length > 0) {
    return `▸[struct:${node.commandId}:${node.slots.length}:${flags.join(',')}]${slotParts}`;
  }

  if (node.commandId === 'sup' && node.slots.length === 2) {
    return `▸u${slotParts}`;
  }
  if (node.commandId === 'sub' && node.slots.length === 2) {
    return `▸d${slotParts}`;
  }
  if (node.commandId === 'paren' && node.slots.length === 1) {
    return `▸p${slotParts}`;
  }

  const cmd = COMMANDS_BY_ID.get(node.commandId);
  if (cmd && cmd.keys.length > 0 && cmd.slots.length === node.slots.length) {
    return `▸${cmd.keys.join('')}${slotParts}`;
  }

  return `▸[struct:${node.commandId}:${node.slots.length}]${slotParts}`;
}

function serializeSlotStream(slot: SlotNode, appendTerminator: boolean, isRawSlot = false): string {
  let out = '';
  let i = 0;
  while (i < slot.children.length) {
    const child = slot.children[i];
    if (child.type === 'char') {
      if (child.value === ';') {
        out += '▸;';
        i += 1;
        continue;
      }
      if (child.value === '▸') {
        out += '▸▸';
        i += 1;
        continue;
      }
      if (isRawSlot) {
        out += child.value;
        i += 1;
        continue;
      }
      if (child.value === '\\') {
        out += `▸[v:${encodeBracketPayload('\\')}]`;
        i += 1;
        continue;
      }
      if (child.verbatim && /^[A-Za-z~]$/.test(child.value)) {
        let run = child.value;
        let j = i + 1;
        while (j < slot.children.length) {
          const next = slot.children[j];
          if (next.type === 'char' && next.verbatim && /^[A-Za-z~]$/.test(next.value)) {
            run += next.value;
            j += 1;
          } else {
            break;
          }
        }
        out += `▸[v:${encodeBracketPayload(run)}]`;
        i = j;
        continue;
      }
      out += child.value;
      i += 1;
      continue;
    }

    if (child.type === 'symbol') {
      const cmd = COMMANDS_BY_ID.get(child.commandId);
      if (cmd && cmd.keys.length > 0 && cmd.latex === child.latex) {
        out += `▸${cmd.keys.join('')}`;
      } else {
        out += `▸[sym:${encodeBracketPayload(child.commandId)}]`;
      }
      i += 1;
      continue;
    }

    if (child.type === 'raw') {
      out += `▸[raw:${encodeBracketPayload(child.latex)}]`;
      i += 1;
      continue;
    }

    out += serializeStructStream(child);
    i += 1;
  }
  return appendTerminator ? `${out};` : out;
}

/**
 * Serializes any `Document` AST into MathSlot's 1D prefix stream code (`▸f1;2;`, `▸lx;0;▸fsin x;x;;`).
 * Standard keyboard structures produce concise human-readable `▸<keys>...;` codes, while extended
 * AST flags (`autoSized`, `limitsMode`, dynamic `grid`, `verbatim`, `RawNode`) use lossless `▸[...]` tags.
 */
export function toStreamCode(doc: Document): string {
  return serializeSlotStream(doc.root, false);
}
