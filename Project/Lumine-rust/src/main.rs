use std::io::{self, BufRead, Write};
use std::process::ExitCode;

use lumine_rust::llm::chat::{Message, chat};

#[tokio::main]
async fn main() -> ExitCode {
    match dotenvy::dotenv() {
        Ok(_) => {}
        Err(error) if error.not_found() => {}
        Err(error) => eprintln!("failed to load .env: {error}"),
    }

    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .init();

    let client = match reqwest::Client::builder().no_proxy().build() {
        Ok(client) => client,
        Err(error) => {
            eprintln!("failed to build HTTP client: {error}");
            return ExitCode::from(1);
        }
    };

    let mut history = vec![Message::system("You are a helpful assistant.")];
    println!("Chat with deepseek-chat. Type exit or quit to leave.");

    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout();

    loop {
        print!("> ");
        if let Err(error) = stdout.flush() {
            eprintln!("failed to flush prompt: {error}");
            return ExitCode::from(1);
        }

        let mut line = String::new();
        match stdin.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::Interrupted => break,
            Err(error) => {
                eprintln!("failed to read input: {error}");
                return ExitCode::from(1);
            }
        }

        let input = line.trim();
        if input.is_empty() {
            continue;
        }
        if input.eq_ignore_ascii_case("exit") || input.eq_ignore_ascii_case("quit") {
            break;
        }

        history.push(Message::user(input));
        match chat(&client, "deepseek-chat", &history).await {
            Ok(reply) => {
                println!("{reply}");
                history.push(Message::assistant(reply));
            }
            Err(error) => {
                history.pop();
                tracing::error!(error = %error, "chat failed");
                eprintln!("{error}");
            }
        }
    }

    ExitCode::SUCCESS
}
