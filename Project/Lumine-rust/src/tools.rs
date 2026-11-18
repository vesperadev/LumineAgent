use std::fs;
use std::path::{Path, PathBuf};

const MAX_FILE_BYTES: u64 = 64 * 1024;

/// 把相对路径锁在工作区根内，拒绝 `..` 逃逸。
pub fn resolve_in_workspace(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .unwrap_or_else(|_| root.to_path_buf());
    let candidate = if rel.trim().is_empty() || rel == "." {
        root.clone()
    } else {
        root.join(rel)
    };
    let canonical = candidate
        .canonicalize()
        .map_err(|_| format!("路径不存在: {rel}"))?;
    if !canonical.starts_with(&root) {
        return Err("路径超出工作区".to_owned());
    }
    Ok(canonical)
}

pub fn list_dir(root: &Path, rel: &str) -> Result<String, String> {
    let path = resolve_in_workspace(root, rel)?;
    if !path.is_dir() {
        return Err("不是目录".to_owned());
    }
    let mut names = Vec::new();
    for entry in fs::read_dir(&path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let suffix = if entry.path().is_dir() { "/" } else { "" };
        names.push(format!("{name}{suffix}"));
    }
    names.sort();
    Ok(names.join("\n"))
}

pub fn read_file(root: &Path, rel: &str) -> Result<String, String> {
    let path = resolve_in_workspace(root, rel)?;
    if !path.is_file() {
        return Err("不是文件".to_owned());
    }
    let meta = fs::metadata(&path).map_err(|error| error.to_string())?;
    if meta.len() > MAX_FILE_BYTES {
        return Err("文件超过 64KiB，拒绝整文件读入".to_owned());
    }
    fs::read_to_string(&path).map_err(|error| error.to_string())
}

pub fn execute(root: &Path, name: &str, path: &str) -> Result<String, String> {
    match name {
        "list_dir" => list_dir(root, path),
        "read_file" => read_file(root, path),
        other => Err(format!("未知工具: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn rejects_escape_and_lists_workspace() {
        let dir = std::env::temp_dir().join(format!("lumine-tools-{}", std::process::id()));
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("src/hello.txt"), "hi").unwrap();
        let listed = list_dir(&dir, ".").unwrap();
        assert!(listed.contains("src/"));
        assert_eq!(read_file(&dir, "src/hello.txt").unwrap(), "hi");
        assert!(resolve_in_workspace(&dir, "../").is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
