//! 持久化安全与故障注入测试工具集 (Fault Injection Harness)
//!
//! 依据 `agent-state/decisions/ADR-0008-fault-injection-harness-t0.5.md` 与 `agent-state/audits/AUD-5.md`。
//! 纯标准库实现（`std::fs`, `std::io`, `std::sync`, `std::thread`），无需宿主机 root 特权，
//! 适用于 CI 与本地测试环境，用于验证持久化安全（A-DATA-001..005）。

use mathslot_core::library::{FormulaEntry, FormulaLibrary, UserLibrary};
use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Barrier, Mutex, RwLock};
use std::thread;

// ============================================================================
// 1. CorruptedDataInjector（损坏数据注入器）
// ============================================================================

/// 损坏数据生成与严格 EOF 校验辅助工具
pub struct CorruptedDataInjector;

impl CorruptedDataInjector {
    /// 注入非闭合 JSON（剥离尾部闭合花括号，模拟半写截断）
    pub fn unclosed_json(valid_json: &str) -> String {
        let trimmed = valid_json.trim_end();
        if let Some(stripped) = trimmed.strip_suffix('}') {
            stripped.to_owned()
        } else {
            trimmed[..trimmed.len().saturating_sub(1)].to_owned()
        }
    }

    /// 注入精准截断字符串（在指定字节处截断，并保证落在 char 边界）
    pub fn truncated_json(valid_json: &str, byte_len: usize) -> String {
        let cut = byte_len.min(valid_json.len());
        let mut idx = cut;
        while idx > 0 && !valid_json.is_char_boundary(idx) {
            idx -= 1;
        }
        valid_json[..idx].to_owned()
    }

    /// 注入精准截断字节切片（模拟写入进程遭 SIGKILL）
    pub fn truncated_at(data: &[u8], cut_offset: usize) -> Vec<u8> {
        let cut = cut_offset.min(data.len());
        data[..cut].to_vec()
    }

    /// 注入非法 UTF-8 字节流（模拟物理坏道或二进制乱码）
    pub fn invalid_utf8_bytes() -> Vec<u8> {
        vec![0x7B, 0x22, 0xFF, 0xFE, 0xFD, 0x80, 0x7D]
    }

    /// 注入尾随垃圾（合法 JSON 尾部追加非法 Token，用于测试解析器是否严格校验 EOF）
    pub fn trailing_garbage(valid_json: &str, garbage: &str) -> String {
        format!("{}\n{}", valid_json.trim_end(), garbage)
    }

    /// 注入极端递归深度的嵌套 JSON（测试递归深度上限，防止栈溢出）
    pub fn deep_nested_json(depth: usize) -> String {
        let mut out = String::with_capacity(depth * 10);
        for _ in 0..depth {
            out.push_str("{\"k\":");
        }
        out.push('1');
        for _ in 0..depth {
            out.push('}');
        }
        out
    }

    /// 注入根层级非对象的非法 Schema 类型（如数组、数字、字符串）
    pub fn invalid_schema_type() -> String {
        "[1, 2, 3, 4]".to_owned()
    }

    /// 检测 JSON 字符串是否在首个有效根结构闭合后存在尾随垃圾内容
    pub fn has_trailing_content(raw: &str) -> bool {
        let trimmed = raw.trim();
        if !trimmed.starts_with('{') {
            return false;
        }

        let mut depth: i64 = 0;
        let mut in_string = false;
        let mut escaped = false;
        let mut first_obj_end = None;

        for (idx, ch) in trimmed.char_indices() {
            if in_string {
                if escaped {
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == '"' {
                    in_string = false;
                }
                continue;
            }

            match ch {
                '"' => in_string = true,
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        first_obj_end = Some(idx + ch.len_utf8());
                        break;
                    }
                }
                _ => {}
            }
        }

