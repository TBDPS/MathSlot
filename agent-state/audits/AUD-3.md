---
id: AUD-3
round: 3
gate: G0
scope: [D-001, D-002, D-003, D-004, D-005, D-006, D-007, D-101]
verdict: BLOCK
auditor: auditor
date: 2026-11-13
---

# MathSlot 独立审计报告 (AUD-3)

- **审计角色**：auditor（只读独立审计，禁止修改产品代码与测试）
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **当前分支**：`refactor/v1` (HEAD: `346a1f5`)
- **审计依据**：`AGENTS.md`、`.agents/skills/independent-audit/SKILL.md`、`docs/LLM_IMPLEMENTATION_SPEC.md`
- **审计目标**：针对任务 `T0.3`（为 P1 缺陷 D-001..D-007 编写失败回归测试）进行行为级失败回归测试的构造条件、断言方式与测试落位全面只读审计，防御 D-101 假测试模式。
- **综合裁定**：**BLOCK**（7 项 P1 缺陷与 D-101 假测试隐患均处于 `OPEN` 状态；门禁虽通过基础检查，但必须依据 TDD 规则先确立真实失败回归测试才能进入修复环节）。

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

- **裁定原则**：根据 `SKILL.md` §4 与 `AGENTS.md` §5，重构范围内的 7 个 P1 缺陷全部处于 `OPEN` 状态，T0.3 阶段目标是为这 7 个缺陷建立真实运行时的失败回归测试。在真实失败测试建立并经验证前，裁定必须保持 **BLOCK**。

---

## 2. 逐项证据与失败回归测试设计（D-001 .. D-007, D-101）

### 2.1 D-001：调色板 5 张卡片 code 错误
- **关联代码**：
  - `src/app.rs:1613-1621`：`Tile { badge: "ob", glyph: "∂", label: "偏导", code: "ob", .. }`
  - `src/app.rs:1658-1666`：`Tile { badge: "xa", glyph: "≈", label: "约等于", code: "xa", .. }`
  - `src/app.rs:1676-1684`：`Tile { badge: "oe", glyph: "·", label: "点乘", code: "oe", .. }`
  - `src/app.rs:1685-1693`：`Tile { badge: "od", glyph: "×", label: "叉乘", code: "od", .. }`
  - `src/app.rs:1694-1702`：`Tile { badge: "xb", glyph: "≡", label: "恒等于", code: "xb", .. }`
  - `crates/mathslot-core/src/command.rs:1151`：`code: "ob"` 对应 `SymbolCmd::To` (`→`, `\to`)
  - `crates/mathslot-core/src/command.rs:1169`：`code: "od"` 对应 `SymbolCmd::Nabla` (`∇`, `\nabla`)
  - `crates/mathslot-core/src/command.rs:1178`：`code: "oe"` 对应 `SymbolCmd::Pm` (`±`, `\pm`)
  - `crates/mathslot-core/src/command.rs:583`：`code: "xa"` 对应 `SymbolCmd::Equiv` (`≡`, `\equiv`)
  - `crates/mathslot-core/src/command.rs:592`：`code: "xb"` 对应 `SymbolCmd::Approx` (`≈`, `\approx`)
- **执行命令**：`python3 scripts/agent/audit_palette.py`
- **退出码**：`1`
- **输出尾部**：
  ```text
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

  FAIL：5 张卡片与命令目录不一致
  ```
- **判定**：**OPEN**
- **T0.3 失败回归测试构造方案**：
  - **测试目标**：在 Rust 单元测试中直接调用 `mathslot_core::command::lookup_sub_command(c1, c2)` 与调色板卡片定义，断言卡片的 `code` 解析后得到的 `display_glyph` 与 `latex_macro` 必须与卡片声明的 `glyph` 及语义宏严格一致。
  - **测试落位**：`src/p1_regression_tests.rs`（在桌面端 binary 包内测试卡片定义，避免 D-101 跨 crate 读取源码文本）。
  - **断言方式**：
    ```rust
    // 遍历 common_symbols 卡片集合
    for tile in &common_symbols {
        if tile.code.len() == 2 {
            let mut chars = tile.code.chars();
            let c1 = chars.next().unwrap();
            let c2 = chars.next().unwrap();
            let target = mathslot_core::command::lookup_sub_command(c1, c2)
                .expect(&format!("Tile code '{}' must exist in command catalog", tile.code));
            if let mathslot_core::command::CommandTarget::Symbol(sym) = target {
                assert_eq!(sym.display_glyph(), tile.glyph, "Tile '{}' glyph mismatch", tile.label);
            }
        }
    }
    ```
  - **当前失败表现**：在当前代码下运行时，卡片 "偏导" (`ob`) 期望 `∂`，实测收到 `→`；卡片 "约等于" (`xa`) 期望 `≈`，实测收到 `≡`；测试立即 Panic 产生 **FAIL**。

