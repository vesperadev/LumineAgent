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
    Done,
    /// 上游在 200 流内下发的 `{"error":{...}}`：必须转成 error 事件，不能当作正常结束
    Error(String),
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
                events.push(UpstreamEvent::Done);
                continue;
            }
            if let Some(message) = error_message(payload) {
                events.push(UpstreamEvent::Error(message));
                continue;
            }
            if let Some(text) = delta_text(payload) {
                events.push(UpstreamEvent::Delta(text));
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

fn request_body(model: &str, messages: &[Message]) -> Value {
    json!({
        "model": model,
        "stream": true,
        "messages": messages
            .iter()
            .map(|message| json!({ "role": message.role.as_api_str(), "content": message.content }))
            .collect::<Vec<_>>(),
    })
}

/// 打开上游流式请求，返回事件通道；错误只在此刻发生一次，之后都走通道。
pub async fn chat_stream(
    client: &reqwest::Client,
    model: &str,
    messages: &[Message],
) -> Result<tokio::sync::mpsc::Receiver<Result<UpstreamEvent, String>>, ChatError> {
    let api_key = std::env::var("DEEPSEEK_API_KEY").map_err(ChatError::MissingApiKey)?;

    let response = client
        .post("https://api.deepseek.com/v1/chat/completions")
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
                    UpstreamEvent::Done => {
                        let _ = tx.send(Ok(UpstreamEvent::Done)).await;
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
                UpstreamEvent::Done,
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
            vec![UpstreamEvent::Delta("分片".into()), UpstreamEvent::Done]
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
            vec![UpstreamEvent::Delta("a\rb".into()), UpstreamEvent::Done]
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
        assert_eq!(body["messages"].as_array().map(Vec::len), Some(2));
        assert_eq!(body["messages"][0]["role"], "system");
    }
}
