//! 工作区只读快照：扫描配置根目录的 git 工作树，产出文件增删改 + unified diff。
//!
//! 任何失败（非仓库、无 git、无改动、命令超时）都变成空列表，由 HTTP 层返回 200。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

/// 单文件上限：避免把巨型 diff 塞进 JSON；超出时截断并附注。
const MAX_DIFF_BYTES: usize = 64 * 1024;
/// 单次快照最多收录的文件数，防止海量未跟踪目录拖垮接口。
const MAX_FILES: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Add,
    Mod,
    Del,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FileChange {
    pub path: String,
    pub status: FileStatus,
    pub diff: String,
}

/// 解析 `LUMINE_WORKSPACE`：空或未设则用当前工作目录。
pub fn resolve_workspace_root(raw: Option<&str>, cwd: &Path) -> PathBuf {
    match raw.map(str::trim) {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => cwd.to_path_buf(),
    }
}

/// 给 HTTP 用：永远成功，失败即空列表。
pub fn snapshot_or_empty(root: &Path) -> Vec<FileChange> {
    snapshot(root).unwrap_or_default()
}

/// `None` 表示「不是 git 工作树 / git 不可用」，调用方应视作空快照。
pub fn snapshot(root: &Path) -> Option<Vec<FileChange>> {
    if !root.is_dir() {
        return Some(Vec::new());
    }
    let inside = git_stdout(root, &["rev-parse", "--is-inside-work-tree"])?;
    if String::from_utf8_lossy(&inside).trim() != "true" {
        return Some(Vec::new());
    }

    let porcelain = git_stdout(root, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
    let entries = parse_porcelain_z(&porcelain);
    if entries.is_empty() {
        return Some(Vec::new());
    }

    let has_head = git_stdout(root, &["rev-parse", "--verify", "HEAD"]).is_some();
    let combined = if has_head {
        git_stdout(root, &["diff", "HEAD", "--no-ext-diff", "--no-color"]).unwrap_or_default()
    } else {
        git_stdout(root, &["diff", "--cached", "--no-ext-diff", "--no-color"]).unwrap_or_default()
    };
    let mut diffs = split_unified_diff(&String::from_utf8_lossy(&combined));

    let mut out = Vec::new();
    for entry in entries {
        if out.len() >= MAX_FILES {
            break;
        }
        let Some(status) = status_from_xy(entry.xy) else {
            continue;
        };
        if !is_safe_rel_path(&entry.path) {
            continue;
        }
        let diff = diffs.remove(&entry.path).unwrap_or_else(|| match status {
            FileStatus::Add => read_add_diff(root, &entry.path),
            FileStatus::Del => format!("--- a/{}\n+++ /dev/null\n", entry.path),
            FileStatus::Mod => String::new(),
        });
        out.push(FileChange {
            path: entry.path,
            status,
            diff: truncate_diff(diff),
        });
    }
    Some(out)
}

#[derive(Debug, PartialEq, Eq)]
struct PorcelainEntry {
    xy: [u8; 2],
    path: String,
}

/// 把 `git status --porcelain=v1 -z` 拆成条目。纯函数，便于离线测。
fn parse_porcelain_z(bytes: &[u8]) -> Vec<PorcelainEntry> {
    let mut rest = bytes;
    let mut out = Vec::new();
    while rest.len() >= 3 {
        let xy = [rest[0], rest[1]];
        // 标准格式是 `XY PATH\0`；XY 后必须有一个空格
        if rest[2] != b' ' {
            break;
        }
        rest = &rest[3..];
        let (first, next) = split_nul(rest);
        if first.is_empty() && next.is_empty() {
            break;
        }
        let rename = xy[0] == b'R' || xy[0] == b'C';
        let (path, next) = if rename {
            let (second, next) = split_nul(next);
            (String::from_utf8_lossy(second).into_owned(), next)
        } else {
            (String::from_utf8_lossy(first).into_owned(), next)
        };
        if !path.is_empty() {
            out.push(PorcelainEntry { xy, path });
        }
        rest = next;
    }
    out
}

/// 将 index/worktree 两列映射到对外的 add|mod|del。
pub fn status_from_xy(xy: [u8; 2]) -> Option<FileStatus> {
    if xy == *b"??" {
        return Some(FileStatus::Add);
    }
    let index = xy[0];
    let work = xy[1];
    // 工作树删除优先：暂存了修改再删文件，侧栏应显示 del
    if work == b'D' || (index == b'D' && work == b' ') {
        return Some(FileStatus::Del);
    }
    if index == b'A' || work == b'A' || index == b'R' || index == b'C' {
        return Some(FileStatus::Add);
    }
    if index == b'M' || work == b'M' || index == b'T' || work == b'T' || index == b'U' || work == b'U' {
        return Some(FileStatus::Mod);
    }
    if index == b'D' {
        return Some(FileStatus::Del);
    }
    None
}

/// 把 `git diff` 的拼接输出按文件切开。键是 `+++`/`---` 里的路径。
pub fn split_unified_diff(combined: &str) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    if combined.is_empty() {
        return map;
    }
    let mut current_path: Option<String> = None;
    let mut buf = String::new();
    for line in combined.split_inclusive('\n') {
        if line.starts_with("diff --git ") {
            if let Some(path) = current_path.take() {
                map.insert(path, std::mem::take(&mut buf));
            }
            buf.push_str(line);
            current_path = path_from_git_header(line.trim_end());
            continue;
        }
        buf.push_str(line);
        if let Some(path) = path_from_plus_minus(line.trim_end()) {
            current_path = Some(path);
        }
    }
    if let Some(path) = current_path {
        map.insert(path, buf);
    }
    map
}

