# ADR-0001：冻结方式与工作区选择

- 日期：2026-11-12
- 状态：已生效
- 决策者：coordinator

## 背景

用户要求"先冻结项目文件以防重构失败，再重新创建一个项目"。当前磁盘上已有三个候选：`mathslot`（6 文件快照，不可构建）、`mathslot-next`（可构建，133 测试）、以及不存在的"全新项目"。

## 决策

1. **冻结**：`mathslot-next` 打 tag `freeze/pre-refactor-20261112`，并生成只读副本 `/home/mat/Projects/mathslot-freeze-20261112`（11 MB，排除 `target/`）。
2. **不新建第三份副本**：在 `mathslot-next` 上开分支 `refactor/v1`。理由：
   - 133 个测试是 G1 的 parity 基线（T1.7），复制目录会立刻产生两份基线；
   - 规范把 canonical repo 固定为 `mathslot-next`；
   - 真正的"新结构"是 G1/G2 的 crate 拆分，不是新目录。
3. **冻结体只读**：`chmod -R a-w`，恢复方式见下。

## 后果

- 任何"推倒重来"的冲动都要先回到本 ADR；若要新目录，需人工批准并说明如何保留 parity 基线。
- 回滚：`git checkout main && git reset --hard freeze/pre-refactor-20261112`，或从只读副本 rsync 回来。

## 恢复命令

```bash
# 从冻结体恢复（谨慎，先确认没有要保留的新改动）
rsync -a --delete /home/mat/Projects/mathslot-freeze-20261112/ /home/mat/Projects/mathslot-next/ \
  --exclude target

# 或从 git 回滚
git -C /home/mat/Projects/mathslot-next checkout main
git -C /home/mat/Projects/mathslot-next reset --hard freeze/pre-refactor-20261112
```
