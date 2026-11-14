---
id: AUD-20
round: 20
gate: PRE-G3-NATIVE
scope: [D-110, D-007, D-009, D-012, D-015, D-016, D-020, D-024, D-025, D-026, release-build-readiness]
verdict: BLOCK
auditor: mathslot-auditor
date: 2026-11-14
---

# 独立审计报告 AUD-20：原生桌面端（PRE-G3-NATIVE）与 Wayland/fcitx5 死循环审计

## 1. 判定摘要

- **审计裁定**：**`BLOCK`**（`PRE-G3-NATIVE` 范围内存在 **2 项 `OPEN` 的 P1 缺陷**：新登记 `D-110` 与既定 `D-007`，以及多项 `OPEN` P2/P3 原生桌面端缺陷；禁止在修复前打包发布原生二进制）。
- **核心发现**：
  1. **`D-110`（P1，新登记）— `OPEN`**：原生 `eframe 0.37.0` / `egui 0.37.0` / `egui-winit 0.37.0` / `winit 0.30.13` 桌面端在 `XDG_SESSION_TYPE=wayland` + `fcitx5`（`XMODIFIERS=@im=fcitx`）下存在**焦点强制抢占 + IME 每帧打断重置 + 无 `repeat` 过滤的键盘重复放大回路**。根因位于 [`src/app.rs:2196-2201`](file:///home/mat/Projects/mathslot-next/src/app.rs#L2196-L2201)（每帧无条件调用 `request_focus(self.input_id)`）与 [`src/app.rs:1495`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1495)（`.lock_focus(true)`）及 [`src/app.rs:376-700`](file:///home/mat/Projects/mathslot-next/src/app.rs#L376-L700)（快捷键/导航输入未检查 `Event::Key { repeat, .. }`）。
  2. **`D-007`（P1）— `OPEN`**：[`src/modals.rs:235-237, 991-1069`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L235-L237) 仍调用启发式 `mathslot_core::latex::latex_to_mathslot`，未接入 `mathslot_latex::convert_latex_with_report` 与 `ImportReport` 诊断/阻断；[`crates/mathslot-core/tests/p1_regression_tests.rs:161-163`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/tests/p1_regression_tests.rs#L161-L163) 仍为 `#[ignore]`。
  3. **其余原生 UI/输入缺陷**：`D-009`（`OPEN`）、`D-012`（原生运行时 `OPEN`）、`D-015`（`OPEN`）、`D-016`（`OPEN`）、`D-020`（`OPEN`）、`D-024`（`OPEN`）、`D-025`（`OPEN`）、`D-026`（`OPEN`）。
  4. **门禁与发布构建就绪度**：`scripts/agent/acceptance.sh --fast`（exit `0`）、`cargo test --workspace --offline`（exit `0`，`214 passed; 0 failed; 1 ignored`）、`cargo build --release --locked --bin mathslot --offline`（exit `0`，产出 14 MB [`target/release/mathslot`](file:///home/mat/Projects/mathslot-next/target/release/mathslot)）均可在当前环境离线完成编译打包，但**必须在解决 `D-110` 等原生阻断缺陷后再执行正式打包分发**。

---

## 2. 缺陷总表

| ID | 级别 | 位置（`file:line`） | 现象摘要 | 判定 |
|---|---|---|---|---|
| **D-110** | **P1** | [`src/app.rs:2196-2206`](file:///home/mat/Projects/mathslot-next/src/app.rs#L2196-L2206), [`src/app.rs:1481-1495`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1481-L1495), [`src/app.rs:376-700`](file:///home/mat/Projects/mathslot-next/src/app.rs#L376-L700) | Wayland + `fcitx5` 下每帧 `request_focus` 触发 `should_interrupt_composition = true` → `zwp_text_input_v3` 每帧 `disable/enable` 与持续重绘，且按键分发未过滤 `repeat: true` | **OPEN** |
| **D-007** | **P1** | [`src/modals.rs:235-237, 991-1069`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L235-L237), [`crates/mathslot-core/src/latex.rs:888-909`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/latex.rs#L888-L909) | 原生 LaTeX 导入仍走启发式 `mathslot_core::latex::latex_to_mathslot`，未使用 `mathslot_latex::convert_latex_with_report` 与 `ImportReport` | **OPEN** |
| **D-009** | **P2** | [`src/app.rs:1475-1499`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1475-L1499) | `egui::TextEdit::singleline` 绑定设置 `job.wrap.max_width = wrap_width` 的 `layouter`，长输入出现视觉多行、语义单行 | **OPEN** |
| **D-015** | **P2** | [`src/app.rs:2196-2206`](file:///home/mat/Projects/mathslot-next/src/app.rs#L2196-L2206), [`src/app.rs:1495`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1495), [`src/app.rs:455-475`](file:///home/mat/Projects/mathslot-next/src/app.rs#L455-L475) | `Palette` 模式下每帧 `request_focus` + `.lock_focus(true)` 形成键盘焦点陷阱（Tab 无法离开）；快捷键硬编码不可配置 | **OPEN** |
| **D-012** | **P2** | [`src/app.rs:1501-1510`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1501-L1510) | 原生桌面端仍使用 `last_typing_undo.elapsed() > Duration::from_millis(450)` 时间窗合并撤销，尚未切换 `mathslot-app` 意图分组 | **OPEN**（桌面运行时） |
| **D-016** | **P2** | [`src/modals.rs:760-766, 805-816`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L760-L766), [`src/modals.rs:1330-1332, 1364-1374`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L1330-L1332), [`src/modals.rs:1608-1610, 1639-1648`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L1608-L1610) | 公式库、自定义格式、片段的“删除”按钮点击后直接移除并写盘，无二次确认或 undo/回收站 | **OPEN** |
| **D-020** | **P2** | [`crates/mathslot-core/src/parser.rs:55-82, 196-199, 297, 632-637, 660-665`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/parser.rs#L297) | 深度 `>= MAX_PARSE_DEPTH` (256) 静默退化为 `Expr::UnknownCmd { code: "?" }`；导航标签上限 576 超限回退 `z{local_idx}` | **OPEN** |
| **D-024** | **P3** | [`crates/mathslot-core/src/editor.rs:2233-2281`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/editor.rs#L2233-L2281) | `bracket_pairs` 仅扫描单字符 `(`/`[`/`{`/`|`，不识别 `\left (` / `\bigl [` 等带空格形式 | **OPEN** |
| **D-025** | **P3** | [`crates/mathslot-core/src/editor.rs:838-869`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/editor.rs#L838-L869), [`src/app.rs:350-353`](file:///home/mat/Projects/mathslot-next/src/app.rs#L350-L353) | `wrap_selection_with_bracket` 固定 `self.cursor_char = e + 2`（右括号后），无停留在括号内或设置项 | **OPEN** |
| **D-026** | **P3** | [`src/theme.rs:15-124, 182-225`](file:///home/mat/Projects/mathslot-next/src/theme.rs#L15-L124), [`src/app.rs:2443-2511`](file:///home/mat/Projects/mathslot-next/src/app.rs#L2443-L2511) | 强制 `ThemePreference::Dark` 无浅色主题；`palette_tile` 等自绘控件使用 `allocate_exact_size` + `painter`，无焦点可见环与可读 a11y 标签 | **OPEN** |

---

## 3. 逐项代码与命令证据

### 3.1 D-110（新登记 P1）：Wayland + `fcitx5` 无限按键重复 / 焦点+IME 死循环

- **本地会话环境验证**：
  - 命令：`env | grep -E "XDG_SESSION_TYPE|WAYLAND_DISPLAY|GTK_IM_MODULE|QT_IM_MODULE|XMODIFIERS" || true`
  - 退出码：`0`
  - 输出：
    ```text
    XMODIFIERS=@im=fcitx
    XDG_SESSION_TYPE=wayland
    WAYLAND_DISPLAY=wayland-1
    ```
- **锁定依赖版本**（[`Cargo.lock:477-557, 3353-3358`](file:///home/mat/Projects/mathslot-next/Cargo.lock#L477-L557)）：
  - `eframe 0.37.0`、`egui 0.37.0`、`egui-winit 0.37.0`、`winit 0.30.13`；[`Cargo.toml:32-39`](file:///home/mat/Projects/mathslot-next/Cargo.toml#L32-L39) 启用 `wayland` 与 `x11` feature，[`src/main.rs:19-34`](file:///home/mat/Projects/mathslot-next/src/main.rs#L19-L34) 使用 `eframe::Renderer::Glow`。
- **完整因果链（逐文件实证）**：
  1. **每帧强制 `request_focus`**（[`src/app.rs:2196-2201`](file:///home/mat/Projects/mathslot-next/src/app.rs#L2196-L2201)）：
     - 在 `WorkspaceTab::Palette` 且 `self.editor.esc_nav.is_none()` 时，`MathSlotApp::ui` **每一帧**都执行 `ctx.memory_mut(|m| m.request_focus(self.input_id));`，同时 [`src/app.rs:1481-1495`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1481-L1495) 为 `TextEdit::singleline` 设置了 `.lock_focus(true)`。
  2. **`request_focus` 每帧触发 `interrupt_ime()`**：
     - [`egui-0.37.0/src/memory/mod.rs:922-926`](file:///home/mat/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/egui-0.37.0/src/memory/mod.rs#L922-L926)：`Memory::request_focus` 无条件调用 `self.interrupt_ime()`，将 `requested_interrupt_ime` 置 `true`（每帧 `begin_pass` 在 `:799` 清零后又被 `src/app.rs:2198` 重新置 `true`）。
     - [`egui-0.37.0/src/widgets/text_edit/builder.rs:1049-1067`](file:///home/mat/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/egui-0.37.0/src/widgets/text_edit/builder.rs#L1049-L1067) 与 [`egui-0.37.0/src/context.rs:3173-3177`](file:///home/mat/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/egui-0.37.0/src/context.rs#L3173-L3177)：`TextEdit` 持焦并设置 `platform_output.ime = Some(...)`，随后 `ContextImpl::end_pass` 将 `ime.should_interrupt_composition` 覆写为 `true`。
  3. **`egui-winit` 每帧反复关闭并重启 IME**：
     - [`egui-winit-0.37.0/src/lib.rs:1276-1283`](file:///home/mat/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/egui-winit-0.37.0/src/lib.rs#L1276-L1283)：当 `!is_toggling_ime && ime.should_interrupt_composition` 为真时，每帧执行：
       `window.set_ime_allowed(false); window.set_ime_allowed(true);`
  4. **Wayland 后端每帧收发 `zwp_text_input_v3` 并唤醒 `calloop` 持续重绘**：
     - [`winit-0.30.13/src/platform_impl/linux/wayland/window/mod.rs:613-621`](file:///home/mat/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/winit-0.30.13/src/platform_impl/linux/wayland/window/mod.rs#L613-L621) 与 [`window/state.rs:1019-1035`](file:///home/mat/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/winit-0.30.13/src/platform_impl/linux/wayland/window/state.rs#L1019-L1035)：每次 `set_ime_allowed(false/true)` 都会向 Wayland 合成器发送 `zwp_text_input_v3::disable() + commit()` 与 `enable() + set_content_type_by_purpose() + commit()`，同时推送 `WindowEvent::Ime(Ime::Disabled / Enabled)` 并调用 `self.event_loop_awakener.ping()`。
     - [`egui-winit-0.37.0/src/lib.rs:440-446`](file:///home/mat/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/egui-winit-0.37.0/src/lib.rs#L440-L446) 将每条 `WindowEvent::Ime` 转为 `EventResponse { repaint: true, ... }`，形成**每帧无休止重绘 + `zwp_text_input_v3` 撕毁重建回路**。`egui-winit-0.37.0/src/lib.rs:747, 762` 亦在注释中实证记录了 Wayland + `fcitx5` 在 `text_input` 状态变动时会持续发出重复的 `Preedit("", Some(0, 0)) -> Preedit("", None)` 事件。
  5. **Wayland `calloop` 按键重复定时器 + `src/app.rs` 无 `repeat` 过滤**：
     - [`winit-0.30.13/src/platform_impl/linux/wayland/seat/keyboard/mod.rs:134-227`](file:///home/mat/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/winit-0.30.13/src/platform_impl/linux/wayland/seat/keyboard/mod.rs#L134-L227)：Wayland 键重复由客户端 `calloop::timer::Timer`（`repeat_token`）驱动，只有收到对应键的 `WlKeyboardEvent::Key { Released }` 或 `WlKeyboardEvent::Leave` 才会停止定时器；若在 `fcitx5` 激活/抓取输入或 `zwp_text_input_v3` 每帧重置期间释放事件时序被打断或丢失，定时器会持续生成重复 `Pressed (repeat: true)`。
     - [`egui-0.37.0/src/input_state/mod.rs:705, 736, 766`](file:///home/mat/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/egui-0.37.0/src/input_state/mod.rs#L705) 明确标注 `consume_key`、`num_presses` 与 `key_pressed` **均包含 key-repeat 事件**（`Includes key-repeat events`）。
     - 实测搜索 `rg -n "repeat" src/app.rs`（exit `1`，0 匹配）：[`src/app.rs:260`](file:///home/mat/Projects/mathslot-next/src/app.rs#L260)、[`src/app.rs:376-700`](file:///home/mat/Projects/mathslot-next/src/app.rs#L376-L700)（`handle_keys_before_ui` 全量使用 `consume_key` / `key_pressed`）、[`src/app.rs:2855`](file:///home/mat/Projects/mathslot-next/src/app.rs#L2855)（`consume_esc_jump_key`）均**从未检查或过滤 `repeat: true`**，且 [`src/app.rs:359-374`](file:///home/mat/Projects/mathslot-next/src/app.rs#L359-L374) 与 `:2843-2884` 只拦截 `Event::Text`，不处理 `Event::Ime`。
- **判定**：**`OPEN`**（P1）。

---

### 3.2 D-009（`TextEdit::singleline` + wrapping `layouter`）

- **代码**：[`src/app.rs:1475-1499`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1475-L1499)
  - `layouter` 设置 `job.wrap.max_width = wrap_width;`，并传给 `egui::TextEdit::singleline(&mut self.editor.source).layouter(&mut layouter)`。
- **复现验证**：`rg -n "singleline|max_width = wrap_width" src/app.rs` 命中 `1477` 与 `1481`。
- **判定**：**`OPEN`**。

### 3.3 D-015（焦点/快捷键/键盘可达性）

- **代码**：
  - [`src/app.rs:1495`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1495)：`.lock_focus(true)` 锁定 Tab/方向键/Esc 离开输入框。
  - [`src/app.rs:2196-2201`](file:///home/mat/Projects/mathslot-next/src/app.rs#L2196-L2201)：`Palette` 非导航态每帧调用 `ctx.memory_mut(|m| m.request_focus(self.input_id));`。
  - [`src/app.rs:455-475`](file:///home/mat/Projects/mathslot-next/src/app.rs#L455-L475)：硬编码 `Ctrl/Cmd+Shift+C`、`Ctrl/Cmd+Shift+S`，无快捷键配置模型。
- **判定**：**`OPEN`**。

### 3.4 D-012（撤销按时间窗合并而非意图分组）

- **代码**：[`src/app.rs:1501-1510`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1501-L1510)
  - 当 `output.response.changed()` 时，仍执行 `if self.last_typing_undo.elapsed() > Duration::from_millis(450) || char_delta > 1 { self.editor.save_undo_snapshot(prev_snap); ... }`。
  - 注：`crates/mathslot-app` 已在 G2 实现按意图分组的撤销且通过 [`crates/mathslot-app/tests/app_state_machine_tests.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/tests/app_state_machine_tests.rs)（12 passed），但 [`src/app.rs`](file:///home/mat/Projects/mathslot-next/src/app.rs) 尚未切换至 `mathslot-app`。
- **判定**：**`OPEN`**（原生桌面端运行时）。

### 3.5 D-016（删除无确认/撤销）

- **代码**：
  - 公式库删除：[`src/modals.rs:760-766, 805-816`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L760-L766) 点击“删除”直接赋 `delete_id` 并调用 `editor.library.formulas.remove(&did)` + `save_library`。
  - 自定义格式删除：[`src/modals.rs:1330-1332, 1364-1374`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L1330-L1332) 点击“删除”直接 `editor.library.remove_custom(k)` + `save_library`。
  - 片段删除：[`src/modals.rs:1608-1610, 1639-1648`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L1608-L1610) 点击“删除”直接 `editor.library.remove_snippet(k)` + `save_library`。
- **判定**：**`OPEN`**。

### 3.6 D-007（LaTeX 导入启发式丢结构）

- **代码**：
  - [`src/modals.rs:235-237`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L235-L237)：`update_latex_conversion` 调用 `mathslot_core::latex::latex_to_mathslot(&self.latex_input)`（[`crates/mathslot-core/src/latex.rs:888-909`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/latex.rs#L888-L909) 为启发式字符串扫描 `convert_latex_chars`，规范 §3 F-022 亦记录其无报告机制）。
  - [`src/modals.rs:1022-1069`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L1022-L1069)：“校验反推”仅重新 `mathslot_core::parser::parse_with_library` + `to_latex`，且仅检查 `!self.latex_converted_mathslot.is_empty()` 即可点击替换/插入，未调用 [`crates/mathslot-latex/src/import.rs:95`](file:///home/mat/Projects/mathslot-next/crates/mathslot-latex/src/import.rs#L95) 的 `convert_latex_with_report` 与 `ImportReport`。
- **命令验证**（`#[ignore]` 测试）：
  - 命令：`cargo test --workspace --offline -- --ignored`
  - 退出码：`101`
  - 输出摘要（来自 `VER-18` 复核并由本次 `--offline` 测试统计 `1 ignored` 确认）：仅 `test_p1_d007_latex_import_reports_lossy_and_blocks_degradation`（[`crates/mathslot-core/tests/p1_regression_tests.rs:162-182`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/tests/p1_regression_tests.rs#L162-L182)）处于 `#[ignore]` 失败态。
- **判定**：**`OPEN`**（P1）。

### 3.7 D-020 / D-024 / D-025 / D-026

- **D-020**（[`crates/mathslot-core/src/parser.rs:55-82, 196-199, 297, 632-637, 660-665`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/parser.rs#L297)）：`MAX_PARSE_DEPTH = 256` 超限时静默返回 `Expr::UnknownCmd { code: "?" }`；`generate_nav_labels` 上限 `24 * 24 = 576`，越界回退 `format!("z{local_idx}")`。判定：**`OPEN`**。
- **D-024**（[`crates/mathslot-core/src/editor.rs:2233-2281`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/editor.rs#L2233-L2281)）：`bracket_pairs` 仅基于字符遍历匹配单字符 `(`/`[`/`{`/`|`，不识别 `\left (` 等带空格分隔定界符。判定：**`OPEN`**。
- **D-025**（[`crates/mathslot-core/src/editor.rs:838-869`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/editor.rs#L838-L869)、[`src/app.rs:350-353`](file:///home/mat/Projects/mathslot-next/src/app.rs#L350-L353)）：`wrap_selection_with_bracket` 固定设置 `self.cursor_char = e + 2;`（右括号外侧）。判定：**`OPEN`**。
- **D-026**（[`src/theme.rs:15-124, 182-225`](file:///home/mat/Projects/mathslot-next/src/theme.rs#L15-L124)、[`src/app.rs:2443-2511`](file:///home/mat/Projects/mathslot-next/src/app.rs#L2443-L2511)）：`install_style` 硬编码 `ThemePreference::Dark`，无浅色主题 token；`palette_tile`、`kbd_colored`、`status_pill` 使用 `allocate_exact_size` + `painter` 手工绘制，缺少键盘焦点指示环与可读语义标签。判定：**`OPEN`**。

---

## 4. 门禁测试与发布构建就绪度实测

### 4.1 `scripts/agent/acceptance.sh --fast`
- **退出码**：`0`
- **输出尾部**：
  ```text
  结果 检查项                    说明
  ------ ---------------------------- ----
  PASS   cargo fmt --check            exit 0
  WARN   cargo clippy -D warnings     跳过（--fast）
  PASS   cargo test --workspace       exit 0
  PASS   调色板一致性           exit 0（gate=G3）
  WARN   let _ = 计数               15 处（G4 前应清零）
  WARN   unwrap() 计数              20 处（用户输入路径应为 0）
  WARN   命令表常量              3 处（G1 后应只剩 catalog）
  PASS   工作区干净              0 个未提交改动

  PASS=4 FAIL=0 WARN=4
  结论：PASS
  ```

### 4.2 `cargo test --workspace --offline`
- **退出码**：`0`
- **聚合结果**：全部 crate 共 **214 passed; 0 failed; 1 ignored**（唯一 ignored 为 `D-007`）。
- **输出尾部**：
  ```text
  test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  ```
  （注：尾部后续为 0 测试的 bin/lib doc-test 汇总，全部 `0 passed; 0 failed`。）

### 4.3 `.github/workflows/release.yml` 原生 Linux 构建就绪度（`cargo build --release --locked --bin mathslot`）
- **Workflow 核查**（[`.github/workflows/release.yml:13-55`](file:///home/mat/Projects/mathslot-next/.github/workflows/release.yml#L13-L55)）：
  - `build-linux-x86_64` 在 `ubuntu-24.04` 上安装 `libasound2-dev libudev-dev libwayland-dev libxkbcommon-dev libx11-dev libx11-xcb-dev`，随后执行 `cargo build --release --locked --bin mathslot` 并打包 `target/release/mathslot`、`assets/*`、`scripts/install-desktop.sh`、`README.md`、`HELP.md`。
- **本地离线编译与产物实测**：
  - 命令：`cargo build --release --locked --bin mathslot --offline && ls -lh target/release/mathslot && git status --short`
  - 退出码：`0`
  - 输出尾部：
    ```text
       Compiling mathslot v0.7.0 (/home/mat/Projects/mathslot-next)
        Finished `release` profile [optimized] target(s) in 1m 35s
    -rwxr-xr-x. 2 mat mat 14M 11月14日 10:32 target/release/mathslot
    ```
  - 命令：`ldd target/release/mathslot`（exit `0`）仅静态/系统基础库依赖（`linux-vdso.so.1`、`libgcc_s.so.1`、`libm.so.6`、`libc.so.6`、`/lib64/ld-linux-x86-64.so.2`；Wayland/X11/OpenGL 由 `winit`/`glutin` 运行时动态加载），且打包清单文件 `assets/icons/*`、`assets/mathslot.desktop`、`scripts/install-desktop.sh`、`README.md`、`HELP.md` 均完整存在，`git status --short` 为空。
  - **结论**：**编译与打包流水线本身可立即运行通过**；但因 `D-110` 与 `D-007` 两个 P1 缺陷仍处于 `OPEN`，**禁止在修复前发布原生包**。

---

## 5. 历史结论抽查（按 `independent-audit` §3.3）

| 来源 | 历史声称 | 本轮代码实测 | 结论 |
|---|---|---|---|
| [`docs/AUDIT_ROUND_11_INLINE_WORKSPACE_AND_ZERO_MODAL.md:22, 37, 76, 90-100`](file:///home/mat/Projects/mathslot-next/docs/AUDIT_ROUND_11_INLINE_WORKSPACE_AND_ZERO_MODAL.md#L76) | 声称“状态机与焦点治理高度自洽”，过去每帧强行 `request_focus` 的问题已建立“极高确定性的状态管理” | 同文件引用的代码段 [`src/app.rs:2196-2201`](file:///home/mat/Projects/mathslot-next/src/app.rs#L2196-L2201) 恰恰在 `Palette` 模式下**仍每帧调用 `request_focus(self.input_id)`**，且 [`src/app.rs:1495`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1495) 仍设 `.lock_focus(true)`，直接导致 `D-015` 与 `D-110` | **历史结论失实（把缺陷代码当成已解决）** |
| [`docs/AUDIT_ROUND_11_INLINE_WORKSPACE_AND_ZERO_MODAL.md:23, 39`](file:///home/mat/Projects/mathslot-next/docs/AUDIT_ROUND_11_INLINE_WORKSPACE_AND_ZERO_MODAL.md#L39) | 声称“0 个未受保护的 `unwrap()`/`panic` 隐患……业务运行路径全量使用 `match` / `if let` / `unwrap_or_default`，仅测试模块保留断言 `unwrap`” | [`src/main.rs:17`](file:///home/mat/Projects/mathslot-next/src/main.rs#L17)、[`src/app.rs:1299`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1299)、[`src/render.rs:129, 170`](file:///home/mat/Projects/mathslot-next/src/render.rs#L129) 存在 4 处生产路径 `.expect(...)` panic 点，且 [`src/devshot.rs:58`](file:///home/mat/Projects/mathslot-next/src/devshot.rs#L58) 存在 `let _ = pixmap.save_png(&path);` 静默吞错 | **历史结论与事实不符** |

---

## 6. `src/` 静默失败与 Panic 模式核查

- 命令：`rg -n "let _\s*=|\.unwrap\(|\.expect\(" src/`
- 退出码：`0`
- 实测结果（`src/` 生产代码，不含 `#[cfg(test)]`）：
  1. [`src/devshot.rs:58`](file:///home/mat/Projects/mathslot-next/src/devshot.rs#L58)：`let _ = pixmap.save_png(&path);` — 静默吞掉 PNG 截图保存错误（`src/` 中唯一 `let _ =`；工作区 15 处其余分布在 `crates/`）。
  2. [`src/main.rs:17`](file:///home/mat/Projects/mathslot-next/src/main.rs#L17)：`.expect("Failed to load embedded icon")` — 内嵌图标解码失败时直接 panic。
  3. [`src/app.rs:1299`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1299)：`let active_stage = chain.last().expect("root stage exists");` — 导航视图 UI 渲染路径直接 panic 假定非空。
  4. [`src/render.rs:129`](file:///home/mat/Projects/mathslot-next/src/render.rs#L129)：`.expect("failed to spawn latex-rust render worker");` — 渲染线程创建失败时主线程直接 panic。
  5. [`src/render.rs:170`](file:///home/mat/Projects/mathslot-next/src/render.rs#L170)：`MathFont::stix_two_math().expect("embedded STIX Two Math font must load");` — 后台线程初始化字体失败时 panic 并断开渲染通道。
  6. [`src/app.rs:194-203`](file:///home/mat/Projects/mathslot-next/src/app.rs#L194-L203)：`copy_latex` 仍调用 `mathslot_core::latex::to_latex` 且仅用 `text.is_empty()` 判空，会静默丢弃 `PendingCmd`/`UnknownCmd`（`D-004` 原生运行时体现）。
  7. `.unwrap()`：`src/` 中共有 **0 处**（`acceptance.sh` 统计的 20 处全部位于 `crates/mathslot-core/src/lib.rs` 与 `library.rs` 单测中）。

---

## 7. 下一步建议（不写实现方案）

1. **优先止血并锁定 `D-110`（P1，原生发布阻断）与 `D-015`**：
   - 先为“焦点非每帧强制夺取 / 非激活状态下不打断 IME / 键盘 `repeat: true` 不触发非文本控制命令重复”建立可复现测试，随后消除 [`src/app.rs:2196-2201`](file:///home/mat/Projects/mathslot-next/src/app.rs#L2196-L2201) 每帧无条件 `request_focus`、放开 `.lock_focus(true)`（`D-015`）并在快捷键/导航分发路径显式处理 `repeat`，最后在 `XDG_SESSION_TYPE=wayland` + `fcitx5` 实机验证输入与快捷键无无限循环。
2. **修复原生端 `D-007`（P1）及 P2 交互/安全缺陷（`D-009`、`D-012`、`D-016`）**：
   - 将 [`src/modals.rs:235-237, 991-1069`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L235-L237) 的 LaTeX 导入接上 `mathslot_latex::convert_latex_with_report` 与 `ImportReport` 展示/Error 阻断；
   - 为 [`src/modals.rs`](file:///home/mat/Projects/mathslot-next/src/modals.rs) 三处删除补齐确认或可撤销机制（`D-016`）；
   - 修正 `TextEdit::singleline` 视觉折行（`D-009`）及原生编辑历史与 `mathslot-app`/意图分组对齐（`D-012`）。
3. **完成原生修复验收后再执行 Release 二进制打包**：
   - 全部 `PRE-G3-NATIVE` 修复经独立 `verifier` 出具 `PASS` 后，再运行 `cargo build --release --locked --bin mathslot` 交付原生可执行包，随后按已批复的 `OPEN-001 = Tauri 2` 路线推进 Gate G3（`T3.1..T3.7`）。
