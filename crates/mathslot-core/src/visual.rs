use crate::ast::{
    Expr, MathSeq, NavEntry, NavEntryKind, ParsedDoc, ResolvedStage, SlotNode, Span,
};
use crate::command::StructKind;
use crate::latex::{
    canonical_macro, ends_with_latex_macro_word, is_known_bare_word, matching_delim, multi_symbol,
    needs_latex_space, word_to_latex,
};

/// 视觉预览与分层导航输出的 LaTeX 方言：
/// - `LatexRust`：供原生超轻量桌面端（`latex-rust` 引擎）直接解析光栅化，采用 `\fcolorbox` + `\textcolor`；
/// - `MathJax`：供 Obsidian 插件（内置 MathJax v3 `renderMath`）直接渲染，采用数学态 `\bbox` + `\color`。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VisualDialect {
    LatexRust,
    MathJax,
}

#[derive(Clone, Copy)]
struct ColorSpec {
    name: &'static str,
    hex: &'static str,
}

const GREEN_FG: ColorSpec = ColorSpec {
    name: "msGfg",
    hex: "16a34a",
};
const GREEN_BG: ColorSpec = ColorSpec {
    name: "msGbg",
    hex: "dcfce7",
};
const GREEN_SCOPE_BG: ColorSpec = ColorSpec {
    name: "msGsbg",
    hex: "ecfdf5",
};
const RED_FG: ColorSpec = ColorSpec {
    name: "msRfg",
    hex: "ef4444",
};
const RED_BG: ColorSpec = ColorSpec {
    name: "msRbg",
    hex: "fef2f2",
};
const BLUE_FG: ColorSpec = ColorSpec {
    name: "msBfg",
    hex: "2563eb",
};
const BLUE_BG: ColorSpec = ColorSpec {
    name: "msBbg",
    hex: "eff6ff",
};
const VIOLET_FG: ColorSpec = ColorSpec {
    name: "msVfg",
    hex: "7c3aed",
};
const VIOLET_BG: ColorSpec = ColorSpec {
    name: "msVbg",
    hex: "ede9fe",
};
const VIOLET_STAGE_BG: ColorSpec = ColorSpec {
    name: "msVsbg",
    hex: "ffffff",
};
const AMBER_FG: ColorSpec = ColorSpec {
    name: "msAfg",
    hex: "d97706",
};
const AMBER_BG: ColorSpec = ColorSpec {
    name: "msAbg",
    hex: "fffbeb",
};
const CYAN_FG: ColorSpec = ColorSpec {
    name: "msCfg",
    hex: "0891b2",
};
const CYAN_BG: ColorSpec = ColorSpec {
    name: "msCbg",
    hex: "ecfeff",
};
const MUTED_FG: ColorSpec = ColorSpec {
    name: "msMfg",
    hex: "94a3b8",
};
const MUTED_BG: ColorSpec = ColorSpec {
    name: "msMbg",
    hex: "f1f5f9",
};

/// 供 `latex-rust` 注册到 `ColorTable` 的全部自定义调色板条目 `(name, rrggbb)`
pub const VISUAL_COLORS: &[(&str, &str)] = &[
    (GREEN_FG.name, GREEN_FG.hex),
    (GREEN_BG.name, GREEN_BG.hex),
    (GREEN_SCOPE_BG.name, GREEN_SCOPE_BG.hex),
    (RED_FG.name, RED_FG.hex),
    (RED_BG.name, RED_BG.hex),
    (BLUE_FG.name, BLUE_FG.hex),
    (BLUE_BG.name, BLUE_BG.hex),
    (VIOLET_FG.name, VIOLET_FG.hex),
    (VIOLET_BG.name, VIOLET_BG.hex),
    (VIOLET_STAGE_BG.name, VIOLET_STAGE_BG.hex),
    (AMBER_FG.name, AMBER_FG.hex),
    (AMBER_BG.name, AMBER_BG.hex),
    (CYAN_FG.name, CYAN_FG.hex),
    (CYAN_BG.name, CYAN_BG.hex),
    (MUTED_FG.name, MUTED_FG.hex),
    (MUTED_BG.name, MUTED_BG.hex),
];

/// 构建实时公式预览 LaTeX：
/// 1. 将光标当前所在的「最内层活跃槽位」整体包裹在柔和绿色作用域框内，彻底解决嵌套根号/分式层级归属不清的问题；
/// 2. 在精确光标字符位置插入高对比绿色实时光标竖线 `\pmb{\lvert}`；
/// 3. 未填槽位以红框占位，等待完成的指令（如 `▸`、`▸m`）以琥珀色提示框呈现。
pub fn build_preview_latex(doc: &ParsedDoc, cursor_char: usize, dialect: VisualDialect) -> String {
    build_preview_latex_inner(doc, cursor_char, dialect, false)
}

/// 当用户自定义格式使用了预览引擎未收录的外部宏包命令时，自动降级为 `name(slot1, slot2)` 安全预览
pub fn build_fallback_preview_latex(
    doc: &ParsedDoc,
    cursor_char: usize,
    dialect: VisualDialect,
) -> String {
    build_preview_latex_inner(doc, cursor_char, dialect, true)
}

fn build_preview_latex_inner(
    doc: &ParsedDoc,
    cursor_char: usize,
    dialect: VisualDialect,
    fallback_custom: bool,
) -> String {
    let clamped = cursor_char.min(doc.char_len);
    let active_slot = doc.innermost_active_slot_span(clamped);
    let root_cursor = if active_slot.is_none() {
        Some(clamped)
    } else {
        None
    };
    render_seq_preview(
        &doc.root,
        active_slot,
        clamped,
        root_cursor,
        true,
        dialect,
        fallback_custom,
    )
}

