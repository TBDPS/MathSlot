# MathSlot 层级三实现参考：迁移、回归与验收（§6–§9）

> 接 §1–§5（角色协议与代码地图）。本节给出迁移切片、回归矩阵与验收命令，供执行模型按序落地。

---

## 6. 迁移切片（以 commit 为单位）

**P0 · 角色模型（`library.rs`）**

```text
- RoleSpec { role: SlotRole, label: String, join_from: Option<usize> }
- SlotRole 枚举 + from_str/metadata（display、默认行为）
- CustomFormat.role_specs: Option<Vec<RoleSpec>>
- parse/serialize 与 upsert_custom 校验接入（禁二次引用、禁越界）
```

**P1 · 导航几何（`visual.rs`）**

```text
- slot_grid_pos(spec, slots) -> (row, col)：行优先推导；
- ↑/↓ 穿槽：同行内左右寻槽，跨行时保持列号（无同列则停靠行首）；
- Delimited/Accent 单槽结构：返回 (1,0)，行为与现状一致。
```

**P2 · 渲染方言（`latex.rs` / `scheme_a.rs`）**

```text
- render_latex(doc, role_specs)：按 role 决定输出顺序与包裹符；
- 未知 role → 该格式降级为现状（无协议）路径，禁止静默丢弃其他槽。
```

## 7. 回归矩阵（落地后必须全绿）

| # | 场景 | 断言 |
|---|---|---|
| 1 | 旧文件（无 roles）加载 | 22 项测试零修改通过；`role_specs = None` 路径 |
| 2 | env 网格（2×3） | 行优先渲染；↑=slot1；跨行保持列号 |
| 3 | autoJoin 两态 | cond 空 → base 槽不变；非空 → 宏拼入 |
| 4 | 越界 join（`join_from: 99`） | 保存拒绝，文案含下标 |
| 5 | 孤立 role（roleSpecs 非法） | 该格式跳过，其余格式不受影响 |
| 6 | 序列化往返 | v1 文件 → v2 读 → 写 → 读，逐字节一致 |
| 7 | UI 回归 | palette 零抖动（§5 断言） |

## 8. 回滚与非目标（明确不做）

- **回滚**：每个 commit 独立可回滚；协议落地后旧路径（线性数组）保留一个发布周期；
- **非目标**：不做层级二宏展开；不做槽位角色的递归嵌套；不引入 serde。

---

## 9. 执行顺序速查（给执行模型的 step-by-step）

```text
1. library.rs      ：RoleSpec/RoleKind + parse/serialize + 校验（P0）
2. latex.rs/visual.rs：协议驱动渲染分支接入（P1）
3. editor.rs       ：wrap_body_slot_index 改为 role 驱动（P2）
4. app.rs          ：表单接入 role 选择（P3）
5. 回归            ：22 项测试零修改通过 + 上述 9 项新测试全绿
```

每个 commit 前运行：`cargo test --workspace && node obsidian-mathslot/scripts/build.mjs`；任何一步红灯先修复再前进，禁止跳过失败测试。

## 6. 迁移切片（按 commit 落地）

每个 commit 独立可交付、可回滚；任何一步红灯先修复再前进。

**C1 · 角色模型落地（`library.rs`）**

```text
- RoleSpec { role, label, join_from } 解析 + 序列化
- CustomFormat.role_specs 接入 palette 分组渲染
- 兼容：roles 缺失时按旧路径解析（零行为变更）
```

**C2 · 导航几何泛化（`ast.rs` / `visual.rs`）**

```text
- slot_grid_pos 泛化为协议驱动：按 row/col 网格坐标生成骨架；
- 内置结构保持现状路径（零行为变更）；
- ↑/↓ 穿槽：同行内左右寻槽、跨行保持列号。
```

**C3 · 渲染方言统一（`latex.rs`）**

```text
- render_latex(doc, role_specs) 收敛为唯一渲染入口；
- visual.rs 双方言骨架只做方言差异适配，删除重复骨架。
```

