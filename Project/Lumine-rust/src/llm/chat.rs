use std::fmt;

use reqwest::Client;
use serde_json::{Value, json};

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
    UnexpectedResponse,
}

impl fmt::Display for ChatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ChatError::MissingApiKey(error) => {
                write!(f, "failed to read DEEPSEEK_API_KEY: {error}")
            }
            ChatError::Request(error) => write!(f, "DeepSeek request failed: {error}"),
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
        .map_err(ChatError::Request)?
        .error_for_status()
        .map_err(ChatError::Request)?
        .json::<Value>()
        .await
        .map_err(ChatError::Request)?;

    response["choices"][0]["message"]["content"]
        .as_str()
        .map(str::to_owned)
        .ok_or(ChatError::UnexpectedResponse)
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
}