fn path_from_git_header(line: &str) -> Option<String> {
    // `diff --git a/foo.rs b/foo.rs` —— 取 b/ 侧（重命名后的新路径）
    let rest = line.strip_prefix("diff --git ")?;
    let b_at = rest.rfind(" b/")?;
    Some(rest[b_at + 3..].to_string())
}

fn path_from_plus_minus(line: &str) -> Option<String> {
    if let Some(rest) = line.strip_prefix("+++ b/") {
        return Some(rest.to_string());
    }
    if line == "+++ /dev/null" {
        return None;
    }
    if let Some(rest) = line.strip_prefix("--- a/") {
        // 仅在尚未从 +++ 取到路径时作为删除文件名；调用方后写覆盖
        return Some(rest.to_string());
    }
    None
}

fn read_add_diff(root: &Path, rel: &str) -> String {
    let path = root.join(rel);
    match std::fs::read(&path) {
        Ok(bytes) if bytes.contains(&0) => format!("Binary files /dev/null and {rel} differ\n"),
        Ok(bytes) => {
            let body = String::from_utf8_lossy(&bytes);
            unified_from_empty(rel, &body)
        }
        Err(_) => String::new(),
    }
}

/// 把「从空文件新增」编成 unified diff。纯函数。
pub fn unified_from_empty(path: &str, body: &str) -> String {
    if body.is_empty() {
        return format!("--- /dev/null\n+++ b/{path}\n");
    }
    let lines: Vec<&str> = body.split('\n').collect();
    // split 会在末尾换行时多出一个空串；保留内容行
    let content: Vec<&str> = if body.ends_with('\n') {
        lines[..lines.len().saturating_sub(1)].to_vec()
    } else {
        lines
    };
    let n = content.len();
    let mut out = String::new();
    out.push_str("--- /dev/null\n");
    out.push_str("+++ b/");
    out.push_str(path);
    out.push('\n');
    out.push_str(&format!("@@ -0,0 +1,{n} @@\n"));
    for line in content {
        out.push('+');
        out.push_str(line);
        out.push('\n');
    }
    out
}

fn truncate_diff(mut diff: String) -> String {
    if diff.len() <= MAX_DIFF_BYTES {
        return diff;
    }
    diff.truncate(MAX_DIFF_BYTES);
    diff.push_str("\n... [truncated]\n");
    diff
}

fn is_safe_rel_path(path: &str) -> bool {
    if path.is_empty() || path.starts_with('/') || path.starts_with('\\') {
        return false;
    }
    if Path::new(path).is_absolute() {
        return false;
    }
    !path.split(['/', '\\']).any(|part| part == "..")
}

fn split_nul(bytes: &[u8]) -> (&[u8], &[u8]) {
    match bytes.iter().position(|&b| b == 0) {
        Some(i) => (&bytes[..i], &bytes[i + 1..]),
        None => (bytes, &[]),
    }
}