        if let Some(end_idx) = first_obj_end {
            let remainder = trimmed[end_idx..].trim();
            !remainder.is_empty()
        } else {
            false
        }
    }

    /// 严格验证 JSON 字符串解析后不得留有尾随残余字符（INV-001 规范校验器）
    pub fn verify_strict_eof(raw: &str) -> Result<(), String> {
        if Self::has_trailing_content(raw) {
            Err("检测到 JSON 根结构后存在未闭合的尾随垃圾数据".to_owned())
        } else {
            Ok(())
        }
    }
}

// ============================================================================
// 2. IsolatedTempDir（跨平台只读与沙箱环境守卫）
// ============================================================================

static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

#[cfg(unix)]
fn set_target_writable(target: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let meta = std::fs::metadata(target)?;
    let mut perms = meta.permissions();
    let is_dir = meta.is_dir();
    let current_mode = perms.mode();
    let new_mode = if is_dir {
        current_mode | 0o755
    } else {
        current_mode | 0o644
    };
    perms.set_mode(new_mode);
    std::fs::set_permissions(target, perms)
}

#[cfg(not(unix))]
fn set_target_writable(target: &Path) -> std::io::Result<()> {
    let meta = std::fs::metadata(target)?;
    let mut perms = meta.permissions();
    perms.set_readonly(false);
    std::fs::set_permissions(target, perms)
}

/// RAII 临时沙箱目录管理工具
///
/// 具备独立路径生成、只读权限切换与 Drop 时安全清理（递归恢复写权限后再删除，防止 /tmp 残留）。
pub struct IsolatedTempDir {
    path: PathBuf,
}

impl IsolatedTempDir {
    /// 在系统临时目录创建带有独立前缀、PID 和原子计数的唯一沙箱目录
    pub fn new(prefix: &str) -> std::io::Result<Self> {
        let count = TEMP_DIR_COUNTER.fetch_add(1, Ordering::SeqCst);
        let pid = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir_name = format!("mathslot_harness_{prefix}_{pid}_{nanos}_{count}");
        let path = std::env::temp_dir().join(dir_name);
        std::fs::create_dir_all(&path)?;
        Ok(Self { path })
    }

    /// 获取沙箱根路径
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// 获取沙箱内相对路径的绝对路径
    pub fn file_path(&self, filename: impl AsRef<Path>) -> PathBuf {
        self.path.join(filename)
    }

    /// 设置文件或目录的只读属性（跨平台标准库与 Unix 权限安全支持）
    pub fn set_readonly(
        &self,
        relative_path: impl AsRef<Path>,
        readonly: bool,
    ) -> std::io::Result<()> {
        let target = self.path.join(relative_path);
        if readonly {
            let meta = std::fs::metadata(&target)?;
            let mut perms = meta.permissions();
            perms.set_readonly(true);
            std::fs::set_permissions(&target, perms)
        } else {
            set_target_writable(&target)
        }
    }

    /// 恢复文件或目录的可写属性
    pub fn restore_writable(&self, relative_path: impl AsRef<Path>) -> std::io::Result<()> {
        self.set_readonly(relative_path, false)
    }
}

impl Drop for IsolatedTempDir {
    fn drop(&mut self) {
        fn make_tree_writable(dir: &Path) {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        make_tree_writable(&p);
                    }
                    if set_target_writable(&p).is_err() {
                        // Drop 过程静默忽略错误并尽力清理
                    }
                }
            }
            if set_target_writable(dir).is_err() {
                // Drop 过程静默忽略错误并尽力清理
            }
        }

        if self.path.exists() {
            make_tree_writable(&self.path);
            if std::fs::remove_dir_all(&self.path).is_err() {
                // Drop 过程静默忽略错误并尽力清理
            }
        }
    }
}

// ============================================================================
// 3. QuotaWriter（受限容量 / 磁盘满模拟 Writer）
// ============================================================================

