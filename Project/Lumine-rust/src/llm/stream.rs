use std::time::Duration;

use futures_util::StreamExt;
use serde_json::{Value, json};

use super::chat::{ChatError, Message};

pub const DONE_MARKER: &str = "[DONE]";

/// 上游多久没有任何字节就判定为卡死：DeepSeek 正常流不会静默 60 秒
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);

/// 上游（DeepSeek）分片解析后的最小事件集
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UpstreamEvent {
    Delta(String),
    Done { usage: Option<Usage> },
    /// 上游在 200 流内下发的 `{"error":{...}}`：必须转成 error 事件，不能当作正常结束
    Error(String),
}

/// 上游收尾分片带回的 token 用量；字段缺失时按 0 记
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Usage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
}

/// 字节级行缓冲：TCP chunk 可能切在多字节字符中间，不能先 `from_utf8_lossy`。
/// 只在凑齐一条以 `\n` 结尾的帧后再解码，半个汉字会留在缓冲里等下一包。
#[derive(Default)]
struct ByteLineBuffer {
    buf: Vec<u8>,
}

impl ByteLineBuffer {
    fn feed(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(chunk);
        let mut lines = Vec::new();
        while let Some(index) = self.buf.iter().position(|&b| b == b'\n') {
            let line = self.buf.drain(..=index).collect::<Vec<u8>>();
            match String::from_utf8(line) {
                Ok(text) => lines.push(text),
                Err(error) => {
                    lines.push(String::from_utf8_lossy(error.as_bytes()).into_owned());
                }
            }
        }
        lines
    }
}

fn drain_sse_bytes(
    lines: &mut ByteLineBuffer,
    parser: &mut SseLineBuffer,
    chunk: &[u8],
) -> Vec<UpstreamEvent> {
    let mut events = Vec::new();
    for line in lines.feed(chunk) {
        events.extend(parser.feed(&line));
    }
    events
}

/// 行缓冲解析器：一个 TCP chunk 既可能含多条 `data:` 事件，也可能半条，
/// 因此必须按行累积、不能假设 chunk == event。
#[derive(Default)]
pub struct SseLineBuffer {
    buffer: String,
}

impl SseLineBuffer {
    pub fn feed(&mut self, chunk: &str) -> Vec<UpstreamEvent> {
        // 不在这里删 `\r`：正文里的合法回车不能被吃掉，只在切行时剥掉行尾的 CRLF 中的 CR
        self.buffer.push_str(chunk);
        let mut events = Vec::new();

        while let Some(index) = self.buffer.find('\n') {
            let line = self.buffer[..index].trim_end_matches('\r').to_owned();
            self.buffer.drain(..=index);

            if line.trim().is_empty() {
                continue;
            }
            let Some(payload) = line.strip_prefix("data:") else {
                continue;
            };
            let payload = payload.trim();
            if payload.is_empty() {
                continue;
            }
            if payload == DONE_MARKER {
                events.push(UpstreamEvent::Done { usage: None });
                continue;
            }
            if let Some(message) = error_message(payload) {
                events.push(UpstreamEvent::Error(message));
                continue;
            }
            // 先取 delta 再看 usage：include_usage 的收尾分片 choices 为空，两者互斥；
            // 若上游在最后一个内容分片里同时给了 usage，也不丢正文
            if let Some(text) = delta_text(payload) {
                events.push(UpstreamEvent::Delta(text));
            }
            if let Some(usage) = usage_of(payload) {
                events.push(UpstreamEvent::Done { usage: Some(usage) });
            }
        }

        events
    }
}

/// 上游错误帧：`{"error":{"message":"..."}}` 或 `{"error":"..."}`
fn error_message(payload: &str) -> Option<String> {
    let value: Value = serde_json::from_str(payload).ok()?;
    let error = value.get("error")?;
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| error.as_str())
        .unwrap_or("上游返回错误");
    Some(message.to_owned())
}

/// 从上游分片里取出 `choices[0].delta.content`；空分片（role-only）返回 None
fn delta_text(payload: &str) -> Option<String> {
    let value: Value = serde_json::from_str(payload).ok()?;
    let text = value["choices"][0]["delta"]["content"].as_str()?;
    if text.is_empty() {
        return None;
    }
    Some(text.to_owned())
}

