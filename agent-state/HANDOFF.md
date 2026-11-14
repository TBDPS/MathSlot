# MathSlot 重构交接（HANDOFF）

- 当前分支：`refactor/v1`
- 当前 Gate：`G4`（Round 37，下一任务：`T4.6` 发布流水线）
- 当前 `last_verdict`：`PASS`（[VER-36.md](file:///home/mat/Projects/mathslot-next/agent-state/verify/VER-36.md)）

## 已完成里程碑（Round 36：`T4.5` PASS）

- 提交 `9fd72fd` 通过独立验收 [VER-36.md](file:///home/mat/Projects/mathslot-next/agent-state/verify/VER-36.md)，彻底闭环 **`D-162`..`D-166`** 并根治复现的 **`D-002`**（命令表生成块）与 **`D-022`**（多端路径/Schema/规模文档）：
  - **SSOT 文档生成与锚点注入**：`xtask` 由 `6` 份扩展至 `10` 份产物（新增覆盖 `README.md`、`HELP.md`、`obsidian-mathslot/README.md`、`docs/ARCHITECTURE.md` 的 `<!-- BEGIN GENERATED: metadata|commands|presets|shortcuts -->` 注入块）；清除 `HELP.md:176` 错误希腊字母映射（`▸gx`=`\xi`、`▸gz`=`\zeta`）及 10 处幻影指令、`README.md`/`HELP.md` 标记块外零手写命令清单、`LICENSE`/Round 8 断链、虚假 `F1` 帮助声明、`egui` 历史描述与旧 `schema_version: 1` / macOS 路径偏差。
  - **UI 动态计数与全链路解析门禁**：`packages/ui/src/palette/PalettePanel.svelte` 改为 `{COMMANDS.length}` 与 `{PRESETS.length}`；`codegen_tests.rs` 补入 `presets.ts`；新增 `crates/mathslot-app/tests/docs_ssot_tests.rs` 验证活动文档全部 `▸` token 经 `mathslot_syntax::parse` 零错误解析、121/121 全覆盖与相对路径零死链；`.github/workflows/ci.yml` 新增 `cargo run -p xtask -- generate && git diff --exit-code`；全工作区 Rust 测试 **`273 passed`**。

## 下一轮入口（Round 37 / `T4.6` + Gate G4 退出收敛）

1. 派发 `mathslot-auditor` 对 `T4.6`（发布流水线：`.github/workflows/release.yml` 与 Tauri 2 原生桌面打包 `apps/desktop/src-tauri`、`obsidian-mathslot` 插件发布包、安装脚本/desktop entry、离线本地原生可执行文件打包验证、`README.md` 锚点及 G4 收口遗留项检查）做只读审计，产出 `agent-state/audits/AUD-33.md`。
2. 依据 `AUD-33.md` 撰写 `ADR-0037`（并单列评估 G4 收口前遗留 `acceptance.sh` WARN 处置），完成 `T4.6` 的 `I -> V`，随后完成原生可执行文件构建检查与 Gate G4 最终退出核验。
