use std::path::Path;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

// ── 辅助：执行 git 命令 ──

fn run_git(args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .output()
        .map_err(|e| format!("执行 git 失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        Err(if stderr.is_empty() {
            format!(
                "git {} 失败，退出码: {}",
                args.join(" "),
                output.status.code().unwrap_or(-1)
            )
        } else {
            stderr
        })
    }
}

// ── 公开 API ──

/// 克隆或更新仓库缓存，返回仓库根目录路径
pub fn ensure_repo(repo_url: &str, ref_name: &str, cache_dir: &Path) -> Result<String, String> {
    let git_dir = cache_dir.join(".git");

    if !git_dir.exists() {
        std::fs::create_dir_all(cache_dir)
            .map_err(|e| format!("创建缓存目录失败: {}", e))?;

        log_action(&format!("正在克隆 {} ...", repo_url));
        run_git(
            &[
                "clone",
                "--depth",
                "1",
                "--branch",
                ref_name,
                repo_url,
                &cache_dir.to_string_lossy(),
            ],
            None,
        )?;
    } else {
        log_action("正在更新缓存...");
        run_git(
            &["remote", "set-url", "origin", repo_url],
            Some(cache_dir),
        )?;
        run_git(
            &["fetch", "--depth", "1", "origin", ref_name],
            Some(cache_dir),
        )?;
        run_git(&["checkout", ref_name], Some(cache_dir))?;
        run_git(
            &["reset", "--hard", &format!("origin/{}", ref_name)],
            Some(cache_dir),
        )?;
    }

    Ok(cache_dir.to_string_lossy().to_string())
}

/// 获取仓库信息（当前 commit hash、分支）
pub fn get_repo_info(cache_dir: &Path) -> Result<RepoInfo, String> {
    if !cache_dir.join(".git").exists() {
        return Ok(RepoInfo {
            ready: false,
            commit: String::new(),
            branch: String::new(),
        });
    }

    let commit =
        run_git(&["rev-parse", "--short", "HEAD"], Some(cache_dir)).unwrap_or_default();
    let branch =
        run_git(&["rev-parse", "--abbrev-ref", "HEAD"], Some(cache_dir)).unwrap_or_default();

    Ok(RepoInfo {
        ready: true,
        commit,
        branch,
    })
}

/// 检查目录是否是 Git 仓库
pub fn is_git_repo(dir: &Path) -> bool {
    if !dir.exists() {
        return false;
    }
    run_git(&["rev-parse", "--is-inside-work-tree"], Some(dir))
        .map(|s| s == "true")
        .unwrap_or(false)
}

/// 获取 git status 输出
pub fn get_status(dir: &Path) -> Result<String, String> {
    run_git(&["status", "--short", "--branch"], Some(dir))
}

/// 获取相对于 project_dir 的相对路径（如果目标在项目内）
pub fn relative_path_inside_project(project_dir: &Path, target_path: &Path) -> Option<String> {
    target_path
        .strip_prefix(project_dir)
        .ok()
        .map(|p| p.to_string_lossy().to_string().replace('\\', "/"))
}

/// 自动 git add + commit + push
pub fn auto_commit_and_push(
    project_dir: &Path,
    paths: &[String],
    message: &str,
    skip_push: bool,
) -> Result<GitCommitResult, String> {
    if !is_git_repo(project_dir) {
        return Ok(GitCommitResult {
            status: "skipped".to_string(),
            reason: "目标目录不是 Git 仓库".to_string(),
            message: String::new(),
        });
    }

    // 过滤被 gitignore 的路径
    let mut commit_paths: Vec<String> = Vec::new();
    for p in paths {
        match run_git(&["check-ignore", "-q", "--", p], Some(project_dir)) {
            Ok(_) => log_action(&format!("跳过 Git 忽略路径: {}", p)),
            Err(_) => commit_paths.push(p.clone()),
        }
    }

    if commit_paths.is_empty() {
        return Ok(GitCommitResult {
            status: "skipped".to_string(),
            reason: "没有可提交的同步路径".to_string(),
            message: String::new(),
        });
    }

    // git add
    let mut add_args: Vec<&str> = vec!["add", "-A", "--"];
    let owned_paths: Vec<String> = commit_paths.iter().cloned().collect();
    for p in &owned_paths {
        add_args.push(p.as_str());
    }
    run_git(&add_args, Some(project_dir))?;

    // 检查是否有改动
    let mut status_args: Vec<&str> = vec!["status", "--porcelain", "--"];
    for p in &owned_paths {
        status_args.push(p.as_str());
    }
    let status_output = run_git(&status_args, Some(project_dir))?;

    if status_output.trim().is_empty() {
        return Ok(GitCommitResult {
            status: "skipped".to_string(),
            reason: "同步路径没有 Git 改动".to_string(),
            message: String::new(),
        });
    }

    // git commit
    log_action(&format!("自动提交：{}", message));
    let mut commit_args: Vec<&str> = vec!["commit", "-m", message, "--"];
    for p in &owned_paths {
        commit_args.push(p.as_str());
    }
    run_git(&commit_args, Some(project_dir))?;

    // git push
    if !skip_push {
        log_action("正在推送...");
        run_git(&["push"], Some(project_dir))?;
    }

    Ok(GitCommitResult {
        status: if skip_push {
            "committed".to_string()
        } else {
            "committed-and-pushed".to_string()
        },
        reason: String::new(),
        message: message.to_string(),
    })
}

fn log_action(msg: &str) {
    use std::io::Write;
    let _ = std::io::stderr().write_all(format!("[PAI git] {}\n", msg).as_bytes());
}

// ── 数据结构 ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoInfo {
    pub ready: bool,
    pub commit: String,
    pub branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommitResult {
    pub status: String,
    pub reason: String,
    pub message: String,
}