/// 包装任意底层 `Write`，超出配额时精确返回 `ErrorKind::WriteZero` 模拟 ENOSPC 磁盘满
pub struct QuotaWriter<W: Write> {
    inner: W,
    quota: usize,
    written: usize,
}

impl<W: Write> QuotaWriter<W> {
    pub fn new(inner: W, quota: usize) -> Self {
        Self {
            inner,
            quota,
            written: 0,
        }
    }

    pub fn written_bytes(&self) -> usize {
        self.written
    }

    pub fn quota(&self) -> usize {
        self.quota
    }

    pub fn remaining(&self) -> usize {
        self.quota.saturating_sub(self.written)
    }

    pub fn into_inner(self) -> W {
        self.inner
    }

    pub fn get_ref(&self) -> &W {
        &self.inner
    }

    pub fn get_mut(&mut self) -> &mut W {
        &mut self.inner
    }
}

impl<W: Write> Write for QuotaWriter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if self.written >= self.quota {
            return Err(std::io::Error::new(
                std::io::ErrorKind::WriteZero,
                "Disk quota exceeded: simulated disk full (ENOSPC)",
            ));
        }
        let available = self.quota - self.written;
        let to_write = buf.len().min(available);
        if to_write == 0 {
            return Ok(0);
        }
        let n = self.inner.write(&buf[..to_write])?;
        self.written += n;
        Ok(n)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

// ============================================================================
// 4. ConcurrentPersistenceHarness（并发竞态注入器）
// ============================================================================

/// 并发压测结果报告
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ConcurrentReport {
    pub total_operations: usize,
    pub successful_operations: usize,
    pub failed_operations: usize,
    pub detected_panics: usize,
    pub unique_ids_generated: usize,
    pub collision_count: usize,
}

/// 并发压测执行器
pub struct ConcurrentPersistenceHarness {
    pub num_threads: usize,
    pub iterations_per_thread: usize,
}

pub type ConcurrentRunner = ConcurrentPersistenceHarness;

impl ConcurrentPersistenceHarness {
    pub fn new(num_threads: usize, iterations_per_thread: usize) -> Self {
        Self {
            num_threads,
            iterations_per_thread,
        }
    }

    /// 使用 Arc 与 Barrier 调度多线程同时起跑，高频执行任务并收集指标
    pub fn run_parallel<F>(&self, task: F) -> ConcurrentReport
    where
        F: Fn(usize, usize) -> Result<Option<String>, String> + Send + Sync + 'static,
    {
        let num_threads = self.num_threads;
        let iters = self.iterations_per_thread;
        let task = Arc::new(task);
        let barrier = Arc::new(Barrier::new(num_threads));
        let results = Arc::new(Mutex::new(Vec::with_capacity(num_threads * iters)));

        let mut handles = Vec::with_capacity(num_threads);

        for thread_idx in 0..num_threads {
            let task_clone = Arc::clone(&task);
            let barrier_clone = Arc::clone(&barrier);
            let results_clone = Arc::clone(&results);

            let handle = thread::spawn(move || {
                barrier_clone.wait();

                let mut thread_results = Vec::with_capacity(iters);
                for iter in 0..iters {
                    let res = task_clone(thread_idx, iter);
                    thread_results.push(res);
                }

                if let Ok(mut guard) = results_clone.lock() {
                    guard.extend(thread_results);
                }
            });

            handles.push(handle);
        }

        let mut detected_panics = 0;
        for handle in handles {
            if handle.join().is_err() {
                detected_panics += 1;
            }
        }

        let all_results = results.lock().unwrap().clone();
        let total_operations = all_results.len();
        let mut successful_operations = 0;
        let mut failed_operations = 0;
        let mut generated_ids = Vec::new();

        for res in all_results {
            match res {
                Ok(maybe_id) => {
                    successful_operations += 1;
                    if let Some(id) = maybe_id {
                        generated_ids.push(id);
                    }
                }
                Err(_) => {
                    failed_operations += 1;
                }
            }
        }

        let total_ids = generated_ids.len();
        let unique_ids: HashSet<String> = generated_ids.into_iter().collect();
        let unique_ids_generated = unique_ids.len();
        let collision_count = total_ids.saturating_sub(unique_ids_generated);

        ConcurrentReport {
            total_operations,
            successful_operations,
            failed_operations,
            detected_panics,
            unique_ids_generated,
            collision_count,
        }
    }
}

