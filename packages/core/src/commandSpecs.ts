import { COMMANDS, COMMANDS_BY_ID } from './catalog';
import {
  type AdaptiveTemplateRule,
  BIGOP_VERTICAL,
  BINARY_RELATION_CMD_IDS,
  type CommandCapabilities,
  type InlineArgOpenSpec,
  LEGACY_OPTIONAL_SLOTS,
  type MacroArgToken,
  type MacroParseRule,
  SPEC_OVERRIDES,
  type VerticalSlotNav,
} from './commandBlueprintData';
import type { GridMeta, StructNode } from './types';

export * from './gridSpec';
export * from './sanitize';
export type {
  AdaptiveTemplateRule,
  CommandCapabilities,
  InlineArgOpenSpec,
  MacroArgToken,
  MacroParseRule,
  VerticalSlotNav,
};

function enrichCapabilities(
  optionalSlots: readonly number[],
  raw?: Omit<CommandCapabilities, 'optionalSlots'>,
): CommandCapabilities {
  if (!raw) return { optionalSlots };
  const verticalNav = raw.verticalNav ?? (raw.bigopMacro ? BIGOP_VERTICAL : undefined);
  let parseRule = raw.parseRule;
  if (!parseRule) {
    if (raw.bigopMacro) {
      parseRule = {
        macros: [raw.bigopMacro],
        signature: [
          {
            kind: 'bigop',
            subSlot: 0,
            supSlot: 1,
            bodySlot: 2,
            integralStyle: Boolean(raw.isIntegralOp),
          },
        ],
      };
    } else if (raw.accentMacro) {
      parseRule = {
        macros: [raw.accentMacro],
        signature: [{ kind: 'brace', slot: 0 }],
      };
    }
  }
  return {
    optionalSlots,
    ...raw,
    ...(verticalNav ? { verticalNav } : {}),
    ...(parseRule ? { parseRule } : {}),
  };
}

export const COMMAND_CAPABILITIES: ReadonlyMap<string, CommandCapabilities> = (() => {
  const map = new Map<string, CommandCapabilities>();
  for (const cmd of COMMANDS) {
    const raw =
      SPEC_OVERRIDES[cmd.id] ??
      (BINARY_RELATION_CMD_IDS.has(cmd.id) ? { isBinaryRelation: true } : undefined);
    map.set(cmd.id, enrichCapabilities(cmd.optionalSlots ?? [], raw));
  }
  for (const [id, ov] of Object.entries(SPEC_OVERRIDES)) {
    if (!map.has(id)) {
      map.set(id, enrichCapabilities(LEGACY_OPTIONAL_SLOTS[id] ?? [], ov));
    }
  }
  return map;
})();

const EMPTY_CAPS: CommandCapabilities = { optionalSlots: [] };

export function getCommandCapabilities(commandId: string): CommandCapabilities {
  return COMMAND_CAPABILITIES.get(commandId) ?? EMPTY_CAPS;
}

export function getOptionalSlots(commandId: string): readonly number[] {
  return getCommandCapabilities(commandId).optionalSlots;
}

export function isTightSlot(commandId: string, slotIndex: number): boolean {
  return getCommandCapabilities(commandId).tightSlots?.includes(slotIndex) ?? false;
}

export function getSlotPlacement(commandId: string, slotIndex: number): 'top' | 'bottom' {
  return getCommandCapabilities(commandId).bottomSlots?.includes(slotIndex) ? 'bottom' : 'top';
}

export function isIntegralBodySlot(commandId: string, slotIndex: number): boolean {
  return getCommandCapabilities(commandId).integralBodySlots?.includes(slotIndex) ?? false;
}

/**
 * Declaratively resolves the LaTeX template for `node` based on which optional slots are filled
 * and any modifiers (`limitsMode`), replacing the legacy 130-line hardcoded `switch`.
 */
export function resolveCommandTemplate(
  node: StructNode,
  hasSlot: (idx: number) => boolean,
): string | null {
  if (node.customLatex) return null;
  const caps = getCommandCapabilities(node.commandId);

  if (caps.bigopMacro) {
    const macro = node.limitsMode ? `${caps.bigopMacro}\\${node.limitsMode}` : caps.bigopMacro;
    if (node.slots.length === 3) {
      const hasLo = hasSlot(0);
      const hasHi = hasSlot(1);
      if (hasLo && hasHi) return `${macro}_{$1}^{$2} $3`;
      if (hasLo) return `${macro}_{$1} $3`;
      if (hasHi) return `${macro}^{$2} $3`;
      return `${macro} $3`;
    }
    if (node.slots.length === 2) {
      return hasSlot(0) ? `${macro}_{$1} $2` : `${macro} $2`;
    }
    return null;
  }

  if (caps.derivMacro && node.slots.length === 4) {
    const d = caps.derivMacro;
    const numOrder = hasSlot(0) ? `${d}^{$1}` : d;
    const denOrder = hasSlot(3) ? '$3^{$4}' : '$3';
    return `\\frac{${numOrder} $2}{${d} ${denOrder}}`;
  }

  if (caps.adaptiveTemplates) {
    const limitsToken = node.limitsMode ? `\\${node.limitsMode}` : '';
    for (const rule of caps.adaptiveTemplates) {
      if (rule.slotCount !== undefined && rule.slotCount !== node.slots.length) continue;
      if (rule.filled.every((idx) => hasSlot(idx))) {
        return rule.latex.replace('__LIMITS__', limitsToken);
      }
    }
  }

  return null;
}