---

### 2.2 D-002：README/HELP 命令漂移
- **关联代码**：
  - `README.md:42-43`：声称 `▸cg` (偏导分式)、`▸ch` (全导分式)、`▸ci/▸cj` (上下大括号)、`▸oq` (垂直)、`▸op` (平行)、`▸qm` (复数集 $\mathbb{C}$)。
  - `HELP.md:142-144, 195`：声称全导分式为 `▸ch`，复数集 $\mathbb{C}$ 为 `▸qm`。
  - `crates/mathslot-core/src/command.rs:339`：`code: "ci"` 对应 `TotalFrac` (全导分式)，不存在 `ch`。
  - `crates/mathslot-core/src/command.rs:812`：`code: "qm"` 对应 `SymbolCmd::SetMinus` (`\setminus` 差集)；复数集实际为 `code: "qn"` (行 819)。
  - `crates/mathslot-core/src/command.rs:1277`：`code: "op"` 对应 `SymbolCmd::Perp` (`\perp` 垂直)；平行实际为 `code: "oo"` (行 1269)。
  - `command.rs` 中完全不存在 `ch`、`cj`、`oq` 命令。
- **执行命令**：`python3 -c "import re; from pathlib import Path; c = Path('crates/mathslot-core/src/command.rs').read_text(); print('ch:', 'code: \"ch\"' in c); print('cj:', 'code: \"cj\"' in c); print('oq:', 'code: \"oq\"' in c); print('qm:', re.search(r'code: \"qm\".*?label: \"([^\"]+)\"', c, re.S).group(1)); print('op:', re.search(r'code: \"op\".*?label: \"([^\"]+)\"', c, re.S).group(1))"`
- **退出码**：`0`
- **输出尾部**：
  ```text
  ch: False
  cj: False
  oq: False
  qm: 差集
  op: 垂直
  ```
- **判定**：**OPEN**
- **T0.3 失败回归测试构造方案**：
  - **测试目标**：验证文档中作为标准示范向用户公开的所有 `▸xx` 简码必须在 `command.rs` 中注册，且其语义必须与文档声称一致。
  - **测试落位**：`crates/mathslot-core/tests/p1_regression_tests.rs`。
  - **断言方式**：
    ```rust
    // 针对文档中承诺的核心微积分与符号命令清单进行行为级断言：
    let doc_claims = [
        ("ch", "全导分式", "\\frac{\\mathrm{d}"),
        ("cj", "下大括号", "\\underbrace"),
        ("oq", "垂直", "\\perp"),
        ("op", "平行", "\\parallel"),
        ("qm", "复数集", "\\mathbb{C}"),
    ];
    for (code, label, expected_macro_prefix) in doc_claims {
        let mut chars = code.chars();
        let c1 = chars.next().unwrap();
        let c2 = chars.next().unwrap();
        let target = mathslot_core::command::lookup_sub_command(c1, c2);
        assert!(target.is_some(), "Documented command '▸{code}' ({label}) does not exist");
        // 校验目标语义（例如 op 必须是 parallel 而非 perp；qm 必须是 complex 而非 setminus）
        ...
    }
    ```
  - **当前失败表现**：`lookup_sub_command('c', 'h')`、`('c', 'j')`、`('o', 'q')` 均返回 `None`；`('o', 'p')` 返回 `Perp`；`('q', 'm')` 返回 `SetMinus`；测试立即 Panic 产生 **FAIL**。

---

### 2.3 D-003：长公式预览两端裁切 / fitted_size 死参数
- **关联代码**：
  - `src/app.rs:2658-2671`：
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
  - `src/app.rs:1028` 与 `src/app.rs:1136`：在导航模式与卡片渲染中调用 `fitted_size(texture, (avail_w - 12.0).max(100.0), img_h, 1.15)`，随后直接调用 `Rect::from_center_size(preview_rect.center(), size)` 居中绘制。由于忽略最大宽高，超宽公式在固定视口中两端溢出并被强制裁切。