## 7. 测试计划（新增 9 项）

| # | 测试 | 断言 |
|---|---|---|
| 1 | `slot_grid_pos` 行优先 | Env 2×3 网格中 slot4 坐标 = (1,1)；↑=slot1；跨行保持列号 |
| 2 | `autoJoin` 两态 | cond 空 → base 槽内容不变；非空 → 宏拼入 |
| 3 | 越界 join | `join_from: 99` → 保存拒绝，文案含下标 |

**验收门禁**：每步以 `cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进。

## 8. 回滚与非目标（明确不做）

- **回滚**：每个 commit 独立可回滚；协议落地后旧路径（线性数组）保留一个发布周期；
- **非目标**：不做层级二的迷你宏展开；不做槽位角色的递归嵌套；不改变内置 `StructKind` 的任何渲染路径。

## 9. 执行顺序速查（给执行模型的 step-by-step）

```text
P0 角色模型 → P1 渲染方言 → P2 导航几何 → P3 UI 表单 → P4 回归全绿
```

## 6. 迁移切片（`plugin.js` / Obsidian 端）

现状锚点（改动前必读）：

- `plugin.js` 的 palette 渲染入口：`renderMenu`（根面板 pill 平铺）与 `applyState`（状态徽章刷写）；
- 菜单目录来源：`catalog()` 返回的 `directEntries/subCategories`（与桌面端同一份目录 JSON）；
- palette 容器：`.mathslot-menu-card` 内 `#mathslot-menu-grid`（键帽 pill 网格）。

**改法**：

1. `renderMenu` 接收 `roleSpecs`（由 `catalog()` 透传），按 `SlotRole` 分组渲染 pill；
2. pill 结构：`[key]` 键帽（绿色）+ glyph 提示 + label 文案；active 组加 `.is-active`；
3. 分组渲染函数 `renderRoleGroups(ui, roleSpecs)` 独立成纯函数，便于单测；
4. 兼容：旧格式（无 `roles`）按全 `Body` 解析，palette 行为与现状逐字节一致。

**验收门禁**：`catalog()` 在无 `roles` 的格式上返回值与现状逐字节一致（单测断言）。

## 7. 测试计划（新增 9 项）

| # | 测试 | 断言 |
|---|---|---|
| 1 | `slot_grid_pos` 行优先 | Env 2×3 网格中 slot4 坐标 = (1,1)；↑=slot1；跨行保持列号 |
| 2 | env 两态 | `\begin{env}` 直出 / 未知 role 降级，两侧输出一致 |
| 3 | 越界 join（`join_from: 99`） | 保存拒绝，文案含下标 |

**验收门禁**：每步以 `cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进。

## 6. 迁移切片（按 commit 落地）

现状锚点：接 §5 触点清单。迁移按 commit 切片，每片独立可验证：

- **C1 · 角色枚举**：`SlotRole` 枚举 + `from_str` + `metadata`（display/默认行为）落地 `library.rs`；序列化仅写出非默认字段；
- **C2 · 空间坐标泛化**：↑/↓ 穿槽按 §5 坐标推导；内置结构保持现状路径（零行为变更）；
- **C3 · 序列化兼容**：`library.json` 的 `roles` 字段两态读取（v1 缺省 → 全 `Body`；v2 显式声明角色）；
- **C4 · UI 表单**：`modals.rs` 表单接入 role 选择（下拉 + 说明）；palette 按角色分组渲染。

每片完成后运行：`cargo test --workspace && node obsidian-mathslot/scripts/build.mjs`。

## 7. 测试计划

| # | 测试 | 断言 |
|---|---|---|
| 1 | `slot_grid_pos` 行优先 | Env 2×3 网格中 slot4 坐标 = (1,1)；↑=slot1；跨行保持列号 |
| 2 | `autoJoin` 两态 | cond 空 → base 槽内容不变；非空 → 宏拼入 |
| 3 | 越界 join | `join_from: 99` → 保存拒绝，文案含下标 |

**验收门禁**：每步以 `cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进。

