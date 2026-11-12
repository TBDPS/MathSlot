---
doc_id: mathslot-llm-spec
version: 1.0
status: active
audience: llm-coding-agent
language: zh-CN
updated: 2026-11-12
canonical_repo: /home/mat/Projects/mathslot-next
review_report: /home/mat/Projects/mathslot/审查报告与重写方案.md
screenshots: /home/mat/Projects/mathslot/docs/assets
---

# MathSlot LLM 实施规范

> 这份文档写给大语言模型/编码代理，不写给人类做汇报。
>
> 目标：让代理在不猜测、不重复造轮子、不静默改坏数据的前提下，继续修复和重写 MathSlot。
>
> 规则：本文用 `MUST` / `MUST NOT` / `SHOULD` 表达约束；所有任务都有稳定 ID；不使用时间估算，只用依赖关系和门禁（Gate）。

---

## 0. 读取协议

### 0.1 阅读顺序

按以下顺序读取，不要跳读：

1. §1 项目快照：知道代码在哪、怎么跑。
2. §2 不变量：任何实现都不得违反。
3. §3 已验证事实：知道当前代码真实行为。
4. §4 缺陷登记：知道要修什么。
5. §5–§12 目标契约：知道改成什么样。
6. §13 测试与 CI：知道如何证明改对了。
7. §14 任务 DAG：知道先做哪一项。
8. §15 代理工作协议：知道如何提交改动。
9. 附录 D 偏差自检命令：提交前跑一遍。

### 0.2 事实优先级

发生冲突时，按以下顺序判断：

1. 本文的目标契约（target-state）——用于决定“应该怎样”。
2. `catalog/commands.toml` 与生成产物——唯一命令事实源（迁移完成后）。
3. 当前代码与测试——用于确认“现在怎样”。
4. `README.md` / `HELP.md`——默认视为**不可信文档**，除非它由 catalog 生成或与代码一致。

禁止用 README/HELP 反推命令行为；必须查 `command.rs` 或 catalog。

### 0.3 目录约定

| 路径 | 角色 |
|---|---|
| `/home/mat/Projects/mathslot` | 交付文档与 6 个桌面端源文件快照；**不可构建** |
| `/home/mat/Projects/mathslot-next` | 真实工作区 v0.7.0；所有代码改动在这里 |
| `/home/mat/Projects/mathslot/审查报告与重写方案.md` | 人类可读的完整审查报告；本文的上游证据 |
| `/home/mat/Projects/mathslot/LLM_IMPLEMENTATION_SPEC.md` | 本文；代理的实施规范 |
| `/home/mat/Projects/mathslot/docs/assets/` | 审查截图 |

### 0.4 任务执行原则

- 一次只做一个 `T-*` 任务；不要在一个提交里跨 Gate。
- 开始前必须确认 `depends_on` 全部完成。
- 任何行为变更必须先有失败测试，再有实现，再有通过测试。
- 不得为了让 CI 变绿而删除、跳过或弱化测试。
- 不得新增第二套 parser/AST/命令表；见 INV-001、INV-006。
- 遇到规范未覆盖的行为，先写 `OPEN-*` 问题并停止扩展，不要自行发明语义。

### 0.5 最小启动提示词

在把本文件交给编码代理时，可直接使用下面的提示词：

```text
你在 /home/mat/Projects/mathslot-next 工作（Rust edition 2024，v0.7.0）。

第一步：完整读取 /home/mat/Projects/mathslot/LLM_IMPLEMENTATION_SPEC.md，
按 §0.1 的顺序读，不要跳读。

第二步：报告你选择的下一步：
- 当前处于哪个 Gate；
- 你要做的 T-* 任务及其 depends_on 是否全部完成；
- 对应要修的 D-* 缺陷；
- 你计划先写哪个失败测试。

约束：
- 遵守 §2 全部 INV-*，违反任何一条必须停下并写 OPEN-*。
- 只改 mathslot-next，不要改 /home/mat/Projects/mathslot 下的代码快照。
- 不要在同一个提交里跨 Gate，不要新增第二套 parser/AST/命令表。
- 完成定义以 §15.4 为准；报告格式以 §15.5 为准。

现在开始：先给出上述第二步的报告，等我确认后再改代码。
```

> 代理不需要读 `审查报告与重写方案.md` 才能工作；该报告是证据来源。只有在需要复现截图、查看人类可读论证或核对缺陷上下文时才读它。

---

## 1. 项目快照

### 1.1 两个目录的关系

`/home/mat/Projects/mathslot` 只有 6 个桌面端文件：

| 文件 | 行数 | 作用 |
|---|---:|---|
| `app.rs` | 2520 | 桌面 UI、事件、焦点、撤销分组、调色板、预览/导航 |
| `modals.rs` | 1607 | 公式库、格式/片段、LaTeX 导入、配置读写 |
| `render.rs` | 317 | 后台 `latex-rust` 渲染、降级、图像留白 |
| `theme.rs` | 381 | 颜色、样式、字体、自绘小部件 |
| `main.rs` | 32 | eframe 启动 |
| `devshot.rs` | 65 | 环境变量驱动的截图辅助 |

它没有 `Cargo.toml`、`crates/` 或应用资源目录，不能独立构建。真实工作区是：

`/home/mat/Projects/mathslot-next`（version `0.7.0`, Rust edition `2024`）。

两处桌面端 6 个文件已逐字节核对一致。

### 1.2 工作区模块

| 模块 | 当前角色 |
|---|---|
| `crates/mathslot-core` | 运行时领域层：`ast`、`parser`、`latex`、`editor`、`visual`、`library`、`command` |
| `crates/mathslot-syntax` | 另一套 lexer/parser/AST/diagnostics/printer |
| `crates/mathslot-doc` | Document/Transaction/UndoStack/SlotTable |
| `crates/mathslot-latex` | LaTeX 导入、环境识别、round-trip、ImportReport |
| `crates/mathslot-wasm` | 手写 C ABI 的 WASM 桥；28 个 `pub extern "C" fn` |
| `obsidian-mathslot/` | Obsidian 插件；`plugin.js` + 内联 base64 WASM |
| `src/` | 桌面端二进制 crate（eframe/egui） |

### 1.3 当前运行路径

```text
Desktop: TextEdit
  -> StreamEditor::sync_after_edit
  -> mathslot_core::parser
  -> mathslot_core::visual
  -> RenderWorker (latex-rust)
  -> PNG texture

WASM/Obsidian: JS key event
  -> C ABI
  -> mathslot_core::editor/parser/visual
  -> MathJax
```

关键事实：

- 桌面端和 WASM 都直接使用 `mathslot_core::{ast, parser, latex, editor, visual}`。
- `mathslot_core::session::Session` 只在测试和 `lib.rs` re-export 中使用；两个前端都没有用它。
- `mathslot-syntax/doc/latex` 是更干净的另一套栈，但没有成为运行时主路径。
- 因此同时存在两套 AST、两套 parser、两套 LaTeX 生成/导入逻辑。

### 1.4 基线状态

| 命令 | 结果 |
|---|---|
| `cargo test --workspace` | 133 passed, 0 failed |
| `cargo clippy --workspace --all-targets -- -D warnings` | **失败**（产品代码 + `golden_tests.rs`） |
| `.github/workflows/` | 只有 `release.yml`；没有 test/fmt/clippy/WASM/plugin CI |
| 预置公式 | **88 条内置**（测试中的 89 条 = 88 内置 + 1 条用户公式） |
| WASM | 约 602 KB |
| Obsidian `main.js` | 约 856 KB（内联 base64 WASM） |
| 桌面 release 二进制 | 约 14 MB |

### 1.5 vibecoding 遗留特征

以下不是道德判断，而是代理必须主动对抗的代码现实：

- 同一命令出现在 5 处以上：`command.rs`、`app.rs` 调色板、`HELP.md`、`README.md`、Obsidian catalog。
- 文档与代码已经漂移，且文档写得很详细，因此更容易误导。
- 多处 `let _ = save_library_to_disk(...)` 吞掉错误。
- 配置读取失败静默回退默认库。
- 渲染失败静默走 fallback，调用方不知道。
- `TextEdit::singleline` 配 wrapping layouter，视觉多行、语义单行。
- 大量行为由输入前后 diff 推断，而不是显式状态机。

代理的默认动作：**先找唯一事实源；找不到就建立它；不要复制第五份。**

---

## 2. 不变量

> 这些是硬约束。任何任务如果违反其中一条，必须拒绝实现并写 `OPEN-*`。