fn git_stdout(root: &Path, args: &[&str]) -> Option<Vec<u8>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    // diff 在有差异时退出码为 1，仍要把 stdout 当结果
    if output.status.success() || output.status.code() == Some(1) {
        Some(output.stdout)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(1);

    struct TempDir {
        path: PathBuf,
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn temp_dir() -> TempDir {
        let path = std::env::temp_dir().join(format!(
            "lumine-ws-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        TempDir { path }
    }

    fn git(root: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("git must be available for workspace tests");
        assert!(status.success(), "git {args:?} failed");
    }

    fn init_repo(root: &Path) {
        git(root, &["init", "-b", "main"]);
        git(root, &["config", "user.email", "test@example.com"]);
        git(root, &["config", "user.name", "test"]);
        git(root, &["config", "commit.gpgsign", "false"]);
    }

    #[test]
    fn resolve_root_prefers_env_then_cwd() {
        let cwd = Path::new("/tmp/cwd");
        assert_eq!(resolve_workspace_root(None, cwd), cwd);
        assert_eq!(resolve_workspace_root(Some(""), cwd), cwd);
        assert_eq!(
            resolve_workspace_root(Some(" /data/proj "), cwd),
            PathBuf::from("/data/proj")
        );
    }

    #[test]
    fn porcelain_parses_add_mod_del_and_rename() {
        let raw = b"?? new.txt\0 M src/a.rs\0D  gone.rs\0R  old.rs\0renamed.rs\0";
        let entries = parse_porcelain_z(raw);
        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0].path, "new.txt");
        assert_eq!(status_from_xy(entries[0].xy), Some(FileStatus::Add));
        assert_eq!(entries[1].path, "src/a.rs");
        assert_eq!(status_from_xy(entries[1].xy), Some(FileStatus::Mod));
        assert_eq!(entries[2].path, "gone.rs");
        assert_eq!(status_from_xy(entries[2].xy), Some(FileStatus::Del));
        assert_eq!(entries[3].path, "renamed.rs");
        assert_eq!(status_from_xy(entries[3].xy), Some(FileStatus::Add));
    }

    #[test]
    fn status_xy_covers_common_index_worktree_pairs() {
        assert_eq!(status_from_xy(*b"A "), Some(FileStatus::Add));
        assert_eq!(status_from_xy(*b"M "), Some(FileStatus::Mod));
        assert_eq!(status_from_xy(*b"MM"), Some(FileStatus::Mod));
        assert_eq!(status_from_xy(*b"MD"), Some(FileStatus::Del));
        assert_eq!(status_from_xy(*b" D"), Some(FileStatus::Del));
        assert_eq!(status_from_xy(*b"??"), Some(FileStatus::Add));
        assert_eq!(status_from_xy(*b"  "), None);
    }

    #[test]
    fn split_diff_uses_plus_path_and_deleted_minus_path() {
        let combined = "\
diff --git a/keep.rs b/keep.rs
--- a/keep.rs
+++ b/keep.rs
@@ -1 +1 @@
-old
+new
diff --git a/gone.rs b/gone.rs
deleted file mode 100644
--- a/gone.rs
+++ /dev/null
@@ -1 +0,0 @@
-bye
";
        let map = split_unified_diff(combined);
        assert!(map["keep.rs"].contains("+new"));
        assert!(map["gone.rs"].contains("--- a/gone.rs"));
    }

    #[test]
    fn unified_from_empty_numbers_lines() {
        let diff = unified_from_empty("hello.txt", "a\nb\n");
        assert!(diff.contains("+++ b/hello.txt"));
        assert!(diff.contains("@@ -0,0 +1,2 @@"));
        assert!(diff.contains("+a\n+b\n"));
    }

    #[test]
    fn unsafe_paths_are_rejected() {
        assert!(!is_safe_rel_path("../secret"));
        assert!(!is_safe_rel_path("/etc/passwd"));
        assert!(is_safe_rel_path("src/lib.rs"));
    }

    #[test]
    fn non_git_directory_yields_empty_list() {
        let tmp = temp_dir();
        fs::write(tmp.path.join("x.txt"), "hi").unwrap();
        let files = snapshot_or_empty(&tmp.path);
        assert!(files.is_empty());
    }

    #[test]
    fn missing_directory_yields_empty_list() {
        let files = snapshot_or_empty(Path::new("/this/path/does/not/exist-lumine-ws"));
        assert!(files.is_empty());
    }

    #[test]
    fn git_repo_reports_add_mod_del() {
        let tmp = temp_dir();
        init_repo(&tmp.path);
        fs::write(tmp.path.join("keep.txt"), "one\n").unwrap();
        fs::write(tmp.path.join("gone.txt"), "bye\n").unwrap();
        git(&tmp.path, &["add", "keep.txt", "gone.txt"]);
        git(&tmp.path, &["commit", "-m", "init"]);

        fs::write(tmp.path.join("keep.txt"), "two\n").unwrap();
        fs::remove_file(tmp.path.join("gone.txt")).unwrap();
        fs::write(tmp.path.join("fresh.txt"), "hello\n").unwrap();

        let files = snapshot(&tmp.path).expect("repo should snapshot");
        let by_path: BTreeMap<_, _> = files.into_iter().map(|f| (f.path.clone(), f)).collect();

        assert_eq!(by_path["keep.txt"].status, FileStatus::Mod);
        assert!(by_path["keep.txt"].diff.contains("+two"));
        assert_eq!(by_path["gone.txt"].status, FileStatus::Del);
        assert_eq!(by_path["fresh.txt"].status, FileStatus::Add);
        assert!(by_path["fresh.txt"].diff.contains("+hello"));
    }

    #[test]
    fn empty_repo_without_head_lists_untracked_as_add() {
        let tmp = temp_dir();
        init_repo(&tmp.path);
        fs::write(tmp.path.join("only.txt"), "solo\n").unwrap();
        let files = snapshot(&tmp.path).expect("empty repo is still a work tree");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "only.txt");
        assert_eq!(files[0].status, FileStatus::Add);
        assert!(files[0].diff.contains("+solo"));
    }

    #[test]
    fn file_change_serializes_to_documented_shape() {
        let json = serde_json::to_value(FileChange {
            path: "src/a.rs".into(),
            status: FileStatus::Mod,
            diff: "@@\n".into(),
        })
        .unwrap();
        assert_eq!(json["path"], "src/a.rs");
        assert_eq!(json["status"], "mod");
        assert_eq!(json["diff"], "@@\n");
    }
}
