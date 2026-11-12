---
id: AUD-1
round: 1
gate: G0
scope: [D-001, D-002, D-003, D-004, D-005, D-006, D-007, D-101]
verdict: BLOCK
auditor: auditor
date: 2026-11-13
---

# MathSlot 独立审计报告 (AUD-1)

- **审计角色**：auditor (只读审计)
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **当前分支**：`refactor/v1` (HEAD: `b8c2d9e`)
- **审计依据**：`AGENTS.md`、`.agents/skills/independent-audit/SKILL.md`、`docs/LLM_IMPLEMENTATION_SPEC.md`
- **综合裁定**：**BLOCK**（存在 8 项 OPEN 的 P1/P2 缺陷，门禁检查失败）

---

## 1. 判定摘要

| 缺陷 ID | 严重级别 | 简述 | 当前判定 | 证据章节 |
|:---:|:---:|:---|:---:|:---:|
| **D-001** | P1 | 调色板 5 张卡片 code 错误 | **OPEN** | §2.1 |
| **D-002** | P1 | README/HELP 命令漂移 | **OPEN** | §2.2 |
| **D-003** | P1 | 长公式预览两端裁切 / fitted_size 死参数 | **OPEN** | §2.3 |
| **D-004** | P1 | Pending/Unknown 节点复制时消失 | **OPEN** | §2.4 |
| **D-005** | P1 | 配置读取/保存的数据安全 (吞错/覆写/单代备份) | **OPEN** | §2.5 |
| **D-006** | P1 | 用户公式 ID 秒级碰撞覆盖 | **OPEN** | §2.6 |
| **D-007** | P1 | LaTeX 导入启发式丢结构 / 未用 convert_latex_with_report | **OPEN** | §2.7 |
| **D-101** | P1 | 验收测试以源码字符串为断言，不验证行为 | **OPEN** | §2.8 |

- **CI / 格式基线**：`cargo fmt --check` 失败（exit 1），`cargo clippy --workspace --all-targets -- -D warnings` 失败（exit 101），`cargo test --workspace` 为 133 passed。
- **裁定原则**：依据审计规约，范围内存在 OPEN 状态的 P1 缺陷，判定为 **BLOCK**，严禁推进 Gate。

---

## 2. 逐项证据

### 2.1 D-001：调色板 5 张卡片 code 错误
- **关联代码**：
  - `src/app.rs:1496`：`Tile { badge: "ob".into(), glyph: "∂".into(), label: "偏导".into(), code: "ob".into() }`
  - `src/app.rs:1501`：`Tile { badge: "xa".into(), glyph: "≈".into(), label: "约等于".into(), code: "xa".into() }`
  - `src/app.rs:1503`：`Tile { badge: "oe".into(), glyph: "·".into(), label: "点乘".into(), code: "oe".into() }`
  - `src/app.rs:1504`：`Tile { badge: "od".into(), glyph: "×".into(), label: "叉乘".into(), code: "od".into() }`
  - `src/app.rs:1505`：`Tile { badge: "xb".into(), glyph: "≡".into(), label: "恒等于".into(), code: "xb".into() }`
  - `crates/mathslot-core/src/command.rs:1151`：`code: "ob"` 对应 `SymbolCmd::To` (`→`, `\to`)
  - `crates/mathslot-core/src/command.rs:1165`：`code: "od"` 对应 `SymbolCmd::Nabla` (`∇`, `\nabla`)
  - `crates/mathslot-core/src/command.rs:1172`：`code: "oe"` 对应 `SymbolCmd::Pm` (`±`, `\pm`)
  - `crates/mathslot-core/src/command.rs:1200`：`code: "xa"` 对应 `SymbolCmd::Equiv` (`≡`, `\equiv`)
  - `crates/mathslot-core/src/command.rs:1207`：`code: "xb"` 对应 `SymbolCmd::Approx` (`≈`, `\approx`)
- **执行命令**：`python3 scripts/agent/audit_palette.py`
- **退出码**：`1`
- **输出尾部**：
  ```
  扫描：12 张卡片，109 条子菜单命令

  不一致的卡片：
    - ob "偏导" -> Symbol::SymbolCmd::To
        glyph 卡片=∂ 目录=→; latex 卡片=partial 目录=to
    - xa "约等于" -> Symbol::SymbolCmd::Equiv
        glyph 卡片=≈ 目录=≡; latex 卡片=approx 目录=equiv
    - oe "点乘" -> Symbol::SymbolCmd::Pm
        glyph 卡片=· 目录=±; latex 卡片=cdot 目录=pm
    - od "叉乘" -> Symbol::SymbolCmd::Nabla
        glyph 卡片=× 目录=∇; latex 卡片=times 目录=nabla
    - xb "恒等于" -> Symbol::SymbolCmd::Approx
        glyph 卡片=≡ 目录=≈; latex 卡片=equiv 目录=approx

  未在命令目录中找到的卡片（可能是直输简码，需人工确认）：
    - +- (正负号)
    - <= (小于等于)
    - >= (大于等于)
    - != (不等于)
    - -> (趋向箭头)

  FAIL：5 张卡片与命令目录不一致
  ```
