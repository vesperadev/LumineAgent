


#[path = "llm/chat.rs"]
mod chat;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .init();

    tracing::debug!("starting DeepSeek chat call");
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let result = chat::chat(
        &client,
        "deepseek-chat",
        "You are a helpful assistant.",
        "Hello, who are you?",
    )
    .await;
    println!("{:?}", result);
}