- **执行命令**：`git grep -n -A 13 "fn fitted_size" src/app.rs`
- **退出码**：`0`
- **输出尾部**：
  ```text
  src/app.rs:2658:fn fitted_size(
  src/app.rs-2659-    texture: &egui::TextureHandle,
  src/app.rs-2660-    _max_width: f32,
  src/app.rs-2661-    _max_height: f32,
  src/app.rs-2662-    scale_factor: f32,
  src/app.rs-2663-) -> Vec2 {
  src/app.rs-2664-    let original = texture.size_vec2() / PIXELS_PER_POINT;
  src/app.rs-2665-    if original.x <= 0.0 || original.y <= 0.0 {
  src/app.rs-2666-        return Vec2::new(1.0, 1.0);
  src/app.rs-2667-    }
  src/app.rs-2668-    // 真实比例几何缩放，废除强制高度截断 clamp，公式尺寸由 ScrollArea 视口平滑承载
  src/app.rs-2669-    let scale = scale_factor.max(0.05);
  src/app.rs-2670-    original * scale
  src/app.rs-2671-}
  ```
- **判定**：**OPEN**
- **T0.3 失败回归测试构造方案**：
  - **测试目标**：在给定有限容器约束 `max_width` 与 `max_height` 时，计算得到的渲染尺寸必须满足 `size.x <= max_width + 1e-4` 且 `size.y <= max_height + 1e-4`，杜绝死参数导致的几何越界。
  - **测试落位**：`src/p1_regression_tests.rs`。
  - **断言方式**：
    ```rust
    let ctx = egui::Context::default();
    // 构造宽 1200、高 300 的大尺寸测试纹理
    let img = egui::ColorImage::new([1200, 300], egui::Color32::WHITE);
    let tex = ctx.load_texture("large_formula", img, Default::default());
    let max_w = 400.0;
    let max_h = 100.0;
    let size = fitted_size(&tex, max_w, max_h, 1.0);
    assert!(size.x <= max_w, "Fitted width {} exceeds max_width {}", size.x, max_w);
    assert!(size.y <= max_h, "Fitted height {} exceeds max_height {}", size.y, max_h);
    ```
  - **当前失败表现**：当前实现返回 `size = (1200.0, 300.0)`，`1200.0 <= 400.0` 为假，断言立即失败抛出 **FAIL**。

---

### 2.4 D-004：Pending/Unknown 节点复制时消失
- **关联代码**：
  - `crates/mathslot-core/src/latex.rs:19`：
    ```rust
    Expr::PendingCmd { .. } | Expr::UnknownCmd { .. } => String::new(),
    ```
  - `crates/mathslot-core/src/latex.rs:21-23`：
    ```rust
    if piece.is_empty() {
        continue;
    }
    ```
  - `src/app.rs:158-179`：`copy_latex` 调用 `formatted_latex()` 导出。当输入为 `▸m` 时导出为空串，界面弹窗“无内容可复制”；当输入为 `1 + ▸m + 2` 时导出为 `1 + 2`，未闭合前缀静默丢失；当输入为 `▸zz` 时，`▸z` 被当作 UnknownCmd 丢弃，尾部 `z` 作为 Text 导出，变成看似合法的 `z`（严重静默语义错误）。
- **执行命令**：`git grep -n "Expr::PendingCmd { .. } | Expr::UnknownCmd" crates/mathslot-core/src/latex.rs`
- **退出码**：`0`
- **输出尾部**：
  ```text
  crates/mathslot-core/src/latex.rs:19:            Expr::PendingCmd { .. } | Expr::UnknownCmd { .. } => String::new(),
  ```