## 6. 迁移切片（分阶段落地，每阶段独立可回滚）

| 阶段 | 内容 | 回滚点 |
|---|---|---|
| M1 | `RoleSpec`/`SlotRole` 枚举 + parse/serialize + `slot_grid_pos`（P0） | 单 commit，不触渲染 |
| M2 | `latex.rs`/`scheme_a.rs` 协议驱动分支切换（内置结构零行为变更） | 单 commit |
| M3 | `editor.rs` smart prepend 改为 role 驱动 | 单 commit |
| M4 | UI（`app.rs` palette）接入 role 分组渲染 | 单 commit |
| M5 | 序列化（`roles` 字段）+ Obsidian 插件端渲染 + 回归 | 单 commit |

## 7. 测试计划

| # | 测试 | 断言 |
|---|---|---|
| 1 | `slot_grid_pos` 行优先 | Env 2×3 网格中 slot4 坐标 = (1,1)；↑=slot1；跨行保持列号 |
| 2 | `autoJoin` 两态 | cond 空 → base 槽内容不变；非空 → 宏拼入 |
| 3 | 越界 join（`join_from: 99`） | 保存拒绝，文案含下标 |

**验收门禁**：每步以 `cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进。

## 8. 回滚与非目标（明确不做）

- **回滚**：每个 commit 独立可回滚；协议落地后旧路径（线性数组）保留一个发布周期；
- **非目标**：不做层级二的迷你宏展开；不做槽位角色的递归嵌套；不引入 serde。

## 6. 迁移切片：C1–C6 分阶段落地

现状锚点：层级一基线已完成（`Env` + `autoJoin`）。迁移按 commit 切片，每片独立可验证。

**C1 · schema 兼容层（`library.rs`）**

```text
- parse/serialize：roles 字段两态读取（v1 缺省 → 全 Body；v2 显式角色声明）
- CustomFormat.role_specs 接入 palette 分组渲染
- 兼容承诺：旧 library.json 零改动加载（role_specs = None 路径）
```

**C2 · 编辑行为泛化（`editor.rs`）**

```text
- smart prepend 吞并目标由 role 驱动（wrap_body_slot_index）；
- ↑/↓ 穿槽按 §5 坐标推导；Idle/Root/SubMenu/Jump/Invalid 状态机不变。
```

**验收门禁**：新增 3 项单测全绿 + 现有 22 项零修改通过。

## 7. 测试计划

| # | 测试 | 断言 |
|---|---|---|
| 1 | `slot_grid_pos` 行优先 | Env 2×3 网格中 slot4 坐标 = (1,1)；↑=slot1；跨行保持列号 |
| 2 | `autoJoin` 两态 | cond 空 → base 槽内容不变；非空 → 宏拼入 |
| 3 | 越界 join（`join_from: 99`） | 保存拒绝，文案含下标 |

**验收门禁**：`node obsidian-mathslot/scripts/build.mjs` 端到端绿。

## 8. 风险与非目标（明确不做）

- **风险**：`visual.rs` 双方言骨架是回归高发区——每个 commit 必须在 `MathJax` 与 `LatexRust` 两种 dialect 下分别断言；
- **非目标**：不做层级二宏展开；不做槽位角色的递归嵌套；不引入 serde。

## 6. 迁移切片（`plugin.js` / Obsidian 端）

现状锚点：接 §5 触点清单。迁移按 commit 切片，每片独立可验证：

- **C1 · schema 兼容**：`roles` 字段两态读取（v1 缺省 → 全 `Body`；v2 显式角色声明）；palette 按 role 分组渲染 pill；
- **C2 · palette 回归**：palette 现状 pill 渲染（`renderMenu`）在协议落地后保持逐字节一致；
- **C3 · wasm 目录**：`node obsidian-mathslot/scripts/build.mjs` 端到端绿（wasm 目录锁校验含 `directEntries/subCategories` 计数）。

## 7. 验收矩阵

| # | 场景 | 断言 |
|---|---|---|
| 1 | `slot_grid_pos` 行优先 | Env 2×3 网格中 slot4 坐标 = (1,1)；↑=slot1；跨行保持列号 |
| 2 | `autoJoin` 两态 | cond 空 → base 槽内容不变；非空 → 宏拼入 |
| 3 | 孤立 role（roleSpecs 非法） | 该格式跳过，其余格式不受影响 |

**验收门禁**：每步以 `cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进。