| ID | 约束 | 验证方式 |
|---|---|---|
| INV-001 | 全系统只能有一套 parser + AST + LaTeX 生成器 | 代码搜索无第二套 `parse`/`Ast`/`to_latex` 运行时入口 |
| INV-002 | 任何输入节点不得在输出时静默消失 | `Pending`/`Unknown`/缺失槽位必须产生 Diagnostic 或显式占位符 |
| INV-003 | 持久化失败不得静默 | 保存返回 `Result`；UI 显示“未保存”；禁止 `let _ = save...` |
| INV-004 | 配置只存用户数据，内置内容编译期加载 | 配置文件无 88 条内置公式；升级按稳定 ID 合并 |
| INV-005 | ID 必须稳定且唯一 | UUIDv7/ULID；同一毫秒批量创建不碰撞 |
| INV-006 | 命令、调色板、文档、TS 类型只有一个事实源 | catalog 生成；CI 检查生成文件无 diff |
| INV-007 | 不完整输入是一等公民 | `▸`、`▸f`、`▸m` 可编辑、可导航、可诊断，不 panic |
| INV-008 | 撤销按意图分组，不按时间窗 | 卡片插入/粘贴/导入/删除各自独立；文本输入可合并 |
| INV-009 | 使用标准编辑原语 | 选区、IME、剪贴板、撤销、多行由 CodeMirror/平台提供 |
| INV-010 | 跨平台路径由库解析 | 使用 `directories`；Linux/macOS/Windows 各有测试 |
| INV-011 | WASM 使用类型化绑定 | `wasm-bindgen`；禁止手写 `wasm_alloc/dealloc` 作为主接口 |
| INV-012 | 渲染失败必须可见 | `RenderOutput { degraded, diagnostics }`；UI 显示降级原因 |
| INV-013 | 预览必须完整可见 | 默认 fit-to-width；超宽可滚动；导航 fit-to-box |
| INV-014 | 危险操作必须可逆或需确认 | 删除公式/格式/片段有确认或 undo toast/回收站 |
| INV-015 | 文档由代码生成，不手写 | HELP/README 命令表、调色板、TS 类型均由 catalog 生成 |
| INV-016 | 任何阶段都必须可回退 | feature flag 或双跑；不得一次性删除旧路径直到 parity 通过 |

---

## 3. 已验证事实

> 以下事实在 2026-11-12 的代码快照上通过阅读、测试、clippy 或截图确认。
> 除特别说明外，路径相对于 `/home/mat/Projects/mathslot-next`。

| ID | 事实 | 证据 | 影响 |
|---|---|---|---|
| F-001 | 运行时主路径使用 `mathslot-core` 的 `editor/parser/ast/latex/visual`；`Session` 未被前端使用 | `src/app.rs`、`crates/mathslot-wasm/src/lib.rs`、`crates/mathslot-core/src/session.rs`、`crates/mathslot-core/tests/*` | 两套栈长期分叉；修一处不会修另一处 |
| F-002 | `mathslot-syntax/doc/latex` 是另一套完整栈，且更接近正确分层 | `crates/mathslot-core/Cargo.toml`、`crates/mathslot-core/src/lib.rs`、`crates/mathslot-syntax/`、`crates/mathslot-doc/`、`crates/mathslot-latex/` | 必须选一套，不能继续双跑 |
| F-003 | `cargo test --workspace` 通过 133 个测试 | 本地执行 | 可作为 characterization baseline |
| F-004 | `cargo clippy --workspace --all-targets -- -D warnings` 失败 | 本地执行；产品代码与 `golden_tests.rs` 均有 lint | 质量门禁未建立 |
| F-005 | CI 只有 `release.yml` | `.github/workflows/` | 测试/clippy/WASM/插件没有持续保障 |
| F-006 | 调色板 5 张卡片的 code 与语义不一致 | `src/app.rs:1496-1505`；`crates/mathslot-core/src/command.rs:1151-1200`、`:583-600` | 核心功能错误，P1 |
| F-007 | 文档与命令目录多处漂移 | `README.md:42-43`、`HELP.md:142-144/182-183/195` | 照文档输入会得到错误命令 |
| F-008 | `fitted_size` 完全不使用 `max_width/max_height` | `src/app.rs:2370-2385` | 预览/导航无法 fit-to-box |
| F-009 | 默认 `preview_scale = 1.25`，UI 显示 100% | `src/app.rs:142`、`:929-933` | 用户以为 100%，实际放大 1.25 倍 |
| F-010 | 长公式预览用 `vertical_centered + fit_to_exact_size`，两端被裁切 | `src/app.rs:944-966`；截图 `02-long-formula-clipped.png` | 看不到公式全貌 |
| F-011 | 导航模式图像区固定 52px，3×3 矩阵溢出 | `src/app.rs:997`、`:1104`；截图 `03-matrix-nav-overflow.png` | 导航图压住徽章/边框 |
| F-012 | `TextEdit::singleline` 配 wrapping layouter，长输入显示为多行 | `src/app.rs:1196-1201`；截图 `02` | 语义与显示不一致 |
| F-013 | `to_latex` 对 `PendingCmd`/`UnknownCmd` 返回空串 | `crates/mathslot-core/src/latex.rs:19` | 复制/导出静默丢节点 |
| F-014 | 复制只检查结果是否为空；空结果提示“无内容可复制” | `src/app.rs:158-179` | 输入非空但复制为空/残缺 |
| F-015 | 直接调用验证：`▸f` → `\frac{}{}`，`▸m` → 空，`▸z` → 空，`▸zz` → `z` | `parser::parse_with_library` + `latex::to_latex` | `▸zz` 会变成看似正常的 `z`，尤其危险 |
| F-016 | 配置读取损坏时尝试 `.bak`，失败则 `default_seeded()`；IO 错误直接默认 | `src/modals.rs:1556-1585` | 用户可能在默认库上继续编辑并覆盖主文件 |
| F-017 | 保存前把旧主文件复制到 `.bak`；无 fsync；多处 `let _ =` 吞错 | `src/modals.rs:1587-1606`、`src/app.rs:195`、`src/modals.rs:211/276/289/408/578` | 备份可能被损坏主文件覆盖；保存失败不可见 |
| F-018 | 用户公式 ID 为 `user-<秒级时间戳>`；`upsert` 遇到同 ID 直接替换 | `crates/mathslot-core/src/library.rs:262-275` | 同秒创建会静默覆盖 |
| F-019 | 手写 JSON parser 忽略尾随垃圾；`t...`/`n...` 前缀被宽松接受；`schema_version` 读取后丢弃 | `crates/mathslot-core/src/library.rs:1025-1036`、`:1077-1089`、`:759` | 损坏配置可能“部分成功” |
| F-020 | 88 条内置预置被写入每个用户的 `library.json`；新预置不会自动合并 | `crates/mathslot-core/src/library.rs:224-247`、`:331+`、`:287-292` | 配置臃肿；升级不可见；`restore_defaults` 会丢导入的 `is_builtin` 条目 |
| F-021 | 撤销文本快照只看距上次输入的 450ms 和字符差；卡片点击不重置计时器 | `src/app.rs:1227-1231`；`crates/mathslot-core/src/editor.rs:1172-1205` | 卡片插入可和后续输入合并成一次撤销 |
| F-022 | LaTeX 导入是启发式字符串扫描；“校验反推”只是再 parse/to_latex 并截断显示 | `src/modals.rs:134`、`:752-770`、`:780-798`；`crates/mathslot-core/src/latex.rs:854` | 丢结构也可能被插入 |
| F-023 | 渲染失败自动走 fallback；调用方不知道发生过降级 | `src/render.rs:152-167`；`crates/mathslot-core/src/visual.rs:474-490` | 预览可能不是用户 LaTeX 的真实效果 |
| F-024 | 渲染错误字符串包含完整 LaTeX 源且未截断 | `src/render.rs:175`、`src/app.rs:914-921` | 错误横幅挤占 UI/泄露内容 |
| F-025 | 渲染无 debounce、无内容哈希缓存、开始后不可取消；每 job 同时渲染 preview + nav | `src/render.rs:56-90`、`src/app.rs:671-683` | 复杂公式输入时预览落后 |
| F-026 | parser 深度上限 256，超限返回 `UnknownCmd { code: "?" }`；导航标签上限 24×24=576 | `crates/mathslot-core/src/parser.rs:293`、`:626-658`、`:51-75`、`:195` | 极端输入静默降级为 `?`/`z123` |
| F-027 | WASM 手写 `wasm_alloc/dealloc`，28 个 C export；无版本握手 | `crates/mathslot-wasm/src/lib.rs:55-72`、`:74+` | ABI 脆弱；签名变化可让 JS 崩溃 |
| F-028 | Obsidian 只提供 5 条示例预设循环；无 LaTeX 导入；无 88 条公式库浏览 | `crates/mathslot-wasm/src/lib.rs:14-20`、`obsidian-mathslot/src/plugin.js:399-408` | 与桌面端不是同一功能集 |
| F-029 | Obsidian 样式大量硬编码深色；`libraryJson` 损坏直接删除重置 | `obsidian-mathslot/styles.css:1-30`、`src/plugin.js:1645-1670` | 浅色主题割裂；损坏库无恢复 |
| F-030 | macOS 配置路径 README 写 `Application Support`，代码实际用 `$XDG_CONFIG_HOME` 或 `~/.config` | `README.md:181`、`src/modals.rs:1531-1554` | 平台声明错误 |
| F-031 | 焦点每帧强制回输入框，且 `lock_focus(true)`；`Ctrl/Cmd+Shift+C`、`+Shift+S` 被占用 | `src/app.rs:1834-1840`、`:1201`、`:421-437`；`plugin.js:649-660` | 键盘可达性差；与常见习惯冲突 |
| F-032 | 删除公式/格式/片段没有确认或 undo | `src/modals.rs:541-579`、`:1046-1083`、`:1310-1343` | 误点即永久删除 |
| F-033 | 桌面端 UI 六文件共 4922 行；`app.rs` 2520、`modals.rs` 1607 | `wc -l` | UI/领域/持久化耦合 |
| F-034 | 桌面端 release 约 14 MB；WASM 约 602 KB；`main.js` 约 856 KB | 文件大小 | 体积基线 |

