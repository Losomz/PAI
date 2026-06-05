pub mod git;
pub mod sync;

use std::path::PathBuf;

use sync::{SyncCategory, SyncPackage, SyncResult};

/// 默认远程仓库
const DEFAULT_REPO_URL: &str = "https://github.com/Losomz/AgentFramework.git";
const DEFAULT_REF: &str = "main";

fn get_cache_dir() -> PathBuf {
    dirs_cache_dir()
}

fn dirs_cache_dir() -> PathBuf {
    // $HOME/.agentframework/repo
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".agentframework").join("repo")
}

// ── Tauri Commands ──

#[tauri::command]
fn get_default_config() -> serde_json::Value {
    serde_json::json!({
        "repoUrl": DEFAULT_REPO_URL,
        "refName": DEFAULT_REF,
        "cacheDir": get_cache_dir().to_string_lossy(),
    })
}

#[tauri::command]
fn ensure_repo(
    repo_url: String,
    ref_name: String,
    cache_dir: String,
) -> Result<String, String> {
    let cache_path = PathBuf::from(&cache_dir);
    git::ensure_repo(&repo_url, &ref_name, &cache_path)
}

#[tauri::command]
fn get_repo_info(cache_dir: String) -> Result<git::RepoInfo, String> {
    git::get_repo_info(&PathBuf::from(&cache_dir))
}

#[tauri::command]
fn get_sync_catalog(repo_root: String) -> Result<Vec<SyncCategory>, String> {
    sync::build_sync_catalog(&PathBuf::from(&repo_root))
}

#[tauri::command]
fn sync_execute(
    repo_root: String,
    project_dir: String,
    packages: Vec<SyncPackage>,
) -> Result<Vec<SyncResult>, String> {
    let repo = PathBuf::from(&repo_root);
    let project = PathBuf::from(&project_dir);
    Ok(sync::sync_packages(&repo, &project, &packages))
}

#[tauri::command]
fn git_auto_commit(
    project_dir: String,
    paths: Vec<String>,
    message: String,
    skip_push: bool,
) -> Result<git::GitCommitResult, String> {
    git::auto_commit_and_push(&PathBuf::from(&project_dir), &paths, &message, skip_push)
}

#[tauri::command]
fn git_status(project_dir: String) -> Result<String, String> {
    git::get_status(&PathBuf::from(&project_dir))
}

#[tauri::command]
fn is_git_repo(dir: String) -> bool {
    git::is_git_repo(&PathBuf::from(&dir))
}

// ── 入口 ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_default_config,
            ensure_repo,
            get_repo_info,
            get_sync_catalog,
            sync_execute,
            git_auto_commit,
            git_status,
            is_git_repo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
