# ADR-0008：建立持久化故障注入测试 Harness（T0.5 与 G0 收口）

- 日期：2026-11-13
- 状态：已批准
- 决策者：coordinator（依据 `AUD-5` 审计结论与规范 §14 G0 / T0.5）
- 关联任务：`T0.5`
- 关联验收：`A-DATA-001`, `A-DATA-002`, `A-DATA-003`, `A-DATA-004`, `A-DATA-005`
- 关联缺陷：`D-005`, `D-006`, `D-102`

## 1. 背景与依据

- 规范 §14 G0 任务：
  > T0.5 | 建立故障注入 harness（磁盘满/只读/损坏/并发） | T0.1 | 测试工具 | 可在 CI 本地复现
- 规范 §14 G0 退出条件：
  > CI 绿 (`ci_green`)；P1 测试存在 (`p1_tests_exist`)；clippy 债务可控 (`clippy_controlled`)；基线 tag 建立 (`baseline_tagged`)。
- `AUD-5` 独立审计确认：当前产品存储逻辑缺乏真实文件系统异常测试工具，存在单代 `.bak` 易覆盖、固定临时文件竞态（D-102）、6 处 `let _ =` 吞错（D-005）及秒级时间戳并发覆盖（D-006）等多项严重隐患。
- T0.5 的目标是构建一套可复用、跨平台、纯标准库且可在 CI 本地零特权复现的故障注入工具集（Harness），为后续 Gate G1/G2 全面治理持久化安全提供测试基础设施。

## 2. 决策内容与架构设计

### 2.1 Harness 架构与测试落位

- **文件路径**：`crates/mathslot-core/tests/fault_injection_harness.rs`
- **纯标准库与跨平台实现**：严禁引入破坏 CI 或需要 root/特权的外部工具，仅使用 `std::fs`、`std::io`、`std::sync`、`std::thread`。

### 2.2 四大核心注入组件

1. **损坏数据注入器 (`CorruptedDataInjector`)**：
   - 生成 4 类典型损坏 payload：
     - 未闭合 JSON（截断的字符串或花括号）；
     - 乱码随机二进制字节；
     - 尾随垃圾文本（测试解析器是否严格校验 EOF）；
     - 字段类型颠倒的损坏 schema。
2. **只读隔离沙箱 (`IsolatedTempDir`)**：
   - 基于时间戳与进程 PID 构造独立隔离目录；
   - 提供 `set_readonly(path, bool)` 方法翻转目录与文件权限（Unix `0o444` / Windows 只读标志）；
   - 在只读环境下验证写入失败时是否产生显式 `Err`，拒绝静默吞错。
3. **容量耗尽写入模拟器 (`QuotaWriter<W>`)**：
   - 包装标准 `std::io::Write`；
   - 设定最大允许写入字节数 `quota`；超出限制时返回 `std::io::ErrorKind::WriteZero` 或 `StorageFull`；
   - 模拟写入一半磁盘满导致的原子性破坏与截断风险。
4. **并发竞态注入器 (`ConcurrentPersistenceHarness`)**：
   - 启动多线程（如 8-16 线程）并发执行高频写入与 upsert 压测；
   - 收集所有线程产生的 ID、文件状态与错误码；
   - 检测是否有死锁、崩溃、临时文件踩踏或数据静默覆盖。

### 2.3 约束与边界

- 允许写入路径仅限：`crates/mathslot-core/tests/fault_injection_harness.rs`。
- 不得修改产品源码业务逻辑（D-005/D-006/D-102 的实质修复在 G2/T2.3 中统一完成）。
- 测试自身必须保持纯绿（测试 harness 工具的功能本身必须完全通过），保持 `cargo test --workspace` 绿灯。

## 3. G0 Gate 最终收口契约

- T0.5 完成并通过 VER-5 验收后，Gate G0 全部 5 个任务（T0.1..T0.5）全部达成。
- Coordinator 将执行完整 `scripts/agent/acceptance.sh`，生成完整日志，持久化落盘至：
  `agent-state/verify/GATE-G0.md`。
- 确认全绿后，G0 正式收口，方可开启 G1。