---

## 4. 缺陷登记

> 缺陷 ID 是稳定的。修复提交必须在 commit message 或 PR 描述中引用 `D-*` 与 `T-*`。
> 验收一律以“可自动执行的测试”或“可复现的脚本/截图”为准，不以“看起来好了”为准。

### 4.1 P1（阻塞）

| ID | 缺陷 | 必须达到的结果 | 验收 |
|---|---|---|---|
| D-001 | 调色板 5 张卡片 code 错误 | 卡片显示、glyph、插入 code、LaTeX 四者一致 | 单测遍历每个 tile：parse(code) → latex 与期望 glyph/命令匹配 |
| D-002 | README/HELP 命令漂移 | 文档由 catalog 生成；`▸ch/ci/cj/op/oq/qm` 等不再手写 | CI 生成后 `git diff --exit-code`；文档中每个 `▸xx` 可 parse |
| D-003 | 长公式预览两端裁切 | 默认 fit-to-width；超宽左对齐/可滚动；显示缩放真实值 | 截图回归：长公式首尾可见；`fit` 单测覆盖 max_w/max_h |
| D-004 | Pending/Unknown 节点复制时消失 | 导出返回 `Result<(String, Vec<Diagnostic>)>`；Error 时阻止或显式占位 | 单测：`▸m` 不得产生空串；`▸zz` 不得静默变成 `z` |
| D-005 | 配置读取/保存的数据安全 | 损坏隔离；保存失败冒泡；多代备份；原子写 + fsync | 故障注入：损坏 JSON、只读目录、磁盘满、kill -9 |
| D-006 | 用户公式 ID 秒级碰撞 | UUIDv7/ULID；批量创建不覆盖 | 同毫秒创建 1000 条，ID 唯一、条目数正确 |
| D-007 | LaTeX 导入启发式丢结构 | 使用 `convert_latex_with_report`；展示诊断/diff；Error 阻断 | round-trip 测试 + 不支持构造的 ImportReport 快照 |

### 4.2 P2（紧随 P1）

| ID | 缺陷 | 必须达到的结果 | 验收 |
|---|---|---|---|
| D-008 | 导航图溢出固定高度 | fit-to-box；导航图与徽章分区 | 3×3/4×4 矩阵截图无重叠 |
| D-009 | singleline 视觉换行 | 真多行 CodeMirror 或单行不换行+水平滚动 | 长输入不出现“视觉 3 行、语义单行” |
| D-010 | 渲染错误横幅过长 | 短错误码+摘要；详情折叠；源码截断 | 长 LaTeX 错误不挤占缩放按钮 |
| D-011 | 渲染降级静默 | `degraded + diagnostics`；UI 徽章 | 自定义宏降级时可见 |
| D-012 | 撤销跨操作合并 | 按 Intent 分组；卡片/粘贴/导入/删除独立 | 卡片后立即输入，Ctrl+Z 只撤销输入或只撤销卡片 |
| D-013 | 手写 JSON 宽松/schema 未用 | serde + 版本化结构 + 显式迁移 | 尾随垃圾、`tru`、未知版本均报错/迁移 |
| D-014 | 内置预置落盘/不合并 | 配置只存用户数据；内置按稳定 ID 合并 | 老配置升级后看到新预置；配置文件无内置条目 |
| D-015 | 焦点/快捷键/键盘可达性 | 默认聚焦但 Tab 可离开；快捷键可配置 | 键盘-only 走查；无每帧强制 focus |
| D-016 | 删除无确认/撤销 | 确认或 5–10 秒 undo；软删除/回收站 | 误删可恢复 |
| D-017 | Obsidian 功能/主题/数据缺口 | 共享 catalog/UI；CSS 变量；损坏备份 | 浅色主题截图；损坏库可恢复；功能清单对齐 |
| D-018 | 两套 parser/AST/LaTeX 栈 | 选一套；冻结/删除另一套；前端统一走 app-core | 代码搜索只有一个运行时入口 |
| D-019 | 渲染无缓存/取消 | debounce + hash cache + generation cancel | 连续输入 p95 延迟达标；旧请求不覆盖新结果 |
| D-020 | 深度/标签硬上限静默降级 | 超限返回 Diagnostic；导航改可滚动树 | 深层输入给出明确错误，不出现 `?`/`z123` |
| D-021 | WASM 手写 ABI/体积 | wasm-bindgen + 版本握手 + `wasm-opt -Oz` | 类型化 API；版本不匹配有提示；体积预算 |
| D-022 | 平台/文档声明不准确 | `directories` 路径 + 生成文档 + 真实性能数据 | 三平台路径测试；README 不再手写命令表 |
| D-023 | CI 不跑测试/clippy 不绿 | fmt/clippy/test/WASM/plugin build + 三平台矩阵 | CI 全绿才可合并 |

### 4.3 P3（可排期但不阻塞）

| ID | 问题 | 处理 |
|---|---|---|
| D-024 | 括号自动配对不识别 `\left (` 等带空格形式 | 改用解析上下文；补测试 |
| D-025 | 选区包裹后光标在右括号后 | 默认停在括号内或提供设置 |
| D-026 | 自绘控件无 a11y 语义 | 可聚焦、可读标签、对比度审计 |
| D-027 | `.bak` 只有一代、无 fsync | 3–5 代时间戳备份 + 目录 fsync |
| D-028 | 中文硬编码、无 i18n | Fluent/JSON 资源；先抽字符串 |
| D-029 | 状态消息互相覆盖 | 消息队列/持久错误条 |
| D-030 | 无诊断导出 | “复制诊断信息”按钮：版本/OS/路径/最近错误 |

---

## 5. 目标架构

### 5.1 架构图

```text
┌─────────────────────────────┐      ┌─────────────────────────────┐
│ apps/desktop (Tauri 2)      │      │ apps/obsidian (TS)          │
│ Svelte 5 + CodeMirror 6     │      │ Svelte 5 + CodeMirror 6     │
│ MathJax 3 SVG               │      │ MathJax 3 SVG               │
└──────────────┬──────────────┘      └──────────────┬──────────────┘
               │                                    │
               └────────────────┬───────────────────┘
                                ▼
                 ┌──────────────────────────────┐
                 │ packages/ui (shared Svelte)  │
                 │ editor / palette / preview   │
                 │ nav / diagnostics / settings │
                 └──────────────┬───────────────┘
                                ▼
                 ┌──────────────────────────────┐
                 │ mathslot-app (Rust)          │
                 │ Event → Command → Effect     │
                 │ 无 UI / 无 IO / 可测试        │
                 └──────────────┬───────────────┘
        ┌───────────────┬───────┴────────┬────────────────┐
        ▼               ▼                ▼                ▼
 mathslot-doc    mathslot-syntax   mathslot-command   mathslot-render
 transactions    lexer/parser/     catalog + docs     backend trait
 undo/slots      AST/diagnostics   generated data     cache/cancel
        │               │                │                │
        └───────────────┴────────┬───────┴────────────────┘
                                 ▼
                    mathslot-latex / mathslot-store
                    import-export  / schema/atomic-write
```

