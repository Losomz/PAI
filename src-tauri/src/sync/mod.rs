use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

// ── 规则常量（移植自 AgentFramework rules.mjs）──

const ROOT_SYNC_DIR_EXCLUDES: &[&str] = &[
    ".git",
    ".pi",
    ".opencode",
    ".agentframework",
    ".tmp-agentframework",
    ".tmp-bootstrap-src",
    "bin",
    "node_modules",
    "src",
];

const CHILD_SYNC_ENTRY_EXCLUDES: &[&str] = &["node_modules", "README.md"];

const CONFIG_AFTER_MESSAGES: &[(&str, &str)] = &[(".pi", "请在 Pi 中执行 /reload 重新加载扩展。")];

// ── 数据结构 ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncTarget {
    pub from: String,
    pub to: String,
    pub after: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPackage {
    pub name: String,
    pub key: String,
    pub category: String,
    pub entry_name: String,
    pub title: String,
    pub description: String,
    pub commit_scope: String,
    pub targets: Vec<SyncTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncCategory {
    pub name: String,
    pub title: String,
    pub items: Vec<SyncPackage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResult {
    pub from: String,
    pub to: String,
    pub skipped: bool,
    pub error: Option<String>,
}

// ── 规则函数 ──

fn strip_leading_dot(value: &str) -> String {
    value.trim_start_matches('.').to_string()
}

fn trim_markdown_extension(value: &str) -> String {
    if value.to_lowercase().ends_with(".md") {
        value[..value.len() - 3].to_string()
    } else {
        value.to_string()
    }
}

fn is_ignored_root_dir(name: &str) -> bool {
    name.starts_with('.') || ROOT_SYNC_DIR_EXCLUDES.contains(&name)
}

fn is_ignored_child_entry(_category: &str, name: &str) -> bool {
    CHILD_SYNC_ENTRY_EXCLUDES.contains(&name)
}

fn get_category_title(category: &str) -> String {
    match category {
        "agents" => "Agents 模板".to_string(),
        "configs" => "工具配置".to_string(),
        "docs" => "文档".to_string(),
        _ => category.to_string(),
    }
}

fn get_target_path(category: &str, entry_name: &str) -> String {
    if category == "configs" {
        // configs/ 特殊规则：去掉 configs/ 前缀
        entry_name.to_string()
    } else {
        format!("{}/{}", category, entry_name)
    }
}

fn get_package_title(category: &str, entry_name: &str) -> String {
    if category == "configs" {
        match entry_name {
            ".pi" => "Pi 配置".to_string(),
            ".opencode" => "OpenCode 配置".to_string(),
            _ => format!("{} 配置", strip_leading_dot(entry_name)),
        }
    } else {
        format!("{} / {}", get_category_title(category), entry_name)
    }
}

fn get_package_description(category: &str, entry_name: &str, target_path: &str) -> String {
    if category == "configs" {
        format!("同步 {} 到 {}", entry_name, target_path)
    } else {
        format!("同步 {}/{} 到 {}", category, entry_name, target_path)
    }
}

fn get_commit_scope(category: &str, entry_name: &str) -> String {
    if category == "configs" {
        strip_leading_dot(entry_name)
    } else {
        trim_markdown_extension(entry_name)
    }
}

fn get_after_message(entry_name: &str) -> Option<String> {
    for &(key, msg) in CONFIG_AFTER_MESSAGES {
        if key == entry_name {
            return Some(msg.to_string());
        }
    }
    None
}

// ── 构建同步目录 ──

fn create_sync_package(category: &str, entry_name: &str) -> SyncPackage {
    let source_path = format!("{}/{}", category, entry_name);
    let target_path = get_target_path(category, entry_name);
    let base_name = trim_markdown_extension(entry_name);

    let name = if category == "configs" {
        strip_leading_dot(entry_name)
    } else {
        base_name.clone()
    };

    SyncPackage {
        name,
        key: source_path.clone(),
        category: category.to_string(),
        entry_name: entry_name.to_string(),
        title: get_package_title(category, entry_name),
        description: get_package_description(category, entry_name, &target_path),
        commit_scope: get_commit_scope(category, entry_name),
        targets: vec![SyncTarget {
            from: source_path,
            to: target_path,
            after: get_after_message(entry_name),
        }],
    }
}

/// 扫描仓库根目录，构建同步目录
pub fn build_sync_catalog(repo_root: &Path) -> Result<Vec<SyncCategory>, String> {
    let entries = fs::read_dir(repo_root)
        .map_err(|e| format!("读取仓库根目录失败: {}", e))?;

    let mut categories: Vec<SyncCategory> = Vec::new();

    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().to_string();
        let file_type = entry
            .file_type()
            .map_err(|e| format!("读取文件类型失败: {}", e))?;

        if !file_type.is_dir() || is_ignored_root_dir(&file_name) {
            continue;
        }

        let category_name = file_name;
        let category_path = repo_root.join(&category_name);

        let children = fs::read_dir(&category_path)
            .map_err(|e| format!("读取 {} 失败: {}", category_name, e))?;

        let mut items: Vec<SyncPackage> = Vec::new();
        for child in children.flatten() {
            let child_name = child.file_name().to_string_lossy().to_string();
            if is_ignored_child_entry(&category_name, &child_name) {
                continue;
            }
            // 非 configs 分类下，跳过以 . 开头的条目
            if category_name != "configs" && child_name.starts_with('.') {
                continue;
            }
            items.push(create_sync_package(&category_name, &child_name));
        }

        // 对 items 按名称排序
        items.sort_by(|a, b| a.entry_name.cmp(&b.entry_name));

        if !items.is_empty() {
            categories.push(SyncCategory {
                name: category_name.clone(),
                title: get_category_title(&category_name),
                items,
            });
        }
    }

    // 按分类名排序
    categories.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(categories)
}

// ── 执行同步 ──

/// 同步单个目标：删除目标 → 复制源
pub fn sync_target(
    repo_root: &Path,
    project_dir: &Path,
    from: &str,
    to: &str,
) -> Result<SyncResult, String> {
    let source_path = repo_root.join(from);
    let target_path = project_dir.join(to);

    if !source_path.exists() {
        return Ok(SyncResult {
            from: from.to_string(),
            to: to.to_string(),
            skipped: false,
            error: Some(format!("同步源不存在: {}", source_path.display())),
        });
    }

    // 源和目标是同一路径 → 跳过
    let source_canonical = source_path.canonicalize().unwrap_or_else(|_| source_path.clone());
    let target_canonical = if target_path.exists() {
        target_path.canonicalize().unwrap_or_else(|_| target_path.clone())
    } else {
        target_path.clone()
    };

    if source_canonical == target_canonical {
        return Ok(SyncResult {
            from: from.to_string(),
            to: to.to_string(),
            skipped: true,
            error: None,
        });
    }

    // 删除目标
    if target_path.exists() {
        if target_path.is_dir() {
            fs::remove_dir_all(&target_path)
                .map_err(|e| format!("删除目标目录失败: {}", e))?;
        } else {
            fs::remove_file(&target_path)
                .map_err(|e| format!("删除目标文件失败: {}", e))?;
        }
    }

    // 确保目标父目录存在
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目标目录失败: {}", e))?;
    }

    // 复制
    if source_path.is_dir() {
        copy_dir_recursive(&source_path, &target_path)?;
    } else {
        fs::copy(&source_path, &target_path)
            .map_err(|e| format!("复制文件失败: {}", e))?;
    }

    Ok(SyncResult {
        from: from.to_string(),
        to: to.to_string(),
        skipped: false,
        error: None,
    })
}

