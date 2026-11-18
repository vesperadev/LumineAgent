use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionMessage {
    pub role: String,
    pub content: String,
}

fn default_space() -> String {
    "daily".to_owned()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Session {
    pub id: String,
    pub title: String,
    #[serde(default, alias = "updatedMs")]
    pub updated_ms: u64,
    #[serde(default)]
    pub messages: Vec<SessionMessage>,
    /// 侧栏分组：`daily` 进「日常」，`agent` 进「智能体对话」。缺省当日常，兼容旧 JSON。
    #[serde(default = "default_space")]
    pub space: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct SessionStore {
    pub sessions: Vec<Session>,
}

impl SessionStore {
    pub fn load(path: &Path) -> Self {
        let Ok(raw) = fs::read_to_string(path) else {
            return Self::default();
        };
        serde_json::from_str(&raw).unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let raw = serde_json::to_string_pretty(self).map_err(|error| error.to_string())?;
        fs::write(path, raw).map_err(|error| error.to_string())
    }

    pub fn list(&self) -> Vec<Session> {
        let mut sessions = self.sessions.clone();
        sessions.sort_by_key(|session| std::cmp::Reverse(session.updated_ms));
        for session in &mut sessions {
            session.messages.clear();
        }
        sessions
    }

    pub fn get(&self, id: &str) -> Option<&Session> {
        self.sessions.iter().find(|session| session.id == id)
    }

    pub fn upsert(&mut self, mut session: Session) -> Session {
        session.updated_ms = now_ms();
        if session.id.trim().is_empty() {
            session.id = new_id();
        }
        if session.title.trim().is_empty() {
            session.title = title_from(&session.messages);
        }
        if session.space.trim().is_empty() {
            session.space = default_space();
        }
        if let Some(existing) = self
            .sessions
            .iter_mut()
            .find(|item| item.id == session.id)
        {
            *existing = session.clone();
        } else {
            self.sessions.push(session.clone());
        }
        session
    }

    pub fn delete(&mut self, id: &str) -> bool {
        let before = self.sessions.len();
        self.sessions.retain(|session| session.id != id);
        self.sessions.len() < before
    }
}

pub fn store_path(data_dir: &Path) -> PathBuf {
    data_dir.join("sessions.json")
}

fn title_from(messages: &[SessionMessage]) -> String {
    messages
        .iter()
        .find(|message| message.role == "user")
        .map(|message| {
            let flat = message.content.replace('\n', " ");
            let trim = flat.trim();
            if trim.chars().count() > 24 {
                format!("{}…", trim.chars().take(24).collect::<String>())
            } else if trim.is_empty() {
                "新会话".to_owned()
            } else {
                trim.to_owned()
            }
        })
        .unwrap_or_else(|| "新会话".to_owned())
}

fn new_id() -> String {
    format!("s{}", now_ms())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_assigns_id_and_title() {
        let mut store = SessionStore::default();
        let saved = store.upsert(Session {
            id: String::new(),
            title: String::new(),
            updated_ms: 0,
            messages: vec![SessionMessage {
                role: "user".into(),
                content: "帮我看一下 Cargo.toml".into(),
            }],
            space: String::new(),
        });
        assert_eq!(saved.space, "daily");
        assert!(saved.id.starts_with('s'));
        assert!(saved.title.contains("Cargo"));
        assert_eq!(store.list().len(), 1);
        assert!(store.get(&saved.id).is_some());
        assert!(store.delete(&saved.id));
        assert!(store.list().is_empty());
    }

    #[test]
    fn upsert_accepts_payload_without_updated_ms() {
        let session: Session = serde_json::from_str(
            r#"{"id":"s1","title":"hi","messages":[{"role":"user","content":"你好"}]}"#,
        )
        .unwrap();
        assert_eq!(session.updated_ms, 0);
        assert_eq!(session.space, "daily");
        let mut store = SessionStore::default();
        let saved = store.upsert(session);
        assert!(saved.updated_ms > 0);
        assert_eq!(saved.space, "daily");
    }

    #[test]
    fn upsert_keeps_agent_space() {
        let mut store = SessionStore::default();
        let saved = store.upsert(Session {
            id: "s-agent".into(),
            title: "审阅".into(),
            updated_ms: 0,
            messages: vec![],
            space: "agent".into(),
        });
        assert_eq!(saved.space, "agent");
        assert_eq!(store.get("s-agent").map(|item| item.space.as_str()), Some("agent"));
    }
}
