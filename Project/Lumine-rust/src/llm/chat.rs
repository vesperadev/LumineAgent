use std::fmt;

use reqwest::Client;
use serde_json::{Value, json};

/// 上游错误正文退化为原文时的截断长度（字符数，不是字节）
const MAX_UPSTREAM_CHARS: usize = 300;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Message {
    pub role: Role,
    pub content: String,
}

impl Message {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: Role::System,
            content: content.into(),
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: content.into(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: Role::Assistant,
            content: content.into(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    System,
    User,
    Assistant,
}

impl Role {
    fn as_api_str(self) -> &'static str {
        match self {
            Role::System => "system",
            Role::User => "user",
            Role::Assistant => "assistant",
        }
    }
}

#[derive(Debug)]
pub enum ChatError {
    MissingApiKey(std::env::VarError),
    Request(reqwest::Error),
    /// 上游返回非 2xx：保留状态码与上游正文里的原因，否则 401/429/额度不足在界面上无法区分。
    Upstream { status: u16, message: String },
    UnexpectedResponse,
}

impl fmt::Display for ChatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ChatError::MissingApiKey(error) => {
                write!(f, "failed to read DEEPSEEK_API_KEY: {error}")
            }
            ChatError::Request(error) => write!(f, "DeepSeek request failed: {error}"),
            ChatError::Upstream { status, message } => {
                write!(f, "DeepSeek rejected the request with {status}: {message}")
            }
            ChatError::UnexpectedResponse => {
                write!(f, "DeepSeek response did not include assistant text")
            }
        }
    }
}

impl std::error::Error for ChatError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ChatError::MissingApiKey(error) => Some(error),
            ChatError::Request(error) => Some(error),
            ChatError::Upstream { .. } => None,
            ChatError::UnexpectedResponse => None,
        }
    }
}