// ============================================================================
// 5. 验收断言辅助工具集 (Assertion Helpers)
// ============================================================================

/// 验证目标文件存在且内容丝毫不变（A-DATA-002: 保存失败旧文件不受破坏）
pub fn assert_file_intact(path: &Path, expected_content: &str) {
    let content = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("Failed to read target file {}: {e}", path.display()));
    assert_eq!(
        content,
        expected_content,
        "File {} content was unexpectedly altered",
        path.display()
    );
}

/// 验证目录中存在符合 `.corrupt-<timestamp>.json` 规范的隔离文件（A-DATA-001）
pub fn assert_quarantined(dir: &Path, prefix: &str) -> PathBuf {
    let entries = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("Failed to read directory {}: {e}", dir.display()));

    let mut quarantined = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(prefix) && name.contains(".corrupt-") && name.ends_with(".json") {
            quarantined.push(entry.path());
        }
    }

    assert_eq!(
        quarantined.len(),
        1,
        "Expected exactly 1 quarantined file in {} matching prefix '{}', found: {:?}",
        dir.display(),
        prefix,
        quarantined
    );

    quarantined.remove(0)
}

/// 验证目录中无未清理的中间僵尸临时文件 `.tmp`（A-DATA-004）
pub fn assert_no_zombie_tmp(dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                assert_no_zombie_tmp(&p);
            } else {
                let name = entry.file_name().to_string_lossy().to_string();
                assert!(
                    !name.ends_with(".tmp") && !name.contains(".tmp."),
                    "Found zombie temp file: {}",
                    p.display()
                );
            }
        }
    }
}

// ============================================================================
// 6. 核心单测集（验证 Harness 自身功能与故障注入有效性）
// ============================================================================

/// 单测 1：验证 CorruptedDataInjector 的损坏数据生成与 UserLibrary 的拒绝行为
#[test]
fn test_corrupted_json_injection_scenarios() {
    let valid_lib = UserLibrary::default();
    let valid_json = valid_lib.to_json_pretty();
    assert!(
        UserLibrary::from_json(&valid_json).is_ok(),
        "Baseline default library must be valid JSON"
    );

    // 1. 未闭合 JSON 注入与拒绝断言
    let unclosed = CorruptedDataInjector::unclosed_json(&valid_json);
    let unclosed_result = UserLibrary::from_json(&unclosed);
    assert!(
        unclosed_result.is_err(),
        "UserLibrary::from_json must reject unclosed JSON"
    );

    // 2. 截断 JSON 注入与拒绝断言
    let truncated = CorruptedDataInjector::truncated_json(&valid_json, 64);
    let truncated_result = UserLibrary::from_json(&truncated);
    assert!(
        truncated_result.is_err(),
        "UserLibrary::from_json must reject truncated JSON"
    );

    // 3. 非法 Schema 根节点注入（数组而非对象）
    let invalid_schema = CorruptedDataInjector::invalid_schema_type();
    let schema_result = UserLibrary::from_json(&invalid_schema);
    assert!(
        schema_result.is_err(),
        "UserLibrary::from_json must reject non-object root schema"
    );

    // 4. 任意乱码二进制注入
    let corrupt_syntax = "<<<NOT_A_VALID_JSON_OBJECT>>>";
    assert!(UserLibrary::from_json(corrupt_syntax).is_err());

    // 5. 内部字段损坏注入
    let inner_corrupt = valid_json.replace(
        "\"customFormats\": [",
        "\"customFormats\": [ INVALID_UNQUOTED_TOKEN, ",
    );
    assert!(
        UserLibrary::from_json(&inner_corrupt).is_err(),
        "UserLibrary::from_json must reject invalid syntax inside arrays"
    );

    // 6. 非法 UTF-8 字节流解码拒绝
    let invalid_utf8 = CorruptedDataInjector::invalid_utf8_bytes();
    assert!(
        std::str::from_utf8(&invalid_utf8).is_err(),
        "CorruptedDataInjector::invalid_utf8_bytes must produce invalid UTF-8"
    );

    // 7. 尾随垃圾检测与严格 EOF 校验辅助断言
    let with_trailing =
        CorruptedDataInjector::trailing_garbage(&valid_json, "MALICIOUS_GARBAGE_PAYLOAD");
    assert!(
        CorruptedDataInjector::has_trailing_content(&with_trailing),
        "CorruptedDataInjector must detect trailing content"
    );
    assert!(
        CorruptedDataInjector::verify_strict_eof(&with_trailing).is_err(),
        "Strict EOF checker must reject payload with trailing garbage"
    );
    assert!(
        CorruptedDataInjector::verify_strict_eof(&valid_json).is_ok(),
        "Strict EOF checker must accept valid pristine JSON"
    );

    // 8. 极端深度嵌套注入
    let deep_nested = CorruptedDataInjector::deep_nested_json(256);
    assert!(
        UserLibrary::from_json(&deep_nested).is_err(),
        "UserLibrary::from_json must reject JSON exceeding depth limit"
    );
}

