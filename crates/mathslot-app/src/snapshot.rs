use mathslot_doc::{EditorDiagnostic as Diagnostic, Slot, SlotRole};
use mathslot_render::ErrorSummary;
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineSnapshot {
    pub state: EditorState,
    pub latex: String,
    pub preview_latex: String,
    pub copy_text: String,
    pub has_pending_command: bool,
    pub is_composing: bool,
    pub is_nav_mode: bool,
    pub can_undo: bool,
    pub can_redo: bool,
    pub slots: Vec<SlotSnapshot>,
    pub diagnostics: Vec<DiagnosticSnapshot>,
    pub active_slot_id: Option<u32>,
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