/// 取分片顶层的 `usage` 对象；`usage: null`（include_usage 流里的普通分片）返回 None
fn usage_of(payload: &str) -> Option<Usage> {
    let value: Value = serde_json::from_str(payload).ok()?;
    let usage = value.get("usage")?;
    if !usage.is_object() {
        return None;
    }
    Some(Usage {
        prompt_tokens: usage.get("prompt_tokens").and_then(Value::as_u64).unwrap_or(0),
        completion_tokens: usage.get("completion_tokens").and_then(Value::as_u64).unwrap_or(0),
    })
}

fn request_body(model: &str, messages: &[Message]) -> Value {
    json!({
        "model": model,
        "stream": true,
        // 让上游在流末尾多发一个只含 usage 的收尾分片，否则 token 用量拿不到
        "stream_options": { "include_usage": true },
        "messages": messages
            .iter()
            .map(|message| json!({ "role": message.role.as_api_str(), "content": message.content }))
            .collect::<Vec<_>>(),
    })
}

pub const DEFAULT_COMPLETIONS_URL: &str = "https://api.deepseek.com/v1/chat/completions";

/// 把设置里的 OpenAI 兼容 Base URL 收成 `.../chat/completions`。只允许 http/https。
pub fn completions_url(base: Option<&str>) -> Result<String, String> {
    let Some(raw) = base.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(DEFAULT_COMPLETIONS_URL.to_owned());
    };
    let trimmed = raw.trim_end_matches('/');
    let url = if trimmed.ends_with("/chat/completions") {
        trimmed.to_owned()
    } else {
        format!("{trimmed}/chat/completions")
    };
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Base URL 不是合法地址".to_owned())?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Base URL 只允许 http 或 https".to_owned()),
    }
    if parsed.host_str().is_none() {
        return Err("Base URL 缺少主机名".to_owned());
    }
    if url.len() > 2048 {
        return Err("Base URL 过长".to_owned());
    }
    Ok(url)
}

