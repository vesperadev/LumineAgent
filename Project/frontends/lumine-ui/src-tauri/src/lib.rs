mod backend;
mod chat;
mod logging;
mod window_bounds;
mod window_state;
mod workspace;

use std::path::PathBuf;

use tauri::{Manager, RunEvent, WindowEvent};


pub fn run() {
    // 日志先于一切初始化：后面任何一步失败都要留痕
    logging::init(
        std::env::var_os("LOCALAPPDATA")
            .map(|base| PathBuf::from(base).join("LumineAgent").join("logs")),
        logging::Level::Info,
    );
    crate::log_info!("shell", "LumineAgent 桌面壳启动，日志目录: {:?}", logging::log_path());

    // 单实例必须最先注册：重复启动时把已有窗口带到前台（Percho 的 requestSingleInstanceLock 语义）
    let single = tauri_plugin_single_instance::init(|app, _args, _cwd| {
        crate::log_info!("shell", "检测到第二个实例，聚焦已有窗口");
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
    });

    tauri::Builder::default()
        .plugin(single)
        // 应用内自更新：从 GitHub Releases 拉 latest.json，签名校验由 tauri.conf.json 的 pubkey 完成
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 更新安装完成后重启应用（relaunch）
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            chat::chat_stream,
            chat::chat_abort,
            workspace::workspace_diff,
            log_dump,
            log_write
        ])
        // Percho 的 ready-to-show 等价物：页面加载完成再上屏，避免启动白闪
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
            {
                let _ = webview.window().show();
                let _ = webview.window().set_focus();
            }
        })
        .setup(|app| {
            window_state::init(app.handle());
            backend::start(app.handle().clone());
            let win = app
                .get_webview_window("main")
                .expect("main window missing from config");
            window_state::restore(&win);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                WindowEvent::Resized(_) | WindowEvent::Moved(_) => window_state::track(window),
                WindowEvent::CloseRequested { .. } => crate::log_warn!("shell", "主窗口收到关闭请求"),
                WindowEvent::Destroyed => crate::log_warn!("shell", "主窗口已销毁"),
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build lumine tauri app")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                // 退出兜底：防抖窗口内最后一次 bounds 同步落盘；随后回收后端子进程
                window_state::flush(app);
                backend::shutdown(app);
                crate::log_info!("shell", "桌面壳退出");
            }
        });
}

/// 取回进程内最近若干条日志（供 UI「查看日志」按钮使用）。
///
/// 返回日志行数组与日志文件路径，路径为 None 表示当前只输出到 stderr。
#[tauri::command]
fn log_dump() -> (Vec<String>, Option<String>) {
    let lines = logging::dump();
    let path = logging::log_path().map(|p| p.to_string_lossy().to_string());
    (lines, path)
}

/// 接收前端日志并写入同一个日志文件。
///
/// 目的是让「前端做了什么」与「壳做了什么」落在同一条时间线上：
/// 用户报障时只看一个文件即可还原完整链路。
#[tauri::command]
fn log_write(level: String, scope: String, message: String) {
    let level = match level.to_ascii_lowercase().as_str() {
        "trace" => logging::Level::Trace,
        "debug" => logging::Level::Debug,
        "warn" | "warning" => logging::Level::Warn,
        "error" => logging::Level::Error,
        _ => logging::Level::Info,
    };
    logging::log(level, &scope, &message);
}