/// 构建纯字母分层结构导航图 LaTeX：
/// 1. 始终在作用域起点放置 `[a]`（根级即跳回整行行首），非空末尾放置 `[;]`（跳至行尾）；
/// 2. 含嵌套结构的复合槽位在外层折叠为单个 `[x+]` 紫色徽章；
/// 3. 选中或进入复合槽时，自动以 `左父骨架 ⟹ 右子式` 分步展开。
pub fn build_nav_latex(
    doc: &ParsedDoc,
    cursor_char: usize,
    nav_path: &[String],
    nav_filter: Option<&str>,
    dialect: VisualDialect,
) -> String {
    build_nav_latex_inner(doc, cursor_char, nav_path, nav_filter, dialect, false)
}

pub fn build_fallback_nav_latex(
    doc: &ParsedDoc,
    cursor_char: usize,
    nav_path: &[String],
    nav_filter: Option<&str>,
    dialect: VisualDialect,
) -> String {
    build_nav_latex_inner(doc, cursor_char, nav_path, nav_filter, dialect, true)
}

fn build_nav_latex_inner(
    doc: &ParsedDoc,
    cursor_char: usize,
    nav_path: &[String],
    nav_filter: Option<&str>,
    dialect: VisualDialect,
    fallback_custom: bool,
) -> String {
    let clamped = cursor_char.min(doc.char_len);
    let chain = doc.resolve_scope_chain(nav_path);
    if chain.len() <= 1 {
        return render_stage_nav(
            &chain[0],
            clamped,
            true,
            None,
            nav_filter,
            dialect,
            fallback_custom,
        );
    }

    let parent = &chain[chain.len() - 2];
    let child = &chain[chain.len() - 1];
    let drilled_label = child.via_label;

    let left_math = render_stage_nav(
        parent,
        clamped,
        false,
        drilled_label,
        None,
        dialect,
        fallback_custom,
    );
    let right_math = render_stage_nav(
        child,
        clamped,
        true,
        None,
        nav_filter,
        dialect,
        fallback_custom,
    );

    let path_tag = chain
        .iter()
        .skip(1)
        .filter_map(|s| s.via_label)
        .map(|l| format!("\\mathtt{{{l}+}}"))
        .collect::<Vec<_>>()
        .join("\\to ");
    let colored_tag = colored_math(dialect, VIOLET_FG, &path_tag);
    let child_box = framed_math(dialect, VIOLET_FG, VIOLET_STAGE_BG, &right_math, 4);

    format!("{left_math} \\; \\overset{{{colored_tag}}}{{\\Longrightarrow}} \\; {child_box}")
}

// ===========================================================================
// Preview 渲染实现（精确嵌套槽位作用域框 + 实时光标竖线 + 全量容错）
// ===========================================================================

fn render_seq_preview(
    seq: &MathSeq,
    active_slot: Option<Span>,
    global_cursor: usize,
    cursor_here: Option<usize>,
    is_root: bool,
    dialect: VisualDialect,
    fallback_custom: bool,
) -> String {
    if seq.items.is_empty() {
        let is_current = cursor_here.is_some() || (is_root && active_slot.is_none());
        return empty_slot_box(dialect, is_current, cursor_here.is_some());
    }

    let caret = live_caret(dialect);
    let mut out = String::new();
    let mut caret_placed = false;

    for item in &seq.items {
        let item_span = item.span();

        if !caret_placed
            && let Some(cur) = cursor_here
            && cur < item_span.start.char_idx
        {
            append_math_piece(&mut out, &caret);
            caret_placed = true;
        }

        match item {
            Expr::Text { raw, span, .. } => {
                if !caret_placed
                    && let Some(cur) = cursor_here
                    && span.contains_cursor(cur)
                {
                    let local_offset = cur.saturating_sub(span.start.char_idx);
                    let piece = preview_text(raw, Some(local_offset), dialect);
                    if !piece.trim().is_empty() {
                        append_math_piece(&mut out, &piece);
                    }
                    caret_placed = true;
                } else {
                    let piece = preview_text(raw, None, dialect);
                    if !piece.trim().is_empty() {
                        append_math_piece(&mut out, &piece);
                    }
                }
            }
            Expr::Symbol { cmd, span, .. } => {
                if !caret_placed
                    && let Some(cur) = cursor_here
                    && cur == span.start.char_idx
                {
                    append_math_piece(&mut out, &caret);
                    caret_placed = true;
                }
                append_math_piece(&mut out, cmd.latex_macro());
                if !caret_placed
                    && let Some(cur) = cursor_here
                    && cur == span.end.char_idx
                {
                    append_math_piece(&mut out, &caret);
                    caret_placed = true;
                }
            }
            Expr::Struct {
                kind,
                slots,
                full_span,
                ..
            } => {
                if !caret_placed
                    && let Some(cur) = cursor_here
                    && cur == full_span.start.char_idx
                {
                    append_math_piece(&mut out, &caret);
                    caret_placed = true;
                }
                let piece = render_struct_skeleton(*kind, slots, |slot| {
                    render_slot_preview(slot, active_slot, global_cursor, dialect, fallback_custom)
                });
                append_math_piece(&mut out, &piece);
                if !caret_placed
                    && let Some(cur) = cursor_here
                    && cur == full_span.end.char_idx
                {
                    append_math_piece(&mut out, &caret);
                    caret_placed = true;
                }
            }
            Expr::CustomStruct {
                format,
                slots,
                full_span,
                ..
            } => {
                if !caret_placed
                    && let Some(cur) = cursor_here
                    && cur == full_span.start.char_idx
                {
                    append_math_piece(&mut out, &caret);
                    caret_placed = true;
                }
                let rendered_slots: Vec<String> = slots
                    .iter()
                    .map(|slot| {
                        render_slot_preview(
                            slot,
                            active_slot,
                            global_cursor,
                            dialect,
                            fallback_custom,
                        )
                    })
                    .collect();
                let piece = if fallback_custom {
                    render_custom_fallback(&format.scheme_a_name, format.item_key, &rendered_slots)
                } else {
                    format.render_latex(&rendered_slots)
                };
                append_math_piece(&mut out, &piece);
                if !caret_placed
                    && let Some(cur) = cursor_here
                    && cur == full_span.end.char_idx
                {
                    append_math_piece(&mut out, &caret);
                    caret_placed = true;
                }
            }
            Expr::PendingCmd { partial, span } => {
                if !caret_placed
                    && let Some(cur) = cursor_here
                    && cur == span.start.char_idx
                {
                    append_math_piece(&mut out, &caret);
                    caret_placed = true;
                }
                let safe_code: String = partial
                    .chars()
                    .filter_map(|c| {
                        if c == '▸' {
                            Some('>')
                        } else if c.is_ascii_alphanumeric() || matches!(c, '.' | '-') {
                            Some(c)
                        } else if c == '$' {
                            Some(';')
                        } else {
                            None
                        }
                    })
                    .collect();
                let label = if safe_code.is_empty() {
                    ">".to_owned()
                } else {
                    safe_code
                };
                let inner = colored_math(dialect, AMBER_FG, &format!("\\mathtt{{{label}}}"));
                let badge = framed_math(dialect, AMBER_FG, AMBER_BG, &inner, 2);
                append_math_piece(&mut out, &badge);
                if !caret_placed
                    && let Some(cur) = cursor_here
                    && cur <= span.end.char_idx
                {
                    append_math_piece(&mut out, &caret);
                    caret_placed = true;
                }
            }
            Expr::UnknownCmd { code, span } => {
                if !caret_placed
                    && let Some(cur) = cursor_here
                    && cur == span.start.char_idx
                {
                    append_math_piece(&mut out, &caret);
                    caret_placed = true;
                }
                let safe: String = code.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
                let inner = colored_math(dialect, RED_FG, &format!("\\mathtt{{?{safe}}}"));
                let badge = framed_math(dialect, RED_FG, RED_BG, &inner, 2);
                append_math_piece(&mut out, &badge);
                if !caret_placed
                    && let Some(cur) = cursor_here
                    && cur <= span.end.char_idx
                {
                    append_math_piece(&mut out, &caret);
                    caret_placed = true;
                }
            }
        }
    }

    if cursor_here.is_some() && !caret_placed {
        append_math_piece(&mut out, &caret);
    }

    if out.trim().is_empty() {
        let is_current = cursor_here.is_some() || (is_root && active_slot.is_none());
        return empty_slot_box(dialect, is_current, cursor_here.is_some());
    }

    out
}

