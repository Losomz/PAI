use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

// ── Data structures ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResult {
    pub from: String,
    pub to: String,
    pub skipped: bool,
    pub error: Option<String>,
    pub files_copied: u64,
}

// ── URL detection ──

fn is_remote_url(path: &str) -> bool {
    path.starts_with("http://")
        || path.starts_with("https://")
        || path.starts_with("git://")
        || path.starts_with("ssh://")
}

/// Parse a from_path that may contain a remote URL.
/// Returns (repo_url, sub_path_in_repo) if remote, or None if local.
fn parse_remote_source(from_path: &str) -> Option<(String, Option<String>)> {
    if !is_remote_url(from_path) {
        return None;
    }
    if let Some(idx) = from_path.find("::") {
        let repo_url = from_path[..idx].to_string();
        let sub_path = from_path[idx + 2..].to_string();
        Some((repo_url, if sub_path.is_empty() { None } else { Some(sub_path) }))
    } else {
        Some((from_path.to_string(), None))
    }
}

/// Compute a cache directory for a given repo URL.
fn repo_cache_dir(repo_url: &str) -> std::path::PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    // Simple hash from the URL string
    let hash = simple_hash(repo_url);
    std::path::PathBuf::from(home)
        .join(".agentframework")
        .join("cache")
        .join(format!("{:x}", hash))
}

fn simple_hash(s: &str) -> u64 {
    let mut hash: u64 = 5381;
    for b in s.bytes() {
        hash = hash.wrapping_mul(33).wrapping_add(b as u64);
    }
    hash
}

// ── Direct sync command ──

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SyncMode {
    Full,
    Incremental,
}

impl SyncMode {
    fn from_option(value: Option<String>) -> Result<Self, String> {
        match value.as_deref().unwrap_or("full") {
            "full" | "clean" => Ok(Self::Full),
            // Compatibility aliases for older builds / saved records.
            "incremental" | "replace" | "merge" => Ok(Self::Incremental),
            other => Err(format!("未知同步模式: {}", other)),
        }
    }
}

#[tauri::command]
pub async fn sync_direct(
    from_path: String,
    to_path: String,
    ref_name: Option<String>,
    sync_mode: Option<String>,
) -> Result<SyncResult, String> {
    tokio::task::spawn_blocking(move || -> Result<SyncResult, String> {
        let target = Path::new(&to_path);
        let sync_mode = SyncMode::from_option(sync_mode)?;

        match parse_remote_source(&from_path) {
            Some((repo_url, sub_path)) => {
                // Remote repository source
                let branch = ref_name.unwrap_or_else(|| "main".to_string());
                let cache_dir = repo_cache_dir(&repo_url);

                // Clone or update the repo to cache
                crate::git::ensure_repo(&repo_url, &branch, &cache_dir)?;

                // The actual source is cache_dir + optional sub_path
                let effective_source = match &sub_path {
                    Some(sp) => cache_dir.join(sp),
                    None => cache_dir.clone(),
                };

                if !effective_source.exists() {
                    return Err(format!(
                        "仓库内路径不存在: {} (缓存位置: {})",
                        sub_path.unwrap_or_default(),
                        effective_source.display()
                    ));
                }

                do_sync(&effective_source, target, &from_path, &to_path, sync_mode)
            }
            None => {
                // Local path source
                let source = Path::new(&from_path);
                if !source.exists() {
                    return Err(format!("源路径不存在: {}", from_path));
                }
                do_sync(source, target, &from_path, &to_path, sync_mode)
            }
        }
    })
    .await
    .map_err(|e| format!("任务执行失败: {}", e))? }

/// Core copy logic: source path → target path
fn do_sync(
    source: &Path,
    target: &Path,
    display_from: &str,
    display_to: &str,
    sync_mode: SyncMode,
) -> Result<SyncResult, String> {
    // Skip if source and target resolve to the same location
    let source_canonical = source
        .canonicalize()
        .unwrap_or_else(|_| source.to_path_buf());
    let target_canonical = if target.exists() {
        target.canonicalize().unwrap_or_else(|_| target.to_path_buf())
    } else {
        target.to_path_buf()
    };

    if source_canonical == target_canonical {
        return Ok(SyncResult {
            from: display_from.to_string(),
            to: display_to.to_string(),
            skipped: true,
            error: None,
            files_copied: 0,
        });
    }

    let files_copied = match sync_mode {
        SyncMode::Full => {
            // Full sync: remove the existing target first, then copy everything from source.
            if target.exists() {
                if target.is_dir() {
                    fs::remove_dir_all(target).map_err(|e| format!("删除目标目录失败: {}", e))?;
                } else {
                    fs::remove_file(target).map_err(|e| format!("删除目标文件失败: {}", e))?;
                }
            }
            copy_source_to_target(source, target)?
        }
        SyncMode::Incremental => {
            // Incremental sync: copy everything from source onto target without deleting target extras.
            // Same-path files are overwritten; new source files are added.
            copy_source_to_target(source, target)?
        }
    };

    // If nothing was copied (empty source), flag it as an error
    if files_copied == 0 {
        return Ok(SyncResult {
            from: display_from.to_string(),
            to: display_to.to_string(),
            skipped: false,
            error: Some("源目录为空，未复制任何文件。请检查仓库地址和分支名是否正确".to_string()),
            files_copied: 0,
        });
    }

    Ok(SyncResult {
        from: display_from.to_string(),
        to: display_to.to_string(),
        skipped: false,
        error: None,
        files_copied,
    })
}

// ── Helpers ──

fn copy_source_to_target(source: &Path, target: &Path) -> Result<u64, String> {
    if source.is_dir() {
        if target.exists() && !target.is_dir() {
            return Err("目标路径已存在且不是目录，无法同步目录".to_string());
        }
        copy_dir_recursive(source, target)
    } else {
        if target.exists() && target.is_dir() {
            return Err("目标路径已存在且是目录，无法用源文件覆盖目录".to_string());
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目标父目录失败: {}", e))?;
        }
        fs::copy(source, target).map_err(|e| format!("复制文件失败: {}", e))?;
        Ok(1)
    }
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<u64, String> {
    fs::create_dir_all(target).map_err(|e| format!("创建目录失败: {}", e))?;

    let mut count: u64 = 0;
    for entry in walkdir::WalkDir::new(source)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let entry_path = entry.path();
        if entry_path == source {
            continue;
        }

        let relative = entry_path
            .strip_prefix(source)
            .map_err(|e| format!("计算相对路径失败: {}", e))?;
        let dest_path = target.join(relative);

        if entry_path.is_dir() {
            fs::create_dir_all(&dest_path).map_err(|e| format!("创建目录失败: {}", e))?;
        } else {
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
            }
            fs::copy(entry_path, &dest_path)
                .map_err(|e| format!("复制文件失败 {}: {}", entry_path.display(), e))?;
            count += 1;
        }
    }

    Ok(count)
}
