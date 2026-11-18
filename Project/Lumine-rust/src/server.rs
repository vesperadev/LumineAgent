use std::{convert::Infallible, path::PathBuf, sync::Arc};
use std::time::Duration;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderValue, Method, StatusCode},
    response::{
        Sse, IntoResponse,
        sse::{Event, KeepAlive},
    },
    routing::{get, post},
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::Mutex;
use tokio_stream::wrappers::ReceiverStream;
use tower_http::cors::CorsLayer;

use crate::approvals::ApprovalHub;
use crate::llm::chat::{ChatError, Message, Role};
use crate::llm::stream::{UpstreamEvent, Usage, chat_stream};
use crate::sessions::{Session, SessionStore, store_path};
use crate::tools;
use crate::workspace::{FileChange, snapshot_or_empty};

#[derive(Clone)]
pub struct AppState {
    pub client: reqwest::Client,
    pub model: String,
    pub workspace_root: PathBuf,
    pub data_dir: PathBuf,
    pub sessions: Arc<Mutex<SessionStore>>,
    pub approvals: Arc<ApprovalHub>,
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
    pub session_id: Option<String>,
    /// `default` 需要审批；`full` 自动放行只读工具
    pub permission: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ApprovalBody {
    pub id: String,
    pub allow: bool,
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
    model: String,
}

fn delta_event(text: &str) -> String {
    json!({ "type": "delta", "text": text }).to_string()
}

fn done_event(usage: Option<Usage>) -> String {
    let usage = usage.unwrap_or(Usage {
        prompt_tokens: 0,
        completion_tokens: 0,
    });
    json!({
        "type": "done",
        "usage": { "prompt": usage.prompt_tokens, "completion": usage.completion_tokens }
    })
    .to_string()
}

fn error_event(message: &str) -> String {
    json!({ "type": "error", "message": message }).to_string()
}

fn approval_event(id: &str, tool: &str, path: &str) -> String {
    json!({
        "type": "approval",
        "id": id,
        "tool": tool,
        "args": { "path": path },
        "summary": format!("允许 {tool}({path})？")
    })
    .to_string()
}

fn step_event(id: &str, label: &str, detail: &str, status: &str) -> String {
    json!({
        "type": "step",
        "id": id,
        "label": label,
        "detail": detail,
        "status": status
    })
    .to_string()
}

fn parse_role(role: &str) -> Option<Role> {
    match role {
        "system" => Some(Role::System),
        "user" => Some(Role::User),
        "assistant" => Some(Role::Assistant),
        _ => None,
    }
}

fn to_messages(request: &ChatRequest) -> Result<Vec<Message>, String> {
    if request.messages.is_empty() {
        return Err("messages 不能为空".to_owned());
    }

    request
        .messages
        .iter()
        .map(|message| {
            if message.content.trim().is_empty() {
                return Err(format!("{} 消息的 content 不能为空", message.role));
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
        .route("/api/sessions", get(list_sessions).post(put_session))
        .route("/api/sessions/{id}", get(get_session).delete(delete_session))
        .route("/api/approvals", post(decide_approval))
        .with_state(Arc::new(state));

    if let Some(raw) = cors_origin {
        match raw.parse::<HeaderValue>() {
            Ok(origin) => {
                router = router.layer(
                    CorsLayer::new()
                        .allow_origin(origin)
                        .allow_methods([Method::GET, Method::POST, Method::DELETE])
                        .allow_headers([axum::http::header::CONTENT_TYPE]),
                );
            }
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

async fn workspace_diff(State(state): State<Arc<AppState>>) -> Json<Vec<FileChange>> {
    let root = state.workspace_root.clone();
    let files = tokio::task::spawn_blocking(move || snapshot_or_empty(&root))
        .await
        .unwrap_or_default();
    Json(files)
}

async fn list_sessions(State(state): State<Arc<AppState>>) -> Json<Vec<Session>> {
    let store = state.sessions.lock().await;
    Json(store.list())
}

async fn get_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Session>, StatusCode> {
    let store = state.sessions.lock().await;
    store
        .get(&id)
        .cloned()
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn put_session(
    State(state): State<Arc<AppState>>,
    Json(session): Json<Session>,
) -> Json<Session> {
    let mut store = state.sessions.lock().await;
    let saved = store.upsert(session);
    let _ = store.save(&store_path(&state.data_dir));
    Json(saved)
}

async fn delete_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> StatusCode {
    let mut store = state.sessions.lock().await;
    let ok = store.delete(&id);
    let _ = store.save(&store_path(&state.data_dir));
    if ok {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

async fn decide_approval(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ApprovalBody>,
) -> impl IntoResponse {
    match state.approvals.decide(&body.id, body.allow) {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(message) => {
            tracing::warn!(%message, "审批失败");
            StatusCode::NOT_FOUND
        }
    }
}

fn parse_tool_command(text: &str) -> Option<(&'static str, String)> {
    let trim = text.trim();
    if let Some(rest) = trim.strip_prefix("/list") {
        Some(("list_dir", rest.trim().trim_matches('"').to_owned()))
    } else if let Some(rest) = trim.strip_prefix("/read") {
        let path = rest.trim().trim_matches('"');
        if path.is_empty() {
            None
        } else {
            Some(("read_file", path.to_owned()))
        }
    } else {
        None
    }
}

async fn chat(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ChatRequest>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let (tx, rx) = tokio::sync::mpsc::channel::<Event>(32);

    let messages = to_messages(&request);
    let model = request.model.clone().unwrap_or_else(|| state.model.clone());
    let permission = request.permission.clone().unwrap_or_else(|| "default".into());
    let last_user = request
        .messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .map(|message| message.content.clone());

    match messages {
        Err(message) => {
            let _ = tx.send(Event::default().data(error_event(&message))).await;
        }
        Ok(mut messages) => {
            let client = state.client.clone();
            let workspace = state.workspace_root.clone();
            let approvals = state.approvals.clone();
            tokio::spawn(async move {
                if last_user.as_deref() == Some("/error") {
                    let _ = tx
                        .send(Event::default().data(error_event(
                            "insufficient_quota: 这是后端注入的额度错误帧，用于验收前端 error 气泡",
                        )))
                        .await;
                    return;
                }

                if let Some((tool, path)) = last_user.as_deref().and_then(parse_tool_command) {
                    let id = format!("ap{}", std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis())
                        .unwrap_or(0));
                    let _ = tx
                        .send(Event::default().data(step_event(&id, tool, &path, "running")))
                        .await;
                    let allow = if permission == "full" {
                        true
                    } else {
                        let _ = tx
                            .send(Event::default().data(approval_event(&id, tool, &path)))
                            .await;
                        let rx = approvals.register(id.clone());
                        match tokio::time::timeout(Duration::from_secs(120), rx).await {
                            Ok(Ok(value)) => value,
                            _ => false,
                        }
                    };
                    if !allow {
                        let _ = tx
                            .send(Event::default().data(step_event(&id, tool, "已拒绝", "failed")))
                            .await;
                        let _ = tx
                            .send(Event::default().data(error_event("用户拒绝了工具调用")))
                            .await;
                        return;
                    }
                    let result = tools::execute(&workspace, tool, &path);
                    match result {
                        Ok(output) => {
                            let _ = tx
                                .send(Event::default().data(step_event(&id, tool, "完成", "done")))
                                .await;
                            messages.push(Message {
                                role: Role::System,
                                content: format!("工具 {tool}({path}) 结果：\n{output}"),
                            });
                        }
                        Err(message) => {
                            let _ = tx
                                .send(Event::default().data(step_event(&id, tool, &message, "failed")))
                                .await;
                            let _ = tx.send(Event::default().data(error_event(&message))).await;
                            return;
                        }
                    }
                }

                match chat_stream(&client, &model, &messages).await {
                    Err(ChatError::MissingApiKey(_)) => {
                        let _ = tx
                            .send(Event::default().data(error_event(
                                "缺少 DEEPSEEK_API_KEY。可在设置里填写，或配置 Project/Lumine-rust/.env",
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
                                Ok(UpstreamEvent::Done { usage }) => {
                                    let _ = tx.send(Event::default().data(done_event(usage))).await;
                                    return;
                                }
                                Err(message) | Ok(UpstreamEvent::Error(message)) => {
                                    let _ = tx.send(Event::default().data(error_event(&message))).await;
                                    return;
                                }
                            }
                        }
                        let _ = tx.send(Event::default().data(done_event(None))).await;
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

        let done: serde_json::Value = serde_json::from_str(&done_event(None)).unwrap();
        assert_eq!(done["type"], "done");
        assert_eq!(done["usage"]["completion"], 0);

        let done: serde_json::Value = serde_json::from_str(&done_event(Some(Usage {
            prompt_tokens: 7,
            completion_tokens: 11,
        })))
        .unwrap();
        assert_eq!(done["usage"]["prompt"], 7);
        assert_eq!(done["usage"]["completion"], 11);

        let error: serde_json::Value = serde_json::from_str(&error_event("boom")).unwrap();
        assert_eq!(error["type"], "error");
        assert_eq!(error["message"], "boom");

        let approval: serde_json::Value =
            serde_json::from_str(&approval_event("a1", "read_file", "src/lib.rs")).unwrap();
        assert_eq!(approval["type"], "approval");
        assert_eq!(approval["tool"], "read_file");
    }

    #[test]
    fn rejects_empty_and_unknown_roles() {
        let empty = ChatRequest {
            model: None,
            messages: Vec::new(),
            session_id: None,
            permission: None,
        };
        assert!(to_messages(&empty).is_err());

        let unknown = ChatRequest {
            model: None,
            messages: vec![ChatMessage {
                role: "tool".into(),
                content: "hi".into(),
            }],
            session_id: None,
            permission: None,
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
            session_id: None,
            permission: None,
        };

        let messages = to_messages(&request).unwrap();
        assert_eq!(messages.len(), 2);
        assert!(matches!(messages[0].role, Role::System));
        assert!(matches!(messages[1].role, Role::User));
    }

    #[test]
    fn parses_slash_tool_commands() {
        assert_eq!(parse_tool_command("/list src"), Some(("list_dir", "src".into())));
        assert_eq!(
            parse_tool_command("/read Cargo.toml"),
            Some(("read_file", "Cargo.toml".into()))
        );
        assert_eq!(parse_tool_command("hello"), None);
    }
}