### 5.2 模块边界

| 模块 | 职责 | 允许依赖 | 禁止 |
|---|---|---|---|
| `mathslot-command` | 命令目录、键序列、标签、槽位、LaTeX 模板、文档、示例 | 无（纯数据） | 解析、渲染、IO、UI |
| `mathslot-syntax` | lexer、parser、AST、span、diagnostics | `mathslot-command` | UI、文件、库、渲染 |
| `mathslot-doc` | Document、SlotTable、Selection、Transaction、Undo/Redo | `mathslot-syntax` | UI、文件、网络 |
| `mathslot-latex` | LaTeX → AST、AST → LaTeX、ImportReport、round-trip | `mathslot-syntax` | 字符串启发式替换、UI |
| `mathslot-app` | 事件循环、状态机、命令分发、Effect、导航/撤销策略 | 上述全部 + `render/store` 的 trait | egui、DOM、Obsidian、直接 IO |
| `mathslot-render` | `MathRenderer` trait、缓存、取消、降级、主题/DPI | `mathslot-syntax`（只读类型） | 决定布局 |
| `mathslot-store` | 路径、schema、迁移、原子写、备份、锁 | 领域类型 | 业务规则 |
| `mathslot-wasm` | wasm-bindgen 类型化 API、版本握手 | `mathslot-app` | 手写 alloc/dealloc 主接口 |
| `apps/desktop` | Tauri 壳、菜单、文件对话框、设置、更新 | `packages/ui`、`mathslot-app` | 编辑语义 |
| `apps/obsidian` | Obsidian 壳、Modal/View、设置、编辑器适配 | `packages/ui`、`mathslot-wasm` | 编辑语义 |
| `packages/ui` | Svelte 组件、CM6 扩展、CSS 变量 | 生成类型、WASM API | 直接文件/网络 |

### 5.3 依赖规则

- MUST 保持单向依赖；禁止循环依赖。
- MUST 让 `mathslot-app` 可在无 UI、无文件系统、无渲染器的环境下跑测试。
- MUST 让桌面端与 Obsidian 调用同一个 `mathslot-app` 状态机。
- MUST 让 `packages/ui` 只依赖 `EngineClient` 抽象：桌面端用 Tauri `invoke`，Obsidian 用 `wasm-bindgen`，UI 不直接依赖其中一种传输。
- MUST 让所有命令元数据从 `mathslot-command` 流向 UI/文档/测试。
- MUST NOT 在 `apps/*` 或 `packages/ui` 里复制命令表、解析规则或 LaTeX 模板。
- MUST NOT 让 DOM/egui 类型进入 `mathslot-app` 的公开 API。

### 5.4 目标目录

```text
mathslot-next/
├── Cargo.toml
├── catalog/
│   ├── commands.toml          # 唯一命令事实源
│   └── presets.json           # 88 条内置公式（稳定 ID）
├── crates/
│   ├── mathslot-command/
│   ├── mathslot-syntax/       # 现有，保留并成为唯一 parser
│   ├── mathslot-doc/          # 现有，保留并成为唯一 transaction/undo
│   ├── mathslot-latex/        # 现有，保留并成为唯一 LaTeX 映射
│   ├── mathslot-app/          # 新增：状态机 + Effects
│   ├── mathslot-render/       # 新增：渲染抽象/缓存/取消
│   ├── mathslot-store/        # 新增：持久化/迁移/备份
│   └── mathslot-wasm/         # 现有，改为 wasm-bindgen
├── apps/
│   ├── desktop/               # Tauri 2 + Svelte
│   └── obsidian/              # Obsidian plugin + Svelte
├── packages/
│   ├── ui/                    # shared Svelte components
│   └── core-wasm/             # generated wasm-bindgen package + TS types
├── docs/
│   ├── commands.md            # generated
│   └── architecture.md
└── xtask/                     # catalog/docs/type generation
```

---

## 6. 数据契约

### 6.1 核心类型

```rust
/// 字节偏移；只在 WASM/JS 边界做 UTF-16 转换。
pub struct Span { pub start: u32, pub end: u32 }

pub enum Severity { Error, Warning, Info }

pub struct Diagnostic {
    pub severity: Severity,
    pub code: &'static str,
    pub span: Span,
    pub message: String,
    pub hint: Option<String>,
}

pub struct CommandSpec {
    pub id: CommandId,             // 稳定 ID，例如 "frac"
    /// 有序键序列：["f"] 或 ["o", "c"]；每个命令只能有一条。
    pub keys: &'static [&'static str],
    pub label: &'static str,
    pub category: Category,
    pub glyph: &'static str,
    pub slots: &'static [SlotRole],
    pub latex: LatexTemplate,      // "\\frac{$1}{$2}"
    pub doc: &'static str,
    pub examples: &'static [&'static str],
    pub since: Version,            // 命令语言版本
}

pub struct Document {
    pub source: String,
    pub ast: Ast,
    pub slots: SlotTable,
    pub diagnostics: Vec<Diagnostic>,
}

pub struct Transaction {
    pub edits: Vec<Edit>,
    pub selection_before: Selection,
    pub selection_after: Selection,
    pub intent: Intent,            // Typing | Command | Paste | Delete | Import | Clear
}

pub enum Effect {
    Render(RenderRequest),
    Persist(SaveRequest),
    Clipboard(String),
    Status(StatusMessage),
    Focus(FocusTarget),
}
```

### 6.2 单位与边界

- `Span` 使用**字节偏移**；Rust 内部不混用 char index。
- 只在 `mathslot-wasm` 暴露给 JS 时转换为 UTF-16 code unit。
- 任何跨层传递的 `Span` 必须能映射回原始 source；禁止丢失原文本。
- 诊断必须带 span；无法定位时使用整行 span，并在 message 说明。

### 6.3 ID 策略

| 对象 | ID 规则 |
|---|---|
| 命令 | 稳定 slug：`frac`、`sqrt`、`partial`；一旦发布不可改 |
| 内置公式 | `preset-<slug>`，稳定；禁止用序号作为长期 ID |
| 用户公式 | UUIDv7（时间有序） |
| 自定义格式 | `k<key>`，key 唯一；删除后不复用，除非用户显式覆盖 |
| 片段 | `t<key>`，同上 |
| 渲染请求 | `RenderId`，单调递增或 UUID |
| 迁移 | `schema_version` 整数；每次不兼容变更 +1 |

### 6.4 错误与诊断策略

- MUST 使用 `Result<T, E>` 表达可恢复失败；禁止 `let _ =` 忽略持久化/渲染/IO 错误。
- MUST 把用户可见错误转成 `Diagnostic`，包含 code/span/message/hint。
- MUST 区分：
  - `Error`：阻止导出/插入/保存，或要求显式确认；
  - `Warning`：允许继续，但 UI 必须可见；
  - `Info`：提示，不阻塞。
- MUST NOT 用空字符串表示“节点无效”；无效节点必须保留 AST 节点并附诊断。
- MUST NOT 在错误消息里拼接完整源码超过 200 字符；详情放折叠区。

### 6.5 版本

| 版本 | 作用 |
|---|---|
| `command_version` | 命令语言/键位语义；不兼容变更 +1 |
| `schema_version` | `library.json` 结构；迁移显式 match |
| `engine_version` | WASM/前端握手；不匹配提示升级 |
| `catalog_hash` | 生成产物与运行时 catalog 一致性校验 |

---

## 7. 编辑语义

### 7.1 显式状态机

禁止继续用“source 形状 + 光标位置 + diff”猜模式。状态必须显式：

```rust
pub enum EditorState {
    Idle,
    PrefixRoot,                 // 已输入 ▸
    PrefixSub { key: char },    // 已输入 ▸c
    Jump { tail: String },      // 已输入 ▸j...
    Nav { path: Vec<NavStep> },
    InvalidPrefix { key: char },
}
```

状态迁移表：

