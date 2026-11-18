use std::env;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use lumine_rust::approvals::ApprovalHub;
use lumine_rust::server::{AppState, router};
use lumine_rust::sessions::{SessionStore, store_path};
use lumine_rust::workspace::resolve_workspace_root;
use tokio::sync::Mutex;

fn load_env_files() {
    match dotenvy::dotenv() {
        Ok(_) => {}
        Err(error) if error.not_found() => {}
        Err(error) => eprintln!("failed to load .env: {error}"),
    }
    if let Ok(base) = env::var("LOCALAPPDATA").or_else(|_| env::var("HOME")) {
        let packaged = PathBuf::from(base).join("LumineAgent").join("secrets.env");
        match dotenvy::from_path(&packaged) {
            Ok(_) => {}
            Err(error) if error.not_found() => {}
            Err(error) => eprintln!("failed to load packaged env: {error}"),
        }
    }
}

fn data_dir() -> PathBuf {
    if let Ok(path) = env::var("LUMINE_DATA_DIR") {
        return PathBuf::from(path);
    }
    let base = env::var("LOCALAPPDATA")
        .or_else(|_| env::var("HOME"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("LumineAgent")
}

#[tokio::main]
async fn main() -> ExitCode {
    load_env_files();

    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    let address = std::env::var("LUMINE_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".to_owned());
    let model = std::env::var("LUMINE_MODEL").unwrap_or_else(|_| "deepseek-chat".to_owned());
    let cors_origin =
        std::env::var("LUMINE_CORS_ORIGIN").unwrap_or_else(|_| "http://localhost:5317".to_owned());

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
    let data_dir = data_dir();
    let sessions = SessionStore::load(&store_path(&data_dir));

    tracing::info!(
        %address,
        %model,
        %cors_origin,
        workspace = %workspace_root.display(),
        data = %data_dir.display(),
        "lumine serve up"
    );

    let app = router(
        AppState {
            client,
            model,
            workspace_root,
            data_dir,
            sessions: Arc::new(Mutex::new(sessions)),
            approvals: Arc::new(ApprovalHub::default()),
        },
        Some(&cors_origin),
    );

    if let Err(error) = axum::serve(listener, app).await {
        eprintln!("server error: {error}");
        return ExitCode::from(1);
    }

    ExitCode::SUCCESS
}
