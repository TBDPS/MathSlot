use mathslot_syntax::{Expr, MatrixEnv, Spanned};

/// 描述多维环境与矩阵网格的几何拓扑结构
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvironmentShape {
    pub env: MatrixEnv,
    pub rows: usize,
    pub cols: usize,
    pub is_rectangular: bool,
}

/// 检查给定 AST 节点是否为标准矩阵或多维环境并提取几何维度
pub fn inspect_environment(spanned: &Spanned<Expr>) -> Option<EnvironmentShape> {
    if let Expr::Matrix { env, rows } = &spanned.node {
        let row_count = rows.len();
        let mut max_cols = 0;
        let mut min_cols = usize::MAX;

        for row in rows {
            let col_count = row.len();
            max_cols = max_cols.max(col_count);
            min_cols = min_cols.min(col_count);
        }

        if row_count == 0 {
            min_cols = 0;
        }

        let is_rectangular = max_cols == min_cols;

        Some(EnvironmentShape {
            env: *env,
            rows: row_count,
            cols: max_cols,
            is_rectangular,
        })
    } else {
        None
    }
}

/// 验证环境名称是否属于合法标准数学环境
pub fn is_supported_environment(name: &str) -> bool {
    MatrixEnv::from_latex_name(name).is_some()
}