| 当前 | 事件 | 下一状态 | 文本变更 | Undo |
|---|---|---|---|---|
| Idle | 输入 `▸` | PrefixRoot | 插入 `▸` | 合并到当前 Typing |
| PrefixRoot | 字母 `f` | Idle | 用 catalog 插入结构 | Intent::Command |
| PrefixRoot | 字母 `m` | PrefixSub | 插入 `▸m` | 合并到 Command |
| PrefixSub | 字母 `b` | Idle | 插入 `▸mb` 对应结构 | Intent::Command |
| PrefixSub | `Esc` | Idle | 删除 `▸m` | Intent::Command |
| Idle | `Tab` | PrefixRoot | 插入 `▸` | Intent::Command |
| Idle | `Tab j` | Jump | 插入 `▸j` | Intent::Command |
| Jump | 字母 | Jump/Nav | 修改 `▸j...` | Intent::Command |
| Nav | 字母/方向 | Nav | 不改文本 | 不改 undo |
| Nav | `Esc`/`Tab` | Idle | 不改文本 | 不改 undo |
| 任意 | 粘贴含 `▸` | 按纯文本处理 | 不解释为命令 | Intent::Paste |

规则：

- MUST 让 `▸`、`▸f`、`▸m` 都是合法可编辑状态；parser 对未完成输入返回 `Pending`/空槽，不 panic。
- MUST 让卡片点击走 `Intent::Command`，一次点击一个 transaction；禁止和后续输入合并。
- MUST 让粘贴永远是纯文本；不得把粘贴内容当命令执行。
- MUST 让导航只移动光标/视图，不修改文本、不产生 undo。
- MUST 在 IME composition 期间不拦截按键、不重写文本。

### 7.2 撤销

| 操作 | Intent | 合并规则 |
|---|---|---|
| 连续输入字符 | `Typing` | 同一输入串可合并；遇到空格/命令/粘贴/导航断开 |
| 点击卡片/命令 | `Command` | 单独一步，永不合并不后续 Typing |
| 粘贴 | `Paste` | 单独一步 |
| 删除选区/退格 | `Delete` | 连续退格可合并，跨单词/行断开 |
| 导入/替换 | `Import` | 单独一步；可一次撤销 |
| 清空 | `Clear` | 单独一步 |
| 导航 | `Nav` | 不改 undo |

实现建议：

- `History` 存逆操作（`Vec<Edit>`），不存整段源码快照；公式很小的情况下可先存 `String`，但 API 必须允许换成 rope。
- 每个 `Transaction` 记录 `selection_before/after`；undo 必须恢复选区。
- MUST 提供确定性测试：给定 source/selection/intent 序列，断言 undo/redo 深度与最终文本。

### 7.3 智能包裹

- MUST 改为**显式建议**：检测到前置原子时，显示 ghost 预览；用户按 `Tab`/`Enter` 接受后才改源码。
- MUST NOT 在粘贴、删除、快速输入时自动改写用户文本。
- 选区包裹使用标准编辑原语；默认光标停在括号内，或由设置决定。
- 括号配对必须识别解析上下文，而不是只看相邻字符；至少覆盖 `\left (`、`\bigl [` 等带空格形式（D-024）。

### 7.4 编辑验收

| ID | 场景 | 期望 |
|---|---|---|
| A-EDIT-001 | 输入 `▸f1;2;` | 得到 `\frac{1}{2}`，无诊断 |
| A-EDIT-002 | 输入 `▸m` 后复制 | 有 Pending 诊断；导出被阻止或显式占位，不返回空串 |
| A-EDIT-003 | 输入 `▸zz` | 不静默变成 `z`；显示 Invalid/Unknown 诊断 |
| A-EDIT-004 | 点击“偏导”卡片 | 插入 `\partial`，不是 `\to` |
| A-EDIT-005 | 点击卡片后立即输入 | Ctrl+Z 先撤销输入，再撤销卡片；不合并 |
| A-EDIT-006 | 粘贴含 `▸` 文本 | 原样插入，不执行命令 |
| A-EDIT-007 | 中文 IME 输入 | 组合期间不丢字、不跳光标 |
| A-EDIT-008 | 导航模式按字母 | 光标跳转；文本与 undo 不变 |

---

## 8. 命令目录（唯一事实源）

### 8.1 `catalog/commands.toml`

```toml
[[commands]]
id = "frac"
keys = ["f"]
label = "分数"
category = "structure"
glyph = "a/b"
slots = ["num", "den"]
latex = "\\frac{$1}{$2}"
doc = "插入分数，分子在前，分母在后。"
examples = ["▸f1;2;"]

[[commands]]
id = "partial"
keys = ["o", "c"]
label = "偏导"
category = "symbol"
glyph = "∂"
latex = "\\partial"
doc = "偏导算子。"
examples = ["▸oc"]
```

### 8.2 生成产物

构建时由 `xtask` 生成，禁止手改：

| 产物 | 消费者 |
|---|---|
| `crates/mathslot-command/src/generated.rs` | Rust 运行时 |
| `catalog/catalog.json` | WASM/TS/Obsidian |
| `docs/commands.md` | README/HELP 命令表 |
| `packages/ui/src/generated/catalog.ts` | Svelte UI |
| `schemas/commands.schema.json` | CI/编辑器校验 |

### 8.3 校验规则

CI 必须执行：

- 键序列唯一；同一前缀不冲突。
- 每个命令有 id/label/glyph/latex/doc/example。
- 调色板每个 tile 的 code 能解析到对应命令，且 glyph/LaTeX 一致。
- 文档中每个 `▸xx` 都能解析；每个命令至少出现一次。
- 生成文件与提交内容一致（`git diff --exit-code`）。
- 命令语言版本变更时，旧 code 仍可解析或提供迁移映射。

### 8.4 必须修复的映射

| 卡片 | 现在插入 | 正确命令 | 正确 LaTeX |
|---|---|---|---|
| 偏导 `∂` | `ob` | `oc` | `\partial` |
| 叉乘 `×` | `od` | `of` | `\times` |
| 点乘 `·` | `oe` | `og` | `\cdot` |
| 约等于 `≈` | `xa` | `xb` | `\approx` |
| 恒等于 `≡` | `xb` | `xa` | `\equiv` |

### 8.5 文档生成

- `README.md` / `HELP.md` 的命令表由 `docs/commands.md` 注入，使用标记块：

```markdown
<!-- BEGIN GENERATED: commands -->
...
<!-- END GENERATED: commands -->
```

- 禁止在标记块外手写命令清单。
- 文档中的快捷键从 catalog 的 `keys` 生成，不手写 `Tab o b`。

---

## 9. 渲染与导出

### 9.1 接口

```rust
pub trait MathRenderer {
    fn render(&self, req: &RenderRequest) -> Result<RenderOutput, RenderError>;
}

pub struct RenderRequest {
    pub id: RenderId,
    pub latex: String,
    pub theme: Theme,
    pub scale: f32,
    pub format: RenderFormat, // Svg | Png
}

pub struct RenderOutput {
    pub id: RenderId,
    pub output: RenderData,
    pub degraded: bool,
    pub diagnostics: Vec<Diagnostic>,
}
```

### 9.2 策略

- 桌面与 Obsidian 主渲染统一 **MathJax 3 SVG**；保证 WYSIWYG 一致、可选中、可访问。
- `latex-rust` 只作为可选原生后端/离线后备，不作为唯一预览。
- 失败返回 `degraded + diagnostics`；UI 显示“降级预览”徽章和原因（D-011）。
- 缓存 key：`hash(latex, theme, scale, backend, format)`。
- 请求带 `generation`；新请求取消旧请求（D-019）。
- 预览默认 fit-to-width；提供“实际大小”；超宽左对齐并可滚动（D-003）。
- 导航默认 fit-to-box；导航图与徽章分区（D-008）。
- 导出 SVG/PNG 文件；复制 LaTeX 时附带诊断检查（D-004）。

### 9.3 错误展示

- header 只显示短错误码 + 一行摘要（≤120 字符）。
- 完整错误、源码片段、诊断列表放折叠面板/弹窗。
- 源码显示截断到 200 字符，并标注“已截断”。

### 9.4 渲染验收

| ID | 场景 | 期望 |
|---|---|---|
| A-RENDER-001 | 长公式（>2 屏宽） | 默认完整可见；两端可滚动 |
| A-RENDER-002 | 3×3/4×4 矩阵导航 | 不溢出、不遮徽章 |
| A-RENDER-003 | 自定义宏不支持 | 显示降级徽章 + 原因 |
| A-RENDER-004 | 连续输入 100 字符 | 预览不落后超过预算；旧请求不覆盖新结果 |
| A-RENDER-005 | 渲染错误 | header 不挤占按钮；详情可复制 |

---

## 10. 持久化与数据安全

### 10.1 配置只存用户数据

```rust
#[derive(Serialize, Deserialize)]
pub struct LibraryFile {
    pub schema_version: u32,
    pub custom_formats: Vec<CustomFormat>,
    pub snippets: Vec<Snippet>,
    pub user_formulas: Vec<UserFormula>,
    pub overrides: Vec<PresetOverride>,
    pub settings: Settings,
}
```

