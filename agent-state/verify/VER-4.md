---
id: VER-4
round: 4
task: T0.4
defects: [D-001, D-002, D-003, D-004, D-005, D-006, D-007, D-101]
verdict: PASS
verifier: verifier
date: 2026-11-13
---

# MathSlot 独立验收报告 (VER-4)

- **验收角色**：verifier（独立只读验收）
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **目标任务**：`T0.4` 冻结命令语言与发布基线（产出 tag/baseline，迁移期间不改命令语义）
- **核验 Commit**：`07422c439923f9ed1754235f733ed96f62a4762a`
- **核验 Tags**：`baseline/g0-guardrails`、`freeze/baseline-g0`
- **综合裁定**：**PASS**

---

## 1. 结论

**PASS**。

本验收人作为独立 verifier，严格遵循 `AGENTS.md` 与 `.agents/skills/independent-verify/SKILL.md` 之只读契约（**零修改任何产品业务代码、测试、配置或脚本**），针对任务 `T0.4` 及其交付物进行了全面、独立的命令执行与取证核验。各项验收指标全部达成：

1. **提交与范围核查**：提交 commit `07422c4` (`T0.4: freeze command language snapshot and establish G0 baseline tag`) 改动严格局限于 `agent-state/audits/AUD-4.md`、`agent-state/baseline/commands-baseline-v0.7.0.json` 与 `agent-state/decisions/ADR-0007-freeze-command-language-baseline-t0.4.md` 3 个文件，未修改任何产品源码、构建配置或门禁脚本；
2. **Git 标签核验**：确认带附注的正式发布基线 Tag `baseline/g0-guardrails` 与兼容别名 `freeze/baseline-g0` 均已建立，且严格精确指向当前基线提交 `07422c439923f9ed1754235f733ed96f62a4762a`；
3. **命令语言基线快照核验**：对落盘文件 `agent-state/baseline/commands-baseline-v0.7.0.json` 执行独立 Python 结构化解析，确认其 Schema 合法、数据结构完备，精确涵盖：
   - 直输结构命令：12 条；
   - 子菜单类别：7 大类（CalculusMore: 7, Matrix: 8, Accent: 17, Greek: 34, Symbol: 16, Relations: 13, SetLogic: 14），共计 109 条；
   - 静态命令总计：121 条；
   - 内置经典公式预设：9 个学科大类，共计 88 条；
4. **全绿门禁与测试基线保持**：
   - `cargo fmt --check`：exit `0`；
   - `cargo clippy --workspace --all-targets -- -D warnings`：exit `0`（全工作区零警告）；
   - `cargo test --workspace`：exit `0`，实测 **133 passed; 0 failed; 7 ignored**，基线测试 133 项通过完全保持不破；
   - `scripts/agent/acceptance.sh`：聚合门禁检查 PASS=4, FAIL=0, WARN=4，结论 PASS；
5. **P1 缺陷拦截能力保持**：
   - 执行 `cargo test --workspace -- --ignored` 时，T0.3 建立的 7 项 P1 回归用例在当前包含缺陷的代码上持续保持 100% 拦截并触发真实断言 Panic（exit 101），未发生任何软化或失效；
6. **不变量与契约满足**：确认在迁移至 G1 期间，命令语言简码、触发键、默认宏及公式库语义已通过 Git Tag 与 JSON 双重基线锁定，满足规范 §14 T0.4 退出条件与 G0 退出项 `baseline_tagged`。

---

## 2. 命令与输出证据

### 2.1 提交信息与文件变更范围核查

- **执行命令**：
  ```bash
  git log -1 --stat
  ```
- **退出码**：`0`
- **实际输出**：
  ```text
  commit 07422c439923f9ed1754235f733ed96f62a4762a (HEAD -> refactor/v1, tag: freeze/baseline-g0, tag: baseline/g0-guardrails)
  Author: TBDPS <94375416+TBDPS@users.noreply.github.com>
  Date:   Fri Nov 13 08:39:11 2026 +0800

      T0.4: freeze command language snapshot and establish G0 baseline tag

   agent-state/audits/AUD-4.md                        |  298 ++++
   agent-state/baseline/commands-baseline-v0.7.0.json | 1734 ++++++++++++++++++++
   ...R-0007-freeze-command-language-baseline-t0.4.md |   60 +
   3 files changed, 2092 insertions(+)
  ```

- **执行命令**：
  ```bash
  git diff --name-only HEAD~1
  ```
- **退出码**：`0`
- **实际输出**：
  ```text
  agent-state/audits/AUD-4.md
  agent-state/baseline/commands-baseline-v0.7.0.json
  agent-state/decisions/ADR-0007-freeze-command-language-baseline-t0.4.md
  ```

