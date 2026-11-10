use mathslot_syntax::Diagnostic;
use serde::{Deserialize, Serialize};

/// 导入诊断报告：提供无损度与差异指标
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportReport {
    /// 是否 100% 无损导入（无语法错误、无 RawLatex 降级节点）
    pub lossless: bool,
    /// 诊断信息集（警告与语法错误）
    pub diagnostics: Vec<Diagnostic>,
    /// 待填充槽位计数（Expr::Placeholder 数量）
    pub empty_slots: usize,
    /// 未识别或降级的 RawLatex / Error 节点计数
    pub raw_nodes: usize,
    /// 重新格式化生成的标准规范 LaTeX 字符串
    pub roundtrip_latex: String,
    /// 归一化等价性匹配（去除冗余空白后，输入与输出是否一致）
    pub normalized_match: bool,
}

impl ImportReport {
    pub fn is_lossless(&self) -> bool {
        self.lossless
    }

    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.is_error())
    }

    pub fn has_warnings(&self) -> bool {
        self.diagnostics.iter().any(|d| d.is_warning)
    }
}
