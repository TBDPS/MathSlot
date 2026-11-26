import { createStructNode } from '../ast';
import { COMMANDS_BY_ID } from '../catalog';
import { MACRO_PARSE_TABLE } from '../commandSpecs';
import type { MathNode } from '../types';

export interface ParserRuleContext {
  readBracketRaw: () => string | null;
  readGroupNodes: () => MathNode[];
  readSubSup: () => { sub: MathNode[] | null; sup: MathNode[] | null };
  readOptionalLimitsMode: () => 'limits' | 'nolimits' | undefined;
  readBigOpBody: (isIntegral: boolean) => MathNode[];
  parseNested: (raw: string) => MathNode[];
}

/**
 * Generic table-driven LaTeX macro parser executing declarative `CommandCapabilities.parseRule` signatures.
 * Automatically parses 1/2/N-arg `{...}`, `[opt]{...}`, `{body}^sup`/`_sub`, and 3-slot `bigop` commands
 * without per-command imperative branches.
 */
export function tryParseMacroByRule(macro: string, ctx: ParserRuleContext): MathNode[] | null {
  const entry = MACRO_PARSE_TABLE.get(macro);
  if (!entry) return null;
  const cmd = COMMANDS_BY_ID.get(entry.commandId);
  if (!cmd) return null;

  const slotContents: MathNode[][] = cmd.slots.map(() => []);
  let limitsMode: 'limits' | 'nolimits' | undefined;

  for (const token of entry.rule.signature) {
    switch (token.kind) {
      case 'bracket_opt': {
        const opt = ctx.readBracketRaw();
        slotContents[token.slot] = opt !== null ? ctx.parseNested(opt) : [];
        break;
      }
      case 'brace': {
        slotContents[token.slot] = ctx.readGroupNodes();
        break;
      }
      case 'sup': {
        const { sup } = ctx.readSubSup();
        slotContents[token.slot] = sup ?? [];
        break;
      }
      case 'sub': {
        const { sub } = ctx.readSubSup();
        slotContents[token.slot] = sub ?? [];
        break;
      }
      case 'bigop': {
        limitsMode = ctx.readOptionalLimitsMode();
        const { sub, sup } = ctx.readSubSup();
        const body = ctx.readBigOpBody(token.integralStyle);
        slotContents[token.subSlot] = sub ?? [];
        slotContents[token.supSlot] = sup ?? [];
        slotContents[token.bodySlot] = body;
        break;
      }
    }
  }

  const struct = createStructNode(cmd, slotContents);
  if (limitsMode) struct.limitsMode = limitsMode;
  return [struct];
}
