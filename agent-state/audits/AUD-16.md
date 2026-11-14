---
id: AUD-16
round: 16
gate: G2
scope: [T2.4, D-003, D-008, D-010, D-011, D-019, INV-012, INV-013, A-RENDER-001, A-RENDER-002, A-RENDER-003, A-RENDER-004, A-RENDER-005]
verdict: BLOCK
auditor: auditor
date: 2026-11-14
---

# MathSlot 独立审计报告 (AUD-16)

- **审计角色**：auditor（独立只读审计员；严格遵守 `AGENTS.md` 与 `.agents/skills/independent-audit/SKILL.md`，未修改任何产品代码、测试、脚本或文档）
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **分支与提交**：`refactor/v1` (`HEAD: 9ec3343`)
- **审计目标**：为 Gate G2 任务 `T2.4`（`crates/mathslot-render`、验收 `A-RENDER-001..005`、关联 P1 缺陷 `D-003` 及 P2 缺陷 `D-008`、`D-010`、`D-011`、`D-019`）执行只读基线审计与架构核查。
- **综合裁定**：**BLOCK**（状态：**READY_FOR_DECISION**）
  - 范围内 P1 缺陷 `D-003` 为 **OPEN**（`cargo test --workspace --offline -- --ignored` 实测 exit `101` 失败），且发现 `test_p1_d003` 调用的是测试文件内的**本地镜像拷贝**而非生产 `fitted_size`（与 `AUD-15` 查出的 `D-005` 问题同源）；
  - P2 缺陷 `D-008`、`D-010`、`D-011`、`D-019` 全部为 **OPEN**；
  - `crates/mathslot-render` 尚未建立；`src/render.rs:90` 仍存在 1 处 `let _ = self.tx_job.send(job);` 吞错；
  - **重要契约提示（供 `ADR-0019` 决策）**：协调指令括号中的若干描述（自研 `GlyphBox`/`LayoutTree`/`FontMetrics` 排版树、`src/editor*.rs`、`src/fonts.rs`）与权威规范 [`docs/LLM_IMPLEMENTATION_SPEC.md`](file:///home/mat/Projects/mathslot-next/docs/LLM_IMPLEMENTATION_SPEC.md) §5.2 / §9 存在明显边界差异（见 §1.1）。按 `AGENTS.md` 硬规则 2，规范契约不可擅改。

---

## 1. 判定摘要与契约边界核查

| ID | 类别 / 级别 | 核查对象 | 当前判定 | 证据章节 |
|---|---|---|---|---|
| **T2.4** | Gate G2 任务 | `crates/mathslot-render` 与 `A-RENDER-001..005` | **OPEN**（crate 不存在，待 `ADR-0019`） | §5, §6, §7 |
| **D-003** | **P1**（预览裁切/缩放） | 默认 fit-to-width、超宽左对齐/可滚动、缩放真实值 | **OPEN**（实测 panic, exit `101`） | §2.1 |
| **D-008** | P2（导航图溢出） | `nav_structure_box` `fitted_size` 忽略边界、未分区裁切 | **OPEN** | §2.2 |
| **D-010** | P2（错误横幅过长） | 完整 `latex_src` 拼接进错误并挤占 preview header | **OPEN** | §2.3 |
| **D-011** | P2（渲染降级静默） | `render_doc` fallback 吞掉 `Err`、无 `degraded`/`diagnostics` | **OPEN** | §2.4 |
| **D-019** | P2（无缓存/取消） | 无 debounce、无内容哈希缓存、进行中不可按 generation 取消 | **OPEN** | §2.5 |

### 1.1 规范权威核对（`docs/LLM_IMPLEMENTATION_SPEC.md` vs. 请求摘要）

核查 `docs/LLM_IMPLEMENTATION_SPEC.md` 与当前仓库文件后，确认以下事实：

1. **文件路径事实**：`src/editor*.rs` 与 `src/fonts.rs` 在当前仓库中**不存在**（`ls src/` 仅有 `app.rs`、`devshot.rs`、`main.rs`、`modals.rs`、`p1_regression_tests.rs`、`render.rs`、`theme.rs`）。字体加载在 [`src/app.rs:2697-2818`](file:///home/mat/Projects/mathslot-next/src/app.rs#L2697-L2818) 与 [`src/render.rs:110`](file:///home/mat/Projects/mathslot-next/src/render.rs#L110)。
2. **规范中 `mathslot-render` 与 `D-008/D-010/D-011/D-019` 的权威定义**：
   - `T2.4`（[`LLM_IMPLEMENTATION_SPEC.md:994`](file:///home/mat/Projects/mathslot-next/docs/LLM_IMPLEMENTATION_SPEC.md#L994)）：`实现 mathslot-render（缓存/取消/降级/fit） | G1 | render crate | A-RENDER-001..005`。
   - §5.2 模块边界（[`LLM_IMPLEMENTATION_SPEC.md:348`](file:///home/mat/Projects/mathslot-next/docs/LLM_IMPLEMENTATION_SPEC.md#L348)）：`mathslot-render` 职责为 **`MathRenderer` trait、缓存、取消、降级、主题/DPI**；允许依赖 `mathslot-syntax`（只读类型）；**禁止：`决定布局`**。
   - §9.1–§9.4（[`LLM_IMPLEMENTATION_SPEC.md:648-699`](file:///home/mat/Projects/mathslot-next/docs/LLM_IMPLEMENTATION_SPEC.md#L648-L699)）：主渲染方案为 **MathJax 3 SVG**（浏览器/Obsidian/Tauri WebView）与 **`latex-rust` 原生可选后端**，而非手写 TeX `GlyphBox`/`LayoutTree` 排版引擎。
   - 规范 §4 中缺陷真实定义：`D-008` = 导航图溢出固定高度；`D-010` = 渲染错误横幅过长；`D-011` = 渲染降级静默；`D-019` = 渲染无缓存/取消。
3. **对 `ADR-0019` 的意义**：
   - 若遵循权威规范 §5.2/§9，`mathslot-render` 不应内置自研 `GlyphBox`/`LayoutTree` 排版树（否则违反 §5.2 `禁止：决定布局`），而应实现 `MathRenderer` trait、`RenderRequest`/`RenderOutput`/`RenderError`、内容哈希缓存 + debounce、generation 取消、显式 `degraded + diagnostics` 降级、错误摘要截断（≤120 / ≤200 字符）及纯几何 `fit_to_width` / `fit_to_box` / 真实缩放比例计算（同时可提供纯抽象 `RenderMetrics` / `BoxSize` 与 `FontProfile` 无头度量/字体配置模型以对接 `latex-rust` 与 egui）。
   - 如确需把 `mathslot-render` 改为自研 `FontMetrics` + `GlyphBox`/`LayoutTree` 数学排版器，须按 `AGENTS.md` 硬规则 2 先写 `agent-state/decisions/OPEN-*.md` 并等待人工确认，不得在未立项情况下变更规范契约。
   - 为保证审计信息完整，下文同时核查了规范定义的 `D-003/008/010/011/019` **以及**当前 `src/` 中的字体加载、字号差异、折行、光标/空槽与 `mathslot-syntax`/`mathslot-doc` 表示。

---

## 2. 逐项缺陷复现与代码证据

### 2.1 `D-003`（P1：长公式预览两端裁切 / 缩放失真 / fit 参数死代码）

- **测试代码**：[`src/p1_regression_tests.rs:67-114`](file:///home/mat/Projects/mathslot-next/src/p1_regression_tests.rs#L67-L114)
- **复现命令**：
  ```bash
  cargo test --workspace --offline -- --ignored
  ```
- **退出码**：`101`
- **关键输出尾部**：
  ```text
  running 1 test
  test p1_regression_tests::test_p1_d003_fitted_size_strictly_respects_max_bounds ... FAILED

  failures:

  ---- p1_regression_tests::test_p1_d003_fitted_size_strictly_respects_max_bounds stdout ----

  thread 'p1_regression_tests::test_p1_d003_fitted_size_strictly_respects_max_bounds' (35803) panicked at src/p1_regression_tests.rs:102:5:
  Fitted width 600 exceeds max_width 400
  note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace


  failures:
      p1_regression_tests::test_p1_d003_fitted_size_strictly_respects_max_bounds

  test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.00s
  ```
- **生产代码缺陷核查（`file:line`）**：
  1. [`src/app.rs:2669-2682`](file:///home/mat/Projects/mathslot-next/src/app.rs#L2669-L2682)：`fn fitted_size(texture: &egui::TextureHandle, _max_width: f32, _max_height: f32, scale_factor: f32) -> Vec2` 将 `_max_width` 与 `_max_height` 设为死参数并完全忽略，直接返回 `original * scale`。
  2. [`src/app.rs:143`](file:///home/mat/Projects/mathslot-next/src/app.rs#L143) 与 [`src/app.rs:963-968`](file:///home/mat/Projects/mathslot-next/src/app.rs#L963-L968)：默认 `preview_scale: 1.25`，但缩放按钮显示 `format!("{:.0}%", self.preview_scale * 80.0)`，把 125% 伪装显示为 `100%`（`F-009`）。
  3. [`src/app.rs:981-1005`](file:///home/mat/Projects/mathslot-next/src/app.rs#L981-L1005)：`preview_box` 未默认执行 `fit-to-width`（完全未传入 `avail_w` 做缩放），直接用 `original * self.preview_scale` 并放入 `ui.vertical_centered(...)`，导致宽公式未按视口宽度自适应也未按左对齐展示（`D-003`、`INV-013`、`A-RENDER-001`）。
- **关键测试边界发现（`test_p1_d003` 与生产代码脱钩）**：
  - [`src/p1_regression_tests.rs:73-87`](file:///home/mat/Projects/mathslot-next/src/p1_regression_tests.rs#L73-L87) 在测试文件内**自行复制了一份本地函数 `fn fitted_size(...)`**，并未调用 [`src/app.rs:2669`](file:///home/mat/Projects/mathslot-next/src/app.rs#L2669) 的生产函数（因 `src/app.rs` 版本是私有的且硬耦合 `&egui::TextureHandle`）。
  - **结论**：`test_p1_d003` 必须重新接回真实生产 API（`mathslot_render::fit_to_box` / `fit_to_width` 及 `crate::app` 调用的纯尺寸函数）并移除 `#[ignore]`，否则即使修复生产代码，测试仍只会测试死拷贝。
- **判定**：**OPEN**

### 2.2 `D-008`（P2：导航图溢出固定高度；附字号/排版尺度核查）

- **代码证据（规范定义：导航图溢出）**：
  - [`src/app.rs:27`](file:///home/mat/Projects/mathslot-next/src/app.rs#L27)：`const NAV_BOX_HEIGHT: f32 = 96.0;`
  - [`src/app.rs:1033-1045`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1033-L1045)：导航模式中 `let img_h = 52.0; let size = fitted_size(texture, (avail_w - 12.0).max(100.0), img_h, 1.15);`，随后用 `egui::Image::new(texture).paint_at(ui, Rect::from_center_size(img_center, size));` 直接绘制。由于 `fitted_size` 忽略 `max_width` 与 `img_h`，3×3 / 4×4 矩阵导航图高度轻松超过 `52.0pt`，向下越界覆盖 `chip_rect`（`rect.left_bottom() + Vec2::new(4.0, -34.0)`）中的跳转徽章，且无 `ScrollArea` 或分区隔离。
  - [`src/app.rs:1142-1158`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1142-L1158)：普通模式下 `fitted_size(texture, (avail_w - 12.0).max(100.0), NAV_BOX_HEIGHT - 12.0, 1.15)` 同样忽略宽高限制并覆盖右上角 `"槽位直达"` 按钮区域 `trigger_rect`。
- **附：排版/字号比例现状核查**：
  - [`src/render.rs:115-121`](file:///home/mat/Projects/mathslot-next/src/render.rs#L115-L121)：`latex-rust` 内部以固定 `font_size_pt: 18`、`dpi: 216`、`display: true` 负责分数/根号/上下标比例与基线对齐。
  - [`src/app.rs:1264`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1264) vs [`src/app.rs:2431`](file:///home/mat/Projects/mathslot-next/src/app.rs#L2431)：`TextEdit::singleline` 声明 `.font(FontId::monospace(18.0))`，而自定义 `highlight_stream_source` layouter 硬编码 `FontId::monospace(18.5)`，两者字号不一致（0.5pt 偏差）。
- **判定**：**OPEN**

### 2.3 `D-010`（P2：渲染错误横幅过长；附输入框折行与溢出核查）

- **代码证据（规范定义：错误横幅过长）**：
  - [`src/render.rs:169-170`](file:///home/mat/Projects/mathslot-next/src/render.rs#L169-L170)：`latex_to_png(&full_src, ...).map_err(|e| format!("{e} (src: {latex_src})"))?;` 将**完整未截断**的 `latex_src` 直接拼入错误字符串。
  - [`src/app.rs:712-730`](file:///home/mat/Projects/mathslot-next/src/app.rs#L712-L730)：将预览和导航错误直接拼接到 `self.render_error`。
  - [`src/app.rs:937-976`](file:///home/mat/Projects/mathslot-next/src/app.rs#L937-L976)：在 `preview_box` 单行 `ui.horizontal` header 内先绘制 `ui.label(RichText::new(format!("⚠ {err}")).size(10.5)...)`（`:947-951`），再排列右侧缩放按钮组（`:955-975`）；未限制 ≤120 字符摘要、未对源码做 200 字符截断、无折叠详情面板与“复制错误信息”按钮，长错误直接把缩放工具栏挤出可视区（违反 §9.3 与 `A-RENDER-005`）。
- **附：输入框折行与视口边界核查（`D-009` 线索）**：
  - [`src/app.rs:1256-1280`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1256-L1280)：`TextEdit::singleline` 配自定义 layouter 设置 `job.wrap.max_width = wrap_width;`，导致语义单行在视觉上多行折行（`F-012` / `D-009`，归属 G3 `T3.1`）。
- **判定**：**OPEN**

### 2.4 `D-011`（P2：渲染降级静默；附光标/选区/空槽表示核查）

- **代码证据（规范定义：渲染降级静默）**：
  - [`src/render.rs:25-27`](file:///home/mat/Projects/mathslot-next/src/render.rs#L25-L27)：`pub struct Rendered { pub image: egui::ColorImage }` 无 `degraded: bool`、无 `diagnostics` 字段。
  - [`src/render.rs:147-164`](file:///home/mat/Projects/mathslot-next/src/render.rs#L147-L164)：`render_doc` 在主 `render_latex(&latex_src)` 失败时进入 `Err(_) => { ... self.render_latex(&fallback_src) }`，**完全吞掉原始错误**并直接返回 `Ok(rendered)`。
  - [`src/render.rs:275-314`](file:///home/mat/Projects/mathslot-next/src/render.rs#L275-L314)：测试 `test_custom_formats_and_exotic_macro_fallback_in_latex_rust` 仅断言 `image.size[0] > 0`，未校验 `degraded == true` 或诊断输出。
  - [`src/app.rs:703-715`](file:///home/mat/Projects/mathslot-next/src/app.rs#L703-L715) 与 [`src/app.rs:931-1017`](file:///home/mat/Projects/mathslot-next/src/app.rs#L931-L1017)：UI 不知道发生过降级，无“降级预览”徽章与原因展示（违反 `INV-012` / `A-RENDER-003`）。
  - [`crates/mathslot-app/src/effect.rs:16-20`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/effect.rs#L16-L20)：`RenderRequest` 目前仅有 `{ request_id, latex, has_diagnostics }`，尚未与规范 §9.1 `RenderRequest` / `RenderOutput` 对齐。
  - [`obsidian-mathslot/src/plugin.js:1250-1256`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/src/plugin.js#L1250-L1256)：直接 `renderMath(state.previewLatex, true)`，捕获异常后 `setText(String(e))`，无结构化降级标记。
- **附：光标、选区与空槽表示现状（供跨栈核对）**：
  - 旧视觉层 [`crates/mathslot-core/src/visual.rs:1360-1376`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/visual.rs#L1360-L1376)：空槽以 `empty_slot_box`（`\fcolorbox` / `\bbox` 包裹 `\phantom{x}` 或绿色光标 `\pmb{\lvert}`）在 LaTeX 层面注入；不支持选区范围高亮几何矩形。
  - 新目标栈：[`crates/mathslot-doc/src/cursor.rs:7-46`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/cursor.rs#L7-L46) 已定义 `Cursor { AtStart, AtEnd, InSlot { slot_id, offset }, AtNode(AstPath) }` 与 `Selection { anchor, focus }`；[`crates/mathslot-doc/src/slot.rs:7-32`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/slot.rs#L7-L32) 已定义 `SlotTable` / `Slot { id, role, path, span, is_empty, label }`；[`crates/mathslot-syntax/src/ast.rs:209-280`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/ast.rs#L209-L280) 已定义完整只读 `Expr`（含 `Placeholder`、`RawLatex`、`Error`）。
- **判定**：**OPEN**

### 2.5 `D-019`（P2：渲染无缓存/取消；附字体加载与跨平台/WASM 核查）

- **代码证据（规范定义：无缓存/取消）**：
  - [`src/render.rs:44-100`](file:///home/mat/Projects/mathslot-next/src/render.rs#L44-L100)：`RenderWorker::spawn()` 仅通过 `mpsc::channel` 队列在**开始前**用 `while let Ok(newer) = rx_job.try_recv()` 覆盖排队任务（`:59-61`）；一旦进入 `renderer.render_doc(..., Mode::Preview)` + `Mode::Nav`（`:62-70`），**运行中不可取消**，且每次强制同步渲染 Preview + Nav 两张图。
  - [`src/app.rs:681-694`](file:///home/mat/Projects/mathslot-next/src/app.rs#L681-L694)：`dispatch_and_poll_render` 在每次 `render_dirty` 立即提交 `RenderJob`，无 debounce；仅在回写贴图时用 `out.revision < self.applied_revision` 丢弃结果（`:697-699`）。
  - 全仓不存在按 `hash(latex, theme, scale, backend, format)` 命中的渲染缓存，重复输入/撤销/切回公式会反复光栅化。
  - [`src/render.rs:90`](file:///home/mat/Projects/mathslot-next/src/render.rs#L90)：`let _ = self.tx_job.send(job);` 静默吞掉通道发送失败错误（违反 §6.4）。
- **附：字体加载与 CJK/符号/无头兼容性核查**：
  - 数学光栅化字体：[`src/render.rs:110`](file:///home/mat/Projects/mathslot-next/src/render.rs#L110) 使用 `MathFont::stix_two_math().expect(...)` 内嵌字体（仅覆盖数学引擎，非 UI 通用 CJK）。
  - 桌面 UI 字体加载：[`src/app.rs:2697-2818`](file:///home/mat/Projects/mathslot-next/src/app.rs#L2697-L2818) `install_fonts` 硬编码三平台候选文件路径并在 Linux 下调用 `Command::new("fc-match")`，直接写入 `egui::FontDefinitions`；该路径耦合 `egui::Context`，不具备独立可测的字体/度量诊断或 WASM 复用能力。
- **判定**：**OPEN**

---

## 3. 基线门禁与静默失败 / 债务核查

### 3.1 当前快照命令实测（`HEAD: 9ec3343`）

| 命令 | 退出码 | 关键输出摘要 |
|---|---|---|
| `cargo fmt --check` | `0` | 通过 |
| `cargo clippy --workspace --all-targets -- -D warnings` | `0` | `Finished dev profile ... in 0.23s` |
| `cargo test --workspace --offline` | `0` | 全工作区 **203 passed; 0 failed; 2 ignored**（`D-003`、`D-007`） |
| `cargo test --workspace --offline -- --ignored` | `101` | `test_p1_d003_fitted_size_strictly_respects_max_bounds` FAILED (`Fitted width 600 exceeds max_width 400`) |
| `cargo check -p mathslot-wasm --target wasm32-unknown-unknown --offline` | `0` | 通过 |
| `scripts/agent/acceptance.sh` | `0` | `PASS=5 FAIL=0 WARN=3`（`let _ =` 16 处、`unwrap()` 22 处、命令表常量 3 处、工作区干净） |

### 3.2 渲染相关文件 `let _ =` 与 `unwrap()`/`expect()` 扫描

1. `let _ =`（[`rg -n 'let _ =' src/ crates/`](file:///home/mat/Projects/mathslot-next/src/render.rs#L90)）：
   - [`src/render.rs:90`](file:///home/mat/Projects/mathslot-next/src/render.rs#L90)：`let _ = self.tx_job.send(job);`（**必须消除**，应转为显式 `RenderError` / 状态反馈）
   - [`src/devshot.rs:58`](file:///home/mat/Projects/mathslot-next/src/devshot.rs#L58)：`let _ = pixmap.save_png(&path);`（开发截图辅助工具）
2. `unwrap()` / `expect()`（`src/` 渲染相关路径）：
   - [`src/render.rs:84`](file:///home/mat/Projects/mathslot-next/src/render.rs#L84)：`.expect("failed to spawn latex-rust render worker")`
   - [`src/render.rs:110`](file:///home/mat/Projects/mathslot-next/src/render.rs#L110)：`.expect("embedded STIX Two Math font must load")`
   - [`src/render.rs:215, 306`](file:///home/mat/Projects/mathslot-next/src/render.rs#L215)：`.unwrap()`（仅在 `#[cfg(test)]` 内）
   - [`src/app.rs:1088`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1088)：`chain.last().expect("root stage exists")`（`nav_structure_box` 渲染路径）
   - [`src/main.rs:17`](file:///home/mat/Projects/mathslot-next/src/main.rs#L17)：`.expect("Failed to load embedded icon")`
3. 冻结文件守卫状态（[`crates/mathslot-syntax/tests/architecture_guard_tests.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/tests/architecture_guard_tests.rs)）：
   - `crates/mathslot-core/src/{parser.rs, ast.rs, latex.rs}` 均有冻结头并由单测锁定，**T2.4 严禁修改**。

---

## 4. 历史结论抽查（`.agents/skills/independent-audit/SKILL.md` §3.3）

| 来源 | 历史声称 | 代码实测 | 结论 |
|---|---|---|---|
| [`docs/AUDIT_OVERHAUL_VERIFICATION.md:113-135, 241, 257`](file:///home/mat/Projects/mathslot-next/docs/AUDIT_OVERHAUL_VERIFICATION.md#L113-L135) | 声称删除 `fitted_size` 的高度 clamp 并引入 `ScrollArea::both()` 后，「大公式高度卡死无法放大：**彻底根除 (VERIFIED)**」，并签发「全面核验通过 (APPROVED)」。 | 实测 [`src/app.rs:2669-2682`](file:///home/mat/Projects/mathslot-next/src/app.rs#L2669-L2682) 中 `fitted_size` 把 `_max_width`/`_max_height` 留成死参数；[`src/app.rs:1035, 1143`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1035) 在无 `ScrollArea` 的 `nav_structure_box` 继续调用它导致矩阵导航图溢出（`D-008`）；[`src/app.rs:963, 999-1004`](file:///home/mat/Projects/mathslot-next/src/app.rs#L963) 默认 1.25x 却显示 `100%` 且不 fit-to-width（`D-003`）；`test_p1_d003` 至今 panic exit `101`。 | **与事实不符（虚假根除）** |
| [`docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:11, 23, 113`](file:///home/mat/Projects/mathslot-next/docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md#L113) | 声称「全部 128 项测试 100% 通过…正式完成重构 (PASS)」且条目 8「普通预览 < 50ms，渲染基准 < 5ms — 100% 达标」。 | 实测 [`src/render.rs:44-100`](file:///home/mat/Projects/mathslot-next/src/render.rs#L44-L100) 无任何渲染缓存、debounce 或取消令牌，且每帧同时强算 Preview + Nav，降级吞错（[`src/render.rs:147-164`](file:///home/mat/Projects/mathslot-next/src/render.rs#L147-L164)），错误横幅拼接完整源码挤占按钮（[`src/app.rs:947-951`](file:///home/mat/Projects/mathslot-next/src/app.rs#L947-L951)）。 | **与事实不符（遗留多处 P1/P2）** |

---

## 5. 离线依赖盘点与 WASM/无头兼容性核查

检查 `Cargo.lock` 与 `~/.cargo/registry/cache/index.crates.io-1949cf8c6b5b557f/`，得出离线可用依赖清单：

| Crate | `Cargo.lock` | 本地 Cache | 用途与 WASM/无头兼容性评估 |
|---|---|---|---|
| `mathslot-syntax` | 工作区内部 | — | 纯 Rust + `#![forbid(unsafe_code)]`，无头/WASM 兼容；规范 §5.2 指定为 `mathslot-render` 唯一内部依赖（只读类型） |
| `serde` (`1.0.229`) / `serde_json` (`1.0.154`) | **是** | **是** | `RenderRequest` / `RenderOutput` / `RenderError` / `ErrorSummary` / `ViewportFit` 跨 WASM/Tauri 序列化 |
| `thiserror` (`2.0.21`) | **是** | **是** | 强类型 `RenderError` |
| `latex-rust` (`3.0.3`) + `tiny-skia` (`0.11.4`) | **是** | **是** | `latex-rust` 仅依赖 `skrifa 0.39.0` 与 `tiny-skia`。**建议置为可选 feature（如 `native-latex-rust`）或由桌面端 `src/render.rs` 适配器实现 `MathRenderer`**，保持 `mathslot-render` 默认构建零光栅重依赖且轻量化兼容 `wasm32` |
| `lru` (`0.12.5` / `0.18.5`) | 否 | **是** | 可选；也可用标准库 `HashMap + VecDeque` 实现约 50 行确定性有界 LRU 缓存（零新增传递依赖） |
| `sha2` (`0.10.9`) / `ahash` (`0.8.12`) | `ahash` 是；`sha2` 否 | **均是** | 缓存键可用确定性 FNV-1a 64/128-bit 或 `sha2` 生成（注意 `std::collections::hash_map::DefaultHasher` 跨进程随机化，缓存键若需快照稳定建议使用确定性哈希函数，如 FNV-1a-128 或 `sha2`） |
| `resvg` (`0.46`/`0.47`) + `fontdb` (`0.23.0`) | 否 | **是** | 若需无头 SVG→PNG 验证可用，但默认 `mathslot-render` 核心不应强绑 GPU 或系统字体库 |

---

## 6. `crates/mathslot-render` 架构蓝图与 `ADR-0019` 建议

### 6.1 推荐架构蓝图（严格遵守 `docs/LLM_IMPLEMENTATION_SPEC.md` §5.2 & §9）

1. **核心原则**：`#![forbid(unsafe_code)]`、纯无头（无 GPU/egui/DOM 依赖）、默认兼容 `wasm32-unknown-unknown`、仅依赖 `mathslot-syntax`（及 `serde`/`thiserror`），**不决定 UI 布局**（§5.2）。
2. **核心 Trait 与数据契约（§9.1）**：
   - `RenderId(u64)`、`Generation(u64)`、`Theme { Light, Dark, HighContrast }`、`RenderFormat { Svg, Png }`、`BackendKind { MathJaxSvg, LatexRust, Mock }`
   - `RenderRequest { id: RenderId, generation: Generation, mode: RenderMode /* Preview | Nav */, latex: String, theme: Theme, scale: f32, format: RenderFormat, backend: BackendKind }`
   - `RenderData { Svg(String) | Png { width: u32, height: u32, bytes: Vec<u8> } }`
   - `RenderOutput { id: RenderId, generation: Generation, output: RenderData, degraded: bool, diagnostics: Vec<RenderDiagnostic>, cache_hit: bool }`
   - `pub trait MathRenderer { fn render(&self, req: &RenderRequest) -> Result<RenderOutput, RenderError>; }`
3. **确定性缓存与代际取消（`D-019`, `A-RENDER-004`）**：
   - `RenderCacheKey`：基于 `(mode, latex, theme, scale_bits, backend, format)` 计算确定性 128-bit 哈希 + 精确字段比较（避免碰撞），有界容量 LRU 淘汰；
   - `CancellationGuard` / `GenerationTracker`：单调递增 `Generation`（`AtomicU64`）；开始渲染前、主渲染与降级回退之间、提交结果前检查 `tracker.is_current(req.generation)`，过期请求返回 `Err(RenderError::Cancelled { id, generation })`，确保旧请求永不覆盖新结果；
   - `DebounceGate`：纯时间抽象（接收 `now_ms: u64` 参数，无头单元测试不 `sleep`），决定何时派发渲染。
4. **显式降级与错误摘要截断（`D-010`, `D-011`, `INV-012`, `A-RENDER-003`, `A-RENDER-005`）**：
   - `FallbackRenderer` / `RenderPipeline`：主渲染失败时，若配置了 fallback（如自定义未知宏转安全数学表达式或离线 `latex-rust` 回退），返回 `Ok(RenderOutput { degraded: true, diagnostics: [RenderDiagnostic { code, summary, source_excerpt, .. }], .. })`；**严禁静默吞错**；
   - `ErrorSummary::from_error(code, message, source)`：
     - `header_summary`: `short_code + single_line_summary`，严格 **≤ 120 chars**（`chars().count() <= 120`）；
     - `source_excerpt`: 截断至 **≤ 200 chars** 并附加 `"…（已截断）"` 标记；
     - `full_detail`: 完整诊断与原因文本供折叠面板与“复制诊断”使用。
5. **纯几何视口 Fit 与缩放计算（`D-003`, `D-008`, `INV-013`, `A-RENDER-001`, `A-RENDER-002`）**：
   - `Size2D { width: f32, height: f32 }`、`FitPolicy { FitToWidth, FitToBox, ActualScale(f32) }`、`FitResult { display_size: Size2D, effective_scale: f32, display_percent: u32, left_aligned: bool, scrollable_x: bool, scrollable_y: bool }`；
   - `fit_to_width(content, viewport_w, user_scale_override)`：默认将超宽内容按 `viewport_w / content.width` 缩至完整可见（或支持“实际大小”切换到左对齐水平滚动，绝不居中裁切两端）；
   - `fit_to_box(content, max_w, max_h, max_scale)`：严格保证 `result.display_size.width <= max_w && result.display_size.height <= max_h`（闭环 `D-003` 与 `D-008`），防止导航图压住徽章/按钮；
   - `true_scale_percent(scale: f32) -> u32`：直接返回 `(scale * 100.0).round()`，根除 `preview_scale * 80.0` 假百分比。
6. **可选无头度量/字体抽象（仅当 `ADR-0019` 明确需要）**：
   - 可在 `mathslot-render` 内提供轻量的 `FontMetrics` / `GlyphBounds` / `FontProfile` 纯 trait 与无头 Mock 实现，供桌面端 `src/render.rs` / `src/app.rs` 统一度量或字体配置查询；但**如要将自研 `GlyphBox`/`LayoutTree` 排版树纳入 `T2.4`，必须先经 `OPEN-*` 修订规范 §5.2**。

### 6.2 `A-RENDER-001..005` 无头 TDD 测试蓝图

在 `crates/mathslot-render/tests/render_acceptance_tests.rs` 及 `src/p1_regression_tests.rs` 先写红灯测试：
1. **`A-RENDER-001` (`D-003`)**：超宽公式（如 `1200x300`）在 `400x100` 视口下，`fit_to_width` 默认完整可见（`display_size.width <= 400.0`），切换实际大小时 `scrollable_x == true` 且 `left_aligned == true`、`true_scale_percent` 真实反映倍率；同时将 `src/p1_regression_tests.rs:73-114` 切换为调用真实生产 `fit_to_box`（以及 `crate::app::fitted_size`）并移除 `#[ignore]`。
2. **`A-RENDER-002` (`D-008`)**：3×3 / 4×4 矩阵导航大图（如 `800x260`）进入 `max_w=440, max_h=52` 的导航区域，`fit_to_box` 严格满足 `width <= 440 && height <= 52` 且保持宽高比，绝不越界遮挡底部徽章区。
3. **`A-RENDER-003` (`D-011`, `INV-012`)**：构造不支持的自定义宏 `\myExoticPkgMacro{a+b}{c}`，主渲染失败后经 fallback 产出结果时，`RenderOutput.degraded == true` 且 `diagnostics` 非空含明确原因；验证 `src/render.rs` `Rendered` 与 `src/app.rs` 状态同步暴露降级标记（不再静默吞错）。
4. **`A-RENDER-004` (`D-019`)**：
   - 连续提交 100 次变更请求（1..=100 generation），模拟第 10 次慢请求在第 100 次到达后完成 → 返回 `Cancelled`，绝不覆盖最新输出；
   - 重复提交相同 `(latex, theme, scale, backend, format)` → 第二次命中缓存（mock backend 调用次数不变），任一维度变化则 cache miss。
5. **`A-RENDER-005` (`D-010`)**：注入 500 字符 LaTeX 编译失败 → `ErrorSummary.header_summary.chars().count() <= 120`（单行无换行），`source_excerpt.chars().count() <= 200`（加 `"…（已截断）"`），`full_detail` 完整保留原始信息供复制。

### 6.3 `ADR-0019` 建议允许与禁止写路径

- **建议允许修改路径**：
  - `Cargo.toml`、`Cargo.lock`（仅新增 `crates/mathslot-render` 成员；如需确定性哈希/LRU 可评估是否零新增外部依赖或使用本地已缓存 `sha2`/`lru`）；
  - `crates/mathslot-render/**`（新建 crate，含 `#![forbid(unsafe_code)]`、核心 trait/缓存/取消/降级/错误截断/fit 几何、完整 `A-RENDER-001..005` 单测，及可选 `native-latex-rust` 适配器）；
  - `src/render.rs`、`src/app.rs`（将桌面端 `RenderWorker`/`Renderer` 接入 `mathslot-render` 管线，消除 `src/render.rs:90` `let _ =`，修复 `fitted_size`、`preview_scale` 真实百分比显示、fit-to-width / fit-to-box、降级徽章提示与错误摘要截断，同步 `18.0`/`18.5` 字号常量）；
  - `src/p1_regression_tests.rs`（将 `test_p1_d003_*` 从死拷贝切换至真实生产 `fitted_size` / `mathslot_render::fit_to_box` 并移除 `#[ignore]`）。
- **建议禁止路径**：
  - 冻结旧核心 `crates/mathslot-core/src/{parser.rs, ast.rs, latex.rs}`（`ADR-0012`）；
  - `crates/mathslot-core/src/library.rs`、`crates/mathslot-store/**`、`crates/mathslot-command/**`、`crates/mathslot-latex/**`；
  - `crates/mathslot-app/**`（除非 `ADR-0019` 明确扩展 `effect::RenderRequest`，否则保持纯状态机边界；建议扩展留待 `T2.5` 或单独协调）；
  - `scripts/agent/**`、`docs/**`、`agent-state/**`、`obsidian-mathslot/**`（Obsidian UI 接入属 G3 `T3.6`）。

---

## 7. 建议的下一步

1. **coordinator 起草 `ADR-0019`**：明确确认 `T2.4` 按规范 §5.2/§9 实现 `crates/mathslot-render`（`MathRenderer`、哈希缓存、generation 取消、显式降级、错误摘要截断、`fit_to_width`/`fit_to_box`），而非在 `mathslot-render` 内手写 `GlyphBox`/`LayoutTree` 布局引擎（如确实需要改契约则先立 `OPEN-*`）；同时明确允许桌面端 `src/{render,app,p1_regression_tests}.rs` 接入并解除 `test_p1_d003` 的 `#[ignore]`。
2. **implementer 执行 TDD**：先建立 `A-RENDER-001..005` 红灯测试并接回 `test_p1_d003` 验证 FAIL，再实现 `crates/mathslot-render` 与桌面端适配，确保全工作区 `fmt`/`clippy -D warnings`/`test --workspace --offline`/`wasm32` check 全绿。
