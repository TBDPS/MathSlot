# MathSlot 深度审计报告 (Round 8: 全面成果独立客观审计)

- **审计周期**：Round 8 (Feature Expansion, Native Desktop Integration & Release Readiness)
- **审计专家**：Auditor Agent (第三方系统与代码审计专家)
- **审阅对象**：Project Lead / Decision Maker Agent / Implementer Agent
- **审计基准版本**：MathSlot v0.6.1 (Release Candidate)
- **关联交付物**：
  - 决策报告：[docs/DECISION_ROUND_8_FEATURE_AND_RELEASE.md](file:///home/mat/Projects/mathslot-next/docs/DECISION_ROUND_8_FEATURE_AND_RELEASE.md)
  - 实施交付：[docs/IMPLEMENTATION_ROUND_8.md](file:///home/mat/Projects/mathslot-next/docs/IMPLEMENTATION_ROUND_8.md)
  - 示例公式库：[crates/mathslot-core/src/presets.rs](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/presets.rs)
  - 桌面集成：[src/main.rs](file:///home/mat/Projects/mathslot-next/src/main.rs), [assets/icons/](file:///home/mat/Projects/mathslot-next/assets/icons/), [scripts/install-desktop.sh](file:///home/mat/Projects/mathslot-next/scripts/install-desktop.sh)
  - CI/CD 流水线：[.github/workflows/release.yml](file:///home/mat/Projects/mathslot-next/.github/workflows/release.yml)

---

## 1. 审计裁决与综合评分 (Executive Verdict & Quality Score)

经过对 `/home/mat/Projects/mathslot-next` 代码仓库在 Round 8 的全量提交（提交 `bbdae33` 与 `fd46a5d`）、底层 AST/LaTeX 编译器、预置公式库、模态交互、Linux Wayland 桌面集成、存储架构与 GitHub Actions 流水线的逐行代码级审查与实机验证，审计裁决如下：

| 评估维度 | 权重 | 得分 | 裁决状态 | 核心考量 |
| :--- | :---: | :---: | :---: | :--- |
| **1. 欧拉公式与槽位书写顺序规范** | 20% | **20 / 20** | **PASS** | 欧拉恒等式彻底纠正为 `▸ue;i▸gp;; + 1 = 0`，全结构槽位设计契合学术手写思考流与排版规范 |
| **2. 海量示例公式库与光栅化测试** | 25% | **25 / 25** | **PASS** | 62 项权威公式覆盖 6 大学科领域，纯 Rust 渲染器 216 DPI 光栅化测试 100% 通过 |
| **3. Wayland 应用图标与桌面集成** | 20% | **20 / 20** | **PASS** | 16~256 多尺寸 PNG 与 SVG 齐全，`with_app_id` 与 `.desktop` 经 Fedora 系统级验证 |
| **4. 存储架构规范与数据容灾安全** | 15% | **15 / 15** | **PASS** | Schema 契约明确（`schema_version: 1`），原子重命名与 `.bak` 容灾回退逻辑可靠 |
| **5. CI/CD 流水线与跨平台发布就绪** | 20% | **16 / 20** | **CONDITIONAL** | 发现 2 项阻碍 CI 构建与打包安装的潜在缺陷（WASM 构建调用与安装脚本二进制路径判断） |
| **综合评分** | **100%** | **96 / 100** | **【附条件正式批准 (Conditional Release Approved)】** |

> [!IMPORTANT]
> **总体审计结论**：Round 8 的实施成果在核心数学语法、示例丰富度、桌面原生感与存储安全性上达到了极高品质。建议在正式发布 Release Tag 前，对本报告指出的两项工程细节（`.github/workflows/release.yml` 的 WASM 构建步骤，以及 `scripts/install-desktop.sh` 的二进制寻址逻辑）进行微调修复。

---

## 2. 逐项深度审计与技术细节核实

### 2.1 审计领域 1：欧拉恒等式与全结构槽位书写顺序

#### 2.1.1 欧拉恒等式 Bug 修复真实性查证
- **原代码遗留缺陷定位**：历史代码中存在 `"e▸ui▸gp;; + 1 = 0"`，导致基底字母 `e` 位于结构外部，`▸u` (Sup) 的两个槽位分别吞噬了本该作为指数的 `i` 与 `\pi`，导致错误编译为 $e \cdot i^\pi + 1 = 0$。
- **现行代码查证**：
  1. [`crates/mathslot-core/src/presets.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/presets.rs#L21)：
     ```rust
     PresetFormula {
         category: "微积分/高等数学",
         name: "欧拉恒等式",
         source: "▸ue;i▸gp;; + 1 = 0",
         desc: "复分析中最著名的恒等式，连接五大数学常数 e, i, π, 1, 0",
     }
     ```
  2. [`crates/mathslot-core/src/lib.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/lib.rs#L609)：
     ```rust
     let euler = parse("▸ue;i▸gp;; + 1 = 0");
     assert_eq!(to_latex(&euler), "{e}^{i\\pi} + 1 = 0");
     ```
  3. 全局搜索 `e▸u`：在源码、测试用例与资源文件中，历史错误简码已 **100% 清除**，仅在历史故障归因文档中有留存记录。
  4. 自然输入兼容性：测试验证 `parse("e^(i▸gp) + 1 = 0")` 与 `parse("e^{i\\pi} + 1 = 0")` 均能正常生成标准欧拉恒等式。

#### 2.1.2 全结构槽位书写顺序与学术直觉审计
审查 `crates/mathslot-core/src/command.rs` 中 44 种 `StructKind` 的 `slot_roles` 定义与 `crates/mathslot-core/src/latex.rs` 对应映射：
- **上标 (Sup `▸u`)**：`["底数", "指数"]` $\to$ `{base}^{exp}`，符合人类自左向右先写基数后标指数的笔顺；
- **下标 (Sub `▸d`)**：`["主体", "下标"]` $\to$ `{base}_{sub}`；
- **上下标 (SubSup `▸b`)**：`["主体", "下标", "上标"]` $\to$ `{base}_{sub}^{sup}`；
- **定积分 (Integral `▸i`)**：`["下限", "上限", "被积式"]` $\to$ `\int_{lower}^{upper} body`，契合积分画完后先填下限再填上限再写被积函数的自然落笔流；
- **多重积分 (`▸cd`/`▸cc`/`▸ce`)**：`["路径/区域/体", "被积式"]` $\to$ `\oint_{L} body` / `\iint_{D} body` / `\iiint_{\Omega} body`；
- **极限 (Limit `▸l`)**：`["趋近变量", "趋近目标", "主体"]` $\to$ `\lim_{var \to target} body`；
- **代入求值杠 (EvalBar `▸kg`)**：`["表达式", "下限", "上限"]` $\to$ `\left. {expr} \right|_{lower}^{upper}`；
- **矩阵与行列式 (`▸ma`/`▸mc`/`▸mg`)**：严格遵循行优先 (Row-Major)，自左向右、自上而下逐元素排列。
- **审计结论**：底层 AST 槽位拓扑与渲染模板高度一致，定义严谨，完全符合学术规范。

---

### 2.2 审计领域 2：海量示例公式库 (Preset Corpus) 与全量兼容性

#### 2.2.1 公式库容量与学科覆盖度
审查 [`crates/mathslot-core/src/presets.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/presets.rs)：
公式库收录 **62 个** 经典公式，学科划分严谨：
1. **微积分与高等数学** (15 项)：欧拉恒等式、高斯积分、微积分基本定理、重要极限 (Sinc / 自然常数 e)、泰勒级数展开式、多元全微分、格林公式、斯托克斯旋度定理、高斯散度定理、伽马函数欧拉积分、贝塔函数、柯西中值定理、洛必达法则、平面曲线弧长积分；
2. **线性代数与矩阵分析** (12 项)：求根公式、柯西-施瓦茨不等式、特征行列式、特征值本征方程、伴随矩阵求逆、SVD 分解、3×3 单位阵、2D 旋转矩阵、向量内积/外积模长、格拉姆-施密特正交化、矩阵迹定理；
3. **概率论与数理统计** (9 项)：贝叶斯公式、一维高斯密度、多元正态分布、泊松分布律、二项分布质量函数、切比雪夫不等式、方差与期望、中心极限定理；
4. **大学物理与场论** (12 项)：麦克斯韦方程组全四式、薛定谔方程、爱因斯坦质能等价、相对论质能动量、阻尼振动方程、热力学第一定律、普朗克黑体辐射、万有引力、德布罗意波；
5. **复变函数与积分变换** (8 项)：柯西-黎曼条件、柯西复变积分、留数定理、傅里叶正/逆变换、拉普拉斯变换、欧拉极坐标展开、莫比乌斯变换；
6. **离散数学、信息论与算法** (6 项)：香农信息熵、二项式定理、斯特林近似、斐波那契比奈公式、三集合容斥原理、分治法主定理。

#### 2.2.2 Preset Library Modal 交互与状态流转
审查 [`src/modals.rs`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L170-L358)：
- **搜索过滤机制**：支持模糊匹配 `name`、`desc`、`source` 与 `category`，支持一键清空；
- **学科分类标签**：`全部` 与 6 大学科分类按钮高亮切换无缝；
- **动作响应**：
  - `[✓ 载入]`：通过 `ModalAction::ReplaceCode` 清空并载入简码流，正确请求输入聚焦与界面重绘；
  - `[+ 追加]`：通过 `ModalAction::InsertCode` 追加至光标处并自动同步光标；
  - `[复制 LaTeX]`：通过 `ui.ctx().copy_text()` 写入剪贴板并弹出即时 Toast 反馈；
  - 简码流预览：使用等宽字体搭配 `AMBER` / `CYAN` 高亮，辨识度极佳。

#### 2.2.3 自动化集成测试实机验证
实机执行：
```bash
cargo test -p mathslot-core --test massive_preset_compatibility_tests -- --nocapture
```
- **验证项**：
  1. `parse_with_library` 递归下降解析无 panic；
  2. 导出 LaTeX 不为空；
  3. 花括号 `{}` 开闭数量完全对称平衡；
  4. 使用纯 Rust 渲染引擎 `latex-rust`（STIX Two Math 字体，216 DPI）渲染并使用 `tiny-skia` 解码 PNG 位图尺寸（长宽均 > 0）；
- **实测结果**：**62 / 62 个公式全部通过验证，0 失败，耗时 0.21s**。

---

### 2.3 审计领域 3：Fedora Wayland 与 Linux 原生桌面集成

#### 2.3.1 Wayland 图标匹配痛点归因与实施核查
- **痛点根本机理**：Wayland 合成器（GNOME Mutter、KDE KWin、Sway）禁止客户端直接向窗口设置 `_NET_WM_ICON` 位图属性，必须依赖客户端提交的 `app_id` 与操作系统 XDG applications 目录下的 `<app_id>.desktop` 进行匹配。若缺失 `app_id` 或未安装系统图标，将强制回退为黄色默认齿轮/问号图标。
- **实施代码审查**：
  1. [`src/main.rs`](file:///home/mat/Projects/mathslot-next/src/main.rs#L10-L24)：
     - 使用 `include_bytes!("../assets/icons/mathslot-256.png")` 内嵌图标；
     - 显式声明 `.with_app_id("mathslot")`；
     - 显式声明 `.with_icon(icon)`；
  2. [`assets/mathslot.desktop`](file:///home/mat/Projects/mathslot-next/assets/mathslot.desktop)：
     - 声明 `StartupWMClass=mathslot` 与 `Icon=mathslot`；
     - 经 `desktop-file-validate` 校验通过（返回码 0）；
  3. [`assets/icons/`](file:///home/mat/Projects/mathslot-next/assets/icons/)：
     - 生成了标准 `mathslot.svg`（高质量矢量，含渐变微光与黄金微积分符号）；
     - 生成了 16x16, 32x32, 48x48, 64x64, 128x128, 256x256 各尺寸像素点位图（经 `file` 命令验证均为标准 RGBA PNG）。

#### 2.3.2 宿主系统安装现状验证
在当前 Fedora Linux 工作站环境下走查：
```bash
ls -la ~/.local/bin/mathslot ~/.local/share/applications/mathslot.desktop
find ~/.local/share/icons/hicolor/ -name "*mathslot*"
```
- 二进制文件已正确定位在 `~/.local/bin/mathslot`；
- 桌面启动入口已就绪在 `~/.local/share/applications/mathslot.desktop`；
- 图标缓存中 16~256 分辨率及 scalable SVG 共 7 份资源全部就位。

---

### 2.4 审计领域 4：存储架构、Schema 契约与容灾机制

#### 2.4.1 Schema 版本化与向前兼容
审查 [`crates/mathslot-core/src/library.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L466-L528)：
- **模式版本**：定义常量 `CURRENT_SCHEMA_VERSION = 1`；
- **序列化**：`to_json_pretty()` 显式输出 `"schema_version": 1`；
- **反序列化兼容**：`from_json()` 支持读取 `schema_version` 或 `schemaVersion`；若旧版配置缺少该字段，缺省回退至 `1`，实现平滑向后兼容与平滑迁移。

#### 2.4.2 原子落盘与双重容灾备份
审查 [`src/modals.rs`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L1250-L1295)：
- **原子替换 (Atomic Rename)**：写入时先写至 `library.json.tmp`，校验无误后再调用 `std::fs::rename` 覆盖，杜绝意外掉电或崩溃产生的半写截断文件；
- **双重容灾备份 (`library.json.bak`)**：每次保存前先将原文件复制为 `library.json.bak`；若主配置文件遭遇损坏（如外部误改），`load_library_from_disk()` 自动尝试加载 `.bak` 备份并向状态栏反馈恢复提示。

#### 2.4.3 文档完整性走查
审查 [`README.md`](file:///home/mat/Projects/mathslot-next/README.md) 与 [`HELP.md`](file:///home/mat/Projects/mathslot-next/HELP.md)：
- `README.md` 包含【存储架构与数据容灾】与【跨平台发布与 GitHub Releases】专门章节；
- `HELP.md` Section 11 详尽列出了 Linux, Windows, macOS 路径规范、JSON 样例与容灾回退说明；Section 12 详尽列出了 Fedora Wayland 安装与排查指南。

---

### 2.5 审计领域 5：CI/CD 流水线与代码库状态（关键风险发现）

#### 2.5.1 Git Remote 与仓库同步状态
走查 git 分支与远程追踪：
- 远程仓库 `origin` 正确指向 `git@github.com:TBDPS/MathSlot.git`；
- 提交历史已平滑合并，当前 `HEAD`（`fd46a5d`）与 `origin/main` 保持一致，工作区干净无脏文件。

#### 2.5.2 CI/CD 流水线与打包脚本深度审查（重要问题发现）
在审查 `.github/workflows/release.yml` 与 `scripts/install-desktop.sh` 时，审计专家发现了 **2 项工程缺陷**：

##### ⚠️ 缺陷发现 1：CI 中 `build-obsidian-plugin` 使用了不匹配的 `wasm-pack`
- **问题代码**：[`.github/workflows/release.yml` 第 134-140 行](file:///home/mat/Projects/mathslot-next/.github/workflows/release.yml#L134-L140)：
  ```yaml
  - name: Install wasm-pack
    run: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

  - name: Build wasm package
    run: |
      cd crates/mathslot-wasm
      wasm-pack build --target web --release
  ```
- **技术隐患归因**：
  1. `crates/mathslot-wasm` 是一个**零依赖的纯原生 WebAssembly 模块**，其 `Cargo.toml` 中**根本没有引入 `wasm-bindgen`**；
  2. `wasm-pack` 的核心前置条件是要求目标 crate 依赖 `wasm-bindgen`。在没有该依赖的工程中执行 `wasm-pack build` 将**直接报错中断构建**：`[ERROR]: wasm-bindgen is not listed as a dependency in Cargo.toml`；
  3. 事实上，本项目已经拥有经过完备测试的原生构建打包脚本 [`obsidian-mathslot/scripts/build.mjs`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/scripts/build.mjs)。该脚本使用 `cargo build -p mathslot-wasm --target wasm32-unknown-unknown --release`，将 WASM 以 base64 内联打包进 `obsidian-mathslot/main.js`，并运行内置的 Node.js 端到端 Smoke Test；
  4. Obsidian 插件运行时**只需根目录包含 `manifest.json`, `main.js`, `styles.css`**，并不需要 `wasm-pack` 产出的 `pkg/` 文件夹。
- **修复方案建议**：
  将 `build-obsidian-plugin` 的 CI 步骤修改为调用项目现有的原生打包脚本：
  ```yaml
  - name: Setup Node.js
    uses: actions/setup-node@v4
    with:
      node-version: 22

  - name: Build and Bundle Obsidian Plugin
    run: |
      node obsidian-mathslot/scripts/build.mjs

  - name: Package Obsidian Plugin
    run: |
      PKG_NAME="mathslot-obsidian-plugin"
      mkdir -p "${PKG_NAME}"
      cp obsidian-mathslot/manifest.json obsidian-mathslot/main.js obsidian-mathslot/styles.css "${PKG_NAME}/"
      cp README.md "${PKG_NAME}/"
      zip -r "${PKG_NAME}.zip" "${PKG_NAME}"
  ```

##### ⚠️ 缺陷发现 2：`scripts/install-desktop.sh` 在独立发布包中找不到二进制
- **问题代码**：[`scripts/install-desktop.sh` 第 22-26 行](file:///home/mat/Projects/mathslot-next/scripts/install-desktop.sh#L22-L26)：
  ```bash
  TARGET_BIN="${PROJECT_ROOT}/target/release/mathslot"
  if [ ! -f "${TARGET_BIN}" ]; then
      echo "==> 未发现 release 构建，正在执行 cargo build --release..."
      (cd "${PROJECT_ROOT}" && cargo build --release)
  fi
  ```
- **技术隐患归因**：
  在 `.github/workflows/release.yml` 的打包步骤中，Linux 发行包结构为：
  ```
  mathslot-linux-x86_64/
  ├── mathslot             <-- 二进制文件直接位于根目录
  ├── assets/
  ├── scripts/install-desktop.sh
  ├── README.md
  └── HELP.md
  ```
  当最终用户下载 `mathslot-linux-x86_64.tar.gz` 解压并执行 `./scripts/install-desktop.sh` 时，脚本检测的是 `${PROJECT_ROOT}/target/release/mathslot`。由于解压目录没有 `target/release/`，脚本会误判为未编译，并尝试在用户机器上调用 `cargo build --release`。若普通 Linux 用户没有安装 Rust 工具链或源码，安装将直接报错失败！
- **修复方案建议**：
  增强 `scripts/install-desktop.sh` 的二进制文件查找优先级：
  ```bash
  if [ -f "${PROJECT_ROOT}/mathslot" ]; then
      TARGET_BIN="${PROJECT_ROOT}/mathslot"
  elif [ -f "${PROJECT_ROOT}/target/release/mathslot" ]; then
      TARGET_BIN="${PROJECT_ROOT}/target/release/mathslot"
  else
      echo "==> 未发现本地二进制，正在尝试 cargo build --release..."
      (cd "${PROJECT_ROOT}" && cargo build --release)
      TARGET_BIN="${PROJECT_ROOT}/target/release/mathslot"
  fi
  ```

##### ℹ️ 发现 3：版本号字符串微小不一致
- 在 `DECISION_ROUND_8_FEATURE_AND_RELEASE.md` 与 `IMPLEMENTATION_ROUND_8.md` 中，声明目标交付版本为 `v0.6.1`；
- 但目前根目录 `Cargo.toml` 与 `obsidian-mathslot/manifest.json` 中版本号仍保持为 `0.6.0`；
- **建议**：在打发布 tag 前，统一将 `Cargo.toml` 及 `manifest.json` 的版本字段更新为 `0.6.1`。

---

## 3. 测试与验证全矩阵 (Verification Matrix)

本轮审计在本地实机环境对整个工作区执行了完整的端到端自动化验证：

| 测试阶段 / 套件 | 执行命令 | 目标用例数 | 通过数 | 失败数 | 耗时 | 审计核查状态 |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Workspace 单元与集成测试** | `cargo test --workspace` | 92 | 92 | 0 | 0.85s | **PASS** |
| **预置公式库全量光栅化测试** | `cargo test -p mathslot-core --test massive_preset_compatibility_tests` | 62 | 62 | 0 | 0.21s | **PASS** |
| **桌面端编译与语法检查** | `cargo check --bin mathslot` | - | - | 0 | 0.17s | **PASS** |
| **Obsidian 插件编译与 WASM Smoke Test** | `node obsidian-mathslot/scripts/build.mjs` | 8 | 8 | 0 | 0.23s | **PASS** |
| **Desktop 文件语法规范校验** | `desktop-file-validate assets/mathslot.desktop` | 1 | 1 | 0 | 0.01s | **PASS** |
| **图标资产物理存在性与格式校验** | `file assets/icons/*` | 8 | 8 | 0 | 0.01s | **PASS** |

---

## 4. 审计结论与实施交接建议

1. **核心功能与学术排版**：欧拉恒等式和全结构槽位设计完全纠正且符合直觉；
2. **公式库质量**：62 个权威经典公式覆盖全面，解析及渲染测试 100% 绿灯；
3. **桌面集成体验**：Fedora Wayland 下的应用图标与快捷方式配置专业规范；
4. **存储持久化安全**：Schema 版本契约、原子写入与双重容灾恢复逻辑清晰严密；
5. **发布就绪改进建议**：
   - 将 `.github/workflows/release.yml` 的 `build-obsidian-plugin` 调整为使用 `node obsidian-mathslot/scripts/build.mjs`；
   - 优化 `scripts/install-desktop.sh` 支持免源码的二进制解压包一键安装；
   - 统一工作区版本号为 `0.6.1`。

*审计报告归档完毕，批准交付！*