## 6. 迁移切片：回归矩阵（落地后必须全绿）

| # | 场景 | 断言 |
|---|---|---|
| 1 | 旧文件（无 `roles`）加载 | `role_specs = None` 路径；输出与现状逐字节一致 |
| 2 | env 网格（2×3） | 行优先渲染；↑=slot1；跨行保持列号 |
| 3 | `autoJoin` 两态 | cond 空 → base 槽内容不变；非空 → 宏拼入 |
| 4 | 孤立 role（roleSpecs 非法） | 该格式跳过，其余格式不受影响 |
| 5 | 序列化往返 | v1 文件 → v2 读 → 写 → 读，逐字节一致 |
| 6 | UI 回归 | palette 零抖动；`cargo test --workspace` 全绿 |

**验收门禁**：每步以 `cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进，禁止跳过失败测试。

## 6. 迁移与回滚门禁

现状锚点（改动前必须全部绿，作为回归门禁）：

- `cargo test --workspace`：22 项全绿；
- `node obsidian-mathslot/scripts/build.mjs`：端到端绿（wasm 目录锁校验）。

每片完成后运行同一门禁；任何一步红灯先修复再前进，禁止跳过失败测试。

## 7. 测试计划（新增 9 项）

| # | 测试 | 断言 |
|---|---|---|
| 1 | `slot_grid_pos` 行优先 | Env 2×3 网格中 slot4 坐标 = (1,1)；↑=slot1；跨行保持列号 |
| 2 | `autoJoin` 两态 | cond 空 → base 槽内容不变；非空 → 宏拼入 |
| 3 | 越界 join（`join_from: 99`） | 保存拒绝，文案含下标 |

**验收门禁**：每步以 `cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进，禁止跳过失败测试。

## 8. 风险与非目标（明确不做）

- **风险**：`visual.rs` 双方言骨架是回归高发区——每片必须分别断言；
- **非目标**：不做层级二宏展开；不做槽位角色递归嵌套；不引入 serde。

## 6. 迁移切片：`plugin.js` 端（Obsidian）

Obsidian 端无独立 schema——它消费与桌面端同一份目录 JSON。改法：

1. `catalog()` 透传 `roleSpecs`（`directEntries/subCategories` 原样保留）；
2. palette pill 的角色分组渲染按 §5 的 `SlotRole` 分组键生成；
3. 兼容：无 `roles` 的格式走现状路径（`role_specs = None`），palette 行为零变更。

## 7. 回归矩阵（落地后必须全绿）

| # | 场景 | 断言 |
|---|---|---|
| 1 | 旧文件（无 `roles`）加载 | 22 项测试零修改通过；`role_specs = None` 路径 |
| 2 | env 网格（2×3） | 行优先渲染；↑=slot1；跨行保持列号 |
| 3 | `autoJoin` 两态 | cond 空 → base 槽内容不变；非空 → 宏拼入 |
| 4 | 孤立 role（roleSpecs 非法） | 该格式跳过，其余格式不受影响 |

## 8. 回滚与非目标（明确不做）

- **回滚**：每个 commit 独立可回滚；协议落地后旧路径（线性数组）保留一个发布周期；
- **非目标**：不做层级二宏展开；不做槽位角色递归嵌套；不引入 serde。

## 6. 迁移与回滚门禁

现状锚点：接 §5 触点清单。迁移按 commit 切片，每片独立可验证：

