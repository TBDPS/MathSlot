use mathslot_doc::{EditorDiagnostic as Diagnostic, Slot, SlotRole};
use mathslot_render::ErrorSummary;
use mathslot_syntax::{Diagnostic as SyntaxDiagnostic, SyntaxErrorKind};
use serde::{Deserialize, Serialize};

use crate::effect::{Effect, StatusSeverity};
use crate::state::EditorState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandSpan {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotSnapshot {
    pub id: u32,
    pub role: String,
    pub label: String,
    pub is_empty: bool,
    pub is_active: bool,
    pub span: CommandSpan,
    pub path: Vec<usize>,
    pub depth: usize,
}

impl SlotSnapshot {
    #[must_use]
    pub fn from_slot(slot: &Slot, active_slot_id: Option<u32>) -> Self {
        let id = slot.id.0;
        let role = slot_role_key(slot.role);
        let label = slot
            .label
            .clone()
            .filter(|l| !l.is_empty())
            .unwrap_or_else(|| slot_role_label(slot.role));

        Self {
            id,
            role,
            label,
            is_empty: slot.is_empty,
            is_active: active_slot_id == Some(id),
            span: CommandSpan {
                start: slot.span.start,
                end: slot.span.end,
            },
            path: slot.path.as_slice().to_vec(),
            depth: slot.path.depth(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagnosticSnapshot {
    pub code: String,
    pub severity: StatusSeverity,
    pub message: String,
    pub summary: String,
    pub source_excerpt: String,
    pub truncated: bool,
    pub detail: String,
    pub hint: Option<String>,
    pub span: Option<CommandSpan>,
}

impl DiagnosticSnapshot {
    #[must_use]
    pub fn from_diagnostic(diag: &Diagnostic) -> Self {
        Self::from_diagnostic_with_source(diag, "")
    }

    #[must_use]
    pub fn from_diagnostic_with_source(diag: &Diagnostic, source: &str) -> Self {
        let (code, severity, message, fallback_source, hint) = match diag {
            Diagnostic::PendingCommand { prefix, message } => (
                "PENDING_COMMAND",
                StatusSeverity::Info,
                message.clone(),
                format!("▸{prefix}"),
                Some(format!("继续输入命令字符或按 Esc 取消未决前缀 ▸{prefix}")),
            ),
            Diagnostic::UnknownCommand { command, message } => (
                "UNKNOWN_COMMAND",
                StatusSeverity::Error,
                message.clone(),
                command.clone(),
                Some(format!("检查命令拼写或从命令面板选择有效命令：{command}")),
            ),
            Diagnostic::Syntax(message) => (
                "SYNTAX_ERROR",
                StatusSeverity::Error,
                message.clone(),
                String::new(),
                Some("检查括号/花括号配对及命令参数是否完整".to_string()),
            ),
        };

        let effective_source = if source.is_empty() {
            fallback_source.as_str()
        } else {
            source
        };
        let err_summary = ErrorSummary::from_error(code, &message, effective_source);

        Self {
            code: err_summary.code,
            severity,
            message,
            summary: err_summary.header_summary,
            source_excerpt: err_summary.source_excerpt,
            truncated: err_summary.truncated,
            detail: err_summary.full_detail,
            hint,
            span: None,
        }
    }

    #[must_use]
    pub fn from_syntax_diagnostic(diag: &SyntaxDiagnostic, source: &str) -> Self {
        let (code, hint) = match &diag.kind {
            SyntaxErrorKind::UnexpectedToken(tok) => (
                "UNEXPECTED_TOKEN",
                Some(format!("检查意外标记 `{tok}` 附近的语法结构")),
            ),
            SyntaxErrorKind::ExpectedToken { expected, found } => (
                "EXPECTED_TOKEN",
                Some(format!("预期 `{expected}`，但实际遇到 `{found}`")),
            ),
            SyntaxErrorKind::UnclosedDelimiter(delim) => (
                "UNCLOSED_DELIMITER",
                Some(format!("请补全未闭合的定界符 `{delim}`")),
            ),
            SyntaxErrorKind::UnmatchedDelimiter(delim) => (
                "UNMATCHED_DELIMITER",
                Some(format!("存在多余或未匹配的定界符 `{delim}`")),
            ),
            SyntaxErrorKind::UnclosedEnvironment(env) => (
                "UNCLOSED_ENVIRONMENT",
                Some(format!("请补全 `\\end{{{env}}}` 闭合环境")),
            ),
            SyntaxErrorKind::MismatchedEnvironment { expected, found } => (
                "MISMATCHED_ENVIRONMENT",
                Some(format!(
                    "环境不匹配：期望 `\\end{{{expected}}}`，实际遇到 `\\end{{{found}}}`"
                )),
            ),
            SyntaxErrorKind::UnsupportedEnvironment(env) => (
                "UNSUPPORTED_ENVIRONMENT",
                Some(format!(
                    "不支持的环境 `\\begin{{{env}}}` 已降级保留为原始 LaTeX 节点"
                )),
            ),
            SyntaxErrorKind::DepthExceeded(limit) => (
                "DEPTH_EXCEEDED",
                Some(format!("LaTeX 嵌套深度超过安全上限 ({limit})，已拒绝解析")),
            ),
            SyntaxErrorKind::OuterDelimitersStripped { open, close } => (
                "OUTER_DELIMITERS_STRIPPED",
                Some(format!("已自动剥离外层数学定界符 `{open} ... {close}`")),
            ),
            SyntaxErrorKind::EmptyBlock => (
                "EMPTY_BLOCK",
                Some("存在空分组或空代码块，请补充内容".to_string()),
            ),
            SyntaxErrorKind::UnknownMacro(name) => (
                "UNKNOWN_MACRO",
                Some(format!("未知 LaTeX 宏 \\{name} 已降级保留为原始节点")),
            ),
            SyntaxErrorKind::Custom(_) => (
                "SYNTAX_ERROR",
                Some("请检查输入 LaTeX 语法是否完整".to_string()),
            ),
        };
        let severity = if diag.is_info() {
            StatusSeverity::Info
        } else if diag.is_warning {
            StatusSeverity::Warning
        } else {
            StatusSeverity::Error
        };
        let message = diag.kind.to_string();
        let err_summary = ErrorSummary::from_error(code, &message, source);

        Self {
            code: err_summary.code,
            severity,
            message,
            summary: err_summary.header_summary,
            source_excerpt: err_summary.source_excerpt,
            truncated: err_summary.truncated,
            detail: err_summary.full_detail,
            hint,
            span: Some(CommandSpan {
                start: diag.span.start,
                end: diag.span.end,
            }),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportReportSnapshot {
    #[serde(default)]
    pub input_latex: String,
    pub lossless: bool,
    pub empty_slots: usize,
    pub raw_nodes: usize,
    pub roundtrip_latex: String,
    pub normalized_match: bool,
    pub blocked: bool,
    pub diagnostics: Vec<DiagnosticSnapshot>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemePreference {
    Light,
    Dark,
    #[default]
    System,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DelimiterStyle {
    #[default]
    None,
    #[serde(alias = "inline")]
    InlineDollar,
    #[serde(alias = "display")]
    BlockDollar,
    #[serde(alias = "markdown_code")]
    CodeFence,
}

impl DelimiterStyle {
    #[must_use]
    pub fn format_latex(self, raw: &str) -> String {
        if raw.is_empty() {
            return String::new();
        }
        match self {
            Self::None => raw.to_owned(),
            Self::InlineDollar => format!("${raw}$"),
            Self::BlockDollar => format!("$$\n{raw}\n$$"),
            Self::CodeFence => format!("```latex\n{raw}\n```"),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum RenderBackendPreference {
    #[default]
    #[serde(rename = "mathjax")]
    MathJax,
    #[serde(rename = "latex-rust")]
    LatexRust,
}

fn default_nav_next_slot() -> String {
    "j".to_owned()
}

fn default_nav_prev_slot() -> String {
    "k".to_owned()
}

fn default_nav_parent() -> String {
    "h".to_owned()
}

fn default_nav_first_child() -> String {
    "l".to_owned()
}

fn default_copy_latex() -> String {
    "Mod+Shift+C".to_owned()
}

fn default_save_snippet() -> String {
    "Mod+Shift+S".to_owned()
}

fn default_focus_editor() -> String {
    "Mod+E".to_owned()
}

fn default_toggle_nav() -> String {
    "Mod+J".to_owned()
}

fn default_open_settings() -> String {
    "Mod+,".to_owned()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShortcutSettings {
    #[serde(default = "default_nav_next_slot")]
    pub nav_next_slot: String,
    #[serde(default = "default_nav_prev_slot")]
    pub nav_prev_slot: String,
    #[serde(default = "default_nav_parent")]
    pub nav_parent: String,
    #[serde(default = "default_nav_first_child")]
    pub nav_first_child: String,
    #[serde(default = "default_copy_latex")]
    pub copy_latex: String,
    #[serde(default = "default_save_snippet")]
    pub save_snippet: String,
    #[serde(default = "default_focus_editor")]
    pub focus_editor: String,
    #[serde(default = "default_toggle_nav")]
    pub toggle_nav: String,
    #[serde(default = "default_open_settings")]
    pub open_settings: String,
}

impl Default for ShortcutSettings {
    fn default() -> Self {
        Self {
            nav_next_slot: default_nav_next_slot(),
            nav_prev_slot: default_nav_prev_slot(),
            nav_parent: default_nav_parent(),
            nav_first_child: default_nav_first_child(),
            copy_latex: default_copy_latex(),
            save_snippet: default_save_snippet(),
            focus_editor: default_focus_editor(),
            toggle_nav: default_toggle_nav(),
            open_settings: default_open_settings(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryStateSnapshot {
    pub corrupt_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup_candidate: Option<String>,
    pub error: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default)]
    pub theme: ThemePreference,
    #[serde(default)]
    pub delimiter_style: DelimiterStyle,
    #[serde(default)]
    pub render_backend: RenderBackendPreference,
    #[serde(default)]
    pub shortcuts: ShortcutSettings,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_scale_pct: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineSnapshot {
    pub state: EditorState,
    pub latex: String,
    pub preview_latex: String,
    pub copy_text: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub cursor_char: usize,
    pub has_pending_command: bool,
    pub is_composing: bool,
    pub is_nav_mode: bool,
    pub can_undo: bool,
    pub can_redo: bool,
    pub slots: Vec<SlotSnapshot>,
    pub diagnostics: Vec<DiagnosticSnapshot>,
    pub active_slot_id: Option<u32>,
    #[serde(default)]
    pub settings: AppSettings,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery: Option<RecoveryStateSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_import: Option<ImportReportSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DispatchResponse {
    pub effects: Vec<Effect>,
    pub snapshot: EngineSnapshot,
}

fn slot_role_key(role: SlotRole) -> String {
    match role {
        SlotRole::Numerator => "Numerator".to_string(),
        SlotRole::Denominator => "Denominator".to_string(),
        SlotRole::Radicand => "Radicand".to_string(),
        SlotRole::RootIndex => "RootIndex".to_string(),
        SlotRole::Subscript => "Subscript".to_string(),
        SlotRole::Superscript => "Superscript".to_string(),
        SlotRole::LowerBound => "LowerBound".to_string(),
        SlotRole::UpperBound => "UpperBound".to_string(),
        SlotRole::BigOpBody => "BigOpBody".to_string(),
        SlotRole::MatrixCell { row, col } => format!("MatrixCell({row},{col})"),
        SlotRole::DelimitedBody => "DelimitedBody".to_string(),
        SlotRole::StyleBody => "StyleBody".to_string(),
        SlotRole::Placeholder => "Placeholder".to_string(),
    }
}

fn slot_role_label(role: SlotRole) -> String {
    match role {
        SlotRole::Numerator => "分子".to_string(),
        SlotRole::Denominator => "分母".to_string(),
        SlotRole::Radicand => "被开方数".to_string(),
        SlotRole::RootIndex => "根指数".to_string(),
        SlotRole::Subscript => "下标".to_string(),
        SlotRole::Superscript => "上标".to_string(),
        SlotRole::LowerBound => "下限".to_string(),
        SlotRole::UpperBound => "上限".to_string(),
        SlotRole::BigOpBody => "主体".to_string(),
        SlotRole::MatrixCell { row, col } => format!("矩阵单元格({},{})", row + 1, col + 1),
        SlotRole::DelimitedBody => "括号内容".to_string(),
        SlotRole::StyleBody => "样式内容".to_string(),
        SlotRole::Placeholder => "占位槽位".to_string(),
    }
}