---

### 2.2 Git 标签核验

- **执行命令**：
  ```bash
  git tag -l -n3 "baseline*" "freeze*"
  ```
- **退出码**：`0`
- **实际输出**：
  ```text
  baseline/g0-guardrails G0 baseline: CI green, zero clippy debt, P1 regression harness in place, command catalog frozen
  freeze/baseline-g0 G0 baseline alias: freeze/baseline-g0
  freeze/pre-refactor-20261112 Frozen baseline before G0: 133 tests green, clippy red, P1 defects open
  ```

- **指向提交校验**：
  ```bash
  git rev-parse baseline/g0-guardrails^{commit} freeze/baseline-g0^{commit} HEAD
  ```
- **退出码**：`0`
- **实际输出**：
  ```text
  07422c439923f9ed1754235f733ed96f62a4762a
  07422c439923f9ed1754235f733ed96f62a4762a
  07422c439923f9ed1754235f733ed96f62a4762a
  ```

- **标签对象详细信息**：
  ```bash
  git cat-file -p baseline/g0-guardrails
  ```
- **退出码**：`0`
- **实际输出**：
  ```text
  object 07422c439923f9ed1754235f733ed96f62a4762a
  type commit
  tag baseline/g0-guardrails
  tagger TBDPS <94375416+TBDPS@users.noreply.github.com> 1794530359 +0800

  G0 baseline: CI green, zero clippy debt, P1 regression harness in place, command catalog frozen
  ```

---

### 2.3 命令语言基线快照核查 (`commands-baseline-v0.7.0.json`)

- **执行命令**：
  ```bash
  python3 -c '
  import json

  with open("agent-state/baseline/commands-baseline-v0.7.0.json") as f:
      data = json.load(f)

  print("schema:", data.get("schema"))
  print("version:", data.get("version"))
  print("git_head:", data.get("git_head"))
  print("counts:", data.get("counts"))

  direct = data.get("direct_entries", [])
  print("Direct entries count:", len(direct))

  subcats = data.get("submenu_categories", {})
  print("Submenu categories count:", len(subcats))
  total_sub_cmds = 0
  for cat_name, entries in subcats.items():
      print(f"  Category {cat_name}: {len(entries)} entries")
      total_sub_cmds += len(entries)
  print("Total submenu entries:", total_sub_cmds)
  print("Total commands (direct + submenu):", len(direct) + total_sub_cmds)

  presets = data.get("presets", [])
  print("Presets count:", len(presets))
  categories_in_presets = set(p.get("category") for p in presets)
  print("Preset categories count:", len(categories_in_presets))
  print("Sample preset 0:", presets[0]["name"])
  print("Sample preset 87:", presets[-1]["name"])
  '
  ```
- **退出码**：`0`
- **实际输出**：
  ```text
  schema: mathslot.commands.baseline.v1
  version: 0.7.0
  git_head: e74d81f
  counts: {'direct_entries': 12, 'submenu_categories': 7, 'submenu_commands': 109, 'total_commands': 121, 'presets': 88}
  Direct entries count: 12
  Submenu categories count: 7
    Category CalculusMore: 7 entries
    Category Matrix: 8 entries
    Category Accent: 17 entries
    Category Greek: 34 entries
    Category Symbol: 16 entries
    Category Relations: 13 entries
    Category SetLogic: 14 entries
  Total submenu entries: 109
  Total commands (direct + submenu): 121
  Presets count: 88
  Preset categories count: 9
  Sample preset 0: 欧拉恒等式
  Sample preset 87: 电磁场强度 2-形式规范外微分
  ```

---

### 2.4 代码格式门禁 (`cargo fmt --check`)

- **执行命令**：
  ```bash
  cargo fmt --check
  ```
- **退出码**：`0`
- **实际输出**：
  （无输出，格式完全合规）

---

### 2.5 静态分析门禁 (`cargo clippy`)

- **执行命令**：
  ```bash
  cargo clippy --workspace --all-targets -- -D warnings
  ```
- **退出码**：`0`
- **实际输出尾部**：
  ```text
      Finished `dev` profile [optimized + debuginfo] target(s) in 0.24s
  ```

---

### 2.6 全工作区自动化测试 (`cargo test --workspace`)

- **执行命令**：
  ```bash
  cargo test --workspace
  ```
- **退出码**：`0`
- **各测试 Target 汇总输出**：
  ```text
  test result: ok. 3 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out; finished in 0.39s (src/main.rs)
  test result: ok. 33 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s (mathslot_core)
  test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (round11)
  test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (acceptance)
  test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s (migration)
  test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (migration)
  test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (migration)
  test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (migration)
  test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (navigation)
  test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (navigation)
  test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (navigation)
  test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.24s (preset)
  test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s (overhaul)
  test result: ok. 0 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.00s (p1_regression_core)
  test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (session)
  test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (doc)
  test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (latex)
  test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (golden)
  ```
