use std::collections::HashMap;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio::sync::watch;


#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Health {
    Waiting,
    Ready,
    Failed,
}

/// 后端子进程句柄：所有 chat 命令经由它取地址、等就绪、注册中止信号
pub struct BackendHandle {
    pub client: reqwest::Client,
    pub addr: Mutex<Option<String>>,
    pub health_tx: watch::Sender<Health>,
    pub failure: Mutex<Option<String>>,
    pub child: Mutex<Option<Child>>,
    pub aborts: Arc<Mutex<HashMap<u64, Arc<tokio::sync::Notify>>>>,
    pub next_id: AtomicU64,
}

pub fn start(app: AppHandle) {
    let (health_tx, _) = watch::channel(Health::Waiting);
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .expect("failed to build reqwest client");
    app.manage(BackendHandle {
        client,
        addr: Mutex::new(None),
        health_tx,
        failure: Mutex::new(None),
        child: Mutex::new(None),
        aborts: Arc::new(Mutex::new(HashMap::new())),
        next_id: AtomicU64::new(1),
    });
    tauri::async_runtime::spawn(async move { boot(app).await });
}

/// 写入健康状态。
///
/// 关键：必须用 `send_replace` 而不是 `send`。
/// `watch::Sender::send` 在**当前没有接收者**时会直接返回 Err 且**不更新值**，
/// 而本模块的 `health_tx` 初始接收端在建好后即被丢弃（`let (health_tx, _) = ...`），
/// 因此 `send` 几乎必然失败 → 健康态永远停在 Waiting → `chat_stream` 里的
/// `rx.changed().await` 永久挂起 → 前端表现为 invoke 无响应、无流式输出、Esc 无效。
fn set_health(state: &BackendHandle, health: Health) {
    write_health(&state.health_tx, health);
}

/// 真正写健康态的实现。单独抽出来是为了让回归测试覆盖**应用代码**本身，
/// 而不是只验证 tokio 库行为——若有人把这里改回 `send`，测试会立刻失败。
fn write_health(tx: &watch::Sender<Health>, health: Health) {
    // send_replace 无论如何都会写入值并通知已有接收者
    let previous = tx.send_replace(health);
    if previous != health {
        crate::log_info!("backend", "后端健康状态: {previous:?} -> {health:?}");
    }
}

/// 记录失败原因并把健康态置为 Failed。
fn fail(state: &BackendHandle, message: String) {
    crate::log_error!("backend", "{message}");
    *state.failure.lock().unwrap() = Some(message);
    set_health(state, Health::Failed);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 回归测试：健康状态必须在「无接收者」时也能写入。
    ///
    /// 这是本项目最贵的一个 bug 的根因：`watch::Sender::send` 在没有接收者时
    /// 返回 Err 且**不更新值**，导致后端就绪后健康态仍是 Waiting，
    /// `chat_stream` 永久挂在 `rx.changed().await` 上（前端表现为 invoke 无响应）。
    /// `send_replace` 没有这个语义，因此必须用它。
    #[test]
    fn health_state_is_written_even_without_receivers() {
        let (tx, rx) = watch::channel(Health::Waiting);
        // 丢弃初始接收者，模拟「后端就绪时前端还没发第一条消息」的真实情形
        drop(rx);

        // 对照：旧写法 send 在零接收者时失败，值不变（证明原 bug 的机制真实存在）
        assert!(tx.send(Health::Ready).is_err());
        assert_eq!(
            *tx.borrow(),
            Health::Waiting,
            "watch::Sender::send 在无接收者时不会更新值（这正是原 bug 的机制）"
        );

        // 关键：调用应用代码 write_health，而非裸 send_replace。
        // 若有人把 set_health 的实现改回 send，本断言会失败，测试真正防住回归。
        write_health(&tx, Health::Ready);
        assert_eq!(*tx.borrow(), Health::Ready);
    }

    /// 回归测试：后订阅的接收者必须能看到已写入的健康态。
    ///
    /// 前端在 `chat_stream` 里 `subscribe()` 时，后端可能早已就绪；
    /// 若健康态没被真正写入，新订阅者会永远等 `changed()`。
    #[tokio::test]
    async fn late_subscriber_sees_ready_state() {
        let (tx, _rx) = watch::channel(Health::Waiting);
        write_health(&tx, Health::Ready);

        let mut late = tx.subscribe();
        assert_eq!(*late.borrow_and_update(), Health::Ready);
        // 复刻 chat_stream 的等待逻辑：已是 Ready 时不应进入 changed() 分支
        if *late.borrow() == Health::Waiting {
            // 走到这里说明健康态没写进去，等待会永久挂起
            panic!("健康态仍为 Waiting，chat_stream 会在此永久挂起");
        }
    }
}

