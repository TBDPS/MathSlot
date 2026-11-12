# 人工复核卡（每轮 5 分钟）

用途：agent 说"完成/通过"时，你不读它的长篇报告，只按这张卡核验。**没有命令输出的结论一律不算。**

---

## 第 0 步：这份回复有没有"可批准的最小信息"

一次合格的开工回复必须包含：

- [ ] 当前 `Gate`（G0–G4）
- [ ] 选定的 `T-*`（必须能在 §14 里查到）
- [ ] `depends_on` 是否满足，依据是哪一行
- [ ] 允许写入的路径（越界即拒绝）
- [ ] 本轮 4 个角色的产物文件名
- [ ] 第一条要跑的命令
- [ ] 明确"等你确认后开工"

缺任意一项 → 让它补齐再谈。

---

## 第 1 步：六条命令（30 秒）

```bash
cd /home/mat/Projects/mathslot-next

# 1. 状态机说的 Gate 与轮次
python3 -c "import json;d=json.load(open('agent-state/state.json'));print(d['gate'],d['round'],d['next_task'])"

# 2. T-* 是否真的存在（把 T0.1 换成它说的任务）
grep -n '| T0.1 |' docs/LLM_IMPLEMENTATION_SPEC.md

# 3. 工作区状态（不该有它未声明的改动）
git status --short && git log -1 --oneline

# 4. 它宣称的缺陷现状（以 D-001 为例）
python3 scripts/agent/audit_palette.py | tail -6

# 5. 它宣称的基线（fmt 现在应为失败）
cargo fmt --check >/dev/null 2>&1; echo "fmt_exit=$?"

# 6. CI 目录现状（T0.1 前只应有 release.yml）
ls .github/workflows
```

对照：Gate 应为 G0；轮次 0；`T0.1` 在 §14 第 965 行附近；工作区干净；调色板 5 条不一致；`fmt_exit=1`；`release.yml` 一个。

---

## 第 2 步：引用核验

- 让它给出 `文件:行号`，你 `sed -n 'N,Mp' 文件` 看原文。
- 行号差 ±3 行可接受；**章节名错了不可接受**（例如把 §14 的 T0.1 表说成 §14.1）。
- "我读过规范，任务存在"不算证据。

---

## 第 3 步：diff 核验（实现轮）

```bash
git diff --stat HEAD~1 HEAD
git diff HEAD~1 HEAD -- .github/ src/ crates/ scripts/agent/
```

只允许出现在 brief 声明的路径里。特别检查：

- 改动是否碰了 `scripts/agent/**`（门禁工具，implementer 不得改）
- 是否碰了 `docs/LLM_IMPLEMENTATION_SPEC.md`（规范不可改）
- 是否删/跳过测试、加 `#[ignore]`、`#[allow]`
- CI 里是否出现 `continue-on-error: true`、`|| true`、`set +e`

---

## 第 4 步：报告核验（AUD / VER）

一份有效的 `AUD-*.md` / `VER-*.md` 必须含：

- [ ] 命令原文
- [ ] 退出码
- [ ] 输出尾部（含关键行，不是"全部通过"四个字）
- [ ] 逐条 `A-*` / `S-*` 对照表
- [ ] 未验证项与原因

缺任何一项 → 判为无效报告，不算通过。

---

## 第 5 步：红旗（出现一条就停）

| 红旗 | 为什么危险 |
|---|---|
| "已通过 / 零缺陷 / 生产级 / 完美达标" | 不可证伪；上一轮 52 处这种措辞与今日代码矛盾 |
| 说跑了命令但不贴输出 | 可能没跑 |
| 改规范来迁就实现 | 契约失效 |
| 删除/跳过测试换绿 | 掩盖回归 |
| 一次提交跨多个 `T-*` | 无法回滚、无法验收 |
| 改 `scripts/agent/**` | 自己改考卷 |
| 同时改 UI 与修 P1 | 范围蔓延 |
| 提出新功能并准备开工 | 必须先进 backlog，人工批准 |

---

## 第 6 步：批准模板

```text
批准 T0.1。附加四个条件：
1) 引用必须给到 §14 表内行号与原文，不要写 §14.1。
2) 允许写路径：.github/workflows/ci.yml（实现者）；scripts/agent/** 只读；
   docs/ 与规范只读。
3) CI 在 G0 期间允许红，但不得用 continue-on-error / || true / set +e 掩盖；
   必须复用 release.yml 的 wasm32 + node 22 + node obsidian-mathslot/scripts/build.mjs 配方；
   不要新引入 wasm-opt/binaryen。
4) 审计范围补上 D-101 与 cargo fmt --check 失败；AUD-1 必须有命令与输出尾部。
开工。完成后先交 VER-1，不要直接宣布通过。
```

---

## 第 7 步：什么时候才算这一轮结束

- `agent-state/state.json` 的 `round` 增加 1；
- `agent-state/HANDOFF.md` 三行已更新；
- `agent-state/verify/VER-<round>.md` 存在且为 PASS；
- 提交信息含 `T-*` 与 `D-*`；
- 你的六条命令里没有新红项（或新红项被明确登记）。

只有这五条同时成立，才批准下一轮。