fn render_slot_preview(
    slot: &SlotNode,
    active_slot: Option<Span>,
    global_cursor: usize,
    dialect: VisualDialect,
    fallback_custom: bool,
) -> String {
    let is_active_slot =
        slot.seq.missing_semis_at_eof == 0 && Some(slot.seq.span) == active_slot;

    if slot.is_empty && slot.seq.items.is_empty() {
        return empty_slot_box(dialect, is_active_slot, is_active_slot);
    }

    let cursor_here = if is_active_slot {
        Some(global_cursor)
    } else {
        None
    };
    let inner = render_seq_preview(
        &slot.seq,
        active_slot,
        global_cursor,
        cursor_here,
        false,
        dialect,
        fallback_custom,
    );

    if is_active_slot {
        framed_math(dialect, GREEN_FG, GREEN_SCOPE_BG, &inner, 2)
    } else {
        inner
    }
}

fn render_custom_fallback(scheme_a_name: &str, item_key: char, rendered_slots: &[String]) -> String {
    let safe_head: String = scheme_a_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    let head = if safe_head.is_empty() {
        format!("k{item_key}")
    } else {
        safe_head
    };
    if rendered_slots.is_empty() {
        format!("\\mathtt{{{head}}}")
    } else {
        format!("\\mathtt{{{head}}}\\left( {} \\right)", rendered_slots.join(", "))
    }
}

// ===========================================================================
// Nav 分层结构导航渲染实现（纯徽章 + 行首 [a] + 复合子式展开）
// ===========================================================================

