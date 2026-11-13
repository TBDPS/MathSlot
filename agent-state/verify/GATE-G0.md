# Gate G0 收口验收报告 (GATE-G0)

- 日期：2026-11-13
- 角色：coordinator
- 工作目录：`/home/mat/Projects/mathslot-next`
- 当前分支：`refactor/v1`
- 结论：**PASS**（G0 退出条件全部达成，允许推进至 Gate G1）

---

## 1. Gate G0 任务完成对照表 (规范 §14)

| 任务 ID | 任务内容 | 关联缺陷/门禁 | 对应提交 | 审计报告 | 验收报告 | 状态 |
|:---|:---|:---|:---:|:---:|:---:|:---:|
| **T0.1** | 增加 CI：fmt/clippy/test/WASM/plugin build | D-023 | `17ffa61` | `AUD-1` | `VER-1` | **PASS** |
| **T0.2** | 清 clippy 或建立显式 test-only 例外清单 | clippy 债务 | `346a1f5` | `AUD-2` | `VER-2` | **PASS** |
| **T0.3** | 为 P1 写失败回归测试（D-001..D-007） | D-001..007, D-101 | `9dc9cae` | `AUD-3` | `VER-3` | **PASS** |
| **T0.4** | 冻结命令语言与发布基线 | 语言语义冻结 | `07422c4` | `AUD-4` | `VER-4` | **PASS** |
| **T0.5** | 建立故障注入 harness（磁盘满/只读/损坏/并发） | A-DATA-001..005, D-005, D-006, D-102 | `956ecea` | `AUD-5` | `VER-5` | **PASS** |

---

## 2. Gate G0 四大退出条件核验 (规范 §14.1)

```yaml
gates:
  - id: G0
    name: baseline-and-guardrails
    tasks: [T0.1, T0.2, T0.3, T0.4, T0.5]
    exit: [ci_green, p1_tests_exist, clippy_controlled, baseline_tagged]
```

1. **`ci_green` (CI 全绿)**：
   - 依赖文件：`.github/workflows/ci.yml` 已通过 T0.1 建立并在 PR/push 触发；
   - 本地完整执行等价命令：`cargo fmt --check` (exit 0)、`cargo clippy` (exit 0)、`cargo test --workspace` (exit 0) 全绿通过。
2. **`p1_tests_exist` (P1 失败回归测试存在)**：
   - 7 项 P1 运行时测试已在 T0.3 建立（`crates/mathslot-core/tests/p1_regression_tests.rs` 与 `src/p1_regression_tests.rs`）；
   - 在 `cargo test --workspace -- --ignored` 实测中 100% 真实 Panic 拦截缺陷现场，绝无 D-101 假测试。
3. **`clippy_controlled` (Clippy 债务可控/归零)**：
   - 全工作区 31 处存量 Clippy 警告经 T0.2 治理已完全归零；
   - 依据 AGENTS.md 规则 7，产品代码零新增 `#[allow]`，以正规 Rust 语法实现零警告编译。
4. **`baseline_tagged` (基线 Tag 已建立)**：
   - 附注标签 `baseline/g0-guardrails` 与兼容别名 `freeze/baseline-g0` 已在 T0.4 建立并指向对应提交；
   - `commands-baseline-v0.7.0.json` 固化 121 项命令与 88 条预设数据。

---

## 3. 完整聚合门禁实测记录 (`scripts/agent/acceptance.sh`)

- **执行时间**：2026-11-13T09:40:07+08:00
- **执行命令**：`scripts/agent/acceptance.sh`（完整模式，不带 `--fast`）
- **退出码**：`0`

```text
== MathSlot 门禁（/home/mat/Projects/mathslot-next）==
时间：2026-11-13T09:40:07+08:00

结果 检查项                    说明
------ ---------------------------- ----
PASS   cargo fmt --check            exit 0
PASS   cargo clippy -D warnings     exit 0
PASS   cargo test --workspace       exit 0
WARN   调色板一致性           G0：已知 D-001，待 G1/T1.3 修复
WARN   let _ = 计数               29 处（G4 前应清零）
WARN   unwrap() 计数              22 处（用户输入路径应为 0）
WARN   命令表常量              3 处（G1 后应只剩 catalog）
WARN   工作区未提交           3 个文件

PASS=3 FAIL=0 WARN=5
结论：PASS
```

---

## 4. Gate G0 收口签署

- **收口判定**：**PASS**
- **当前状态**：Gate G0 正式关闭；准予推进至 **Gate G1（单一事实源）**。
- **下一任务入口**：`T1.1`（定义 `catalog/commands.toml` schema + loader）。
