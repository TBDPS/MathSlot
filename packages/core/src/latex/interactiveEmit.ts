import { findSlotPath, getGridMeta, isOptionalSlot, isSlotVisibleInteractive } from '../ast';
import { COMMANDS_BY_ID } from '../catalog';
import {
  BINARY_RELATION_SYMBOLS,
  INTEGRAL_OPS,
  PREFIX_BIGOPS,
  hasCustomColSpec,
  sanitizeLatexTemplate,
} from '../commandSpecs';
import {
  MATH_FUNCTIONS,
  OPERATORNAME_FUNCTIONS,
  analyzeSlotSemantics,
} from '../emitIr';
import { BARE_WORD_ATOMS, BARE_WORD_BINOPS } from '../shorthands';
import type { Cursor, Document, MathNode, Selection, SlotNode, StructNode } from '../types';
import {
  escapeCharLatex,
  isLineBreakRaw,
  isSimpleFuncArgParen,
  projectGridEnvironment,
  projectMultilineRanges,
  projectStructByTemplate,
} from './structProjector';

export interface InteractiveRenderOptions {
  focused?: boolean;
  showJumpTargets?: boolean;
  autoShorthands?: boolean;
}

function isPrevExprForDiff(children: MathNode[], idx: number): boolean {
  let k = idx - 1;
  while (k >= 0 && children[k].type === 'char' && (children[k] as { value: string }).value === ' ') {
    k -= 1;
  }
  if (k < 0) return false;
  const prev = children[k];
  if (prev.type === 'struct') {
    return !PREFIX_BIGOPS.has(prev.commandId);
  }
  if (prev.type === 'symbol') {
    return !INTEGRAL_OPS.has(prev.commandId) && !BINARY_RELATION_SYMBOLS.has(prev.commandId);
  }
  if (prev.type === 'char') {
    return !/^[([\{+\-*/=<>,;|:~\\]$/.test(prev.value);
  }
  return true;
}

function getStructSubtreeHeight(node: StructNode): number {
  let maxChild = -1;
  for (const s of node.slots) {
    for (const c of s.children) {
      if (c.type === 'struct') {
        if (isSimpleFuncArgParen(c)) continue;
        const h = getStructSubtreeHeight(c);
        if (h > maxChild) maxChild = h;
      }
    }
  }
  return maxChild + 1;
}

function wrapCaret(): string {
  return '\\htmlClass{ms-caret-anchor}{}';
}

function emitSlotInteractive(
  slot: SlotNode,
  cursor: Cursor,
  selection: Selection | null,
  parentStructId: string | null,
  isRoot: boolean,
  focused: boolean,
  autoShorthands: boolean,
  depth: number,
  isOptional = false,
): string {
  const isActive = cursor.slotId === slot.id;
  const isEmpty = slot.children.length === 0;
  const selForSlot = selection && selection.slotId === slot.id ? selection : null;

  const slotClasses = ['ms-slot'];
  if (isRoot) slotClasses.push('ms-slot-root');
  if (isActive && focused) slotClasses.push('ms-slot-active');
  if (isEmpty && !isRoot) slotClasses.push('ms-slot-empty');

  if (isEmpty) {
    const caret = isActive && focused ? wrapCaret() : '';
    if (isRoot) {
      return `\\htmlData{slot-id=${slot.id}}{\\htmlClass{${slotClasses.join(' ')}}{${caret}\\htmlClass{ms-empty-root}{\\phantom{x}}}}`;
    }
    const boxClasses = isActive && focused
      ? isOptional
        ? 'ms-empty-box ms-empty-box-active ms-empty-box-optional'
        : 'ms-empty-box ms-empty-box-active'
      : isOptional
        ? 'ms-empty-box ms-empty-box-optional'
        : 'ms-empty-box';
    const emptyBox =
      isActive && focused
        ? `${caret}\\htmlClass{${boxClasses}}{\\square}`
        : `\\htmlClass{${boxClasses}}{\\square}`;
    return `\\htmlData{slot-id=${slot.id}}{\\htmlClass{${slotClasses.join(' ')}}{${emptyBox}}}`;
  }

  const hints = analyzeSlotSemantics(slot.children, autoShorthands);
  const parts: string[] = [];

  for (let idx = 0; idx < slot.children.length; idx += 1) {
    if (isActive && focused && cursor.offset === idx && !selForSlot) {
      parts.push(wrapCaret());
    }

    const child = slot.children[idx];
    const prevNonSpace = (() => {
      for (let k = idx - 1; k >= 0; k -= 1) {
        const n = slot.children[k];
        if (!(n.type === 'char' && n.value === ' ')) return n;
      }
      return undefined;
    })();
    const nextNonSpace = (() => {
      for (let k = idx + 1; k < slot.children.length; k += 1) {
        const n = slot.children[k];
        if (!(n.type === 'char' && n.value === ' ')) return n;
      }
      return undefined;
    })();

    const irSpan = hints.spansByStart.get(idx);

    if (irSpan && irSpan.kind === 'macro_draft') {
      const caretTouching =
        isActive && focused && cursor.offset > irSpan.start && cursor.offset <= irSpan.end;
      const selSlicesMacro =
        selForSlot !== null &&
        ((selForSlot.start > irSpan.start && selForSlot.start < irSpan.end) ||
          (selForSlot.end > irSpan.start && selForSlot.end < irSpan.end));
      const knownMacroLatex =
        irSpan.rawText.length > 0
          ? (BARE_WORD_ATOMS[irSpan.rawText] ??
              BARE_WORD_BINOPS[irSpan.rawText] ??
              OPERATORNAME_FUNCTIONS[irSpan.rawText] ??
              (MATH_FUNCTIONS.has(irSpan.rawText) ? `\\${irSpan.rawText}` : undefined))
          : undefined;

      if (!caretTouching && !selSlicesMacro && knownMacroLatex) {
        const isSelected =
          selForSlot !== null &&
          selForSlot.start <= irSpan.start &&
          selForSlot.end >= irSpan.end;
        const atomClasses = isSelected ? 'ms-atom ms-selected' : 'ms-atom';
        const spanLen = irSpan.end - irSpan.start;
        parts.push(
          `\\htmlData{atom-slot=${slot.id},offset=${irSpan.start},span=${spanLen}}{\\htmlClass{${atomClasses}}{${knownMacroLatex}}}`,
        );
        idx = irSpan.end - 1;
        continue;
      }

      for (let k = irSpan.start; k < irSpan.end; k += 1) {
        if (k > irSpan.start && isActive && focused && cursor.offset === k && !selForSlot) {
          parts.push(wrapCaret());
        }
        const mChar = slot.children[k] as { value: string };
        const isSel = selForSlot !== null && k >= selForSlot.start && k < selForSlot.end;
        const cls = isSel ? 'ms-atom ms-macro-draft ms-selected' : 'ms-atom ms-macro-draft';
        const glyph = mChar.value === '\\' ? '\\text{\\texttt{\\textbackslash}}' : `\\text{\\texttt{${mChar.value}}}`;
        parts.push(`\\htmlData{atom-slot=${slot.id},offset=${k}}{\\htmlClass{${cls}}{${glyph}}}`);
      }
      idx = irSpan.end - 1;
      continue;
    }

    if (irSpan && (irSpan.kind === 'diff' || irSpan.kind === 'binop' || irSpan.kind === 'symbol_word')) {
      const caretTouching =
        isActive && focused && cursor.offset > irSpan.start && cursor.offset <= irSpan.end;
      const selSlicesWord =
        selForSlot !== null &&
        ((selForSlot.start > irSpan.start && selForSlot.start < irSpan.end) ||
          (selForSlot.end > irSpan.start && selForSlot.end < irSpan.end));

      if (!caretTouching && !selSlicesWord) {
        if (irSpan.kind === 'diff' && isPrevExprForDiff(slot.children, idx)) {
          parts.push('\\,');
        }
        const isSelected =
          selForSlot !== null && selForSlot.start <= irSpan.start && selForSlot.end >= irSpan.end;
        const atomClasses = isSelected ? 'ms-atom ms-selected' : 'ms-atom';
        const spanLen = irSpan.end - irSpan.start;
        parts.push(
          `\\htmlData{atom-slot=${slot.id},offset=${irSpan.start},span=${spanLen}}{\\htmlClass{${atomClasses}}{${irSpan.latex}}}`,
        );
        idx = irSpan.end - 1;
        continue;
      }
    }

    if (child.type === 'char' && child.value === ' ') {
      const isSelected = selForSlot !== null && idx >= selForSlot.start && idx < selForSlot.end;
      const atomClasses = isSelected
        ? 'ms-atom ms-space-atom ms-selected'
        : 'ms-atom ms-space-atom';
      parts.push(
        `\\htmlData{atom-slot=${slot.id},offset=${idx}}{\\htmlClass{${atomClasses}}{\\kern0pt}}`,
      );
      continue;
    }

    if (
      (hints.diffStarts.has(idx) || (child.type === 'struct' && child.commandId === 'diff')) &&
      isPrevExprForDiff(slot.children, idx)
    ) {
      parts.push('\\,');
    }

    if (
      hints.funcStarts.has(idx) &&
      prevNonSpace &&
      (prevNonSpace.type === 'struct' ||
        prevNonSpace.type === 'symbol' ||
        (prevNonSpace.type === 'char' && /[A-Za-z0-9)]/.test(prevNonSpace.value)))
    ) {
      parts.push('\\,');
    }

    if (
      ((child.type === 'struct' && PREFIX_BIGOPS.has(child.commandId)) ||
        (child.type === 'symbol' && INTEGRAL_OPS.has(child.commandId))) &&
      prevNonSpace &&
      (prevNonSpace.type === 'struct' ||
        (prevNonSpace.type === 'char' && /[A-Za-z0-9)]/.test(prevNonSpace.value)))
    ) {
      parts.push('\\,');
    }

    if (isLineBreakRaw(child)) {
      parts.push(` ${(child as { latex: string }).latex.trim()} `);
      continue;
    }

    const isSelected = selForSlot !== null && idx >= selForSlot.start && idx < selForSlot.end;
    const atomLatex = emitNodeInteractive(
      child,
      cursor,
      selection,
      parentStructId,
      focused,
      hints.upright.has(idx),
      autoShorthands,
      depth,
    );
    const atomClasses = isSelected ? 'ms-atom ms-selected' : 'ms-atom';
    parts.push(
      `\\htmlData{atom-slot=${slot.id},offset=${idx}}{\\htmlClass{${atomClasses}}{${atomLatex}}}`,
    );

    if (
      hints.funcEnds.has(idx) &&
      nextNonSpace &&
      (nextNonSpace.type === 'struct' ||
        nextNonSpace.type === 'symbol' ||
        (nextNonSpace.type === 'char' && /[A-Za-z0-9]/.test(nextNonSpace.value)))
    ) {
      if (!(nextNonSpace.type === 'struct' && nextNonSpace.commandId === 'paren')) {
        parts.push('\\,');
      }
    }
  }

  if (isActive && focused && cursor.offset === slot.children.length && !selForSlot) {
    parts.push(wrapCaret());
  }

  return `\\htmlData{slot-id=${slot.id}}{\\htmlClass{${slotClasses.join(' ')}}{${parts.join('')}}}`;
}

function emitTextBoxInteractive(
  node: StructNode,
  cursor: Cursor,
  selection: Selection | null,
  focused: boolean,
  autoShorthands: boolean,
  structDepth: number,
): string {
  const slot = node.slots[0];
  const isActive = cursor.slotId === slot.id;
  const slotClasses = ['ms-slot'];
  if (isActive) slotClasses.push('ms-slot-active');
  if (slot.children.length === 0) slotClasses.push('ms-slot-empty');
  const selForSlot = selection && selection.slotId === slot.id ? selection : null;

  if (slot.children.length === 0) {
    const emptyBox = isActive
      ? '\\htmlClass{ms-empty-box ms-empty-box-active}{\\square}'
      : '\\htmlClass{ms-empty-box}{\\square}';
    const content = isActive && focused ? `${wrapCaret()}${emptyBox}` : emptyBox;
    return `\\htmlData{slot-id=${slot.id}}{\\htmlClass{${slotClasses.join(' ')}}{${content}}}`;
  }

  const parts: string[] = [];
  for (let i = 0; i < slot.children.length; i += 1) {
    if (isActive && focused && cursor.offset === i && !selForSlot) {
      parts.push(wrapCaret());
    }
    const ch = slot.children[i];
    let atomLatex: string;
    if (ch.type === 'char') {
      const esc = ch.value === ' ' ? ' ' : escapeCharLatex(ch.value, 'text', false);
      atomLatex = `\\text{${esc}}`;
    } else {
      atomLatex = emitNodeInteractive(
        ch,
        cursor,
        selection,
        node.id,
        focused,
        false,
        autoShorthands,
        structDepth,
      );
    }
    const isSel = selForSlot !== null && i >= selForSlot.start && i < selForSlot.end;
    const cls = isSel ? 'ms-atom ms-selected' : 'ms-atom';
    parts.push(`\\htmlData{atom-slot=${slot.id},offset=${i}}{\\htmlClass{${cls}}{${atomLatex}}}`);
  }
  if (isActive && focused && cursor.offset === slot.children.length && !selForSlot) {
    parts.push(wrapCaret());
  }
  return `\\htmlData{slot-id=${slot.id}}{\\htmlClass{${slotClasses.join(' ')}}{${parts.join('')}}}`;
}

function emitNodeInteractive(
  node: MathNode,
  cursor: Cursor,
  selection: Selection | null,
  parentStructId: string | null,
  focused: boolean,
  isUprightChar: boolean,
  autoShorthands: boolean,
  depth: number,
): string {
  switch (node.type) {
    case 'char': {
      const escaped = escapeCharLatex(node.value, 'math', autoShorthands && !node.verbatim);
      return isUprightChar ? `\\mathrm{${escaped}}` : escaped;
    }
    case 'symbol':
      return node.latex;
    case 'raw':
      return sanitizeLatexTemplate(node.latex)
        .replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
        .replace(/\\end\{align\*?\}/g, '\\end{aligned}')
        .replace(/\\tag\*\{([^}]*)\}/g, '\\qquad\\text{$1}')
        .replace(/\\tag\{([^}]*)\}/g, '\\qquad\\text{($1)}');
    case 'struct': {
      const structDepth = depth + 1;
      const structHeight = getStructSubtreeHeight(node);
      const baseMeta = getGridMeta(node);
      const dynGrid =
        node.grid ??
        (baseMeta &&
        (node.slots.length !== (COMMANDS_BY_ID.get(node.commandId)?.slots.length ?? 0) ||
          hasCustomColSpec(baseMeta.colSpec, baseMeta.cols))
          ? baseMeta
          : null);

      let rendered: string;
      if (node.commandId === 'text_box' && !node.customLatex && node.slots.length === 1) {
        rendered = emitTextBoxInteractive(node, cursor, selection, focused, autoShorthands, structDepth);
      } else if (dynGrid) {
        rendered = projectGridEnvironment(dynGrid, node.slots, (slot) =>
          slot
            ? emitSlotInteractive(
                slot,
                cursor,
                selection,
                parentStructId,
                false,
                focused,
                autoShorthands,
                structDepth,
              )
            : '',
        );
      } else {
        rendered = projectStructByTemplate(node, {
          isSlotFilled: (idx) => isSlotVisibleInteractive(node, idx, cursor.slotId),
          templateOverride: (n, safeCustom) =>
            !safeCustom && n.commandId === 'tag_eq' && n.slots.length === 1
              ? '\\qquad\\text{(}$1\\text{)}'
              : undefined,
          renderSlot: (slot, idx) =>
            emitSlotInteractive(
              slot,
              cursor,
              selection,
              parentStructId,
              false,
              focused,
              autoShorthands,
              structDepth,
              isOptionalSlot(node.commandId, idx),
            ),
        });
      }

      const boxFlag = isSimpleFuncArgParen(node) ? '0' : '1';
      return `\\htmlData{struct-id=${node.id},struct-depth=${structDepth},struct-height=${structHeight},struct-cmd=${node.commandId},struct-box=${boxFlag}}{\\htmlClass{ms-struct}{${rendered}}}`;
    }
  }
}