fn render_stage_nav(
    stage: &ResolvedStage<'_>,
    cursor_char: usize,
    is_active_stage: bool,
    drilled_child_label: Option<&str>,
    nav_filter: Option<&str>,
    dialect: VisualDialect,
    fallback_custom: bool,
) -> String {
    let active_local = if is_active_stage {
        stage.scope.active_entry_idx(cursor_char)
    } else {
        None
    };

    let mut pieces = Vec::new();

    if let Some(start_entry) = stage.scope.entries.first() {
        pieces.push(render_pure_badge(
            start_entry,
            active_local == Some(0),
            is_active_stage,
            false,
            nav_filter,
            dialect,
        ));
    }

    for item in &stage.seq.items {
        let p = match item {
            Expr::Text {
                scope_entry_idx, ..
            }
            | Expr::Symbol {
                scope_entry_idx, ..
            } => {
                if let Some(idx) = scope_entry_idx {
                    stage
                        .scope
                        .entries
                        .get(*idx)
                        .map(|entry| {
                            render_pure_badge(
                                entry,
                                active_local == Some(*idx),
                                is_active_stage,
                                false,
                                nav_filter,
                                dialect,
                            )
                        })
                        .unwrap_or_default()
                } else {
                    String::new()
                }
            }
            Expr::Struct { kind, slots, .. } => render_struct_skeleton(*kind, slots, |slot| {
                if let Some(idx) = slot.scope_entry_idx
                    && let Some(entry) = stage.scope.entries.get(idx)
                {
                    let is_drilled = drilled_child_label == Some(entry.label.as_str());
                    return render_pure_badge(
                        entry,
                        active_local == Some(idx),
                        is_active_stage,
                        is_drilled,
                        nav_filter,
                        dialect,
                    );
                }
                empty_slot_box(dialect, false, false)
            }),
            Expr::CustomStruct {
                format,
                slots,
                scope_entry_idx,
                ..
            } => {
                if slots.is_empty() {
                    if let Some(idx) = scope_entry_idx {
                        stage
                            .scope
                            .entries
                            .get(*idx)
                            .map(|entry| {
                                render_pure_badge(
                                    entry,
                                    active_local == Some(*idx),
                                    is_active_stage,
                                    false,
                                    nav_filter,
                                    dialect,
                                )
                            })
                            .unwrap_or_default()
                    } else {
                        String::new()
                    }
                } else {
                    let badge_strs: Vec<String> = slots
                        .iter()
                        .map(|slot| {
                            if let Some(idx) = slot.scope_entry_idx
                                && let Some(entry) = stage.scope.entries.get(idx)
                            {
                                let is_drilled = drilled_child_label == Some(entry.label.as_str());
                                render_pure_badge(
                                    entry,
                                    active_local == Some(idx),
                                    is_active_stage,
                                    is_drilled,
                                    nav_filter,
                                    dialect,
                                )
                            } else {
                                empty_slot_box(dialect, false, false)
                            }
                        })
                        .collect();
                    if fallback_custom
                        || matches!(format.layout, crate::library::LayoutKind::Env { .. })
                    {
                        // Env 布局的导航视图直接用徽章列表呈现各槽位
                        render_custom_fallback(&format.scheme_a_name, format.item_key, &badge_strs)
                    } else {
                        let mut expanded = format.expand_latex(&badge_strs);
                        for (idx, b_str) in badge_strs.iter().enumerate() {
                            let placeholder = format!("${}", idx + 1);
                            if !format.latex_template.contains(&placeholder) {
                                expanded.push_str(" \\, ");
                                expanded.push_str(b_str);
                            }
                        }
                        expanded
                    }
                }
            }
            Expr::PendingCmd { .. } | Expr::UnknownCmd { .. } => String::new(),
        };
        if !p.is_empty() {
            pieces.push(p);
        }
    }

    if let Some(end_entry) = stage
        .scope
        .entries
        .last()
        .filter(|e| matches!(e.kind, NavEntryKind::ScopeEnd))
    {
        pieces.push(render_pure_badge(
            end_entry,
            active_local == Some(end_entry.local_idx),
            is_active_stage,
            false,
            nav_filter,
            dialect,
        ));
    }

    pieces.join(" \\, ")
}

fn render_pure_badge(
    entry: &NavEntry,
    is_current: bool,
    is_active_stage: bool,
    is_drilled: bool,
    nav_filter: Option<&str>,
    dialect: VisualDialect,
) -> String {
    let is_composite = matches!(entry.kind, NavEntryKind::Composite { .. });
    let is_boundary = matches!(entry.kind, NavEntryKind::ScopeStart | NavEntryKind::ScopeEnd);
    let is_empty = matches!(entry.kind, NavEntryKind::Leaf { is_empty: true, .. });

    let display = if is_composite {
        format!("{}+", entry.label)
    } else {
        entry.label.clone()
    };

    let (border, fill, text_color) = if !is_active_stage {
        if is_drilled {
            (VIOLET_FG, VIOLET_BG, VIOLET_FG)
        } else {
            (MUTED_FG, MUTED_BG, MUTED_FG)
        }
    } else if let Some(prefix) = nav_filter.filter(|p| !p.is_empty()) {
        let normalized_prefix: String = prefix
            .chars()
            .map(|c| if matches!(c, '.' | '$') { ';' } else { c })
            .collect();
        if entry.label.starts_with(&normalized_prefix) {
            (AMBER_FG, AMBER_BG, AMBER_FG)
        } else {
            (MUTED_FG, MUTED_BG, MUTED_FG)
        }
    } else if is_current {
        (GREEN_FG, GREEN_BG, GREEN_FG)
    } else if is_composite {
        (VIOLET_FG, VIOLET_BG, VIOLET_FG)
    } else if is_empty {
        (RED_FG, RED_BG, RED_FG)
    } else if is_boundary {
        (CYAN_FG, CYAN_BG, CYAN_FG)
    } else {
        (BLUE_FG, BLUE_BG, BLUE_FG)
    };

    let inner = colored_math(dialect, text_color, &format!("\\mathtt{{{display}}}"));
    if is_boundary && !is_current && is_active_stage && dialect == VisualDialect::MathJax {
        format!(
            "\\bbox[#{},2.5px,border:1.25px dashed #{}]{{{inner}}}",
            fill.hex, border.hex
        )
    } else {
        framed_math(dialect, border, fill, &inner, 2)
    }
}

// ===========================================================================
// 24 种数学结构的统一 2D LaTeX 几何骨架（Preview 与 Nav 共用）
// ===========================================================================

