use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

// ── Data structures ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncRecord {
    pub id: String,
    pub name: String,
    pub from_path: String,
    pub to_path: String,
    pub ref_name: Option<String>,
    #[serde(default = "default_sync_mode")]
    pub sync_mode: String,
    pub created_at: String,
}

// ── Persistence helpers ──

fn records_file_path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join(".agentframework")
        .join("sync_records.json")
}

fn ensure_records_dir() -> Result<(), String> {
    let path = records_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    Ok(())
}

fn read_all_records() -> Result<Vec<SyncRecord>, String> {
    let path = records_file_path();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("读取记录文件失败: {}", e))?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&content).map_err(|e| format!("解析记录失败: {}", e))
}

fn write_all_records(records: &[SyncRecord]) -> Result<(), String> {
    ensure_records_dir()?;
    let path = records_file_path();
    let content =
        serde_json::to_string_pretty(records).map_err(|e| format!("序列化记录失败: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("写入记录文件失败: {}", e))
}

// ── Tauri Commands ──

#[tauri::command]
pub fn list_sync_records() -> Result<Vec<SyncRecord>, String> {
    read_all_records()
}

#[tauri::command]
pub fn save_sync_record(
    id: Option<String>,
    name: String,
    from_path: String,
    to_path: String,
    ref_name: Option<String>,
    sync_mode: Option<String>,
) -> Result<SyncRecord, String> {
    let sync_mode = normalize_sync_mode(sync_mode)?;
    let mut records = read_all_records()?;

    if let Some(existing_id) = id {
        // Update existing
        {
            let record = records
                .iter_mut()
                .find(|r| r.id == existing_id)
                .ok_or_else(|| "记录不存在".to_string())?;
            record.name = name;
            record.from_path = from_path;
            record.to_path = to_path;
            record.ref_name = ref_name;
            record.sync_mode = sync_mode;
        }
        write_all_records(&records)?;
        let record = records.iter().find(|r| r.id == existing_id).unwrap().clone();
        Ok(record)
    } else {
        // Create new
        let new_id = uuid_like_id();
        let now = chrono_now_string();
        let record = SyncRecord {
            id: new_id,
            name,
            from_path,
            to_path,
            ref_name,
            sync_mode,
            created_at: now,
        };
        records.push(record.clone());
        write_all_records(&records)?;
        Ok(record)
    }
}

#[tauri::command]
pub fn delete_sync_record(id: String) -> Result<(), String> {
    let mut records = read_all_records()?;
    let before = records.len();
    records.retain(|r| r.id != id);
    if records.len() == before {
        return Err("记录不存在".to_string());
    }
    write_all_records(&records)
}

// ── Helpers ──

fn default_sync_mode() -> String {
    "full".to_string()
}

fn normalize_sync_mode(sync_mode: Option<String>) -> Result<String, String> {
    let mode = sync_mode.unwrap_or_else(default_sync_mode);
    match mode.as_str() {
        "full" | "incremental" | "clean" | "replace" | "merge" => Ok(mode),
        other => Err(format!("未知同步模式: {}", other)),
    }
}

fn uuid_like_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let suffix: u32 = (ts & 0xFFFFFFFF) as u32 ^ 0xDEADBEEF;
    format!("{:x}", suffix)
}

fn chrono_now_string() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", ts)
}
