use serde::{Deserialize, Serialize};
use tauri::State;

use crate::backend::BackendHandle;

/// 与后端 `GET /api/workspace/diff`、前端 `core/types.ts` 的 FileChange 同形。
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileChange {
    pub path: String,
    pub status: String,
    pub diff: String,
}

/// 桌面通道：代为请求后端快照。失败返回空列表（与 Web 空态一致，不把 invoke 打成异常）。
#[tauri::command]
pub async fn workspace_diff(state: State<'_, BackendHandle>) -> Result<Vec<FileChange>, String> {
    let addr = match crate::backend::wait_addr(&*state).await {
        Ok(addr) => addr,
        Err(error) => {
            crate::log_warn!("ipc", "workspace_diff 后端未就绪，返回空列表: {error}");
            return Ok(Vec::new());
        }
    };
    let url = format!("http://{addr}/api/workspace/diff");
    crate::log_info!("ipc", "workspace_diff 请求 {url}");
    let response = match state.client.get(&url).send().await {
        Ok(res) => res,
        Err(error) => {
            crate::log_warn!("ipc", "workspace_diff 请求失败: {error}");
            return Ok(Vec::new());
        }
    };
    if !response.status().is_success() {
        crate::log_warn!("ipc", "workspace_diff HTTP {}", response.status());
        return Ok(Vec::new());
    }
    match response.json::<Vec<FileChange>>().await {
        Ok(files) => Ok(files),
        Err(error) => {
            crate::log_warn!("ipc", "workspace_diff JSON 无法解析: {error}");
            Ok(Vec::new())
        }
    }
}
