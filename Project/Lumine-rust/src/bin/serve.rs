use std::env;
use std::process::ExitCode;
use std::time::Duration;

use lumine_rust::server::{AppState, router};
use lumine_rust::workspace::resolve_workspace_root;

#[tokio::main]
async fn main() -> ExitCode {
    match dotenvy::dotenv() {
        Ok(_) => {}
        Err(error) if error.not_found() => {}
        Err(error) => eprintln!("failed to load .env: {error}"),
    }

    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    let address = std::env::var("LUMINE_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".to_owned());
    let model = std::env::var("LUMINE_MODEL").unwrap_or_else(|_| "deepseek-chat".to_owned());
    let cors_origin = std::env::var("LUMINE_CORS_ORIGIN").unwrap_or_else(|_| "http://localhost:5317".to_owned());

    // 连接阶段必须有上限：DNS 或 TCP 卡住时不能把请求挂在原地
    let client = match reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            eprintln!("failed to build HTTP client: {error}");
            return ExitCode::from(1);
        }
    };

    let listener = match tokio::net::TcpListener::bind(&address).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("failed to bind {address}: {error}");
            return ExitCode::from(1);
        }
    };

    let cwd = env::current_dir().unwrap_or_else(|_| ".".into());
    let workspace_root = resolve_workspace_root(env::var("LUMINE_WORKSPACE").ok().as_deref(), &cwd);
    tracing::info!(
        %address,
        %model,
        %cors_origin,
        workspace = %workspace_root.display(),
        "lumine serve up"
    );

    let app = router(
        AppState {
            client,
            model,
            workspace_root,
        },
        Some(&cors_origin),
    );

    if let Err(error) = axum::serve(listener, app).await {
        eprintln!("server error: {error}");
        return ExitCode::from(1);
    }

    ExitCode::SUCCESS
}