- **判定**：**OPEN**

---

### 2.2 D-002：README/HELP 命令漂移
- **关联代码**：
  - `README.md:42-43`：文档手写偏导分式为 `▸cg`、全导分式为 `▸ch`、上下大括号为 `▸ci/▸cj`、垂直为 `▸oq`、平行 `▸op`、复数集为 `▸qm`
  - `HELP.md:195`：声称复数集 $\mathbb{C}$ 为 `▸qm`
  - `crates/mathslot-core/src/command.rs:339`：`code: "ci"` 是全导分式 (`TotalFrac`, dy/dx)，不存在 `ch`
  - `crates/mathslot-core/src/command.rs:812`：`code: "qm"` 实际对应差集 (`SetMinus`, `\setminus`)，复数集实际为 `code: "qn"` (`crates/mathslot-core/src/command.rs:819`)
  - `crates/mathslot-core/src/command.rs:1269, 1277`：平行为 `code: "oo"`，`code: "op"` 实际为垂直 (`Perp`, `\perp`)
  - `src/modals.rs:1049`：界面手写帮助文档又称复数集为 `▸sc`，事实源完全分叉
- **执行命令**：`grep -n -E 'code: "(ch|ci|cj|op|oq|qm)"' crates/mathslot-core/src/command.rs`
- **退出码**：`0`
- **输出尾部**：
  ```
  339:        code: "ci",
  812:        code: "qm",
  1277:        code: "op",
  ```
  （`ch`、`cj`、`oq` 在 `command.rs` 中均不存在，命令与文档严重漂移）
- **判定**：**OPEN**

---

### 2.3 D-003：长公式预览两端裁切 / fitted_size 死参数
- **关联代码**：
  - `src/app.rs:2370-2383`：
    ```rust
    fn fitted_size(
        texture: &egui::TextureHandle,
        _max_width: f32,
        _max_height: f32,
        scale_factor: f32,
    ) -> Vec2 {
        let original = texture.size_vec2() / PIXELS_PER_POINT;
        if original.x <= 0.0 || original.y <= 0.0 {
            return Vec2::new(1.0, 1.0);
        }
        // 真实比例几何缩放，废除强制高度截断 clamp，公式尺寸由 ScrollArea 视口平滑承载
        let scale = scale_factor.max(0.05);
        original * scale
    }
    ```
  - `src/app.rs:997` 与 `src/app.rs:1104`：调用 `fitted_size(texture, (avail_w - 12.0).max(100.0), ...)`，但计算结果完全不参考容器宽高；
  - `src/app.rs:1000` 与 `src/app.rs:1105`：调用 `Rect::from_center_size(rect.center(), size)` 居中绘制；由于导航框未包裹 ScrollArea，公式过长时左右两端直接溢出裁切；
  - `src/app.rs:961-967`：主预览框无 fit-to-width 机制。
- **执行命令**：`git grep -n -A 10 "fn fitted_size" src/app.rs`
- **退出码**：`0`
- **输出尾部**：
  ```
  src/app.rs:2370:fn fitted_size(
  src/app.rs-2371-    texture: &egui::TextureHandle,
  src/app.rs-2372-    _max_width: f32,
  src/app.rs-2373-    _max_height: f32,
  src/app.rs-2374-    scale_factor: f32,
  src/app.rs-2375-) -> Vec2 {
  src/app.rs-2376-    let original = texture.size_vec2() / PIXELS_PER_POINT;
  src/app.rs-2377-    if original.x <= 0.0 || original.y <= 0.0 {
  src/app.rs-2378-        return Vec2::new(1.0, 1.0);
  src/app.rs-2379-    }
  src/app.rs-2380-    // 真实比例几何缩放，废除强制高度截断 clamp，公式尺寸由 ScrollArea 视口平滑承载
  ```
- **判定**：**OPEN**

---