/// 单测 2：验证 IsolatedTempDir 的只读权限切换与真实文件系统拒绝模拟
#[test]
fn test_readonly_filesystem_simulation() -> std::io::Result<()> {
    let sandbox = IsolatedTempDir::new("readonly_test")?;
    let test_file = sandbox.file_path("config.json");
    let initial_data = "{\"schema_version\": 1, \"status\": \"pristine\"}";

    // 写入初始文件并验证完整性
    std::fs::write(&test_file, initial_data)?;
    assert_file_intact(&test_file, initial_data);

    // 设置文件为只读
    sandbox.set_readonly("config.json", true)?;

    // 验证在只读文件上执行写入必须抛出 PermissionDenied 错误
    let write_res = std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(&test_file);
    assert!(
        write_res.is_err(),
        "Opening readonly file with write permission must fail"
    );
    let err = write_res.unwrap_err();
    assert_eq!(
        err.kind(),
        std::io::ErrorKind::PermissionDenied,
        "Error kind must be PermissionDenied"
    );

    // 验证文件在只读保护下内容毫发无损
    assert_file_intact(&test_file, initial_data);

    // 恢复可写并验证可正常修改
    sandbox.restore_writable("config.json")?;
    let updated_data = "{\"schema_version\": 1, \"status\": \"updated\"}";
    std::fs::write(&test_file, updated_data)?;
    assert_file_intact(&test_file, updated_data);

    // 验证只读子目录阻止新建文件
    let sub_dir = sandbox.file_path("readonly_subdir");
    std::fs::create_dir(&sub_dir)?;
    sandbox.set_readonly("readonly_subdir", true)?;

    let new_file_path = sub_dir.join("new_entry.json");
    let create_res = std::fs::File::create(&new_file_path);
    assert!(
        create_res.is_err(),
        "Creating file in readonly directory must fail"
    );
    assert_eq!(
        create_res.unwrap_err().kind(),
        std::io::ErrorKind::PermissionDenied
    );

    // 恢复目录可写权限
    sandbox.restore_writable("readonly_subdir")?;
    let create_ok = std::fs::File::create(&new_file_path);
    assert!(create_ok.is_ok());

    Ok(())
}