- **判定**：**OPEN**
- **T0.3 失败回归测试构造方案**：
  - **测试目标**：断言任何输入节点不得在输出时静默消失（INV-002）。输入含 `PendingCmd` 或 `UnknownCmd` 时，导出的 LaTeX 必须包含显式占位符或报错 Diagnostic，严禁返回空串或丢弃节点。
  - **测试落位**：`crates/mathslot-core/tests/p1_regression_tests.rs`。
  - **断言方式**：
    ```rust
    let lib = mathslot_core::library::UserLibrary::default();
    
    // 用例 1：单前缀不得导出为空串
    let doc1 = mathslot_core::parser::parse_with_library("▸m", &lib);
    let latex1 = mathslot_core::latex::to_latex(&doc1);
    assert!(!latex1.trim().is_empty(), "Exporting '▸m' must not produce empty string");

    // 用例 2：复合表达式中的未决命令不得静默消失
    let doc2 = mathslot_core::parser::parse_with_library("1 + ▸m + 2", &lib);
    let latex2 = mathslot_core::latex::to_latex(&doc2);
    assert_ne!(latex2, "1 + 2", "Exporting '1 + ▸m + 2' must not silently drop pending command to '1 + 2'");

    // 用例 3：未知命令不得丢弃前缀并退化为普通字母
    let doc3 = mathslot_core::parser::parse_with_library("▸zz", &lib);
    let latex3 = mathslot_core::latex::to_latex(&doc3);
    assert_ne!(latex3, "z", "Exporting '▸zz' must not silently mutate into 'z'");
    ```
  - **当前失败表现**：当前代码中 `latex1` 为空串（失败）；`latex2` 严格等于 `"1 + 2"`（失败）；`latex3` 严格等于 `"z"`（失败）。

---

### 2.5 D-005：配置读取/保存的数据安全 (吞错/覆写/单代备份)
- **关联代码**：
  - `src/modals.rs:1714-1743`：
    ```rust
    pub fn load_library_from_disk() -> (UserLibrary, String) {
        ...
        match std::fs::read_to_string(&path) {
            Ok(raw) => match UserLibrary::from_json(&raw) {
                Ok(lib) => (lib, display),
                Err(e) => {
                    // 若无 .bak 或 .bak 也损坏，直接回退默认库
                    (UserLibrary::default_seeded(), format!("配置文件损坏，已回退默认库..."))
                }
            },
            Err(_) => (UserLibrary::default_seeded(), display),
        }
    }
    ```
  - `src/modals.rs:1753-1763`：`save_library_to_disk` 仅做单代 `.bak`，无 `fsync`，无损坏隔离。后续自动触发保存时，直接将旧损坏文件覆盖为 `.bak`，并将默认库写入主文件，导致用户数据永久灭失。
  - `src/modals.rs:218, 304, 325, 444, 614`：共 5 处 `let _ = save_library_to_disk(&editor.library);` 静默吞掉磁盘写入失败。
- **执行命令**：`git grep -n "let _ = save_library_to_disk" src/modals.rs`
- **退出码**：`0`
- **输出尾部**：
  ```text
  src/modals.rs:218:                let _ = save_library_to_disk(&editor.library);
  src/modals.rs:304:                                            let _ = save_library_to_disk(&editor.library);
  src/modals.rs:325:                                            let _ = save_library_to_disk(&editor.library);
  src/modals.rs:444:                                            let _ = save_library_to_disk(&editor.library);
  src/modals.rs:614:                let _ = save_library_to_disk(&editor.library);
  ```
- **判定**：**OPEN**
- **T0.3 失败回归测试构造方案**：
  - **测试目标**：注入损坏 JSON，断言配置加载必须显式返回 `Err(...)`（或显式隔离损坏文件为 `.corrupt.<timestamp>`），严禁静默回退至默认库并在随后的保存中覆盖原文件。
  - **测试落位**：`src/p1_regression_tests.rs`。
  - **断言方式**：
    ```rust
    // 故障注入：在临时目录写入破损 JSON
    let tmp_dir = tempfile::tempdir().unwrap();
    let config_file = tmp_dir.path().join("library.json");
    std::fs::write(&config_file, "{ \"broken_json\": [unterminated").unwrap();

    // 尝试安全读取
    let res = load_library_from_path(&config_file);
    assert!(res.is_err(), "Loading corrupted JSON must return Err, never silent default");

    // 断言损坏文件未被静默覆盖，原文件或隔离副本必须完整留存
    let content = std::fs::read_to_string(&config_file).unwrap_or_default();
    assert!(content.contains("unterminated"), "Corrupted file must be preserved for recovery");
    ```
  - **当前失败表现**：当前 `load_library_from_disk` 不返回 `Result`，直接返回 `UserLibrary::default_seeded()`；一旦保存，损坏文件即被覆盖，断言返回 `Err` 必然 **FAIL**。

