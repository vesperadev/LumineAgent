use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::window_bounds::{self, Rect};

/// 落盘格式：逻辑坐标（DIP）+ 是否最大化。
/// 存普通态尺寸而非最大化尺寸 —— 与 Electron `getNormalBounds()` 语义一致，
/// 否则最大化关窗后下次启动会「还愿」成超出屏幕的普通窗口。
#[derive(Serialize, Deserialize)]
pub struct PersistedWindow {
    pub rect: Rect,
    pub maximized: bool,
}

pub struct BoundsTracker {
    /// 最近一次非最大化、非最小化的普通态 bounds（逻辑坐标）
    last_normal: Mutex<Option<Rect>>,
    /// 防抖代际：每次 resize/move +1，只有持最新代际的定时任务才落盘
    generation: AtomicU64,
    maximized: AtomicBool,
    path: PathBuf,
}

fn state_file(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_local_data_dir().ok()?.join("window-state.json"))
}

pub fn init(app: &AppHandle) {
    let path = state_file(app).expect("app local data dir unavailable");
    app.manage(BoundsTracker {
        last_normal: Mutex::new(None),
        generation: AtomicU64::new(0),
        maximized: AtomicBool::new(false),
        path,
    });
}

/// 启动恢复：读档 → 过屏幕校验 → 摆位（隐藏期执行，上屏前完成，无跳窗）
pub fn restore(win: &WebviewWindow) {
    let tracker = win.app_handle().state::<BoundsTracker>();
    let persisted: Option<PersistedWindow> = std::fs::read(&tracker.path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok());
    let Some(persisted) = persisted else {
        crate::log_info!("window", "无历史窗口记录，使用默认几何");
        return;
    };
    let monitors: Vec<Rect> = win
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(window_bounds::monitor_work_area)
        .collect();
    if let Some(fit) = window_bounds::sanitize(Some(persisted.rect), &monitors) {
        crate::log_info!("window", "恢复窗口位置 {:?}", fit);
        let _ = win.set_position(tauri::LogicalPosition::new(fit.x, fit.y));
        let _ = win.set_size(tauri::LogicalSize::new(fit.width, fit.height));
    }
    if persisted.maximized {
        crate::log_info!("window", "恢复为最大化状态");
        let _ = win.maximize();
    }
}

/// resize/move 事件入口：更新普通态 bounds，调度防抖落盘
pub fn track(window: &tauri::Window) {
    let tracker = window.app_handle().state::<BoundsTracker>();
    let maximized = window.is_maximized().unwrap_or(false);
    tracker.maximized.store(maximized, Ordering::Relaxed);
    // 最大化 / 最小化时不更新普通尺寸：最大化尺寸一旦写盘，还原就错位；
    // 最小化时 Windows 会把窗口挪到 (-32000,-32000)，更不能写
    if maximized || window.is_minimized().unwrap_or(false) {
        return;
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    let (Some(pos), Some(size)) = (window.outer_position().ok(), window.outer_size().ok()) else {
        return;
    };
    let pos = pos.to_logical::<f64>(scale);
    let size = size.to_logical::<f64>(scale);
    let rect = Rect {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    };
    *tracker.last_normal.lock().unwrap() = Some(rect);

    let generation = tracker.generation.fetch_add(1, Ordering::Relaxed) + 1;
    let handle = window.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(window_bounds::BOUNDS_SAVE_DEBOUNCE_MS)).await;
        let tracker = handle.state::<BoundsTracker>();
        // 拖动/缩放途中事件连绵不断，只有「400ms 内没有新事件」的那一代才写盘
        if tracker.generation.load(Ordering::Relaxed) != generation {
            return;
        }
        crate::log_debug!("window", "落盘窗口 bounds: {:?}", tracker.last_normal.lock().unwrap());
        save(&tracker);
    });
}

/// 退出兜底：防抖窗口内直接退出时异步写可能来不及，同步补一次（Percho flushBounds 语义）
pub fn flush(app: &AppHandle) {
    if let Some(tracker) = app.try_state::<BoundsTracker>() {
        save(&tracker);
    }
}

fn save(tracker: &BoundsTracker) {
    let Some(rect) = *tracker.last_normal.lock().unwrap() else {
        return;
    };
    let persisted = PersistedWindow {
        rect,
        maximized: tracker.maximized.load(Ordering::Relaxed),
    };
    let Ok(json) = serde_json::to_vec(&persisted) else {
        return;
    };
    if let Some(parent) = tracker.path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&tracker.path, json);
}