/// 单测 3：验证 QuotaWriter 模拟磁盘满（ENOSPC / WriteZero）及截断检测
#[test]
fn test_quota_writer_simulates_disk_full() -> std::io::Result<()> {
    // 1. 内存 Buffer 配额截断模拟
    let quota = 32;
    let buffer = Vec::new();
    let mut writer = QuotaWriter::new(buffer, quota);

    let large_payload = b"0123456789abcdef0123456789abcdef_EXTRA_TAIL_DATA_EXCEEDING_QUOTA";
    let write_all_res = writer.write_all(large_payload);

    assert!(
        write_all_res.is_err(),
        "Writing payload exceeding quota must return Err"
    );
    let err = write_all_res.unwrap_err();
    assert_eq!(
        err.kind(),
        std::io::ErrorKind::WriteZero,
        "Exceeding quota must produce WriteZero error"
    );
    assert_eq!(writer.written_bytes(), quota);
    assert_eq!(writer.remaining(), 0);

    let inner = writer.into_inner();
    assert_eq!(inner.len(), quota);
    assert_eq!(&inner[..], &large_payload[..quota]);

    // 2. 真实文件配额截断模拟
    let sandbox = IsolatedTempDir::new("quota_file_test")?;
    let target_file = sandbox.file_path("quota_disk.bin");

    let file = std::fs::File::create(&target_file)?;
    let mut file_writer = QuotaWriter::new(file, 48);

    let stream_data = vec![0x42u8; 128];
    let file_res = file_writer.write_all(&stream_data);
    assert!(file_res.is_err());
    drop(file_writer);

    // 物理磁盘文件大小应严格停留在 48 字节截断处
    let file_meta = std::fs::metadata(&target_file)?;
    assert_eq!(
        file_meta.len(),
        48,
        "Physical file size must match quota bytes on disk-full simulation"
    );

    // 3. 零配额边界测试
    let mut zero_writer = QuotaWriter::new(Vec::new(), 0);
    let zero_res = zero_writer.write(b"x");
    assert!(zero_res.is_err());
    assert_eq!(zero_res.unwrap_err().kind(), std::io::ErrorKind::WriteZero);

    Ok(())
}

