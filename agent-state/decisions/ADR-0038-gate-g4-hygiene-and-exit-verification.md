# ADR-0038: Gate G4 收口活跃代码 `.unwrap()` 清零与门禁口径收敛

- **日期**：2026-11-15
- **Gate / Task**：`G4` / `GATE-G4`（G4 退出收敛）
- **状态**：Approved
- **依据审计**：`agent-state/audits/AUD-31.md` §4.2、`agent-state/audits/AUD-33.md` §4.2

---

## 1. 上下文

截至 Round 37，Gate G4 的 `T4.1`..`T4.6` 全部任务已完成独立验收（`VER-32`..`VER-37` 均 **PASS**）。在最终退出 Gate G4 前，仍有两个边界收敛项需要清晰处理（严禁不留记录地“顺手重构”）：

1. **活跃核心存在 3 处受守卫的 `.unwrap()`**（[AUD-31.md](../audits/AUD-31.md) §4.2）：
   - `crates/mathslot-doc/src/document.rs:651, 824, 847` 在 `if new_nodes.len() == 1` 后调用 `new_nodes.into_iter().next().unwrap()`，并且该单节点 vs 多节点折叠逻辑重复出现了 3 次（违反代码不重复规范与活跃路径零 `.unwrap()` 目标）。
2. **`scripts/agent/acceptance.sh` 统计口径陈旧**（[AUD-33.md](../audits/AUD-33.md) §4.2）：
   - 原 `acceptance.sh:109-115` 扫描已冻结的旧栈 `src/` 与 `crates/mathslot-core/src/`（含 `#[cfg(test)]`），输出 `WARN=3`（`let _ = 9`、`unwrap() 20`、`*_ENTRIES 3`），却反而**漏扫描**活跃核心 `crates/mathslot-{syntax,doc,latex,command,app,store,render,wasm}/src`、`apps/desktop/src-tauri/src`、`xtask/src`！

---

## 2. 决策方案

### 2.1 清理 `crates/mathslot-doc/src/document.rs` 重复逻辑与 `.unwrap()`（`GATE-G4` 代码提交）

- 在 `crates/mathslot-doc/src/document.rs` 中先补充/确认单节点与多节点槽位替换回归测试，然后提取一个共享私有辅助函数（如 `collapse_replacement_nodes(new_nodes: Vec<Spanned<Expr>>, span: Span) -> Spanned<Expr>`），使用 `<[Spanned<Expr>; 1]>::try_from(new_nodes)` 模式匹配单节点与 `Expr::Group(rest)` 降级：
  - 彻底消除 `document.rs:651, 824, 847` 三处 `.unwrap()`；
  - 消除三处重复的 `if len == 1 ... else Group(...)` 逻辑；
  - 使全仓全部活跃核心产品代码（`crates/mathslot-{syntax,doc,latex,command,app,store,render,wasm}/src`、`apps/desktop/src-tauri/src`、`xtask/src`）在非测试路径下达到 **`let _ =`: 0 处、`.unwrap()`: 0 处、`const *_ENTRIES`: 0 处**。

### 2.2 独立工具链提交升级 `scripts/agent/acceptance.sh`（严格按 `AGENTS.md` §2 分开提交）

- 修改 `scripts/agent/acceptance.sh` 第 106–115 行：
  - **活跃产品主路径严格 `PASS`/`FAIL` 门禁**：精确扫描活跃非测试 Rust 源码（`crates/mathslot-{syntax,doc,latex,command,app,store,render,wasm}/src`、`apps/desktop/src-tauri/src`、`xtask/src`，按文件剥离 `#[cfg(test)]` 尾部测试模块后统计 `let _ = `、`.unwrap()` 与 `const *_ENTRIES`），**任意一项 `> 0` 直接 `FAIL`**，`== 0` 输出 **`PASS`**！
  - **冻结对照旧栈基线只读透明报告**：将已冻结旧栈（`src/`、`crates/mathslot-core/`）的既有基线统计标为 **`PASS`（或信息提示，说明已冻结留存、不随主架构分发）**，不再产生误导性的 `WARN=3`。
- 该 `scripts/agent/acceptance.sh` 改动与 `crates/mathslot-doc` 代码提交严格分开，单独提交工具链 commit 并引用本 `ADR-0038`。

### 2.3 Gate G4 全景终验与外部监督审查

- 上述两项完成后，由独立 `mathslot-verifier` 对 Gate G4 进行最终退出全景验收（覆盖 `acceptance.sh` 全绿、全部 Rust/UI/Desktop/Obsidian 单元与双端 E2E、`build.mjs`、`package-desktop-local.sh` 及全部 `A-*` / `S-001..007` 证据索引），产出 `VER-38.md`；随后检查是否可用 `scripts/agent/supervise.sh --final`（若外部 `opencode` 可用则执行最终监督审查；若不可用则据实记录真实退出状态）。

---

## 3. 允许写入范围

- **代码提交（`mathslot-implementer`）**：仅 `crates/mathslot-doc/**`，commit message 含 `GATE-G4`。
- **工具链提交（`coordinator`，独立提交）**：仅 `scripts/agent/acceptance.sh`，commit message 注明 `ADR-0038`。