---

### 2.6 D-006：用户公式 ID 秒级碰撞覆盖
- **关联代码**：
  - `crates/mathslot-core/src/library.rs:260-275`：
    ```rust
    if entry.id.trim().is_empty() {
        entry.id = format!(
            "user-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
        );
    }
    let id = entry.id.clone();
    if let Some(pos) = self.entries.iter().position(|e| e.id == id) {
        self.entries[pos] = entry;
    } else {
        self.entries.push(entry);
    }
    ```
  - `as_secs()` 精度仅为秒。同一秒内若连续调用 `upsert`（如快速新建、批量导入、脚本同步），生成的 ID 完全相同，`position(|e| e.id == id)` 直接覆盖旧项，导致前序公式全部丢失。
- **执行命令**：`git grep -n -C 5 "as_secs()" crates/mathslot-core/src/library.rs`
- **退出码**：`0`
- **输出尾部**：
  ```text
  crates/mathslot-core/src/library.rs-260-        if entry.id.trim().is_empty() {
  crates/mathslot-core/src/library.rs-261-            entry.id = format!(
  crates/mathslot-core/src/library.rs-262-                "user-{}",
  crates/mathslot-core/src/library.rs:263:                std::time::SystemTime::now()
  crates/mathslot-core/src/library.rs-264-                    .duration_since(std::time::UNIX_EPOCH)
  crates/mathslot-core/src/library.rs-265-                    .unwrap_or_default()
  crates/mathslot-core/src/library.rs-266-                    .as_secs()
  crates/mathslot-core/src/library.rs-267-            );
  crates/mathslot-core/src/library.rs-268-        }
  ```
- **判定**：**OPEN**
- **T0.3 失败回归测试构造方案**：
  - **测试目标**：同一毫秒内连续插入 1000 条 ID 为空的公式条目，断言生成的 ID 全部唯一，库中最终条目数严格等于 1000。
  - **测试落位**：`crates/mathslot-core/tests/p1_regression_tests.rs`。
  - **断言方式**：
    ```rust
    let mut lib = mathslot_core::library::FormulaLibrary::new();
    let mut generated_ids = std::collections::HashSet::new();
    for i in 0..1000 {
        let entry = mathslot_core::library::FormulaEntry {
            id: String::new(), // 触发自动 ID 生成
            name: format!("Formula {i}"),
            source: format!("x_{i}"),
            latex: format!("x_{i}"),
            category: "测试".to_owned(),
            description: String::new(),
            is_builtin: false,
        };
        let id = lib.upsert(entry).expect("Upsert must succeed");
        generated_ids.insert(id);
    }
    assert_eq!(generated_ids.len(), 1000, "All 1000 generated IDs must be unique");
    assert_eq!(lib.entries().len(), 1000, "Formula library must contain 1000 entries, but got {}", lib.entries().len());
    ```
  - **当前失败表现**：在当前基于 `as_secs()` 的实现下，1000 次循环耗时 < 1ms，全部条目获得相同 ID，最终 `lib.entries().len()` 为 `1`，断言立即 **FAIL**。

---

### 2.7 D-007：LaTeX 导入启发式丢结构 / 未用 convert_latex_with_report
- **关联代码**：
  - `src/modals.rs:133`：`self.latex_converted_mathslot = mathslot_core::latex::latex_to_mathslot(&self.latex_input);`
  - `src/modals.rs:905-908`：只要转换结果非空 `!self.latex_converted_mathslot.is_empty()`，即可直接触发 `ModalAction::ReplaceCode` 替换当前编辑器内容，无诊断报告、无错误阻断、无结构损失提示。
  - `crates/mathslot-core/src/latex.rs:868-888, 1277-1285`：`latex_to_mathslot` 基于字符启发式重写，遇到 `{...}` 暴力剥除外层括号，遇到未知宏直接拼接入源串，造成不可逆结构损坏。
  - `crates/mathslot-latex/src/import.rs:95`：已有具备完备 `ImportReport` 的 `convert_latex_with_report`，但在桌面端完全被绕过。
- **执行命令**：`git grep -n "mathslot_core::latex::latex_to_mathslot" src/modals.rs`
- **退出码**：`0`
- **输出尾部**：
  ```text
  src/modals.rs:133:        self.latex_converted_mathslot = mathslot_core::latex::latex_to_mathslot(&self.latex_input);
  ```
