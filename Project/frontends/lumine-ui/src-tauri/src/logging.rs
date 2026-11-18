//! LumineAgent 桌面壳日志模块。
//!
//! 设计目标：出问题时能靠日志直接定位，不用猜。
//!
//! - **双通道输出**：stderr（开发期实时看）+ 日志文件（用户可提交，事后复盘）。
//! - **分级**：ERROR / WARN / INFO / DEBUG / TRACE，由 `LUMINE_LOG` 环境变量控制。
//!   例如 `LUMINE_LOG=debug` 或 `LUMINE_LOG=lumine_agent=trace,info`。
//! - **带模块标签**：每条日志都带 `[模块名]`，出问题时一眼看出是壳、IPC 还是后端管理在报错。
//! - **进程内环形缓冲**：保留最近 N 条，UI 可通过 `log_dump` 命令取回，
//!   便于「用户截图报障 → 开发读日志」这种无附件场景。
//!
//! 不引入 tracing 生态：壳的日志量很小（启动、窗口、流式通道、中止），
//! 自己实现可避免额外依赖，也能精确控制文件格式与滚动策略。

use std::collections::VecDeque;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

/// 日志级别。数值越大越严重，与常见 syslog 习惯一致。
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
#[repr(u8)]
pub enum Level {
    Trace = 0,
    Debug = 1,
    Info = 2,
    Warn = 3,
    Error = 4,
}

impl Level {
    fn as_str(self) -> &'static str {
        match self {
            Level::Trace => "TRACE",
            Level::Debug => "DEBUG",
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        }
    }

    fn from_str(s: &str) -> Option<Level> {
        match s.to_ascii_lowercase().as_str() {
            "trace" => Some(Level::Trace),
            "debug" => Some(Level::Debug),
            "info" => Some(Level::Info),
            "warn" | "warning" => Some(Level::Warn),
            "error" => Some(Level::Error),
            _ => None,
        }
    }
}

impl fmt::Display for Level {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 进程内全局状态：写文件用的句柄 + 环形缓冲 + 当前级别。
struct LogState {
    /// 日志文件句柄；为 None 表示只输出 stderr（初始化失败时的降级路径）
    file: Option<File>,
    /// 最近若干条日志，供 UI 取回
    buffer: Mutex<VecDeque<String>>,
    /// 环形缓冲容量
    capacity: usize,
    /// 文件最大字节数，超过后轮转
    max_bytes: u64,
    /// 已写入字节数（用于判断轮转）
    written: u64,
    /// 日志文件路径，供 UI 显示「打开日志目录」
    path: Option<PathBuf>,
}

static STATE: OnceLock<Mutex<LogState>> = OnceLock::new();
static LEVEL: AtomicU8 = AtomicU8::new(Level::Info as u8);

/// 环形缓冲默认容量：够看完一次完整对话的日志，又不至于吃掉太多内存。
const DEFAULT_CAPACITY: usize = 500;
/// 单文件上限 8MB，超出后轮转保留 .1 历史。
const DEFAULT_MAX_BYTES: u64 = 8 * 1024 * 1024;

fn state() -> &'static Mutex<LogState> {
    STATE.get_or_init(|| {
        Mutex::new(LogState {
            file: None,
            buffer: Mutex::new(VecDeque::with_capacity(DEFAULT_CAPACITY)),
            capacity: DEFAULT_CAPACITY,
            max_bytes: DEFAULT_MAX_BYTES,
            written: 0,
            path: None,
        })
    })
}

/// 初始化日志系统。
///
/// - `dir`：日志目录（通常取 `app_log_dir()`）；为 `None` 时只写 stderr。
/// - `level`：初始级别；`LUMINE_LOG` 环境变量优先。
pub fn init(dir: Option<PathBuf>, level: Level) {
    let resolved = resolve_level(level);
    LEVEL.store(resolved as u8, Ordering::Relaxed);

    let mut st = state().lock().unwrap_or_else(|e| e.into_inner());

    if let Some(dir) = dir {
        if fs::create_dir_all(&dir).is_ok() {
            let path = dir.join("lumine.log");
            match open_log_file(&path) {
                Ok((file, len)) => {
                    st.file = Some(file);
                    st.written = len;
                    st.path = Some(path);
                }
                Err(error) => {
                    // 降级：文件打不开就只走 stderr，不让日志初始化拖垮启动
                    eprintln!("[lumine] 日志文件打开失败，仅输出到 stderr: {error}");
                }
            }
        }
    }
}