- **M1 · 角色枚举**：`SlotRole` 枚举 + `from_str` + `metadata`（display/默认行为）落地 `library.rs`；序列化仅写出非默认字段；
- **M2 · 导航几何泛化**：↑/↓ 穿槽按 §5 坐标推导；内置结构保持现状路径（零行为变更）；
- **M3 · wasm 目录**：`node obsidian-mathslot/scripts/build.mjs` 端到端绿（wasm 目录锁校验含 `directEntries/subCategories` 计数）。

每片完成后运行同一门禁；任何一步红灯先修复再前进，禁止跳过失败测试。

## 6. 迁移切片：分阶段落地顺序

```
C1  schema 兼容层（roles 解析 + 序列化透传 + 校验）——唯一阻塞项，红灯即停
C2  空间坐标泛化（slot_grid_pos 行优先）+ Env/Role 双方言渲染分支
C3  editor.rs smart prepend 切换为 role 驱动
C4  UI 表单接入 role 选择；palette 按 role 分组渲染
C5  序列化（roles 字段）+ Obsidian 端渲染 + 回归全绿
```

每片完成后运行同一门禁；任何一步红灯先修复再前进。

## 7. 测试计划（新增 9 项）

| # | 测试 | 断言 |
|---|---|---|
| 1 | `slot_grid_pos` 行优先 | Env 2×3 网格中 slot4 坐标 = (1,1)；↑=slot1；跨行保持列号 |
| 2 | `autoJoin` 两态 | cond 空 → base 槽内容不变；非空 → 宏拼入 |
| 3 | 越界 join（`join_from: 99`） | 保存拒绝，文案含下标 |

**验收门禁**：每步以 `cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进。

---

## 8. 回滚与非目标（明确不做）

- **回滚**：每个 commit 独立可回滚；协议落地后旧路径（线性数组）保留一个发布周期；
- **非目标**：不做层级二宏展开；不做槽位角色递归嵌套；不引入 serde。

## 6. 迁移与回滚门禁

### 6.1 阶段门禁（每阶段独立可回滚）

| 阶段 | 门禁 | 回滚点 |
|---|---|---|
| T1 | 角色枚举 + schema 解析/序列化落地（P0） | 单 commit，不触渲染 |
| T2 | 渲染分支接入（Env/Role 双方言） | 单 commit；`visual.rs` 双实现收敛为单入口 |
| T3 | 导航几何（`slot_grid_pos` 行优先） | 单 commit |
| T4 | UI 表单接入 role 选择 | 单 commit |
| T5 | 序列化（`roles` 字段）+ 回归全绿 | 单 commit |

**C2 · 兼容承诺**：旧 `library.json`（无 `roles`）零改动加载；协议落地后旧渲染路径保留一个发布周期。

### 6.2 回滚顺序

1. 关闭新路径开关（`role_specs = None`）→ 现状路径恢复；
2. 协议落地后旧 schema（无 `roles`）继续可读，不阻塞存量用户；
3. 内置结构（`StructKind`）不迁移——保持现状渲染路径，属后续独立课题。

## 7. 验收矩阵（新增 9 项测试）

| # | 测试 | 断言 |
|---|---|---|
| 1 | `slot_grid_pos` 行优先 | Env 2×3 网格中 slot4 坐标 = (1,1)；↑=slot1；跨行保持列号 |
| 2 | `autoJoin` 两态 | cond 空 → base 槽内容不变；非空 → 宏拼入 |
| 3 | 越界 join（`join_from: 99`） | 保存拒绝，文案含下标 |
| 4 | 深度上限（5000 层 `▸f`） | 解析错误，不 panic |
| 5 | 序列化往返 | v1 文件 → v2 读 → 写 → 读，逐字节一致 |
| 6 | UI 回归 | palette 零抖动；`cargo test --workspace` 全绿 |

---

## 9. 执行顺序速查（给执行模型的 step-by-step）

```text
P0 schema 兼容层落地（roles 解析 + 校验）→ P1 渲染分支接入（Env/Role 双方言）
→ P2 导航几何（slot_grid_pos 行优先）→ P3 UI 表单 → P4 回归全绿
```

每片完成后运行同一门禁；任何一步红灯先修复再前进。

## 6. 迁移与回滚门禁

| 切片 | 内容 | 回滚点 |
|---|---|---|
| T1 | `RoleSpec`/`SlotRole` 枚举落地 | 不触渲染 |
| T2 | `latex.rs`/`scheme_a.rs` 协议驱动分支切换 | 单 commit |
| T3 | `editor.rs` smart prepend 改为 role 驱动 | 单 commit |

## 7. 测试计划（新增 9 项）

| # | 测试 | 断言 |
|---|---|---|
| 1 | `slot_grid_pos` 行优先 | Env 2×3 网格中 slot4 坐标 = (1,1)；↑=slot1；跨行保持列号 |
| 2 | `autoJoin` 两态 | cond 空 → base 槽内容不变；非空 → 宏拼入 |
| 3 | 越界 join（`join_from: 99`） | 保存拒绝，文案含下标 |

**验收门禁**：每步以 `cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进。