### 2.4 D-004：Pending/Unknown 节点复制时消失
- **关联代码**：
  - `crates/mathslot-core/src/latex.rs:19`：
    ```rust
    Expr::PendingCmd { .. } | Expr::UnknownCmd { .. } => String::new(),
    ```
    当表达式包含 pending 状态（如 `▸m`）或未知命令时，直接生成空字符串并跳过；
  - `src/app.rs:158-178`：`copy_latex` 调用 `formatted_latex()`，若整个输入为 `▸m`，生成空串提示“无内容可复制”；若处于复杂表达式中，该节点静默丢失，未返回 Diagnostics 或显式占位符。
- **执行命令**：`git grep -n -C 3 "PendingCmd" crates/mathslot-core/src/latex.rs`
- **退出码**：`0`
- **输出尾部**：
  ```
  crates/mathslot-core/src/latex.rs-16-                let rendered: Vec<String> = slots.iter().map(render_slot).collect();
  crates/mathslot-core/src/latex.rs-17-                format.render_latex(&rendered)
  crates/mathslot-core/src/latex.rs-18-            }
  crates/mathslot-core/src/latex.rs:19:            Expr::PendingCmd { .. } | Expr::UnknownCmd { .. } => String::new(),
  crates/mathslot-core/src/latex.rs-20-        };
  crates/mathslot-core/src/latex.rs-21-        if piece.is_empty() {
  crates/mathslot-core/src/latex.rs-22-            continue;
  ```
- **判定**：**OPEN**

---

### 2.5 D-005：配置读取/保存的数据安全
- **关联代码**：
  - `src/modals.rs:211, 276, 289, 408, 578`：共 5 处 `let _ = save_library_to_disk(&editor.library);`，持久化失败（如磁盘写满、只读权限）被完全静默吞掉；
  - `src/modals.rs:1600`：`let _ = std::fs::copy(&path, &bak);` 备份失败静默忽略；
  - `src/modals.rs:1576-1580`：配置与备份均损坏时，静默回退至 `UserLibrary::default_seeded()`，未做坏损文件隔离；后续自动触发保存时将直接覆盖原有损坏配置，导致用户自定义数据永久丢失；
  - 仅支持 1 代备份且无 `fsync` 保护。
- **执行命令**：`git grep -n "let _ = save_library_to_disk" src/modals.rs`
- **退出码**：`0`
- **输出尾部**：
  ```
  src/modals.rs:211:                let _ = save_library_to_disk(&editor.library);
  src/modals.rs:276:                                            let _ = save_library_to_disk(&editor.library);
  src/modals.rs:289:                                            let _ = save_library_to_disk(&editor.library);
  src/modals.rs:408:                                            let _ = save_library_to_disk(&editor.library);
  src/modals.rs:578:                let _ = save_library_to_disk(&editor.library);
  ```
- **判定**：**OPEN**

---

### 2.6 D-006：用户公式 ID 秒级碰撞覆盖
- **关联代码**：
  - `crates/mathslot-core/src/library.rs:261-268`：
    ```rust
    if entry.id.trim().is_empty() {
        entry.id = format!("user-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs());
    }
    let id = entry.id.clone();
    if let Some(pos) = self.entries.iter().position(|e| e.id == id) {
        self.entries[pos] = entry;
    } else {
        self.entries.push(entry);
    }
    ```
    ID 生成采用 `as_secs()`（秒级时间戳）。在同一秒内创建多条公式或批量导入时，ID 产生碰撞，`self.entries[pos] = entry` 会直接静默覆盖前一条公式。
- **执行命令**：`git grep -n -C 5 "as_secs()" crates/mathslot-core/src/library.rs`
- **退出码**：`0`
- **输出尾部**：
  ```
  crates/mathslot-core/src/library.rs-258-        if entry.category.trim().is_empty() {
  crates/mathslot-core/src/library.rs-259-            entry.category = "自定义公式".to_owned();
  crates/mathslot-core/src/library.rs-260-        }
  crates/mathslot-core/src/library.rs-261-        if entry.id.trim().is_empty() {
  crates/mathslot-core/src/library.rs:262:            entry.id = format!("user-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs());
  crates/mathslot-core/src/library.rs-263-        }
  crates/mathslot-core/src/library.rs-264-        let id = entry.id.clone();
  crates/mathslot-core/src/library.rs-265-        if let Some(pos) = self.entries.iter().position(|e| e.id == id) {
  crates/mathslot-core/src/library.rs-266-            self.entries[pos] = entry;
  crates/mathslot-core/src/library.rs-267-        } else {
  ```
- **判定**：**OPEN**

---

