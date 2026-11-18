use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::backend::BackendHandle;

#[derive(Deserialize, Serialize)]
pub struct SessionPayload {
    pub id: String,
    pub title: String,
    pub messages: Vec<crate::chat::ChatMessage>,
    #[serde(default)]
    pub space: String,
}

fn secrets_path() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA").or_else(|_| std::env::var("HOME")).unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("LumineAgent").join("secrets.env")
}

pub fn secrets_file() -> PathBuf {
    secrets_path()
}

#[tauri::command]
pub fn save_api_key(key: String) -> Result<(), String> {
    let path = secrets_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let trimmed = key.trim();
    if trimmed.is_empty() {
        let _ = fs::remove_file(&path);
        return Ok(());
    }
    fs::write(&path, format!("DEEPSEEK_API_KEY={trimmed}\n")).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn pick_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let files = app
        .dialog()
        .file()
        .blocking_pick_files()
        .unwrap_or_default();
    Ok(files
        .into_iter()
        .filter_map(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

#[tauri::command]
pub fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|error| error.to_string())
}

async fn backend_url(state: &BackendHandle, path: &str) -> Result<String, String> {
    let addr = crate::backend::wait_addr(state).await?;
    Ok(format!("http://{addr}{path}"))
}

#[tauri::command]
pub async fn list_sessions(state: State<'_, BackendHandle>) -> Result<Value, String> {
    let url = backend_url(&state, "/api/sessions").await?;
    let res = state.client.get(url).send().await.map_err(|error| error.to_string())?;
    res.json().await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_session(state: State<'_, BackendHandle>, id: String) -> Result<Value, String> {
    let url = backend_url(&state, &format!("/api/sessions/{id}")).await?;
    let res = state.client.get(url).send().await.map_err(|error| error.to_string())?;
    res.json().await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn put_session(state: State<'_, BackendHandle>, session: SessionPayload) -> Result<Value, String> {
    let url = backend_url(&state, "/api/sessions").await?;
    let res = state
        .client
        .post(url)
        .json(&session)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    res.json().await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_session(state: State<'_, BackendHandle>, id: String) -> Result<(), String> {
    let url = backend_url(&state, &format!("/api/sessions/{id}")).await?;
    state
        .client
        .delete(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn approve_tool(state: State<'_, BackendHandle>, id: String, allow: bool) -> Result<(), String> {
    let url = backend_url(&state, "/api/approvals").await?;
    state
        .client
        .post(url)
        .json(&serde_json::json!({ "id": id, "allow": allow }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}