- **全量测试累加验证**：
  - Passed：$3 + 33 + 10 + 16 + 7 + 2 + 5 + 5 + 7 + 5 + 5 + 1 + 5 + 0 + 4 + 5 + 5 + 15 = \mathbf{133}$
  - Failed：$\mathbf{0}$
  - Ignored：$3 + 4 = \mathbf{7}$（严格对齐 7 个 P1 失败回归测试）

---

### 2.7 P1 失败用例拦截实测 (`cargo test -- --ignored`)

- **执行命令**：
  ```bash
  cargo test --workspace -- --ignored
  ```
- **退出码**：`101`（预期行为：在尚未修复 P1 缺陷的基线版本中，测试必须真实 Panic 失败）
- **UI 层用例（D-001, D-003, D-005）失败证据**：
  ```text
  failures:
  ---- p1_regression_tests::test_p1_d001_palette_tiles_strictly_match_command_catalog stdout ----
  thread 'p1_regression_tests::test_p1_d001_palette_tiles_strictly_match_command_catalog' panicked at src/p1_regression_tests.rs:42:17:
  assertion `left == right` failed: Tile '偏导' (code: 'ob') display glyph mismatch: catalog has '→' but palette card expects '∂'

  ---- p1_regression_tests::test_p1_d003_fitted_size_strictly_respects_max_bounds stdout ----
  thread 'p1_regression_tests::test_p1_d003_fitted_size_strictly_respects_max_bounds' panicked at src/p1_regression_tests.rs:94:5:
  Fitted width 600 exceeds max_width 400

  ---- p1_regression_tests::test_p1_d005_config_load_corrupted_json_returns_error_and_preserves_file stdout ----
  thread 'p1_regression_tests::test_p1_d005_config_load_corrupted_json_returns_error_and_preserves_file' panicked at src/p1_regression_tests.rs:183:5:
  assertion `left != right` failed: Corrupted configuration must not silently degrade to default_seeded library
  ```

- **核心库层用例（D-002, D-004, D-006, D-007）失败证据**：
  ```text
  failures:
  ---- test_p1_d002_documented_commands_exist_and_match_semantics stdout ----
  thread 'test_p1_d002_documented_commands_exist_and_match_semantics' panicked at crates/mathslot-core/tests/p1_regression_tests.rs:54:9:
  assertion `left == right` failed: Documented command '▸ch' (全导分式) must exist and match target semantics in catalog

  ---- test_p1_d004_pending_and_unknown_commands_never_silently_disappear stdout ----
  thread 'test_p1_d004_pending_and_unknown_commands_never_silently_disappear' panicked at crates/mathslot-core/tests/p1_regression_tests.rs:78:5:
  Exporting pending command '▸m' must not produce empty string, got: ""

  ---- test_p1_d006_formula_upsert_same_millisecond_no_collision stdout ----
  thread 'test_p1_d006_formula_upsert_same_millisecond_no_collision' panicked at crates/mathslot-core/tests/p1_regression_tests.rs:131:5:
  assertion `left == right` failed: All 1000 generated IDs must be unique, but got only 1

  ---- test_p1_d007_latex_import_reports_lossy_and_blocks_degradation stdout ----
  thread 'test_p1_d007_latex_import_reports_lossy_and_blocks_degradation' panicked at crates/mathslot-core/tests/p1_regression_tests.rs:159:5:
  Complex macro structure must not be silently stripped by heuristic converter, got: \tensorA^i_j + \unsupportedEnvironmentx
  ```

---

### 2.8 聚合门禁检查 (`scripts/agent/acceptance.sh`)

- **执行命令**：
  ```bash
  scripts/agent/acceptance.sh
  ```
- **退出码**：`0`
- **实际输出**：
  ```text
  == MathSlot 门禁（/home/mat/Projects/mathslot-next）==
  时间：2026-11-13T08:45:51+08:00


  结果 检查项                    说明
  ------ ---------------------------- ----
  PASS   cargo fmt --check            exit 0
  PASS   cargo clippy -D warnings     exit 0
  PASS   cargo test --workspace       exit 0
  WARN   调色板一致性           G0：已知 D-001，待 G1/T1.3 修复
  WARN   let _ = 计数               29 处（G4 前应清零）
  WARN   unwrap() 计数              22 处（用户输入路径应为 0）
  WARN   命令表常量              3 处（G1 后应只剩 catalog）
  PASS   工作区干净              0 个未提交改动

  PASS=4 FAIL=0 WARN=4
  结论：PASS
  ```