fn render_struct_skeleton(
    kind: StructKind,
    slots: &[SlotNode],
    mut render_slot: impl FnMut(&SlotNode) -> String,
) -> String {
    let mut s = |i: usize| render_slot(&slots[i]);
    match kind {
        StructKind::Frac => {
            let a = s(0);
            let b = s(1);
            format!("\\frac{{{a}}}{{{b}}}")
        }
        StructKind::Sqrt => format!("\\sqrt{{{}}}", s(0)),
        StructKind::NthRoot => {
            let idx = s(0);
            let rad = s(1);
            format!("\\sqrt[{{{idx}}}]{{{rad}}}")
        }
        StructKind::Sup => {
            let base = s(0);
            let exp = s(1);
            format!("{{{base}}}^{{{exp}}}")
        }
        StructKind::Sub => {
            let base = s(0);
            let sub = s(1);
            format!("{{{base}}}_{{{sub}}}")
        }
        StructKind::SubSup => {
            let base = s(0);
            let sub = s(1);
            let sup = s(2);
            format!("{{{base}}}_{{{sub}}}^{{{sup}}}")
        }
        StructKind::Paren => format!("\\left( {} \\right)", s(0)),
        StructKind::Abs => format!("\\left| {} \\right|", s(0)),
        StructKind::Integral => {
            let lo = s(0);
            let hi = s(1);
            let body = s(2);
            format!("\\int_{{{lo}}}^{{{hi}}} {body}")
        }
        StructKind::IndefIntegral => format!("\\int {}", s(0)),
        StructKind::DoubleIntegral => {
            let reg = s(0);
            let body = s(1);
            format!("\\iint_{{{reg}}} {body}")
        }
        StructKind::ContourIntegral => {
            let path = s(0);
            let body = s(1);
            format!("\\oint_{{{path}}} {body}")
        }
        StructKind::Sum => {
            let lo = s(0);
            let hi = s(1);
            let body = s(2);
            format!("\\sum_{{{lo}}}^{{{hi}}} {body}")
        }
        StructKind::Product => {
            let lo = s(0);
            let hi = s(1);
            let body = s(2);
            format!("\\prod_{{{lo}}}^{{{hi}}} {body}")
        }
        StructKind::Limit => {
            let var = s(0);
            let target = s(1);
            let body = s(2);
            format!("\\lim_{{{var} \\to {target}}} {body}")
        }
        StructKind::Matrix2 => matrix_skeleton("pmatrix", 2, 2, &mut s),
        StructKind::Matrix3 => matrix_skeleton("pmatrix", 3, 3, &mut s),
        StructKind::Det2 => matrix_skeleton("vmatrix", 2, 2, &mut s),
        StructKind::Cases2 => {
            let v1 = s(0);
            let c1 = s(1);
            let v2 = s(2);
            let c2 = s(3);
            format!("\\begin{{cases}} {v1} & {c1} \\\\ {v2} & {c2} \\end{{cases}}")
        }
        StructKind::Hat => format!("\\hat{{{}}}", s(0)),
        StructKind::Bar => format!("\\bar{{{}}}", s(0)),
        StructKind::Vec => format!("\\vec{{{}}}", s(0)),
        StructKind::Tilde => format!("\\tilde{{{}}}", s(0)),
        StructKind::Dot => format!("\\dot{{{}}}", s(0)),
        StructKind::Norm => format!("\\left\\Vert {} \\right\\Vert", s(0)),
        StructKind::Overline => format!("\\overline{{{}}}", s(0)),
        StructKind::Binom => {
            let n = s(0);
            let k = s(1);
            format!("\\binom{{{n}}}{{{k}}}")
        }
        StructKind::BMatrix2 => matrix_skeleton("bmatrix", 2, 2, &mut s),
        StructKind::Cases3 => {
            let v1 = s(0);
            let c1 = s(1);
            let v2 = s(2);
            let c2 = s(3);
            let v3 = s(4);
            let c3 = s(5);
            format!("\\begin{{cases}} {v1} & {c1} \\\\ {v2} & {c2} \\\\ {v3} & {c3} \\end{{cases}}")
        }
        StructKind::TripleIntegral => {
            let reg = s(0);
            let body = s(1);
            format!("\\iiint_{{{reg}}} {body}")
        }
        StructKind::PartialFrac => {
            let num = s(0);
            let den = s(1);
            format!("\\frac{{\\partial {num}}}{{\\partial {den}}}")
        }
        StructKind::TotalFrac => {
            let num = s(0);
            let den = s(1);
            format!("\\frac{{\\mathrm{{d}}{num}}}{{\\mathrm{{d}}{den}}}")
        }
        StructKind::BMatrix3 => matrix_skeleton("bmatrix", 3, 3, &mut s),
        StructKind::Det3 => matrix_skeleton("vmatrix", 3, 3, &mut s),
        StructKind::DDot => format!("\\ddot{{{}}}", s(0)),
        StructKind::Underline => format!("\\underline{{{}}}", s(0)),
        StructKind::Overbrace => format!("\\overbrace{{{}}}^{{{}}}", s(0), s(1)),
        StructKind::Underbrace => format!("\\underbrace{{{}}}_{{{}}}", s(0), s(1)),
        StructKind::Bracket => format!("\\left[ {} \\right]", s(0)),
        StructKind::Brace => format!("\\left\\{{ {} \\right\\}}", s(0)),
        StructKind::Angle => format!("\\left\\langle {} \\right\\rangle", s(0)),
        StructKind::Floor => format!("\\left\\lfloor {} \\right\\rfloor", s(0)),
        StructKind::Ceil => format!("\\left\\lceil {} \\right\\rceil", s(0)),
        StructKind::EvalBar => format!("\\left. {} \\right|_{{{}}}^{{{}}}", s(0), s(1), s(2)),
    }
}

fn matrix_skeleton(
    env: &str,
    rows: usize,
    cols: usize,
    cell: &mut impl FnMut(usize) -> String,
) -> String {
    let mut out = format!("\\begin{{{env}}} ");
    for r in 0..rows {
        if r > 0 {
            out.push_str(" \\\\ ");
        }
        for c in 0..cols {
            if c > 0 {
                out.push_str(" & ");
            }
            out.push_str(&cell(r * cols + c));
        }
    }
    out.push_str(&format!(" \\end{{{env}}}"));
    out
}

// ===========================================================================
// 容错文本 -> 预览 LaTeX（支持任意半成品输入与精确内嵌实时光标）
// ===========================================================================

fn preview_text(input: &str, cursor_offset: Option<usize>, dialect: VisualDialect) -> String {
    let chars: Vec<char> = input.chars().collect();
    let clamped = cursor_offset.map(|c| c.min(chars.len()));
    preview_range(&chars, 0, chars.len(), clamped, dialect)
}