### 2.7 D-007：LaTeX 导入启发式丢结构
- **关联代码**：
  - `src/modals.rs:133-134`：
    `self.latex_converted_mathslot = mathslot_core::latex::latex_to_mathslot(&self.latex_input);`
  - `crates/mathslot-core/src/latex.rs:865-920`：`latex_to_mathslot` 基于字符启发式重写 `convert_latex_chars`，遇到嵌套 `{}` 直接剥除，复杂表达式丢失结构；
  - `src/modals.rs:781-800`：导入面板未使用 `mathslot_latex::convert_latex_with_report`，未提供错误阻断、诊断提示和结构 diff。
- **执行命令**：`git grep -n "latex_to_mathslot" src/modals.rs crates/mathslot-core/src/latex.rs`
- **退出码**：`0`
- **输出尾部**：
  ```
  crates/mathslot-core/src/latex.rs:855:pub fn latex_to_mathslot(latex: &str) -> String {
  src/modals.rs:134:            mathslot_core::latex::latex_to_mathslot(&self.latex_input);
  ```
- **判定**：**OPEN**

---

### 2.8 D-101：验收测试以源码字符串为断言，不验证行为
- **关联代码**：
  - `crates/mathslot-core/tests/final_acceptance_round11.rs:19-43`：读取 `src/app.rs` 源码文本并做 `contains("pub enum WorkspaceTab")` 与 `contains("#[default]\n    Palette,")` 断言；
  - `crates/mathslot-core/tests/acceptance_tester_round11_comprehensive.rs:284-320`：遍历 `src/` 下所有 `.rs` 文件，断言 `!content.contains("egui::Window::new")` 以及 `app_rs.contains("egui::CentralPanel::default()")`；
  - `crates/mathslot-core/tests/final_acceptance_round12.rs:19, 47, 57, 73, 97`：多处直接读取 `src/app.rs`、`presets.rs`、`editor.rs`、`modals.rs` 的源码字符串作为“验收通过”判定。
  该模式不验证运行时行为，极易受格式、命名等无害重构影响而误报，或在功能损坏时因字符串偶然匹配而放过缺陷。
- **执行命令**：`git grep -n "read_to_string.*rs" crates/mathslot-core/tests/`
- **退出码**：`0`
- **输出尾部**：
  ```
  crates/mathslot-core/tests/final_acceptance_round11.rs:148:    let app_src = std::fs::read_to_string(&app_rs_path).expect("Read src/app.rs");
  crates/mathslot-core/tests/final_acceptance_round12.rs:19:    let src = std::fs::read_to_string(&app_rs_path).expect("Read src/app.rs");
  crates/mathslot-core/tests/final_acceptance_round12.rs:47:    let presets_src = std::fs::read_to_string(&presets_path).expect("Read presets.rs");
  crates/mathslot-core/tests/final_acceptance_round12.rs:57:    let editor_src = std::fs::read_to_string(&editor_path).expect("Read editor.rs");
  crates/mathslot-core/tests/final_acceptance_round12.rs:73:    let modals_src = std::fs::read_to_string(&modals_path).expect("Read modals.rs");
  crates/mathslot-core/tests/final_acceptance_round12.rs:97:    let modals_src = std::fs::read_to_string(&modals_path).expect("Read modals.rs");
  crates/mathslot-core/tests/final_acceptance_round12.rs:137:    let main_rs = std::fs::read_to_string(repo_root.join("src/main.rs")).expect("Read src/main.rs");
  ```
- **判定**：**OPEN**

---

## 3. 门禁与构建基线检查

### 3.1 代码格式检查 (`cargo fmt --check`)
- **执行命令**：`cargo fmt --check`
- **退出码**：`1`
- **输出尾部**：
  ```
   /// 分段选择器：返回被点击的下标
  -pub fn segmented(
  -    ui: &mut egui::Ui,
  -    options: &[(&str, &str)],
  -    selected: usize,
  -) -> Option<usize> {
  +pub fn segmented(ui: &mut egui::Ui, options: &[(&str, &str)], selected: usize) -> Option<usize> {
       let mut clicked = None;
       egui::Frame::NONE
           .fill(FIELD)
  Diff in /home/mat/Projects/mathslot-next/src/theme.rs:308:
                               .size(11.5)
                               .color(if is_sel { Color32::WHITE } else { MUTED }),
                       )
  -                    .fill(if is_sel { ACCENT_BG } else { Color32::TRANSPARENT })
  +                    .fill(if is_sel {
  +                        ACCENT_BG
  +                    } else {
  +                        Color32::TRANSPARENT
  +                    })
                       .stroke(if is_sel {
                           Stroke::new(1.0, ACCENT.gamma_multiply(0.6))
                       } else {
  ```
