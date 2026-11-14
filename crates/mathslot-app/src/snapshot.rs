use mathslot_doc::{EditorDiagnostic as Diagnostic, Slot, SlotRole};
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
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagnosticSnapshot {
    pub code: String,
    pub severity: StatusSeverity,
    pub message: String,
}

impl DiagnosticSnapshot {
    #[must_use]
    pub fn from_diagnostic(diag: &Diagnostic) -> Self {
        match diag {
            Diagnostic::PendingCommand { message, .. } => Self {
                code: "PENDING_COMMAND".to_string(),
                severity: StatusSeverity::Info,
                message: message.clone(),
            },
            Diagnostic::UnknownCommand { message, .. } => Self {
                code: "UNKNOWN_COMMAND".to_string(),
                severity: StatusSeverity::Error,
                message: message.clone(),
            },
            Diagnostic::Syntax(message) => Self {
                code: "SYNTAX_ERROR".to_string(),
                severity: StatusSeverity::Error,
                message: message.clone(),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineSnapshot {
    pub state: EditorState,
    pub latex: String,
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