/// 打开上游流式请求，返回事件通道；错误只在此刻发生一次，之后都走通道。
/// `api_key` 与 `completions` 由调用方解析，本函数不读环境变量、不写日志。
pub async fn chat_stream(
    client: &reqwest::Client,
    model: &str,
    messages: &[Message],
    api_key: &str,
    completions: &str,
) -> Result<tokio::sync::mpsc::Receiver<Result<UpstreamEvent, String>>, ChatError> {
    let response = client
        .post(completions)
        .bearer_auth(api_key)
        .json(&request_body(model, messages))
        .send()
        .await
        .map_err(ChatError::Request)?
        .error_for_status()
        .map_err(ChatError::Request)?;

    let (tx, rx) = tokio::sync::mpsc::channel(32);
    let mut bytes = response.bytes_stream();

    tokio::spawn(async move {
        let mut lines = ByteLineBuffer::default();
        let mut parser = SseLineBuffer::default();

        loop {
            // 上游既不吐数据也不断开时，必须由本地判死，否则 SSE 连接被无限期占用
            let next = match tokio::time::timeout(IDLE_TIMEOUT, bytes.next()).await {
                Ok(next) => next,
                Err(_) => {
                    let _ = tx
                        .send(Err("上游响应超时：60 秒没有收到任何数据".to_owned()))
                        .await;
                    return;
                }
            };
            let Some(next) = next else { break };

            let chunk = match next {
                Ok(chunk) => chunk,
                Err(error) => {
                    let _ = tx.send(Err(error.to_string())).await;
                    return;
                }
            };

            for event in drain_sse_bytes(&mut lines, &mut parser, &chunk) {
                match event {
                    UpstreamEvent::Done { usage } => {
                        let _ = tx.send(Ok(UpstreamEvent::Done { usage })).await;
                        return;
                    }
                    UpstreamEvent::Error(message) => {
                        let _ = tx.send(Err(message)).await;
                        return;
                    }
                    UpstreamEvent::Delta(text) => {
                        if tx.send(Ok(UpstreamEvent::Delta(text))).await.is_err() {
                            return;
                        }
                    }
                }
            }
        }
    });

    Ok(rx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cjk_split_across_tcp_chunks_decodes_intact() {
        let payload = "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\n";
        let bytes = payload.as_bytes();
        let ni = bytes.windows(3).position(|w| w == [0xe4, 0xbd, 0xa0]).expect("你");
        let mut lines = ByteLineBuffer::default();
        let mut parser = SseLineBuffer::default();
        let first = drain_sse_bytes(&mut lines, &mut parser, &bytes[..=ni]);
        assert!(first.is_empty(), "半个汉字不能当完整帧解码");
        let events = drain_sse_bytes(&mut lines, &mut parser, &bytes[ni + 1..]);
        assert_eq!(events, vec![UpstreamEvent::Delta("你好".into())]);
    }

    #[test]
    fn splits_multiple_events_from_one_chunk() {
        let mut parser = SseLineBuffer::default();
        let chunk = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}\n\n",
            "data: [DONE]\n\n"
        );

        let events = parser.feed(chunk);
        assert_eq!(
            events,
            vec![
                UpstreamEvent::Delta("你".into()),
                UpstreamEvent::Delta("好".into()),
                UpstreamEvent::Done { usage: None },
            ]
        );
    }

    #[test]
    fn reassembles_event_split_across_chunks() {
        let mut parser = SseLineBuffer::default();
        assert!(parser.feed("data: {\"choices\":[{\"delta\":{\"cont").is_empty());
        let events = parser.feed("ent\":\"分片\"}}]}\n\ndata: [DONE]\n\n");
        assert_eq!(
            events,
            vec![UpstreamEvent::Delta("分片".into()), UpstreamEvent::Done { usage: None }]
        );
    }

    #[test]
    fn ignores_role_only_and_malformed_payloads() {
        let mut parser = SseLineBuffer::default();
        let events = parser.feed(concat!(
            ": keep-alive\n\n",
            "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n",
            "data: not-json\n\n"
        ));
        assert!(events.is_empty());
    }

    #[test]
    fn splits_crlf_frames_and_keeps_inner_carriage_return() {
        let mut parser = SseLineBuffer::default();
        let events = parser.feed(concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"a\\rb\"}}]}\r\n\r\n",
            "data: [DONE]\r\n\r\n"
        ));
        assert_eq!(
            events,
            vec![UpstreamEvent::Delta("a\rb".into()), UpstreamEvent::Done { usage: None }]
        );
    }

    #[test]
    fn surfaces_inline_error_frame() {
        let mut parser = SseLineBuffer::default();
        let events = parser.feed(
            "data: {\"error\":{\"message\":\"quota exceeded\",\"type\":\"insufficient_quota\"}}\n\n",
        );
        assert_eq!(
            events,
            vec![UpstreamEvent::Error("quota exceeded".into())]
        );
    }

    #[test]
    fn request_body_marks_stream_and_keeps_history() {
        let body = request_body(
            "deepseek-chat",
            &[Message::system("Be brief."), Message::user("Hi")],
        );
        assert_eq!(body["stream"], true);
        assert_eq!(body["stream_options"]["include_usage"], true);
        assert_eq!(body["messages"].as_array().map(Vec::len), Some(2));
        assert_eq!(body["messages"][0]["role"], "system");
    }

    #[test]
    fn usage_chunk_terminates_stream_with_usage() {
        let mut parser = SseLineBuffer::default();
        let events = parser.feed(concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\n",
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":34}}\n\n",
        ));
        assert_eq!(
            events,
            vec![
                UpstreamEvent::Delta("你".into()),
                UpstreamEvent::Done {
                    usage: Some(Usage { prompt_tokens: 12, completion_tokens: 34 }),
                },
            ]
        );
    }

    #[test]
    fn null_usage_in_normal_chunks_does_not_terminate() {
        let mut parser = SseLineBuffer::default();
        let events = parser.feed(concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}],\"usage\":null}\n\n",
            "data: [DONE]\n\n",
        ));
        assert_eq!(
            events,
            vec![
                UpstreamEvent::Delta("你".into()),
                UpstreamEvent::Done { usage: None },
            ]
        );
    }

    #[test]
    fn completions_url_defaults_and_appends_path() {
        assert_eq!(completions_url(None).unwrap(), DEFAULT_COMPLETIONS_URL);
        assert_eq!(
            completions_url(Some(" https://api.openai.com/v1/ ")).unwrap(),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            completions_url(Some("http://127.0.0.1:11434/v1/chat/completions")).unwrap(),
            "http://127.0.0.1:11434/v1/chat/completions"
        );
        assert!(completions_url(Some("javascript:alert(1)")).is_err());
        assert!(completions_url(Some("ftp://api.example.com/v1")).is_err());
    }
}