pub async fn chat(client: &Client, model: &str, messages: &[Message]) -> Result<String, ChatError> {
    let api_key = std::env::var("DEEPSEEK_API_KEY").map_err(ChatError::MissingApiKey)?;
    let body = request_body(model, messages);

    let response = client
        .post("https://api.deepseek.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(ChatError::Request)?;

    let status = response.status();
    if !status.is_success() {
        // 上游 4xx/5xx 的正文里才有真正原因（鉴权、额度、限流、参数），丢掉就无法在前端区分
        let body = response.text().await.unwrap_or_default();
        return Err(ChatError::Upstream {
            status: status.as_u16(),
            message: upstream_error_message(&body),
        });
    }

    let payload = response.json::<Value>().await.map_err(ChatError::Request)?;
    completion_text(&payload).ok_or(ChatError::UnexpectedResponse)
}

/// 上游错误正文：优先 `error.message`；网关返回的 HTML/纯文本退化为原文。
/// 先对 key 片段打码、再按字符截断，避免敏感信息进日志（`AGENTS.md` §5）。
fn upstream_error_message(body: &str) -> String {
    let parsed = serde_json::from_str::<Value>(body).ok();
    let extracted = parsed
        .as_ref()
        .and_then(|payload| payload["error"]["message"].as_str())
        .map(str::trim)
        .filter(|message| !message.is_empty());

    let raw = match extracted {
        Some(message) => message.to_owned(),
        None => {
            let text = body.trim();
            if text.is_empty() {
                return "上游返回错误状态，但响应体为空".to_owned();
            }
            text.to_owned()
        }
    };

    redact_secrets(&raw).chars().take(MAX_UPSTREAM_CHARS).collect()
}

/// 把 `sk-` 开头的令牌整体替换为 `sk-***`。上游/网关的报错正文可能回显密钥片段，
/// 原样转发到日志等于把凭证写进文件。
fn redact_secrets(text: &str) -> String {
    let mut redacted = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(index) = rest.find("sk-") {
        redacted.push_str(&rest[..index]);
        let tail = &rest[index..];
        let token_end = tail
            .char_indices()
            .skip("sk-".len())
            .find(|(_, c)| !c.is_ascii_alphanumeric() && *c != '_' && *c != '-')
            .map(|(offset, _)| offset)
            .unwrap_or(tail.len());
        redacted.push_str("sk-***");
        rest = &tail[token_end..];
    }
    redacted.push_str(rest);
    redacted
}

fn completion_text(payload: &Value) -> Option<String> {
    payload["choices"][0]["message"]["content"]
        .as_str()
        .map(str::to_owned)
}

fn request_body(model: &str, messages: &[Message]) -> Value {
    json!({
        "model": model,
        "messages": messages
            .iter()
            .map(|message| {
                json!({
                    "role": message.role.as_api_str(),
                    "content": message.content,
                })
            })
            .collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_body_keeps_system_user_and_assistant_history() {
        let messages = [
            Message::system("Be brief."),
            Message::user("Hi"),
            Message::assistant("Hello."),
        ];
        let body = request_body("deepseek-chat", &messages);

        assert_eq!(body["model"], "deepseek-chat");
        assert_eq!(body["messages"].as_array().map(Vec::len), Some(3));
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][0]["content"], "Be brief.");
        assert_eq!(body["messages"][1]["role"], "user");
        assert_eq!(body["messages"][1]["content"], "Hi");
        assert_eq!(body["messages"][2]["role"], "assistant");
        assert_eq!(body["messages"][2]["content"], "Hello.");
    }

    #[tokio::test]
    async fn missing_api_key_returns_error_without_calling_the_network() {
        // A real key would reach the network. Only the local missing-key path is tested.
        if std::env::var_os("DEEPSEEK_API_KEY").is_some() {
            return;
        }

        let client = Client::builder().no_proxy().build().unwrap();
        let error = chat(&client, "deepseek-chat", &[Message::user("Hi")])
            .await
            .expect_err("missing key should be an error");
        assert!(matches!(error, ChatError::MissingApiKey(_)));
    }

    #[test]
    fn upstream_error_message_prefers_the_error_message_field() {
        let body = r#"{"error":{"message":"  Insufficient Balance  ","type":"insufficient_quota"}}"#;
        assert_eq!(upstream_error_message(body), "Insufficient Balance");
    }

    #[test]
    fn upstream_error_message_keeps_a_plain_text_body() {
        assert_eq!(upstream_error_message("502 Bad Gateway"), "502 Bad Gateway");
    }

    #[test]
    fn upstream_error_message_reports_an_empty_body() {
        let message = upstream_error_message(" \n\t ");
        assert!(message.contains("响应体为空"), "unexpected message: {message}");
    }

    #[test]
    fn upstream_error_message_truncates_by_chars_without_panicking() {
        let body = "错".repeat(MAX_UPSTREAM_CHARS + 10);
        let message = upstream_error_message(&body);
        assert_eq!(message.chars().count(), MAX_UPSTREAM_CHARS);
        assert!(message.chars().all(|c| c == '错'));
    }

    #[test]
    fn upstream_error_message_truncates_a_long_error_message_field() {
        let body = json!({
            "error": { "message": "x".repeat(MAX_UPSTREAM_CHARS + 50) },
        })
        .to_string();
        let message = upstream_error_message(&body);
        assert_eq!(message.chars().count(), MAX_UPSTREAM_CHARS);
    }

    #[test]
    fn upstream_error_message_redacts_api_key_fragments() {
        let body = r#"{"error":{"message":"invalid key sk-ab12cd34ef56 for request"}}"#;
        let message = upstream_error_message(body);
        assert!(!message.contains("sk-ab12cd34ef56"), "key leaked: {message}");
        assert!(message.contains("sk-***"), "unexpected message: {message}");
    }

    #[test]
    fn upstream_error_message_redacts_every_key_in_a_plain_text_body() {
        let message = upstream_error_message("gateway: Bearer sk-aaa111 rejected; retry with sk-bbb222");
        assert!(!message.contains("sk-aaa111"), "key leaked: {message}");
        assert!(!message.contains("sk-bbb222"), "key leaked: {message}");
        assert_eq!(message.matches("sk-***").count(), 2);
    }

    #[test]
    fn completion_text_reads_the_first_choice() {
        let payload = json!({"choices": [{"message": {"content": "Hi"}}]});
        assert_eq!(completion_text(&payload).as_deref(), Some("Hi"));
    }

    #[test]
    fn completion_text_is_none_without_content() {
        assert_eq!(completion_text(&json!({"choices": []})), None);
        assert_eq!(completion_text(&json!({})), None);
    }

    #[test]
    fn upstream_error_display_keeps_status_and_reason() {
        let error = ChatError::Upstream {
            status: 429,
            message: "Rate limit reached".to_owned(),
        };
        let text = error.to_string();
        assert!(text.contains("429"), "unexpected display: {text}");
        assert!(text.contains("Rate limit reached"), "unexpected display: {text}");
    }
}