fn preview_range(
    chars: &[char],
    start: usize,
    end: usize,
    cursor_idx: Option<usize>,
    dialect: VisualDialect,
) -> String {
    let caret = live_caret(dialect);
    let mut out = String::new();
    let mut i = start;
    let mut caret_emitted = false;

    while i < end {
        let c = chars[i];
        match c {
            '^' | '_' => {
                if !caret_emitted && cursor_idx == Some(i) {
                    append_math_piece(&mut out, &caret);
                    out.push_str(" {}");
                    caret_emitted = true;
                } else if out.trim().is_empty()
                    || out.trim_end().ends_with('^')
                    || out.trim_end().ends_with('_')
                {
                    out.push_str("{}");
                }
                out.push(c);
                i += 1;
                let (arg, next, consumed_caret) =
                    preview_script_operand(chars, i, end, cursor_idx, dialect);
                if consumed_caret {
                    caret_emitted = true;
                }
                out.push('{');
                out.push_str(&arg);
                out.push('}');
                i = next;
            }
            '{' => {
                if !caret_emitted && cursor_idx == Some(i) {
                    append_math_piece(&mut out, &caret);
                    caret_emitted = true;
                }
                let open_idx = i;
                let close = matching_delim(chars, open_idx, end, '{', '}');
                let inner_end = close.unwrap_or(end);
                let inner_cur = cursor_idx.and_then(|c| {
                    if c > open_idx && c <= inner_end {
                        Some(c)
                    } else {
                        None
                    }
                });
                let inner = preview_range(chars, open_idx + 1, inner_end, inner_cur, dialect);
                if inner_cur.is_some() {
                    caret_emitted = true;
                }
                out.push('{');
                out.push_str(&inner);
                out.push('}');
                i = if let Some(c) = close { c + 1 } else { end };
            }
            '}' => {
                if !caret_emitted && cursor_idx == Some(i) {
                    append_math_piece(&mut out, &caret);
                    caret_emitted = true;
                }
                i += 1;
            }
            '\\' => {
                if !caret_emitted && cursor_idx == Some(i) {
                    append_math_piece(&mut out, &caret);
                    caret_emitted = true;
                }
                let bs_idx = i;
                i += 1;
                if i < end && chars[i].is_ascii_alphabetic() {
                    let word_start = i;
                    while i < end && chars[i].is_ascii_alphabetic() {
                        i += 1;
                    }
                    if !caret_emitted
                        && let Some(cur) = cursor_idx
                        && cur > bs_idx
                        && cur < i
                    {
                        let left: String = chars[word_start..cur].iter().collect();
                        let right: String = chars[cur..i].iter().collect();
                        append_math_piece(
                            &mut out,
                            &format!("\\backslash\\mathtt{{{left}}}{caret}\\mathtt{{{right}}}"),
                        );
                        caret_emitted = true;
                    } else {
                        let word: String = chars[word_start..i].iter().collect();
                        let piece = safe_backslash_word(&word, dialect);
                        push_preview_piece(&mut out, &piece, chars.get(i).copied());
                    }
                } else if i < end {
                    let next_ch = chars[i];
                    i += 1;
                    let esc = match next_ch {
                        '{' | '}' | '%' | '#' | '&' | '_' | '$' => format!("\\{next_ch}"),
                        ',' | ';' | ':' | '!' | ' ' => format!("\\{next_ch}"),
                        _ => "\\backslash ".to_owned(),
                    };
                    out.push_str(&esc);
                } else {
                    out.push_str("\\backslash ");
                }
            }
            c if c.is_ascii_alphabetic() => {
                if !caret_emitted && cursor_idx == Some(i) {
                    append_math_piece(&mut out, &caret);
                    caret_emitted = true;
                }
                let word_start = i;
                while i < end && chars[i].is_ascii_alphabetic() {
                    i += 1;
                }
                if !caret_emitted
                    && let Some(cur) = cursor_idx
                    && cur > word_start
                    && cur < i
                {
                    let left: String = chars[word_start..cur].iter().collect();
                    let right: String = chars[cur..i].iter().collect();
                    append_math_piece(&mut out, &format!("{left}{caret}{right}"));
                    caret_emitted = true;
                } else {
                    let word: String = chars[word_start..i].iter().collect();
                    if let Some(diff_macro) = crate::latex::is_differential_token(&word) {
                        if crate::latex::needs_diff_thin_space(&out) {
                            out.push_str("\\,");
                        }
                        push_preview_piece(&mut out, diff_macro, chars.get(i).copied());
                    } else {
                        let piece = word_to_latex(&word);
                        push_preview_piece(&mut out, &piece, chars.get(i).copied());
                    }
                }
            }
            _ => {
                if !caret_emitted && cursor_idx == Some(i) {
                    append_math_piece(&mut out, &caret);
                    caret_emitted = true;
                }
                if let Some((replacement, consumed)) = multi_symbol(&chars[i..end]) {
                    if !caret_emitted
                        && let Some(cur) = cursor_idx
                        && cur > i
                        && cur < i + consumed
                    {
                        for &ch in &chars[i..cur] {
                            out.push_str(&safe_single_char(ch, None, dialect));
                        }
                        append_math_piece(&mut out, &caret);
                        for &ch in &chars[cur..(i + consumed)] {
                            out.push_str(&safe_single_char(ch, None, dialect));
                        }
                        caret_emitted = true;
                        i += consumed;
                    } else {
                        i += consumed;
                        push_preview_piece(&mut out, replacement, chars.get(i).copied());
                    }
                } else {
                    i += 1;
                    let piece = safe_single_char(c, chars.get(i).copied(), dialect);
                    out.push_str(&piece);
                }
            }
        }
    }

    if !caret_emitted && cursor_idx == Some(end) {
        append_math_piece(&mut out, &caret);
    }

    out
}