## 8. 风险与非目标（明确不做）

- **风险**：`visual.rs` 双方言骨架是回归高发区——每片必须分别断言；
- **非目标**：不做层级二宏展开；不做槽位角色递归嵌套；不引入 serde。

---

## 7. 回归矩阵（落地后必须全绿）

| # | 场景 | 断言 |
|---|---|---|
| 1 | 旧文件（无 `roles`）加载 | 22 项测试零修改通过；`role_specs = None` 路径 |
| 2 | env 网格（2×3） | 行优先渲染；↑=slot1；跨行保持列号 |
| 3 | `autoJoin` 两态 | cond 空 → base 槽内容不变；非空 → 宏拼入 |

**验收门禁**：每步以 `cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进。

## 9. 执行顺序速查（给执行模型的 step-by-step）

```text
P0 schema 兼容层落地（roles 解析 + 校验）→ P1 渲染分支接入（Env/Role 双方言）
→ P2 导航几何（slot_grid_pos 行优先）→ P3 UI 表单 → P4 回归全绿
```

每片完成后运行同一门禁；任何一步红灯先修复再前进。

## 7. 回归矩阵（落地后必须全绿）

| # | 场景 | 断言 |
|---|---|---|
| 1 | 旧文件（无 `roles`）加载 | 22 项测试零修改通过；`role_specs = None` 路径 |
| 2 | env 网格（2×3） | 行优先渲染；↑=slot1；跨行保持列号 |
| 3 | `autoJoin` 两态 | cond 空 → base 槽内容不变；非空 → 宏拼入 |
| 4 | 孤立 role（roleSpecs 非法） | 该格式跳过，其余格式不受影响 |
| 5 | 序列化往返 | v1 文件 → v2 读 → 写 → 读，逐字节一致 |
| 6 | UI 回归 | palette 零抖动；`cargo test --workspace` 全绿 |

**验收门禁**：每步以 `cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进，禁止跳过失败测试。

## 6. 迁移与回滚门禁

### 6.1 阶段门禁（每阶段独立可回滚）

| 阶段 | 内容 | 回滚点 |
|---|---|---|
| T1 | 角色枚举 + schema 解析/序列化落地（P0） | 单 commit，不触渲染 |
| T2 | 渲染分支接入（Env/Role 双方言） | 单 commit；`visual.rs` 双实现收敛为单入口 |
| T3 | 导航几何（`slot_grid_pos` 行优先） | 单 commit |

## 8. 风险与非目标（明确不做）

- **风险**：`visual.rs` 双方言骨架是回归高发区——每片必须分别断言；
- **非目标**：不做层级二宏展开；不做槽位角色递归嵌套；不引入 serde。

---

## 6. 迁移与回滚门禁（分阶段落地，每阶段独立可回滚）