export function getVerticalNavTarget(
  commandId: string,
  slotIndex: number,
  direction: 'up' | 'down',
  slotCount: number,
): number | undefined {
  const expectedCount =
    COMMANDS_BY_ID.get(commandId)?.slots.length ??
    (commandId === 'nth_root' ? 2 : undefined);
  if (expectedCount !== undefined && expectedCount !== slotCount) {
    return undefined;
  }
  const nav = getCommandCapabilities(commandId).verticalNav?.[slotIndex];
  const target = direction === 'up' ? nav?.up : nav?.down;
  if (target !== undefined && target >= 0 && target < slotCount) {
    return target;
  }
  return undefined;
}

export const BINARY_RELATION_SYMBOLS: ReadonlySet<string> = new Set(
  Array.from(COMMAND_CAPABILITIES.entries())
    .filter(([, c]) => c.isBinaryRelation)
    .map(([id]) => id),
);

export const SELF_DELIMITED_STRUCTS: ReadonlySet<string> = new Set(
  Array.from(COMMAND_CAPABILITIES.entries())
    .filter(([, c]) => c.isSelfDelimited)
    .map(([id]) => id),
);

export const DELIMITER_STRUCT_IDS: ReadonlySet<string> = new Set(
  Array.from(COMMAND_CAPABILITIES.entries())
    .filter(([, c]) => c.isDelimiter)
    .map(([id]) => id),
);

export const PREFIX_BIGOPS: ReadonlySet<string> = new Set(
  Array.from(COMMAND_CAPABILITIES.entries())
    .filter(([, c]) => c.isPrefixBigOp)
    .map(([id]) => id),
);

export const INTEGRAL_OPS: ReadonlySet<string> = new Set(
  Array.from(COMMAND_CAPABILITIES.entries())
    .filter(([, c]) => c.isIntegralOp)
    .map(([id]) => id),
);

export const TALL_STRUCT_IDS: ReadonlySet<string> = new Set(
  Array.from(COMMAND_CAPABILITIES.entries())
    .filter(([, c]) => c.isTall)
    .map(([id]) => id),
);

export const BACKWARD_WRAP_CMDS: ReadonlySet<string> = new Set(
  Array.from(COMMAND_CAPABILITIES.entries())
    .filter(([, c]) => c.backwardWrap)
    .map(([id]) => id),
);

export const BUILTIN_GRID_META: Readonly<Record<string, GridMeta>> = Object.fromEntries(
  Array.from(COMMAND_CAPABILITIES.entries())
    .filter(([, c]) => Boolean(c.gridMeta))
    .map(([id, c]) => [id, c.gridMeta!]),
);

export const INLINE_STRUCT_MAP: Readonly<Record<string, string>> = (() => {
  const rec: Record<string, string> = {};
  for (const [id, caps] of COMMAND_CAPABILITIES.entries()) {
    if (!COMMANDS_BY_ID.has(id)) continue;
    for (const macro of caps.inlineMacros ?? []) {
      rec[macro] = id;
    }
  }
  return rec;
})();

export const ACCENT_MACRO_MAP: Readonly<Record<string, string>> = (() => {
  const rec: Record<string, string> = {};
  for (const [id, caps] of COMMAND_CAPABILITIES.entries()) {
    if (caps.accentMacro && COMMANDS_BY_ID.has(id)) {
      rec[caps.accentMacro] = id;
    }
  }
  return rec;
})();

export const NEXT_BRACE_SLOT_MAP: Readonly<Record<string, number>> = (() => {
  const rec: Record<string, number> = {};
  for (const [id, caps] of COMMAND_CAPABILITIES.entries()) {
    if (typeof caps.nextBraceSlot === 'number') {
      rec[id] = caps.nextBraceSlot;
    } else if (caps.parseRule) {
      const braceSlots = caps.parseRule.signature
        .filter((t) => t.kind === 'brace' || t.kind === 'bracket_opt')
        .map((t) => t.slot);
      if (braceSlots.length === 2 && braceSlots[0] === 0 && braceSlots[1] === 1) {
        rec[id] = 1;
      }
    }
  }
  return rec;
})();

export const INLINE_OPEN_SPEC_MAP: Readonly<Record<string, InlineArgOpenSpec>> = (() => {
  const rec: Record<string, InlineArgOpenSpec> = {};
  for (const [id, caps] of COMMAND_CAPABILITIES.entries()) {
    const cmd = COMMANDS_BY_ID.get(id);
    if (!cmd || cmd.slots.length === 0) continue;
    const sig = caps.parseRule?.signature;
    if (
      sig &&
      sig[0]?.kind === 'bracket_opt' &&
      sig[1]?.kind === 'brace' &&
      cmd.slots.length === 2
    ) {
      rec[id] = {
        bracketSlot: sig[0].slot,
        firstBraceSlot: sig[1].slot,
        bracketFillOrder: [sig[0].slot, sig[1].slot],
        braceFillOrder: [sig[1].slot, sig[0].slot],
      };
    } else {
      rec[id] = {
        firstBraceSlot: 0,
        ...(cmd.slots.length === 2 ? { braceFillOrder: [0, 1] } : {}),
      };
    }
  }
  return rec;
})();

export const MACRO_PARSE_TABLE: ReadonlyMap<string, { commandId: string; rule: MacroParseRule }> =
  (() => {
    const map = new Map<string, { commandId: string; rule: MacroParseRule }>();
    for (const [id, caps] of COMMAND_CAPABILITIES.entries()) {
      if (!COMMANDS_BY_ID.has(id) || !caps.parseRule) continue;
      for (const macro of caps.parseRule.macros) {
        map.set(macro, { commandId: id, rule: caps.parseRule });
      }
    }
    return map;
  })();