- 88 条内置预置从 `catalog/presets.json` 编译期加载，按稳定 ID 合并。
- 用户修改内置条目时存 `PresetOverride`，不复制整条。
- 禁止导入 `is_builtin: true`；导入时规范化为 `false` 或拒绝。

### 10.2 路径

使用 `directories::ProjectDirs`：

| 平台 | 路径 |
|---|---|
| Linux | `$XDG_CONFIG_HOME/mathslot/library.json` 或 `~/.config/mathslot/library.json` |
| macOS | `~/Library/Application Support/mathslot/library.json` |
| Windows | `%APPDATA%\mathslot\library.json` |

### 10.3 原子写与恢复

保存顺序（MUST）：

1. 同目录 `tempfile`；
2. `write_all`；
3. `sync_all`；
4. 轮转备份（保留 3–5 代带时间戳）；
5. `persist` / `rename` 原子替换；
6. `fsync(dir)`（Unix）。

读取失败（MUST）：

1. 不覆盖主文件；
2. 把损坏文件重命名为 `library.corrupt-<timestamp>.json`；
3. 尝试最近可用备份；
4. 主界面显示恢复向导；
5. 只有用户确认后才写新文件。

### 10.4 并发

- 使用文件锁（`fs2`/`fd-lock`）。
- 多实例写冲突时，后写者必须重新读取并合并，或明确报错。
- 禁止最后写入者无提示覆盖。

### 10.5 迁移

- `schema_version` 显式 match；未知版本拒绝并提示。
- 旧 `user-<秒>` ID 迁移为 UUIDv7，保留映射表。
- 旧 `library.json` 先备份，再 dry-run 迁移，最后提交。
- 迁移测试覆盖：缺字段、未知字段、损坏 JSON、超大文件、只读目录。

### 10.6 数据安全验收

| ID | 场景 | 期望 |
|---|---|---|
| A-DATA-001 | 损坏 JSON | 隔离 + 恢复向导；主文件不被覆盖 |
| A-DATA-002 | 磁盘满 | 保存失败可见；旧文件不变 |
| A-DATA-003 | 只读目录 | 明确错误；不假装已保存 |
| A-DATA-004 | kill -9 写入中 | 重启后主文件或备份可用 |
| A-DATA-005 | 同秒创建 1000 公式 | 无覆盖、无丢失 |
| A-DATA-006 | 旧 schema 升级 | 数据完整；新预置出现 |

---

## 11. WASM 与 Obsidian

### 11.1 WASM API

```rust
#[wasm_bindgen]
pub struct Engine { /* ... */ }

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new(catalog_json: &str) -> Result<Engine, JsValue>;
    pub fn dispatch(&mut self, event_json: &str) -> Result<String, JsValue>;
    pub fn snapshot(&self) -> String;
    pub fn engine_version(&self) -> String;
}
```

- 使用 `serde-wasm-bindgen` 或 JSON；TS 类型由生成器产出。
- 版本握手：UI/core 不匹配时提示升级，不崩溃。
- `wasm-opt -Oz`；优先外部 `.wasm` + 懒加载；若 Obsidian 必须单文件，再内联压缩版。
- 体积预算：WASM ≤ 400 KB（gzip 前）为目标，超出需在 CI 报警。

### 11.2 Obsidian 功能对齐

| 能力 | 要求 |
|---|---|
| 命令目录 | 与桌面共享 catalog；禁止 5 条硬编码示例作为唯一入口 |
| 公式库 | 浏览/搜索 88 条内置 + 用户公式 |
| LaTeX 导入 | 有入口、诊断、diff、阻断 |
| 主题 | 使用 Obsidian CSS 变量；明暗跟随 |
| 数据 | `libraryJson` 损坏先备份/隔离，不删除 |
| 移动端 | 真机 E2E；剪贴板/键盘/性能 |
| 代码块 | 阅读视图渲染；不破坏原文 |

### 11.3 Obsidian 验收

| ID | 场景 | 期望 |
|---|---|---|
| A-OBS-001 | 浅色主题 | 弹窗颜色跟随，无硬编码深色 |
| A-OBS-002 | 损坏 libraryJson | 备份 + 提示；不重置 |
| A-OBS-003 | 移动端 | 可打开、可输入、可插入、可复制 |
| A-OBS-004 | 88 条预置 | 可搜索/载入 |
| A-OBS-005 | LaTeX 导入 | 有诊断；Error 阻断 |

---

## 12. UI 要求

### 12.1 布局

- 左/上：输入 + 调色板/命令搜索。
- 右/下：预览 + 结构化导航 + 诊断。
- 设置页：主题、快捷键、分隔符、渲染后端、配置路径、导入/导出。
- 状态栏只显示一条主状态；错误进入持久诊断区，不被成功消息覆盖。

### 12.2 焦点与快捷键

- 默认聚焦输入；`Tab` 必须能离开输入框到调色板/其他控件。
- 提供“回到输入框”的显式快捷键（可配置）。
- 禁止每帧 `request_focus`；只在状态切换/用户动作时聚焦。
- `Ctrl/Cmd+Shift+C`、`+Shift+S` 不得作为不可配置的唯一入口；提供标准复制/保存习惯的替代。
- 所有快捷键从配置读取；冲突时提示。

### 12.3 可访问性

- 所有交互控件可 Tab 聚焦、可 Enter/Space 激活、有可读标签。
- 颜色对比满足 WCAG AA；不仅靠颜色表达状态（错误/活动槽位要有图标/文本）。
- 屏幕阅读器能读出诊断、槽位名、当前模式。
- 提供键盘-only 走查清单和 axe/Playwright 检查。

### 12.4 主题

- 桌面：明/暗/跟随系统。
- Obsidian：使用宿主 CSS 变量。
- 预览与导航的背景、前景、活动槽位颜色必须由主题 token 提供，禁止散落硬编码。

### 12.5 UI 验收

| ID | 场景 | 期望 |
|---|---|---|
| A-UI-001 | 仅键盘 | 打开、输入、导航、复制、导入、删除确认均可完成 |
| A-UI-002 | 长公式 | 预览完整；输入不出现视觉多行/语义单行 |
| A-UI-003 | 3×3 矩阵 | 导航不溢出 |
| A-UI-004 | 浅色主题 | 无深色硬编码块 |
| A-UI-005 | 错误状态 | 错误可见、可定位、可复制、可恢复 |

---

## 13. 测试与 CI

### 13.1 本地命令

```bash
cd /home/mat/Projects/mathslot-next

cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build -p mathslot-wasm --target wasm32-unknown-unknown --release
node obsidian-mathslot/scripts/build.mjs
```

前端（迁移后）：

```bash
npm ci
npm run build
npm run test
npm run e2e
```

### 13.2 测试矩阵

| 层 | 类型 | 必须覆盖 |
|---|---|---|
| `mathslot-command` | 单测/快照 | 键唯一、字段完整、调色板映射、文档 code 可解析 |
| `mathslot-syntax` | 单测/快照/proptest | 不完整输入、深度上限、诊断 span、随机命令序列不 panic |
| `mathslot-doc` | 单测/proptest | transaction、undo/redo 恒等、选区恢复、slot 导航 |
| `mathslot-latex` | 单测/快照/proptest | 支持的 LaTeX 子集 round-trip 等价、ImportReport |
| `mathslot-app` | 单测/状态机 | 8 个 A-EDIT 场景、Effect 顺序、无 UI 依赖 |
| `mathslot-render` | 单测/截图 | fit、缓存、取消、降级、错误截断 |
| `mathslot-store` | 故障注入 | 损坏、磁盘满、只读、kill -9、并发 |
| `mathslot-wasm` | 集成 | 版本握手、dispatch/snapshot、体积预算 |
| UI | Playwright | 桌面/Obsidian 核心流程、截图回归、移动端视口、axe |

### 13.3 截图回归清单

| ID | 场景 | 断言 |
|---|---|---|
| S-001 | 调色板 + 短公式 | 5 张错误卡片修复后的 glyph/命令 |
| S-002 | 长公式 | 首尾可见；无两端裁切 |
| S-003 | 3×3 矩阵导航 | 导航图不溢出 |
| S-004 | 嵌套根号/分数 | 槽位高亮正确 |
| S-005 | 错误/Pending 状态 | 徽章、诊断、复制阻断可见 |
| S-006 | 浅色/深色主题 | 无硬编码颜色块 |
| S-007 | 3 行输入 | 多行语义与视觉一致 |

### 13.4 CI 门禁