/// 解析生效级别：`LUMINE_LOG` 优先于调用方传入的默认值。
///
/// 支持的写法：
/// - `LUMINE_LOG=debug` —— 单一级别
/// - `LUMINE_LOG=trace,info` —— 多级别逗号分隔，取其中最严格的一个
/// - `LUMINE_LOG=lumine_agent=trace,info` —— `target=level` 前缀；本壳只有一个
///   全局级别，因此忽略 target 名、只取其级别部分（与 Rust `tracing` 习惯兼容）
fn resolve_level(default: Level) -> Level {
    let Ok(raw) = std::env::var("LUMINE_LOG") else {
        return default;
    };
    let mut level = default;
    for part in raw.split(',') {
        let mut part = part.trim();
        if part.is_empty() {
            continue;
        }
        // 兼容 `target=level`：`lumine_agent=trace` → `trace`
        if let Some((_target, rest)) = part.split_once('=') {
            part = rest.trim();
        }
        if let Some(parsed) = Level::from_str(part) {
            // 取更严格的级别（数值更小 = 更详细）
            if parsed < level {
                level = parsed;
            }
        }
    }
    level
}

/// 当前生效级别，供 UI 展示。
pub fn current_level() -> Level {
    match LEVEL.load(Ordering::Relaxed) {
        0 => Level::Trace,
        1 => Level::Debug,
        2 => Level::Info,
        3 => Level::Warn,
        4 => Level::Error,
        _ => Level::Info,
    }
}

/// 日志文件路径；未启用文件输出时为 None。
pub fn log_path() -> Option<PathBuf> {
    state().lock().unwrap_or_else(|e| e.into_inner()).path.clone()
}

/// 写一条日志。
///
/// `target` 是模块标签，例如 `shell` / `ipc` / `backend`。
pub fn log(level: Level, target: &str, message: &str) {
    if level < current_level() {
        return;
    }
    let line = format_line(level, target, message);

    // stderr：开发期实时可见；用 eprintln 保证带换行且不被缓冲吞掉
    eprintln!("{line}");

    let mut st = state().lock().unwrap_or_else(|e| e.into_inner());

    // 环形缓冲：给 UI 的 log_dump 用
    {
        let mut buf = st.buffer.lock().unwrap_or_else(|e| e.into_inner());
        if buf.len() >= st.capacity {
            buf.pop_front();
        }
        buf.push_back(line.clone());
    }

    // 文件：滚动写
    // 先判断是否需要轮转（轮转会替换 st.file，必须在借用之外完成）
    if st.written >= st.max_bytes {
        rotate(&mut st);
    }
    if let Some(file) = st.file.as_mut() {
        if file.write_all(line.as_bytes()).is_ok() {
            let _ = file.write_all(b"\n");
            let _ = file.flush();
            st.written += line.len() as u64 + 1;
        }
    }
}

/// 轮转：当前文件改名为 .1，历史文件丢弃（只保留一代，够用且不无限膨胀）。
fn rotate(st: &mut LogState) {
    let Some(path) = st.path.clone() else { return };
    let backup = path.with_extension("log.1");
    let _ = fs::remove_file(&backup);
    let _ = fs::rename(&path, backup);
    match open_log_file(&path) {
        Ok((file, len)) => {
            st.file = Some(file);
            st.written = len;
        }
        Err(_) => {
            st.file = None;
        }
    }
}

/// 以追加模式打开日志文件，返回句柄与已有字节数。
fn open_log_file(path: &PathBuf) -> std::io::Result<(File, u64)> {
    let file = OpenOptions::new().create(true).append(true).open(path)?;
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    Ok((file, len))
}