/// 批量同步多个包
pub fn sync_packages(
    repo_root: &Path,
    project_dir: &Path,
    packages: &[SyncPackage],
) -> Vec<SyncResult> {
    let mut results = Vec::new();

    for pkg in packages {
        for target in &pkg.targets {
            match sync_target(repo_root, project_dir, &target.from, &target.to) {
                Ok(result) => results.push(result),
                Err(e) => results.push(SyncResult {
                    from: target.from.clone(),
                    to: target.to.clone(),
                    skipped: false,
                    error: Some(e),
                }),
            }
        }
    }

    results
}

// ── 辅助：递归复制目录 ──

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|e| format!("创建目录失败: {}", e))?;

    for entry in WalkDir::new(source).into_iter().filter_map(|e| e.ok()) {
        let entry_path = entry.path();
        if entry_path == source {
            continue;
        }

        let relative = entry_path
            .strip_prefix(source)
            .map_err(|e| format!("计算相对路径失败: {}", e))?;
        let dest_path = target.join(relative);

        if entry_path.is_dir() {
            fs::create_dir_all(&dest_path)
                .map_err(|e| format!("创建目录失败: {}", e))?;
        } else {
            // 确保父目录存在
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("创建父目录失败: {}", e))?;
            }
            fs::copy(entry_path, &dest_path)
                .map_err(|e| format!("复制文件失败 {}: {}", entry_path.display(), e))?;
        }
    }

    Ok(())
}