export function toInteractiveLatex(
  doc: Document,
  cursor: Cursor,
  selection: Selection | null,
  options: InteractiveRenderOptions = {},
): string {
  const focused = options.focused ?? true;
  const autoShorthands = options.autoShorthands ?? true;
  const path = findSlotPath(doc.root, cursor.slotId);
  const parentStructId =
    path && path.length > 1 ? (path[path.length - 1].parentStruct?.id ?? null) : null;

  const multiline = projectMultilineRanges(
    doc.root.children,
    (sliceStart, sliceEnd, includeEndCaret) => {
      const subSlot: SlotNode = {
        id: doc.root.id,
        label: doc.root.label,
        children: doc.root.children.slice(sliceStart, sliceEnd),
      };
      const cursorInSlice =
        cursor.slotId === doc.root.id &&
        cursor.offset >= sliceStart &&
        (includeEndCaret ? cursor.offset <= sliceEnd : cursor.offset < sliceEnd);
      const localCursor: Cursor = cursorInSlice
        ? { slotId: doc.root.id, offset: cursor.offset - sliceStart }
        : { slotId: '__none__', offset: 0 };
      const localSel: Selection | null =
        selection && selection.slotId === doc.root.id
          ? {
              slotId: doc.root.id,
              start: Math.max(0, selection.start - sliceStart),
              end: Math.min(subSlot.children.length, selection.end - sliceStart),
            }
          : null;
      const validSel = localSel && localSel.end > localSel.start ? localSel : null;
      const rawSlice = emitSlotInteractive(
        subSlot,
        localCursor,
        validSel,
        parentStructId,
        true,
        focused,
        autoShorthands,
        0,
      );
      if (sliceStart === 0) return rawSlice;
      return rawSlice.replace(
        new RegExp(`atom-slot=${doc.root.id},offset=(\\d+)`, 'g'),
        (_, offStr: string) => `atom-slot=${doc.root.id},offset=${Number(offStr) + sliceStart}`,
      );
    },
    ' ',
  );

  if (multiline) return multiline.latex;

  return emitSlotInteractive(
    doc.root,
    cursor,
    selection,
    parentStructId,
    true,
    focused,
    autoShorthands,
    0,
  );
}