```yaml
# 伪代码
strategy:
  matrix:
    os: [ubuntu, windows, macos]
steps:
  - cargo fmt --check
  - cargo clippy --workspace --all-targets -- -D warnings
  - cargo test --workspace
  - cargo build -p mathslot-wasm --target wasm32-unknown-unknown --release
  - wasm-opt -Oz ...
  - npm ci && npm run build
  - npm run test
  - npm run e2e
```

规则：

- MUST 让 CI 在 PR/push 上运行，而不是只在 tag。
- MUST 让 release workflow 依赖 CI 通过。
- MUST 把 clippy 债务分批清零；不允许用 `#[allow]` 掩盖产品代码问题。
- MUST 对生成文件做 `git diff --exit-code`。
- MUST 对截图回归保存基线，失败时输出 diff 图。

### 13.5 性能预算

| 指标 | 预算（待基准校准） |
|---|---|
| 典型公式 parse | < 5 ms |
| 预览 p95 | < 100 ms |
| 连续输入预览延迟 | < 100 ms |
| 启动 | 有基准，不回归 > 10% |
| 内存 | 有基准，不回归 > 10% |
| WASM | ≤ 400 KB（gzip 前）目标 |

预算不是装饰：每次性能相关 PR 必须跑 benchmark 并记录。

---

## 14. 任务 DAG（无时间线）

> 只按依赖执行。一个 Gate 的退出条件全部满足后，才能进入下一个 Gate。
> `parallel: yes` 的任务可以同批进行；其余按 `depends_on` 串行。

### Gate G0：基线与护栏

| ID | 任务 | depends_on | 产出 | 退出条件 |
|---|---|---|---|---|
| T0.1 | 增加 CI：fmt/clippy/test/WASM/plugin build | — | `.github/workflows/ci.yml` | PR 上自动运行 |
| T0.2 | 清 clippy 或建立显式 test-only 例外清单 | T0.1 | 绿色 clippy | `-D warnings` 通过或例外有注释/期限 |
| T0.3 | 为 P1 写失败回归测试（D-001..D-007） | T0.1 | 测试文件 | 修复前失败、修复后通过 |
| T0.4 | 冻结命令语言与发布基线 | T0.1 | tag/baseline | 迁移期间不改命令语义 |
| T0.5 | 建立故障注入 harness（磁盘满/只读/损坏/并发） | T0.1 | 测试工具 | 可在 CI 本地复现 |

**G0 退出**：CI 绿；P1 测试存在；clippy 债务可控；基线 tag 建立。

### Gate G1：单一事实源

| ID | 任务 | depends_on | 产出 | 退出条件 |
|---|---|---|---|---|
| T1.1 | 定义 `catalog/commands.toml` schema + loader | G0 | catalog crate | 能加载全部命令 |
| T1.2 | 生成调色板/文档/TS 类型 | T1.1 | xtask + generated | 生成文件可重复、无 diff |
| T1.3 | 用 catalog 修 D-001/D-002 | T1.2 | 调色板/文档 | 5 张卡片正确；文档 code 全可解析 |
| T1.4 | 选定唯一 parser/AST 栈（建议 `mathslot-syntax/doc/latex`） | T1.1 | 决策记录 | 另一套标记 frozen |
| T1.5 | 把 StreamEditor 流式语义移植到选定栈 | T1.4 | 新 editor API | 8 个 A-EDIT 场景通过 |
| T1.6 | 诊断贯通：parse → app → UI | T1.5 | Diagnostic pipeline | Pending/Unknown 可见、可导出 |
| T1.7 | 旧/新双跑 parity harness | T1.5 | 对比测试 | 核心输入/导航/复制一致 |

**G1 退出**：运行时只有一个 parser/AST；调色板/文档由 catalog 生成；诊断贯通；旧栈冻结。

### Gate G2：app-core 与数据层

| ID | 任务 | depends_on | 产出 | 退出条件 |
|---|---|---|---|---|
| T2.1 | 实现 `mathslot-app` 状态机 | G1 | Event→Command→Effect | 无 UI/IO 依赖；A-EDIT 全过 |
| T2.2 | Transaction/Undo 按 Intent 分组 | T2.1 | History | 卡片/输入/粘贴/导入独立 |
| T2.3 | 实现 `mathslot-store`（原子写/备份/锁/迁移） | G1 | store crate | A-DATA-001..006 |
| T2.4 | 实现 `mathslot-render`（缓存/取消/降级/fit） | G1 | render crate | A-RENDER-001..005 |
| T2.5 | headless parity：旧实现 vs app-core | T2.1-T2.4 | 对比报告 | 核心路径 100% 一致或有意差异有记录 |

**G2 退出**：app-core 可独立测试；数据/渲染契约通过；旧实现只作为对照。

### Gate G3：UI 与双端

| ID | 任务 | depends_on | 产出 | 退出条件 |
|---|---|---|---|---|
| T3.1 | CodeMirror 6 编辑器 + 命令装饰/槽位 | G2 | `packages/ui` editor | A-EDIT-006/007/008 |
| T3.2 | 调色板/搜索/导航树 | T3.1 | UI 组件 | catalog 驱动；键盘可达 |
| T3.3 | 预览/诊断/错误折叠 | T3.1 | UI 组件 | A-RENDER-005；错误可复制 |
| T3.4 | 设置/主题/快捷键 | T3.1 | 设置页 | 明暗主题、快捷键可配置 |
| T3.5 | Tauri 桌面壳 | T3.1-T3.4 | `apps/desktop` | 桌面 E2E 通过 |
| T3.6 | Obsidian 壳 + 共享 UI | T3.1-T3.4 | `apps/obsidian` | A-OBS-001..005 |
| T3.7 | 双端功能清单对齐 | T3.5/T3.6 | parity 清单 | 差异为 0 或有记录 |

**G3 退出**：桌面与 Obsidian 共享 app-core/UI；核心流程 E2E 通过；无 singleline 伪多行。

### Gate G4：硬化与发布

| ID | 任务 | depends_on | 产出 | 退出条件 |
|---|---|---|---|---|
| T4.1 | LaTeX 导入诊断/diff/round-trip | G3 | import flow | D-007 验收 |
| T4.2 | 数据故障注入全量 | G3 | 测试报告 | A-DATA 全过 |
| T4.3 | 性能基准与预算 | G3 | benchmark | 13.5 达标 |
| T4.4 | 无障碍审计 | G3 | axe/键盘报告 | A-UI-001 |
| T4.5 | 生成文档/README/HELP | G3 | docs | 生成块无手写 |
| T4.6 | 发布流水线 | T4.1-T4.5 | release | CI 绿；三平台包可用 |

**G4 退出**：P1/P2 清零；验收全过；文档/架构一致；发布可回滚。

### 14.1 机器可读门禁索引

```yaml
gates:
  - id: G0
    name: baseline-and-guardrails
    tasks: [T0.1, T0.2, T0.3, T0.4, T0.5]
    exit: [ci_green, p1_tests_exist, clippy_controlled, baseline_tagged]
  - id: G1
    name: single-source-of-truth
    tasks: [T1.1, T1.2, T1.3, T1.4, T1.5, T1.6, T1.7]
    exit: [one_parser, generated_artifacts_clean, diagnostics_wired]
  - id: G2
    name: app-core-and-data
    tasks: [T2.1, T2.2, T2.3, T2.4, T2.5]
    exit: [headless_tests, data_acceptance, render_acceptance]
  - id: G3
    name: ui-and-clients
    tasks: [T3.1, T3.2, T3.3, T3.4, T3.5, T3.6, T3.7]
    exit: [desktop_e2e, obsidian_e2e, feature_parity]
  - id: G4
    name: hardening-and-release
    tasks: [T4.1, T4.2, T4.3, T4.4, T4.5, T4.6]
    exit: [p1_p2_closed, acceptance_green, release_ready]
```

---

## 15. 代理工作协议

### 15.1 开始前

MUST 执行：

1. 确认当前工作目录是 `/home/mat/Projects/mathslot-next`。
2. 读取本文件 §2、§4、§14。
3. 选择 `depends_on` 已完成的最高优先级任务。
4. 运行基线：

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

5. 在回复/提交中写明：`Task: T-*`、`Defect: D-*`、`Expected: ...`。

### 15.2 编辑规则