async fn boot(app: AppHandle) {
    let state = app.state::<BackendHandle>();
    let Some(binary) = resolve_backend() else {
        fail(
            &state,
            "未找到后端二进制：请设置 LUMINE_BACKEND_BIN 指向 serve.exe，或先构建 Lumine-rust（target/{release,debug}/serve.exe）".into(),
        );
        return;
    };

    let Some(port) = free_port() else {
        fail(&state, "无法分配本地端口".into());
        return;
    };
    let addr = format!("127.0.0.1:{port}");
    let cwd = backend_cwd(&binary);
    crate::log_info!("backend", "拉起后端 {} (addr {addr}, cwd {})", binary.display(), cwd.display());

    let mut command = Command::new(&binary);
    command.env("LUMINE_ADDR", &addr).current_dir(&cwd);
    // 打包版不能把后端拉成可见的控制台窗口：Windows 下用 CREATE_NO_WINDOW 隐藏。
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    if let Some(key) = packaged_api_key() {
        command.env("DEEPSEEK_API_KEY", key);
    }
    let child = command.spawn();
    match child {
        Err(error) => {
            fail(&state, format!("后端进程启动失败: {error}"));
        }
        Ok(child) => {
            *state.child.lock().unwrap() = Some(child);
            // 健康探测：cargo 冷构建会很慢，上限 30s（120 × 250ms）
            let mut ok = false;
            for attempt in 0..120 {
                if let Ok(res) = state.client.get(format!("http://{addr}/health")).send().await {
                    if res.status().is_success() {
                        ok = true;
                        break;
                    }
                }
                if attempt % 20 == 19 {
                    crate::log_info!("backend", "后端健康探测中…已重试 {} 次", attempt + 1);
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            if ok {
                crate::log_info!("backend", "后端就绪: {addr}");
                *state.addr.lock().unwrap() = Some(addr);
                set_health(&state, Health::Ready);
            } else {
                fail(&state, "后端 30s 内未通过 /health 探测".into());
            }
        }
    }
}

/// 等到后端子进程健康探测完成，返回监听地址。
/// 与 `chat_stream` 共用：workspace_diff 不能再复制一份 Waiting 等待逻辑。
pub async fn wait_addr(state: &BackendHandle) -> Result<String, String> {
    let mut rx = state.health_tx.subscribe();
    let health = *rx.borrow_and_update();
    crate::log_info!("ipc", "等待后端地址，当前健康态={health:?}");
    if health == Health::Waiting {
        crate::log_debug!("ipc", "后端尚未就绪，等待 health 状态变化");
        rx.changed()
            .await
            .map_err(|_| "backend watcher closed".to_string())?;
    }
    match *rx.borrow() {
        Health::Ready => {}
        Health::Failed => {
            let failure = state.failure.lock().unwrap().clone();
            let message = failure.unwrap_or_else(|| "backend unavailable".into());
            crate::log_error!("ipc", "后端不可用: {message}");
            return Err(message);
        }
        Health::Waiting => {
            crate::log_error!("ipc", "等待后端就绪超时");
            return Err("backend startup timeout".into());
        }
    }
    state
        .addr
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "backend addr missing".to_string())
}

/// 退出回收：杀掉后端子进程并 wait 收尸，避免残留 serve.exe
pub fn shutdown(app: &AppHandle) {
    let state = app.state::<BackendHandle>();
    let child = { state.child.lock().unwrap().take() };
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
        crate::log_info!("backend", "后端子进程已回收");
    }
}

fn packaged_api_key() -> Option<String> {
    let path = crate::local::secrets_file();
    let raw = std::fs::read_to_string(path).ok()?;
    for line in raw.lines() {
        let line = line.trim();
        if let Some(value) = line.strip_prefix("DEEPSEEK_API_KEY=") {
            let value = value.trim().trim_matches('"');
            if !value.is_empty() {
                return Some(value.to_owned());
            }
        }
    }
    None
}

fn free_port() -> Option<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").ok()?;
    let port = listener.local_addr().ok()?.port();
    drop(listener);
    Some(port)
}

/// 二进制解析顺序：
/// 1. `LUMINE_BACKEND_BIN` 显式指定（dev / 特殊布局）；
/// 2. 安装目录旁的 `lumine-backend(.exe)`（未来的 sidecar 布局）；
/// 3. 仓库内 `Project/Lumine-rust/target/{release,debug}/serve(.exe)`（dev 兜底，
///    基于编译期 manifest dir 反推仓库根，只在仓库布局内成立）。
fn resolve_backend() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("LUMINE_BACKEND_BIN") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
        eprintln!("[lumine] LUMINE_BACKEND_BIN={path:?} 不存在，继续走默认解析");
    }

    if let Ok(exe) = std::env::current_exe() {
        let sidecar = if cfg!(windows) { "lumine-backend.exe" } else { "lumine-backend" };
        let path = exe.parent()?.join(sidecar);
        if path.is_file() {
            return Some(path);
        }
    }

    let target = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../Project/Lumine-rust/target");
    let bin = if cfg!(windows) { "serve.exe" } else { "serve" };
    for profile in ["release", "debug"] {
        let path = target.join(profile).join(bin);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

/// 子进程 cwd：dotenvy 从 cwd 向上找 `.env`。
/// 二进制在 `target/` 下时取其上一级（即 Lumine-rust 工程目录，`.env` 所在）；
/// 其余取二进制所在目录；`LUMINE_BACKEND_CWD` 可显式覆盖。
fn backend_cwd(binary: &std::path::Path) -> PathBuf {
    if let Ok(cwd) = std::env::var("LUMINE_BACKEND_CWD") {
        return PathBuf::from(cwd);
    }
    let dir = binary
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .to_path_buf();
    if dir.file_name().and_then(|name| name.to_str()) == Some("target") {
        if let Some(crate_dir) = dir.parent() {
            return crate_dir.to_path_buf();
        }
    }
    dir
}