- **判定**：**OPEN**
- **T0.3 失败回归测试构造方案**：
  - **测试目标**：针对不支持的复杂 LaTeX 结构（如未知高阶环境 `\begin{align}`、未知张量宏 `\tensor{A}{^i_j}`），导入管线必须产出包含结构丢失标记的诊断报告（`lossless == false`），且 UI 替换逻辑必须阻断无提示直接替换。
  - **测试落位**：`crates/mathslot-core/tests/p1_regression_tests.rs` 与 `src/p1_regression_tests.rs`。
  - **断言方式**：
    ```rust
    // 测试未知宏或不支持结构导入时的诊断阻断契约
    let input = r"\tensor{A}{^i_j} + \unsupportedEnvironment{x}";
    // 契约要求：导入入口必须返回附带诊断报告的结构体 (AST/Mathslot, ImportReport)
    let (code, report) = mathslot_core::latex::import_latex_safe(input);
    assert!(!report.is_lossless, "Importing exotic macros must report lossy status");
    assert!(!report.diagnostics.is_empty(), "Must produce diagnostic messages for unsupported constructs");
    ```
  - **当前失败表现**：当前 `latex_to_mathslot` 仅返回裸 `String`，根本没有报告返回；在当前实现上调用诊断校验必然编译或运行 **FAIL**。

---

### 2.8 D-101：防御假测试（严禁源码字符串匹配断言）
- **关联代码**：
  - `crates/mathslot-core/tests/final_acceptance_round11.rs:148`：`let app_src = std::fs::read_to_string(&app_rs_path).expect("Read src/app.rs");`
  - `crates/mathslot-core/tests/final_acceptance_round12.rs:19, 47, 57, 73, 97`：多处直接读取 `src/app.rs`、`presets.rs`、`editor.rs`、`modals.rs` 的源码文本并做 `contains(...)` 断言。
  - 这种假测试不运行实际代码、不检验动态语义，重构改动一个空格即可能崩坏，或逻辑完全损坏却因字符串残留而放过缺陷。
- **执行命令**：`git grep -n "read_to_string.*rs" crates/mathslot-core/tests/`
- **退出码**：`0`
- **输出尾部**：
  ```text
  crates/mathslot-core/tests/final_acceptance_round11.rs:148:    let app_src = std::fs::read_to_string(&app_rs_path).expect("Read src/app.rs");
  crates/mathslot-core/tests/final_acceptance_round12.rs:19:    let src = std::fs::read_to_string(&app_rs_path).expect("Read src/app.rs");
  crates/mathslot-core/tests/final_acceptance_round12.rs:47:    let presets_src = std::fs::read_to_string(&presets_path).expect("Read presets.rs");
  crates/mathslot-core/tests/final_acceptance_round12.rs:57:    let editor_src = std::fs::read_to_string(&editor_path).expect("Read editor.rs");
  crates/mathslot-core/tests/final_acceptance_round12.rs:73:    let modals_src = std::fs::read_to_string(&modals_path).expect("Read modals.rs");
  crates/mathslot-core/tests/final_acceptance_round12.rs:97:    let modals_src = std::fs::read_to_string(&modals_path).expect("Read modals.rs");
  crates/mathslot-core/tests/final_acceptance_round12.rs:137:    let main_rs = std::fs::read_to_string(repo_root.join("src/main.rs")).expect("Read src/main.rs");
  ```
- **判定**：**OPEN**（存量假测试仍驻留在测试目录中）
- **T0.3 审计规约与禁令**：
  - **严禁**：在任何 T0.3 新建测试中出现 `include_str!("app.rs")`、`fs::read_to_string("src/...")`、`contains("pub enum ...")` 等静态源码文本探测断言。
  - **必须**：所有断言必须针对运行期结构体实例、函数返回值、枚举模式匹配及真实的 API 调用结果。

---

## 3. 门禁与构建基线检查

在开展 T0.3 失败回归测试审计的同时，对当前工作区基础构建门禁进行完整复测：

### 3.1 代码格式检查 (`cargo fmt --check`)
- **执行命令**：`cargo fmt --check`
- **退出码**：`0`
- **说明**：T0.2 清理后全工作区格式完全合规。