- MUST 先写失败测试，再改实现。
- MUST 保持改动最小；禁止顺手重构无关文件。
- MUST 使用现有模块边界；禁止把 UI/IO 逻辑塞进 `mathslot-app`。
- MUST 使用 `Result` 和 `Diagnostic`；禁止 `let _ =` 持久化/渲染错误。
- MUST 从 catalog 取命令；禁止硬编码第二份命令表。
- MUST 更新生成文件用 `xtask`，禁止手改 `generated.rs`/`catalog.json`/`commands.md`。
- MUST 在改变命令语义时提升 `command_version` 并提供迁移/兼容解析。
- MUST 在改变 `library.json` 结构时提升 `schema_version` 并提供迁移。

### 15.3 禁止动作

| 禁止 | 原因 |
|---|---|
| 删除/跳过测试让 CI 绿 | 掩盖回归 |
| 新增第二套 parser/AST/命令表 | 直接违反 INV-001/006 |
| 用 `unwrap()` 处理用户输入/文件/网络 | 崩溃或静默失败 |
| 用空字符串表示无效节点 | 静默丢数据 |
| 用 `#[allow(clippy::...)]` 覆盖产品代码 | 债务不可见 |
| 每帧 `request_focus` | 键盘不可达 |
| 在 UI 层直接读写 `library.json` | 绕过 store/备份/锁 |
| 把完整 LaTeX 源塞进错误横幅 | UI 噪音/泄露 |
| 在迁移期间改命令语言 | 破坏 parity |

### 15.4 完成定义（DoD）

一个任务只有同时满足以下条件才算完成：

- [ ] 失败测试先存在，修复后通过。
- [ ] `cargo fmt --check` 通过。
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` 通过。
- [ ] `cargo test --workspace` 通过。
- [ ] 相关验收 ID（A-*/S-*）通过。
- [ ] 生成文件已重新生成且无 diff。
- [ ] 文档/注释与实际行为一致。
- [ ] 没有新增 `let _ =`、`unwrap()`、硬编码命令表。
- [ ] 回复中写明变更文件、命令、结果、剩余风险。

### 15.5 报告模板

```text
Task: T2.3
Defect: D-005, D-013
Changed:
- crates/mathslot-store/src/lib.rs
- crates/mathslot-store/tests/atomic_write.rs
Verification:
- cargo test -p mathslot-store (12 passed)
- cargo clippy --workspace --all-targets -- -D warnings (pass)
Behavior:
- save failure now returns Err; UI shows unsaved state
- corrupt file quarantined; backup restored
Open:
- OPEN-003 (Obsidian single-file constraint)
```

### 15.6 遇到不确定时

- 不要猜产品语义；写 `OPEN-*`，列出 2–3 个选项与影响，等待确认。
- 不要为了“看起来完整”而实现未定义行为。
- 不要修改本文的目标契约；如需变更，先改契约并记录版本。

---

## 16. 最终验收

### 16.1 Gate 验收

| Gate | 必须全绿 |
|---|---|
| G0 | CI、P1 回归、clippy、基线 tag |
| G1 | 单一 parser/AST、catalog 生成、诊断贯通 |
| G2 | app-core、undo、store、render、headless parity |
| G3 | CM6、双端 UI、E2E、功能对齐 |
| G4 | 导入、数据安全、性能、a11y、发布 |

### 16.2 发布前检查

- [ ] 所有 P1/P2 关闭；P3 有明确记录。
- [ ] 调色板/HELP/README 100% 由 catalog 生成，CI 无 diff。
- [ ] `▸m`/`▸z`/`▸zz` 不再静默丢失/变形。
- [ ] 长公式、3×3 矩阵、浅色主题截图回归通过。
- [ ] 配置损坏/磁盘满/只读/并发/kill -9 测试通过。
- [ ] 同秒批量创建公式无覆盖。
- [ ] 桌面与 Obsidian 功能清单对齐。
- [ ] `fmt/clippy/test/WASM/plugin/E2E` 三平台 CI 绿。
- [ ] 发布包可回滚；旧版进入维护模式。

---

## 附录 A：复现命令

```bash
cd /home/mat/Projects/mathslot-next

# 基线
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings

# 桌面构建
cargo build --release --bin mathslot

# 截图：调色板/短公式
MATHSLOT_SHOT=/tmp/shot.png \
./target/release/mathslot

# 截图：长公式
MATHSLOT_SHOT=/tmp/long.png \
MATHSLOT_SHOT_MODAL=esc \
MATHSLOT_SHOT_SRC='a+b+c+d+e+f+g+h+i+j+k+l+m+n+o+p+q+r+s+t+u+v+w+x+y+z = ▸fa+b+c+d+e+f+g+h+i+j+k+l+m+n+o+p+q+r+s+t;u;' \
./target/release/mathslot

# 截图：3×3 矩阵导航
MATHSLOT_SHOT=/tmp/matrix.png \
MATHSLOT_SHOT_MODAL=esc \
MATHSLOT_SHOT_SRC='▸mb1;2;3;4;5;6;7;8;9' \
./target/release/mathslot

# Obsidian 构建
cd obsidian-mathslot
node scripts/build.mjs
```

## 附录 B：关键文件索引

| 主题 | 文件 |
|---|---|
| 调色板/预览/焦点 | `src/app.rs` |
| 配置/导入/删除 | `src/modals.rs` |
| 渲染/降级 | `src/render.rs` |
| 流式编辑/撤销 | `crates/mathslot-core/src/editor.rs` |
| 解析/深度/标签 | `crates/mathslot-core/src/parser.rs` |
| LaTeX 生成/导入 | `crates/mathslot-core/src/latex.rs` |
| 公式库/JSON/预置 | `crates/mathslot-core/src/library.rs` |
| 视觉/导航 | `crates/mathslot-core/src/visual.rs` |
| 命令目录 | `crates/mathslot-core/src/command.rs` |
| WASM ABI | `crates/mathslot-wasm/src/lib.rs` |
| Obsidian | `obsidian-mathslot/src/plugin.js`、`styles.css` |
| CI | `.github/workflows/release.yml` |

## 附录 C：未决问题

| ID | 问题 | 选项 | 需要确认 |
|---|---|---|---|
| OPEN-001 | 桌面端是否必须零 WebView | Tauri 2（共享 UI） vs egui（原生） | 产品硬约束 |
| OPEN-002 | 移动端 MathJax 性能是否可接受 | MathJax SVG vs KaTeX | 真机基准 |
| OPEN-003 | Obsidian 是否必须单文件插件 | 外部 `.wasm` vs 内联 base64 | 分发限制 |
| OPEN-004 | 旧命令语言是否必须 100% 兼容 | 兼容解析 vs 版本化迁移 | 用户数据 |
| OPEN-005 | 88 条预置的稳定 ID 方案 | 手工 slug vs 现有序号迁移 | 升级策略 |

## 附录 D：偏差自检命令

提交前在 `/home/mat/Projects/mathslot-next` 运行。命中不等于错误，但每一条都必须能在评审中解释清楚。

```bash
# 1. 被吞掉的持久化/渲染错误（应逐步清零）
rg -n 'let _ = ' src crates --glob '!target'

# 2. 用户输入路径上的 panic 风险
rg -n '\.unwrap\(\)|\.expect\(' src crates/mathslot-core/src \
  --glob '!**/tests/**' --glob '!target'

# 3. 第二套命令表 / parser / AST（INV-001、INV-006）
rg -n 'const (COMMAND|SYMBOL|STRUCT|RELATION)_ENTRIES' src crates --glob '!target'
rg -n 'fn parse_with_library|fn to_latex' crates --glob '!target'

# 4. 手写命令文档（INV-015）
rg -n '▸[a-z]{1,3}' README.md HELP.md docs --glob '!docs/commands.md'

# 5. 每帧强制聚焦
rg -n 'request_focus' src/app.rs

# 6. 硬编码主题色（D-017）
rg -n '#[0-9a-fA-F]{6}' obsidian-mathslot/styles.css

# 7. 生成文件是否被手改
git diff --exit-code crates/mathslot-command/src/generated.rs \
  catalog/catalog.json docs/commands.md packages/ui/src/generated/catalog.ts
```

期望状态：

| 检查 | G1 后 | G4 后 |
|---|---|---|
| `let _ =` | 只允许在测试/日志 | 0（日志除外，且需注释说明） |
| `unwrap/expect` | 仅限不变量断言且有注释 | 同左 |
| 第二套命令表/parser | 只剩 catalog 与唯一 parser | 同左 |
| 手写 `▸xx` 文档 | 只剩生成块 | 同左 |
| `request_focus` | 只在显式动作 | 同左 |
| 硬编码色值 | 允许在主题 token 文件 | 同左 |
| 生成文件 diff | 0 | 0 |

---

*本文是目标契约与任务索引，不是时间计划。执行时以 §14 的依赖关系和 §15 的完成定义为准。*