- **判定**：FAIL（存在多处存量格式不合规，涉及 `ast.rs`、`command.rs`、`render.rs`、`theme.rs` 等）

### 3.2 静态代码检查 (`cargo clippy --workspace --all-targets -- -D warnings`)
- **执行命令**：`cargo clippy --workspace --all-targets -- -D warnings`
- **退出码**：`101`
- **输出尾部**：
  ```
  error: manual implementation of `Option::filter`
     --> crates/mathslot-core/src/visual.rs:931:44
      |
  931 |                   let inner_cur = cursor_idx.and_then(|c| {
      |  ____________________________________________^
  932 | |                     if c > open_idx && c <= inner_end {
  933 | |                         Some(c)
  934 | |                     } else {
  ...   |
  937 | |                 });
      | |__________________^ help: try: `filter(|&c| c > open_idx && c <= inner_end)`
      |
      = help: for further information visit https://rust-lang.github.io/rust-clippy/rust-1.99.0/index.html#manual_filter
      = note: `-D clippy::manual-filter` implied by `-D warnings`
      = help: to override `-D warnings` add `#[allow(clippy::manual_filter)]`

  error: could not compile `mathslot-core` (lib) due to 13 previous errors
  error: could not compile `mathslot-core` (lib test) due to 13 previous errors
  ```
- **判定**：FAIL（存在 13+ 处 clippy 违规）

### 3.3 全工作区测试套件 (`cargo test --workspace`)
- **执行命令**：`cargo test --workspace`
- **退出码**：`0`
- **测试结果**：共 133 项测试通过（133 passed; 0 failed; 0 ignored）
- **判定**：PASS（符合 AGENTS.md §3 基线事实）

### 3.4 脚本门禁复核 (`scripts/agent/acceptance.sh --fast`)
- **执行命令**：`scripts/agent/acceptance.sh --fast`
- **退出码**：`1`
- **汇总结果**：`PASS=2 FAIL=1 WARN=5`，结论为 `FAIL`（fmt 失败直接阻断）。

---

## 4. 历史结论抽查

依据规约 §3，对 `docs/` 下历史报告中的“已修复/已通过”声明进行独立代码与命令复核：

| 来源报告 | 历史声称 | 实测命令与输出 | 复核结论 |
|:---|:---|:---|:---|
| `docs/ACCEPTANCE_REPORT_FINAL.md:41-42` | `cargo clippy --workspace -- -D warnings 0 警告 🟢 PASS`；`cargo fmt --workspace -- --check 0 差异，100% 格式化 🟢 PASS` | `cargo clippy --workspace --all-targets -- -D warnings` (exit 101, 13 errors)；`cargo fmt --check` (exit 1, 大量 diff) | **虚假结论**。两项检查均严重失败，历史“0 警告 0 差异”为伪造签署。 |
| `docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:41` | `Git 隔离规约: docs/ 严禁参与 git tracking ... git ls-files docs/ 输出 0 PASS` | `git ls-files docs/ \| wc -l` (exit 0, 输出 59) | **虚假结论**。历史报告将“不追踪文档”强行签署为 PASS，实际导致文档与事实丢失；现按 ADR-0002 已追踪 59 个文档文件。 |
| `docs/FINAL_OVERHAUL_ACCEPTANCE_REPORT.md:94-100` | `fitted_size 已彻底删除 .min(max_height / original.y) ... 大公式无法缩放彻底根除 (VERIFIED)` | 检查 `src/app.rs:2370-2383`，函数直接忽略 `_max_width` 与 `_max_height` 参数 | **虚假根除**。仅粗暴删除 clamp 导致参数变成死参数，宽公式在导航和预览中直接被两端裁切，引发 D-003 与 F-008。 |

---

## 5. 建议的下一步（只读建议，不写实现方案）

1. **保持 G0 阶段 Gate 阻塞状态**：当前 8 项缺陷均处于 `OPEN` 状态，门禁一键脚本报 `FAIL`，不得推进至 G1 或进行任何非基础设施交付。
2. **推进 T0.1 建立 CI 门禁**：首要任务是落地 `.github/workflows/ci.yml`（按 ADR-0001 / T0.1），确保 CI 在 GitHub Actions 远程自动化执行 fmt、clippy、test、WASM 构建检查，防止质量进一步劣化。
3. **分阶段治理存量问题**：在 T0.1 建立门禁后，后续按 Gate 规划依序由对应角色完成代码格式化治理、调色板单一事实源重构（catalog 生成），杜绝手写与分叉。