### 3.2 静态代码检查 (`cargo clippy --workspace --all-targets -- -D warnings`)
- **执行命令**：`cargo clippy --workspace --all-targets -- -D warnings`
- **退出码**：`0`
- **说明**：31 处存量警告已彻底清零，未新增任何 `#[allow]`。

### 3.3 全工作区测试套件 (`cargo test --workspace`)
- **执行命令**：`cargo test --workspace`
- **退出码**：`0`
- **测试结果**：133 passed; 0 failed; 0 ignored。

### 3.4 脚本门禁复核 (`scripts/agent/acceptance.sh`)
- **执行命令**：`scripts/agent/acceptance.sh`
- **退出码**：`0`
- **汇总结果**：`PASS=4 FAIL=0 WARN=4`（结论 PASS；剩余 4 项 WARN 均属 G1..G4 已知待演进项）。

---

## 4. 历史结论抽查

依据规约 §3，对 `docs/` 下历史验收报告中的“已修复/彻底根除”声明进行独立代码与命令复核：

| 来源报告 | 历史声称 | 实测命令与输出 | 复核结论 |
|:---|:---|:---|:---|
| `docs/ACCEPTANCE_REPORT_ROUND_11_FINAL.md:114` | `导入有损时 UI 明确警告，不静默替换 PASS` | `git grep -n "mathslot_core::latex::latex_to_mathslot" src/modals.rs`；检查 `src/modals.rs:905-908` | **虚假结论**。UI 完全绕过 `convert_latex_with_report`，只要非空直接全量替换编辑器内容，结构丢失静默发生。 |
| `docs/ACCEPTANCE_REPORT_ROUND_11_FINAL.md:117` | `全链路消除 ▸j，键位表统一由 Facade 管理 PASS` | `git grep -n "▸j" crates/ src/ \| wc -l` (输出 26 处) | **虚假结论**。`▸j` 控制字符不仅在 `editor.rs`、`parser.rs`、`app.rs` 中大量存在，且仍作为核心流式跳转原语在运行。 |

---

## 5. T0.3 失败回归测试架构与落地方案（建议下一步）

为避免模块依赖割裂与 D-101 假测试，建议在 T0.3 实现阶段将失败回归测试按职责分层组织：

### 5.1 文件组织分工

1. **核心库行为回归测试**：
   - **路径**：`crates/mathslot-core/tests/p1_regression_tests.rs`
   - **覆盖**：
     - `test_p1_d002_documented_commands_exist_and_match_semantics`（D-002: 校验 `ch`/`cj`/`oq` 注册与 `qm`/`op` 语义）
     - `test_p1_d004_pending_and_unknown_commands_never_silently_disappear`（D-004: 校验 `▸m`、`1 + ▸m + 2`、`▸zz` 导出不为空或静默剥离）
     - `test_p1_d006_formula_upsert_same_millisecond_no_collision`（D-006: 校验同一毫秒连续 1000 次 upsert 无覆盖，条目数达 1000）
     - `test_p1_d007_latex_import_reports_lossy_and_blocks_degradation`（D-007: 校验复杂宏导入返回 `lossless == false` 诊断报告）

2. **桌面端与 UI 行为回归测试**：
   - **路径**：`src/p1_regression_tests.rs`（在 `src/main.rs` 中声明 `#[cfg(test)] mod p1_regression_tests;`）
   - **覆盖**：
     - `test_p1_d001_palette_tiles_strictly_match_command_catalog`（D-001: 遍历 `common_symbols`，校验 5 张卡片与 catalog 一致性）
     - `test_p1_d003_fitted_size_strictly_respects_max_bounds`（D-003: 给定有限宽高，校验 `fitted_size` 不超限）
     - `test_p1_d005_config_load_corrupted_json_returns_error_and_preserves_file`（D-005: 注入损坏 JSON，断言返回 `Err` 且不覆盖文件）

### 5.2 实施与退出标准
- **红绿测试纪律**：T0.3 提交的代码**只能包含新测试文件**，不得修改任何现有产品代码。
- **验证通过标准**：
  - `cargo test --test p1_regression_tests` 与 `cargo test --bin mathslot p1_regression_tests` 必须在当前代码上产生**可复现的失败（FAIL）**。
  - 严禁任何断言使用源码字符串匹配（D-101）。
  - 随后待 G1 实施修复时，各缺陷修复后对应测试应平滑转绿（PASS）。