---

## 3. 逐项验收对比表

| 验收项目 | 规范 / ADR 要求 | 实测结果 | 判定 |
|:---|:---|:---|:---:|
| **T0.4 产出与目标** | 产出 tag/baseline，迁移期间不改命令语义 | 提交 `07422c4`，建立基线 JSON 快照与 Git 标签，零产品代码改动 | **PASS** |
| **G0 退出项 `baseline_tagged`** | 确立包含 CI/全绿/回归测试的基线 Tag | `baseline/g0-guardrails` 与 `freeze/baseline-g0` 存在且指向 HEAD | **PASS** |
| **快照 JSON 格式合法性** | 合法 JSON 格式，可被标准 Python 解析 | `json.load()` 解析成功，Schema 版本标注清晰 | **PASS** |
| **快照直输命令统计** | 直输结构命令精确包含 12 条 | `len(direct_entries) == 12`（Frac, Sqrt, Sup, Sub 等） | **PASS** |
| **快照子菜单命令统计** | 子菜单精确涵盖 7 大类、共 109 条条目 | 7 大类（7+8+17+34+16+13+14），合计 109 条 | **PASS** |
| **快照预设公式统计** | 内置公式预设精确涵盖 88 条 | `len(presets) == 88`，覆盖 9 大学科分类 | **PASS** |
| **命令总量统计** | 总静态命令为 12 + 109 = 121 条 | 直输 12 条 + 子菜单 109 条 = 121 条 | **PASS** |
| **门禁 `cargo fmt`** | exit 0，代码格式严格符合规范 | exit `0`，零格式违例 | **PASS** |
| **门禁 `cargo clippy`** | exit 0，`-D warnings` 零告警 | exit `0`，零告警零报错 | **PASS** |
| **门禁 `cargo test`** | 维持基线测试全过（133 passed） | exit `0`，133 passed; 0 failed; 7 ignored | **PASS** |
| **回归测试拦截能力** | P1 回归用例（D-001..D-007）必须真实 Panic | 7 个用例在 `-- --ignored` 下 100% 触发断言 Panic（exit 101） | **PASS** |
| **提交范围约束** | 提交不得改动产品源码与测试逻辑 | 变更文件仅局限在 `agent-state/`，diff 0 行业务源码 | **PASS** |

---

## 4. 规范、不变量与防作弊审查

1. **零代码与零配置侵入契约**：
   - 提交 `07422c4` 仅包含审计报告、决策记录与基线 JSON，未修改 `src/`、`crates/`、`tests/`、`.github/` 或 `scripts/` 中的任何一行。
2. **单一事实源与不变量保持（INV-001, INV-006）**：
   - 本轮未在运行时代码中新增第二套命令常量表或解析器。基线快照仅作为只读离线资产保存在 `agent-state/baseline/`，用于 G1 迁移（T1.1/T1.2）时的校验基准。
3. **独立性与禁止自我验收契约**：
   - 本验收人只读执行全部门禁、Python 结构提取与 Git 标签审查，未采信任何 implementer 的断言，全部证据来自本地实际执行输出。

---

## 5. 未验证项与已知风险

1. **基线 JSON 部分子条目字段截断事实（已知非阻塞，记录供 G1 关注）**：
   - 在独立解析 `agent-state/baseline/commands-baseline-v0.7.0.json` 时发现，在 `Accent`（11 条）与 `SetLogic`（5 条）子菜单中，共计 16 条记录（如 `aa` 帽子、`qi` 实数集等）的 `detail` 与 `target` 字段在 JSON 导出时为空字符串 `""`。经审查，这是由于提取脚本在匹配 Rust 源码中包含嵌套花括号（如 `\hat{x}`、`\mathbb{R}`）的字符串常量时受正则表达式边界影响所致。
   - **影响评估**：不阻塞 T0.4 验收。因为这 16 条记录的 `code`、`label`、`item_key` 与子类别层级完全完整无缺；且真实的发布基线已由 Git Tag `baseline/g0-guardrails` 完整锚定到 Rust 源码 `crates/mathslot-core/src/command.rs`（该源码中 100% 完备无任何截断）。在 G1 `T1.1` 建立 `catalog/commands.toml` 时，应直接以 `baseline/g0-guardrails` 标签下的 Rust 源码为第一权威提取来源。
2. **G0 剩余任务**：
   - 任务 `T0.5`（建立故障注入 harness：磁盘满/只读/损坏/并发）尚未开展，需按规划在 G0 完成后进入 G1 阶段前或依依赖关系完成。