/// 格式化一行日志：`2026-11-18T18:42:26.123Z [INFO ] [shell] message`
///
/// 消息里的 `\r`/`\n` 一律转义成字面量：后端错误文本、用户消息都会经 `log_write`
/// 进入这里，不转义就能伪造出 `[ERROR]` 行，干扰事后排障。
fn format_line(level: Level, target: &str, message: &str) -> String {
    let ts = timestamp();
    let safe = message.replace('\r', "\\r").replace('\n', "\\n");
    format!("{ts} [{:<5}] [{target}] {safe}", level.as_str())
}

/// 生成 ISO8601 风格 UTC 时间戳（毫秒精度）。
///
/// 不引入 chrono：只��要「年月日时分秒」格式化，手写反而更可控。
fn timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();

    let (year, month, day) = civil_from_days((secs / 86_400) as i64);
    let sod = secs % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60
    )
}

/// 从「自 1970-01-01 起的天数」反推公历年月日。
///
/// 采用 Howard Hinnant 的 civil_from_days 算法，避免闰年特判。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 取回环形缓冲中的日志（UI 侧 `log_dump` 命令用）。
pub fn dump() -> Vec<String> {
    let st = state().lock().unwrap_or_else(|e| e.into_inner());
    let buf = st.buffer.lock().unwrap_or_else(|e| e.into_inner());
    buf.iter().cloned().collect()
}

/// TRACE 级宏：细节追踪，默认不输出。
#[macro_export]
macro_rules! log_trace {
    ($target:expr, $($arg:tt)*) => {
        $crate::logging::log($crate::logging::Level::Trace, $target, &format!($($arg)*))
    };
}

/// DEBUG 级宏：调试信息。
#[macro_export]
macro_rules! log_debug {
    ($target:expr, $($arg:tt)*) => {
        $crate::logging::log($crate::logging::Level::Debug, $target, &format!($($arg)*))
    };
}

/// INFO 级宏：关键节点（启动、就绪、退出）。
#[macro_export]
macro_rules! log_info {
    ($target:expr, $($arg:tt)*) => {
        $crate::logging::log($crate::logging::Level::Info, $target, &format!($($arg)*))
    };
}

/// WARN 级宏：可恢复的异常。
#[macro_export]
macro_rules! log_warn {
    ($target:expr, $($arg:tt)*) => {
        $crate::logging::log($crate::logging::Level::Warn, $target, &format!($($arg)*))
    };
}

/// ERROR 级宏：功能不可用。
#[macro_export]
macro_rules! log_error {
    ($target:expr, $($arg:tt)*) => {
        $crate::logging::log($crate::logging::Level::Error, $target, &format!($($arg)*))
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_parses_case_insensitively() {
        assert_eq!(Level::from_str("DEBUG"), Some(Level::Debug));
        assert_eq!(Level::from_str("Warning"), Some(Level::Warn));
        assert_eq!(Level::from_str("nope"), None);
    }

    #[test]
    fn level_ordering_is_by_severity() {
        assert!(Level::Error > Level::Warn);
        assert!(Level::Warn > Level::Info);
        assert!(Level::Info > Level::Debug);
        assert!(Level::Debug > Level::Trace);
    }

    #[test]
    fn civil_from_days_matches_known_dates() {
        // 1970-01-01
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 2026-11-18
        assert_eq!(civil_from_days(20_775), (2026, 11, 18));
        // 2024-02-29（闰年）
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
        // 2000-03-01（2000 是闰年，百年闰年）
        assert_eq!(civil_from_days(11_017), (2000, 3, 1));
        // 边界：非闰年的 1 月 31 日
        assert_eq!(civil_from_days(19_753), (2024, 1, 31));
    }

    #[test]
    fn line_format_contains_level_and_target() {
        let line = format_line(Level::Warn, "ipc", "测试");
        assert!(line.contains("[WARN ]"));
        assert!(line.contains("[ipc]"));
        assert!(line.contains("测试"));
        // 时间戳形如 2026-11-18T18:42:26.123Z，位于行首
        let stamp = line.split(' ').next().unwrap_or_default();
        assert!(stamp.starts_with("20"), "时间戳应以年份开头: {stamp}");
        assert!(stamp.contains('T'), "时间戳应含日期与时间分隔符: {stamp}");
        assert!(stamp.ends_with('Z'), "时间戳应以 Z 结尾: {stamp}");
    }
}
