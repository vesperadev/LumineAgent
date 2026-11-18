use std::sync::atomic::Ordering;
use std::sync::Arc;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::Notify;

use crate::backend::BackendHandle;

/// 与前端 `core/types.ts` 的 Message 形状一致（role + content）
#[derive(Deserialize, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct Usage {
    pub prompt: u64,
    pub completion: u64,
}

/// 与前端 `core/types.ts` 的 StreamEvent 完全同形：`{type:"delta"|"done"|"error", ...}`。
/// HTTP 通道（web/dev）与 IPC 通道（桌面）共用这一套事件形状（roadmap 阶段 2）。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum OutEvent {
    Delta { text: String },
    Done {
        #[serde(default)]
        usage: Option<Usage>,
    },
    Error { message: String },
}

/// 前端唯一入口：代为请求后端 SSE，把每帧经 ipc::Channel 推回渲染端。
/// 返回的 id 用于 `chat_abort` 中止；中止即丢弃下游连接，后端自然结束本次会话。
#[tauri::command]
pub async fn chat_stream(
    state: State<'_, BackendHandle>,
    model: String,
    messages: Vec<ChatMessage>,
    on_event: Channel<OutEvent>,
) -> Result<u64, String> {
    // 后端由壳在启动时拉起，首条消息可能要等健康探测完成
    // INFO 级别：排障步骤 1 依赖此行，默认日志级别下必须可见
    crate::log_info!("ipc", "chat_stream 收到请求");
    let addr = crate::backend::wait_addr(&*state).await?;

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let notify = Arc::new(Notify::new());
    state.aborts.lock().unwrap().insert(id, notify.clone());
    let aborts = state.aborts.clone();

    let client = state.client.clone();
    let url = format!("http://{addr}/api/chat/stream");
    crate::log_info!("ipc", "chat_stream id={id} 开始代理，model={model}，消息数={}", messages.len());
    tauri::async_runtime::spawn(async move {
        let tail = pump(client, url, model, messages, on_event.clone(), notify).await;
        if let Some(event) = tail {
            crate::log_warn!("ipc", "chat_stream id={id} 收尾补发事件: {event:?}");
            let _ = on_event.send(event);
        } else {
            crate::log_info!("ipc", "chat_stream id={id} 正常结束");
        }
        aborts.lock().unwrap().remove(&id);
    });
    Ok(id)
}

#[tauri::command]
pub fn chat_abort(state: State<'_, BackendHandle>, id: u64) -> Result<(), String> {
    if let Some(notify) = state.aborts.lock().unwrap().remove(&id) {
        crate::log_info!("ipc", "chat_abort id={id} 触发中止");
        notify.notify_one();
    } else {
        crate::log_debug!("ipc", "chat_abort id={id} 无对应任务（已结束或未知 id），忽略");
    }
    Ok(())
}

/// 代理一次 SSE 往返：逐行解析 `data:` 帧并转发；done/error 帧后即收尾。
/// 返回值是需要补发的最后一帧（错误路径），正常路径全部在 pump 内转发完。
async fn pump(
    client: reqwest::Client,
    url: String,
    model: String,
    messages: Vec<ChatMessage>,
    on_event: Channel<OutEvent>,
    notify: Arc<Notify>,
) -> Option<OutEvent> {
    let body = serde_json::json!({ "model": model, "messages": messages });
    // INFO 级别：排障步骤 2 依赖此行，默认日志级别下必须可见
    crate::log_info!("ipc", "pump 请求后端 {url}");
    let response = match client.post(&url).json(&body).send().await {
        Ok(res) => res,
        Err(error) => {
            crate::log_error!("ipc", "请求后端失败: {error}");
            return Some(OutEvent::Error { message: format!("请求后端失败: {error}") });
        }
    };
    if !response.status().is_success() {
        crate::log_error!("ipc", "后端返回 HTTP {}", response.status());
        return Some(OutEvent::Error {
            // 与前端 HTTP 通道 remote() 的 `HTTP {status}` 文案同形，两条通道错误语义一致
            message: format!("HTTP {}", response.status()),
        });
    }

    let mut stream = response.bytes_stream();
    // 以字节为单位攒行：多字节 UTF-8 字符可能被网络分块从中间切开，不能按字符串切
    let mut buf: Vec<u8> = Vec::new();
    let mut frames = 0u64;
    loop {
        let item = tokio::select! {
            // 中止：drop 掉 response 即断开与后端的连接
            _ = notify.notified() => {
                crate::log_info!("ipc", "pump 收到中止信号，丢弃下游连接（已收 {frames} 帧）");
                None
            }
            item = stream.next() => item,
        };
        let chunk = item?;
        let Ok(bytes) = chunk else {
            crate::log_error!("ipc", "后端连接中断（已收 {frames} 帧）");
            return Some(OutEvent::Error { message: "后端连接中断".into() });
        };
        buf.extend_from_slice(&bytes);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line[..line.len() - 1]).trim().to_string();
            let Some(payload) = line.strip_prefix("data:") else { continue };
            let payload = payload.trim();
            if payload.is_empty() || payload == "[DONE]" {
                continue;
            }
            let Ok(event) = serde_json::from_str::<OutEvent>(payload) else {
                // 单帧坏 JSON 不打断整条流（与前端 HTTP 路径同一容错策略）
                crate::log_warn!("ipc", "跳过无法解析的 SSE 帧");
                continue;
            };
            let finished = matches!(event, OutEvent::Done { .. } | OutEvent::Error { .. });
            frames += 1;
            if frames <= 3 || finished {
                // 只打事件类型与字节数，不打印正文：回答内容属于用户数据，不写进日志
                let kind = match &event {
                    OutEvent::Delta { .. } => "delta",
                    OutEvent::Done { .. } => "done",
                    OutEvent::Error { .. } => "error",
                };
                crate::log_debug!("ipc", "pump 转发第 {frames} 帧: {kind}, {size} bytes", size = payload.len());
            }
            let _ = on_event.send(event);
            if finished {
                buf.clear();
                crate::log_info!("ipc", "pump 收到结束帧，共 {frames} 帧");
                return None;
            }
        }
    }
}