# ADR-0002：证据必须进版本库；源码文本断言不是验收

- 日期：2026-11-12
- 状态：已生效
- 决策者：coordinator
- 关联：D-101（新增）、T0.1、T0.3

## 背景

上一轮重构把 48 份审计/决策/验收报告写进 `docs/`，同时 `.gitignore` 里有 `docs/`，并有一个测试 `test_adv_acc_10_gitignore_isolation_contract` 断言该规则存在。结果是：

- 所有证据都不在版本库里，无法追溯、无法回滚、无法证明对应哪个提交；
- 同一个 20 KB 的"FINAL ACCEPTANCE"报告存在多个副本，其中两份字节相同；
- 报告在 11-11 03:59 签署，之后 10:54 与 11-12 仍有产品提交，没有触发重新验收。

## 决策

1. **移除 `.gitignore` 的 `docs/` 规则**，`docs/` 全部纳入版本库；`target/`、`*.log`、`*.tmp`、`*.bak` 继续忽略。
2. 改写该测试为断言**新策略**：`docs/` 不得被忽略、`/target` 必须被忽略。
   保留测试意图（保护文档不丢失），但把方向反过来：文档丢失的原因是"没进版本库"，不是"被误提交"。
3. 记录新缺陷 **D-101（P1）**：存在以源码字符串为断言的"验收测试"（如 `test_adv_acc_07_zero_modal_static_code_invariants` 断言 `app.rs`/`modals.rs` 含特定中文文案与像素常量）。这类测试：
   - 不验证用户可见行为；
   - 在重构时必然误报；
   - 让"验收通过"与"功能正确"脱钩。
   处理方向：G1 起改为行为级测试（parse/render/flow），源码文本断言只允许出现在架构守卫（如"只存在一套 parser"）。

## 后果

- `cargo test --workspace` 在本次改动后应回到全绿；若不绿，说明还有依赖旧策略的测试，按 D-101 处理。
- 报告与证据进入 VCS 后，`agent-state/verify/` 的 PASS 才有意义。
- 任何人再写"验收通过"必须附带提交哈希与命令输出。

## 附：本次门禁基线

`scripts/agent/acceptance.sh --fast` 在本轮开始时：

- `cargo fmt --check`：FAIL（存量格式问题）
- `cargo test --workspace`：FAIL（本 ADR 提到的 `.gitignore` 测试）
- 调色板一致性：5 张卡片不一致（G0 记为 WARN，G1 起为 FAIL）
- `let _ =` 29 处、`unwrap()` 22 处、命令表常量 3 处
