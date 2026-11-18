use std::{convert::Infallible, path::PathBuf, sync::Arc};
use std::time::Duration;

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderValue, Method},
    response::{
        Sse, IntoResponse,
        sse::{Event, KeepAlive},
    },
    routing::{get, post},
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio_stream::wrappers::ReceiverStream;
use tower_http::cors::CorsLayer;

use crate::llm::chat::{ChatError, Message, Role};
use crate::llm::stream::{UpstreamEvent, chat_stream};
use crate::workspace::{FileChange, snapshot_or_empty};

#[derive(Clone)]
pub struct AppState {
    pub client: reqwest::Client,
    pub model: String,
    pub workspace_root: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub model: Option<String>,
    pub messages: Vec<ChatMessage>,
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
    model: String,
}

/// 事件体的唯一出处：前端按 `type` 分派，不做额外嗅探
fn delta_event(text: &str) -> String {
    json!({ "type": "delta", "text": text }).to_string()
}

fn done_event() -> String {
    json!({ "type": "done", "usage": { "prompt": 0, "completion": 0 } }).to_string()
}

fn error_event(message: &str) -> String {
    json!({ "type": "error", "message": message }).to_string()
}

fn parse_role(role: &str) -> Option<Role> {
    match role {
        "system" => Some(Role::System),
        "user" => Some(Role::User),
        "assistant" => Some(Role::Assistant),
        _ => None,
    }
}

/// 请求体 → 上游消息序列；任何角色非法都整体拒绝，不做部分接受
fn to_messages(request: &ChatRequest) -> Result<Vec<Message>, String> {
    if request.messages.is_empty() {
        return Err("messages 不能为空".to_owned());
    }

    request
        .messages
        .iter()
        .map(|message| {
            if message.content.trim().is_empty() {
                return Err(format!(
                    "{} 消息的 content 不能为空",
                    message.role
                ));
            }
            let role = parse_role(&message.role)
                .ok_or_else(|| format!("不支持的 role: {}", message.role))?;
            Ok(Message {
                role,
                content: message.content.clone(),
            })
        })
        .collect()
}

pub fn router(state: AppState, cors_origin: Option<&str>) -> Router {
    let mut router = Router::new()
        .route("/health", get(health))
        .route("/api/chat/stream", post(chat))
        .route("/api/workspace/diff", get(workspace_diff))
        .with_state(Arc::new(state));

    if let Some(raw) = cors_origin {
        match raw.parse::<HeaderValue>() {
            Ok(origin) => {
                router = router.layer(
                    CorsLayer::new()
                        .allow_origin(origin)
                        .allow_methods([Method::GET, Method::POST])
                        .allow_headers([axum::http::header::CONTENT_TYPE]),
                );
            }
            // 配置写错不能静默变成「没有 CORS」，否则前端只会看到浏览器报错
            Err(_) => tracing::warn!(origin = %raw, "LUMINE_CORS_ORIGIN 不是合法 Origin，已跳过 CORS 层"),
        }
    }

    router
}

async fn health(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(Health {
        status: "ok",
        model: state.model.clone(),
    })
}

/// 工作区改动快照。非 git / 无改动 / git 失败一律 200 + `[]`，不 500。
async fn workspace_diff(State(state): State<Arc<AppState>>) -> Json<Vec<FileChange>> {
    Json(snapshot_or_empty(&state.workspace_root))
}

async fn chat(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ChatRequest>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let (tx, rx) = tokio::sync::mpsc::channel::<Event>(32);

    let messages = to_messages(&request);
    let model = request.model.clone().unwrap_or_else(|| state.model.clone());

    match messages {
        Err(message) => {
            let _ = tx.send(Event::default().data(error_event(&message))).await;
        }
        Ok(messages) => {
            let client = state.client.clone();
            tokio::spawn(async move {
                match chat_stream(&client, &model, &messages).await {
                    Err(ChatError::MissingApiKey(_)) => {
                        let _ = tx
                            .send(Event::default().data(error_event(
                                "缺少 DEEPSEEK_API_KEY，请在 Project/Lumine-rust/.env 配置",
                            )))
                            .await;
                    }
                    Err(error) => {
                        let _ = tx
                            .send(Event::default().data(error_event(&error.to_string())))
                            .await;
                    }
                    Ok(mut upstream) => {
                        while let Some(next) = upstream.recv().await {
                            match next {
                                Ok(UpstreamEvent::Delta(text)) => {
                                    if tx
                                        .send(Event::default().data(delta_event(&text)))
                                        .await
                                        .is_err()
                                    {
                                        return;
                                    }
                                }
                                Ok(UpstreamEvent::Done) => {
                                    let _ = tx.send(Event::default().data(done_event())).await;
                                    return;
                                }
                                Err(message) => {
                                    let _ = tx.send(Event::default().data(error_event(&message))).await;
                                    return;
                                }
                                Ok(UpstreamEvent::Error(message)) => {
                                    let _ = tx.send(Event::default().data(error_event(&message))).await;
                                    return;
                                }
                            }
                        }
                        // 上游未给 [DONE] 就断开：按正常结束处理，避免前端一直转圈
                        let _ = tx.send(Event::default().data(done_event())).await;
                    }
                }
            });
        }
    }

    Sse::new(ReceiverStream::new(rx).map(Ok))
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_bodies_carry_the_documented_shape() {
        let delta: serde_json::Value = serde_json::from_str(&delta_event("嗨")).unwrap();
        assert_eq!(delta["type"], "delta");
        assert_eq!(delta["text"], "嗨");

        let done: serde_json::Value = serde_json::from_str(&done_event()).unwrap();
        assert_eq!(done["type"], "done");
        assert_eq!(done["usage"]["completion"], 0);

        let error: serde_json::Value = serde_json::from_str(&error_event("boom")).unwrap();
        assert_eq!(error["type"], "error");
        assert_eq!(error["message"], "boom");
    }

    #[test]
    fn rejects_empty_and_unknown_roles() {
        let empty = ChatRequest {
            model: None,
            messages: Vec::new(),
        };
        assert!(to_messages(&empty).is_err());

        let unknown = ChatRequest {
            model: None,
            messages: vec![ChatMessage {
                role: "tool".into(),
                content: "hi".into(),
            }],
        };
        assert!(to_messages(&unknown).is_err());
    }

    #[test]
    fn maps_roles_in_order() {
        let request = ChatRequest {
            model: Some("deepseek-chat".into()),
            messages: vec![
                ChatMessage {
                    role: "system".into(),
                    content: "Be brief.".into(),
                },
                ChatMessage {
                    role: "user".into(),
                    content: "Hi".into(),
                },
            ],
        };

        let messages = to_messages(&request).unwrap();
        assert_eq!(messages.len(), 2);
        assert!(matches!(messages[0].role, Role::System));
        assert!(matches!(messages[1].role, Role::User));
    }
}