fn preview_script_operand(
    chars: &[char],
    mut i: usize,
    end: usize,
    cursor_idx: Option<usize>,
    dialect: VisualDialect,
) -> (String, usize, bool) {
    let ws_start = i;
    while i < end && chars[i].is_whitespace() {
        i += 1;
    }
    if i >= end {
        let hit = cursor_idx.is_some_and(|c| c >= ws_start && c <= end);
        return (empty_slot_box(dialect, hit, hit), i, hit);
    }

    let (mut base, mut next, mut caret_consumed, is_paren) = match chars[i] {
        '(' => {
            let open_idx = i;
            if let Some(close) = matching_delim(chars, i, end, '(', ')') {
                let inner_cur = cursor_idx.and_then(|c| {
                    if c >= ws_start && c <= open_idx {
                        Some(open_idx + 1)
                    } else if c > open_idx && c <= close {
                        Some(c)
                    } else {
                        None
                    }
                });
                let inner = preview_range(chars, open_idx + 1, close, inner_cur, dialect);
                let body = if inner.trim().is_empty() {
                    empty_slot_box(dialect, inner_cur.is_some(), inner_cur.is_some())
                } else {
                    inner
                };
                (body, close + 1, inner_cur.is_some(), true)
            } else {
                let inner_cur = cursor_idx.and_then(|c| {
                    if c >= ws_start && c <= open_idx {
                        Some(open_idx + 1)
                    } else if c > open_idx && c <= end {
                        Some(c)
                    } else {
                        None
                    }
                });
                let inner = preview_range(chars, open_idx + 1, end, inner_cur, dialect);
                let body = if inner.trim().is_empty() {
                    empty_slot_box(dialect, inner_cur.is_some(), inner_cur.is_some())
                } else {
                    inner
                };
                (body, end, inner_cur.is_some(), true)
            }
        }
        '{' => {
            let open_idx = i;
            if let Some(close) = matching_delim(chars, i, end, '{', '}') {
                let inner_cur = cursor_idx.and_then(|c| {
                    if c >= ws_start && c <= open_idx {
                        Some(open_idx + 1)
                    } else if c > open_idx && c <= close {
                        Some(c)
                    } else {
                        None
                    }
                });
                let inner = preview_range(chars, open_idx + 1, close, inner_cur, dialect);
                let body = if inner.trim().is_empty() {
                    empty_slot_box(dialect, inner_cur.is_some(), inner_cur.is_some())
                } else {
                    inner
                };
                (body, close + 1, inner_cur.is_some(), false)
            } else {
                let inner_cur = cursor_idx.and_then(|c| {
                    if c >= ws_start && c <= open_idx {
                        Some(open_idx + 1)
                    } else if c > open_idx && c <= end {
                        Some(c)
                    } else {
                        None
                    }
                });
                let inner = preview_range(chars, open_idx + 1, end, inner_cur, dialect);
                let body = if inner.trim().is_empty() {
                    empty_slot_box(dialect, inner_cur.is_some(), inner_cur.is_some())
                } else {
                    inner
                };
                (body, end, inner_cur.is_some(), false)
            }
        }
        '+' | '-' => {
            let sign_idx = i;
            let sign = chars[i];
            let caret = live_caret(dialect);
            let before_sign = cursor_idx.is_some_and(|c| c >= ws_start && c <= sign_idx);
            let (rest, next, rest_caret) =
                preview_script_operand(chars, i + 1, end, cursor_idx, dialect);
            if before_sign {
                return (format!("{caret}{sign}{rest}"), next, true);
            } else {
                return (format!("{sign}{rest}"), next, rest_caret);
            }
        }
        '^' | '_' => {
            let hit = cursor_idx.is_some_and(|c| c >= ws_start && c <= i);
            (empty_slot_box(dialect, hit, hit), i, hit, false)
        }
        c if c.is_ascii_digit() => {
            let start = i;
            while i < end && chars[i].is_ascii_digit() {
                i += 1;
            }
            let inner_cur = cursor_idx.and_then(|cur| {
                if cur >= ws_start && cur < start {
                    Some(start)
                } else if cur >= start && cur < i {
                    Some(cur)
                } else {
                    None
                }
            });
            let rendered = preview_range(chars, start, i, inner_cur, dialect);
            (rendered, i, inner_cur.is_some(), false)
        }
        c if c.is_ascii_alphabetic() => {
            let start = i;
            while i < end && chars[i].is_ascii_alphabetic() {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            let op_end = if is_known_bare_word(&word) {
                i
            } else {
                start + 1
            };
            let inner_cur = cursor_idx.and_then(|cur| {
                if cur >= ws_start && cur < start {
                    Some(start)
                } else if cur >= start && cur < op_end {
                    Some(cur)
                } else {
                    None
                }
            });
            let rendered = preview_range(chars, start, op_end, inner_cur, dialect);
            (rendered, op_end, inner_cur.is_some(), false)
        }
        _ => {
            let before = cursor_idx.is_some_and(|cur| cur >= ws_start && cur <= i);
            let caret = live_caret(dialect);
            if let Some((rep, consumed)) = multi_symbol(&chars[i..end]) {
                let s = if before {
                    format!("{caret} {rep}")
                } else {
                    rep.to_owned()
                };
                (s, i + consumed, before, false)
            } else {
                let piece = safe_single_char(chars[i], None, dialect);
                let s = if before {
                    format!("{caret} {piece}")
                } else {
                    piece
                };
                (s, i + 1, before, false)
            }
        }
    };

    if is_paren && next < end && chars[next] == '^' {
        base = format!("({base})");
    }

    // 复合指数感知解析：连带消费紧随的 ^ 幂次操作符，输出标准单一内聚的指数
    while next < end && chars[next] == '^' {
        let op_idx = next;
        next += 1;
        let caret = live_caret(dialect);
        let caret_at_op = !caret_consumed && cursor_idx == Some(op_idx);
        if caret_at_op {
            caret_consumed = true;
            base.push_str(&caret);
        }
        base.push('^');
        let (sub_arg, sub_next, sub_caret) =
            preview_script_operand(chars, next, end, cursor_idx, dialect);
        if sub_caret {
            caret_consumed = true;
        }
        if sub_arg.chars().count() == 1 && sub_arg.chars().all(|c| c.is_ascii_alphanumeric()) {
            base.push_str(&sub_arg);
        } else {
            base.push('{');
            base.push_str(&sub_arg);
            base.push('}');
        }
        next = sub_next;
    }

    (base, next, caret_consumed)
}

fn safe_backslash_word(word: &str, dialect: VisualDialect) -> String {
    let canonical = canonical_macro(word);
    if is_known_bare_word(word) || is_known_bare_word(canonical) {
        format!("\\{canonical}")
    } else {
        colored_math(dialect, AMBER_FG, &format!("\\backslash\\mathtt{{{word}}}"))
    }
}

fn safe_single_char(c: char, next_c: Option<char>, dialect: VisualDialect) -> String {
    let mut out = String::new();
    match c {
        '{' => out.push_str("\\{"),
        '}' => out.push_str("\\}"),
        '%' | '#' | '&' | '$' => {
            out.push('\\');
            out.push(c);
        }
        '~' => push_preview_piece(&mut out, "\\sim", next_c),
        '×' => push_preview_piece(&mut out, "\\times", next_c),
        '÷' => push_preview_piece(&mut out, "\\div", next_c),
        '·' | '⋅' => push_preview_piece(&mut out, "\\cdot", next_c),
        '±' => push_preview_piece(&mut out, "\\pm", next_c),
        '≤' => push_preview_piece(&mut out, "\\le", next_c),
        '≥' => push_preview_piece(&mut out, "\\ge", next_c),
        '≠' => push_preview_piece(&mut out, "\\neq", next_c),
        '≈' => push_preview_piece(&mut out, "\\approx", next_c),
        '∞' => push_preview_piece(&mut out, "\\infty", next_c),
        '→' => push_preview_piece(&mut out, "\\to", next_c),
        '←' => push_preview_piece(&mut out, "\\leftarrow", next_c),
        '∈' => push_preview_piece(&mut out, "\\in", next_c),
        '∉' => push_preview_piece(&mut out, "\\notin", next_c),
        '⊆' => push_preview_piece(&mut out, "\\subseteq", next_c),
        '∀' => push_preview_piece(&mut out, "\\forall", next_c),
        '∃' => push_preview_piece(&mut out, "\\exists", next_c),
        '∂' => push_preview_piece(&mut out, "\\partial", next_c),
        '∇' => push_preview_piece(&mut out, "\\nabla", next_c),
        '∑' => push_preview_piece(&mut out, "\\sum", next_c),
        '∏' => push_preview_piece(&mut out, "\\prod", next_c),
        '∫' => push_preview_piece(&mut out, "\\int", next_c),
        '∬' => push_preview_piece(&mut out, "\\iint", next_c),
        '∮' => push_preview_piece(&mut out, "\\oint", next_c),
        '√' => push_preview_piece(&mut out, "\\surd", next_c),
        'π' => push_preview_piece(&mut out, "\\pi", next_c),
        'α' => push_preview_piece(&mut out, "\\alpha", next_c),
        'β' => push_preview_piece(&mut out, "\\beta", next_c),
        'γ' => push_preview_piece(&mut out, "\\gamma", next_c),
        'δ' => push_preview_piece(&mut out, "\\delta", next_c),
        'ε' => push_preview_piece(&mut out, "\\varepsilon", next_c),
        'θ' => push_preview_piece(&mut out, "\\theta", next_c),
        'λ' => push_preview_piece(&mut out, "\\lambda", next_c),
        'μ' => push_preview_piece(&mut out, "\\mu", next_c),
        'σ' => push_preview_piece(&mut out, "\\sigma", next_c),
        'φ' => push_preview_piece(&mut out, "\\phi", next_c),
        'ω' => push_preview_piece(&mut out, "\\omega", next_c),
        'Δ' => push_preview_piece(&mut out, "\\Delta", next_c),
        'Ω' => push_preview_piece(&mut out, "\\Omega", next_c),
        c if c.is_ascii() => out.push(c),
        _ => match dialect {
            VisualDialect::MathJax => out.push_str(&format!("\\text{{{c}}}")),
            VisualDialect::LatexRust => push_preview_piece(&mut out, "\\square", next_c),
        },
    }
    out
}

fn push_preview_piece(out: &mut String, piece: &str, next_char: Option<char>) {
    out.push_str(piece);
    if ends_with_latex_macro_word(out) && next_char.is_some_and(|c| c.is_ascii_alphabetic()) {
        out.push(' ');
    }
}

fn append_math_piece(out: &mut String, piece: &str) {
    if piece.is_empty() {
        return;
    }
    if needs_latex_space(out, piece) {
        out.push(' ');
    }
    out.push_str(piece);
}

// ===========================================================================
// 方言原子原语（颜色、描边框、空槽占位、实时光标竖线）
// ===========================================================================

fn empty_slot_box(dialect: VisualDialect, is_current: bool, show_caret: bool) -> String {
    let (border, fill) = if is_current {
        (GREEN_FG, GREEN_BG)
    } else {
        (RED_FG, RED_BG)
    };
    let body = if show_caret {
        live_caret(dialect)
    } else {
        "\\phantom{x}".to_owned()
    };
    framed_math(dialect, border, fill, &body, 3)
}

fn live_caret(dialect: VisualDialect) -> String {
    colored_math(dialect, GREEN_FG, "\\pmb{\\lvert}")
}

fn colored_math(dialect: VisualDialect, color: ColorSpec, body: &str) -> String {
    match dialect {
        VisualDialect::LatexRust => format!("\\textcolor{{{}}}{{{body}}}", color.name),
        VisualDialect::MathJax => format!("{{\\color{{#{}}}{body}}}", color.hex),
    }
}

fn framed_math(
    dialect: VisualDialect,
    border: ColorSpec,
    fill: ColorSpec,
    body: &str,
    pad_px: u8,
) -> String {
    match dialect {
        VisualDialect::LatexRust => {
            format!("\\fcolorbox{{{}}}{{{}}}{{{body}}}", border.name, fill.name)
        }
        VisualDialect::MathJax => format!(
            "\\bbox[#{},{pad_px}px,border:1.25px solid #{}]{{{body}}}",
            fill.hex, border.hex
        ),
    }
}