/// 单测 4：验证 ConcurrentPersistenceHarness 的多线程高并发调度与冲突检测能力
#[test]
fn test_concurrent_upsert_stress_harness() {
    let harness = ConcurrentPersistenceHarness::new(8, 20);

    // 场景 A：8 线程并发插入唯一 ID 公式（验证无死锁、全成功且零碰撞）
    let shared_lib = Arc::new(Mutex::new(FormulaLibrary {
        entries: Vec::new(),
    }));

    let lib_for_task = Arc::clone(&shared_lib);
    let report_unique = harness.run_parallel(move |thread_id, iter| {
        let entry_id = format!("concurrent-t{thread_id}-i{iter}");
        let entry = FormulaEntry {
            id: entry_id.clone(),
            name: format!("Formula {thread_id}-{iter}"),
            category: "并发测试".to_owned(),
            source: format!("x_{{{thread_id}_{iter}}}"),
            desc: String::new(),
            tags: vec!["concurrent".to_owned()],
            is_builtin: false,
            created_at: 1700000000,
        };

        let mut guard = lib_for_task.lock().map_err(|e| e.to_string())?;
        guard.upsert(entry)?;
        Ok(Some(entry_id))
    });

    assert_eq!(report_unique.total_operations, 160);
    assert_eq!(report_unique.successful_operations, 160);
    assert_eq!(report_unique.failed_operations, 0);
    assert_eq!(report_unique.detected_panics, 0);
    assert_eq!(report_unique.unique_ids_generated, 160);
    assert_eq!(report_unique.collision_count, 0);

    let final_entries = shared_lib.lock().unwrap().entries.len();
    assert_eq!(
        final_entries, 160,
        "All 160 unique entries must reside in formula library"
    );

    // 场景 B：故意制造冲突 ID，验证 Harness 能够精确检测并统计 collision_count
    let harness_collision = ConcurrentPersistenceHarness::new(8, 10);
    let report_collision = harness_collision.run_parallel(|_thread_id, iter| {
        // 模 4 取余：80 次操作中仅会产生 4 个不同的 ID
        let colliding_id = format!("collision-slot-{}", iter % 4);
        Ok(Some(colliding_id))
    });

    assert_eq!(report_collision.total_operations, 80);
    assert_eq!(report_collision.successful_operations, 80);
    assert_eq!(report_collision.unique_ids_generated, 4);
    assert_eq!(
        report_collision.collision_count, 76,
        "80 operations with 4 unique keys must yield exactly 76 collisions"
    );

    // 场景 C：多线程并发读写 RwLock 压测（4 读 4 写无死锁）
    let rw_lib = Arc::new(RwLock::new(UserLibrary::default()));
    let harness_rw = ConcurrentPersistenceHarness::new(8, 15);

    let rw_lib_clone = Arc::clone(&rw_lib);
    let report_rw = harness_rw.run_parallel(move |thread_id, iter| {
        if thread_id % 2 == 0 {
            // 偶数线程：读操作
            let guard = rw_lib_clone.read().map_err(|e| e.to_string())?;
            let count = guard.formulas.entries.len();
            assert!(count > 0);
            Ok(None)
        } else {
            // 奇数线程：写操作
            let mut guard = rw_lib_clone.write().map_err(|e| e.to_string())?;
            let entry = FormulaEntry {
                id: format!("rw-t{thread_id}-i{iter}"),
                name: format!("RW Entry {thread_id}-{iter}"),
                category: "RW测试".to_owned(),
                source: "y = x".to_owned(),
                desc: String::new(),
                tags: Vec::new(),
                is_builtin: false,
                created_at: 1700000000,
            };
            guard.formulas.upsert(entry)?;
            Ok(Some(format!("rw-t{thread_id}-i{iter}")))
        }
    });

    assert_eq!(report_rw.total_operations, 120);
    assert_eq!(report_rw.successful_operations, 120);
    assert_eq!(report_rw.detected_panics, 0);
}

/// 单测 5：验证断言辅助工具集（assert_file_intact, assert_quarantined, assert_no_zombie_tmp）
#[test]
fn test_assertion_helpers_and_quarantine_simulation() -> std::io::Result<()> {
    let sandbox = IsolatedTempDir::new("assertion_helpers_test")?;
    let main_file = sandbox.file_path("library.json");
    let pristine_content = "{\"schema_version\": 1}";

    std::fs::write(&main_file, pristine_content)?;
    assert_file_intact(&main_file, pristine_content);

    // 模拟生成损坏隔离文件
    let corrupt_file = sandbox.file_path("library.corrupt-1700000000.json");
    std::fs::write(&corrupt_file, b"corrupted payload")?;

    let found_quarantine = assert_quarantined(sandbox.path(), "library");
    assert_eq!(found_quarantine, corrupt_file);

    let mut buf = String::new();
    std::fs::File::open(&found_quarantine)?.read_to_string(&mut buf)?;
    assert_eq!(buf, "corrupted payload");

    // 验证正常情况下无僵尸临时文件
    assert_no_zombie_tmp(sandbox.path());

    // 验证当存在残留临时文件时能够成功触发断言拦截
    let zombie_tmp = sandbox.file_path("library.json.tmp");
    std::fs::write(&zombie_tmp, b"zombie bytes")?;

    let panic_result = std::panic::catch_unwind(|| {
        assert_no_zombie_tmp(sandbox.path());
    });
    assert!(
        panic_result.is_err(),
        "assert_no_zombie_tmp must panic when .tmp files exist"
    );

    // 清理僵尸临时文件后重新恢复绿灯
    std::fs::remove_file(&zombie_tmp)?;
    assert_no_zombie_tmp(sandbox.path());

    Ok(())
}