```
M1  library.rs：RoleSpec/SlotRole 枚举 + parse/serialize + 校验接入    —— 不触渲染
M2  latex.rs / scheme_a.rs / visual.rs：协议驱动渲染分支切换            —— 单 commit
M3  editor.rs：smart prepend 切换为 role 驱动                          —— 单 commit
M4  wasm 目录 + UI 表单接入 role 选择                                  —— 单 commit
```

每片完成后运行同一门禁：`cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进，禁止跳过失败测试。

## 8. 风险与非目标（明确不做）

- **风险**：`visual.rs` 双方言骨架是回归高发区——每片必须分别断言；
- **非目标**：不做层级二宏展开；不做槽位角色递归嵌套；不引入 serde。

## 7. 测试计划（新增 9 项）

| # | 测试 | 断言 |
|---|---|---|
| 1 | `slot_grid_pos` 行优先 | Env 2×3 网格中 slot4 坐标 = (1,1)；↑=slot1；跨行保持列号 |
| 2 | `autoJoin` 两态 | cond 空 → base 槽内容不变；非空 → 宏拼入 |
| 3 | 越界 join（`join_from: 99`） | 保存拒绝，文案含下标 |

**验收门禁**：每步以 `cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进，禁止跳过失败测试。

## 9. 执行顺序速查（给执行模型的 step-by-step）

```text
P0 schema 兼容层落地（roles 解析 + 校验）→ P1 渲染分支接入（Env/Role 双方言）
→ P2 导航几何（slot_grid_pos 行优先）→ P3 UI 表单 → P4 回归全绿
```

每片完成后运行同一门禁；任何一步红灯先修复再前进，禁止跳过失败测试。

---

## 8. 迁移与回归门禁

### 8.1 阶段门禁（每阶段独立可回滚）

| 阶段 | 门禁 | 回滚点 |
|---|---|---|
| T1 | `SlotRole` 枚举落地 | 不触渲染 |
| T2 | `latex.rs`/`scheme_a.rs` 协议驱动渲染分支切换 | 单 commit |
| T3 | 导航几何（`slot_grid_pos` 行优先） | 单 commit |

每片完成后运行同一门禁：`cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进，禁止跳过失败测试。

---

## 9. 实现顺序速查（给执行模型的 step-by-step）

```text
P0 schema 兼容层落地（roles 解析 + 校验）→ P1 渲染分支接入（Env/Role 双方言）
→ P2 导航几何（slot_grid_pos 行优先）→ P3 UI 表单 → P4 回归全绿
```

每片完成后运行同一门禁：`cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进，禁止跳过失败测试。

---

## 8. 迁移与回归门禁

```
- cargo test --workspace 全绿
- node obsidian-mathslot/scripts/build.mjs 端到端绿
```

每片完成后运行同一门禁：`cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进，禁止跳过失败测试。

## 8. 风险与非目标（明确不做）

- **风险**：`visual.rs` 双方言骨架是回归高发区——每片必须分别断言；
- **非目标**：不做层级二宏展开；不做槽位角色递归嵌套；不引入 serde。

## 6. 迁移与回归门禁

```
- cargo test --workspace 全绿
- node obsidian-mathslot/scripts/build.mjs 端到端绿
```

每片完成后运行同一门禁：`cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进，禁止跳过失败测试。

## 7. 测试计划（新增 9 项）

| # | 测试 | 断言 |
|---|---|---|
| 1 | `slot_grid_pos` 行优先 | Env 2×3 网格中 slot4 坐标 = (1,1)；↑=slot1；跨行保持列号 |
| 2 | `autoJoin` 两态 | cond 空 → base 槽内容不变；非空 → 宏拼入 |
| 3 | 越界 join（`join_from: 99`） | 保存拒绝，文案含下标 |

**验收门禁**：每步以 `cargo test --workspace` 全绿为门禁；任何一步红灯先修复再前进。

## 9. 实现顺序速查（给执行模型的 step-by-step）

```text
P0 角色模型 → P1 渲染方言 → P2 导航几何 → P3 UI 表单 → P4 回归全绿
```

每片完成后运行同一门禁；任何一步红灯先修复再前进。
