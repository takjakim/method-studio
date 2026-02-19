use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct Dataset {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DatasetContent {
    pub name: String,
    pub content: String,
    pub format: String,
}

fn get_datasets_dir(app: tauri::AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let datasets_dir = app_dir.join("datasets");
    fs::create_dir_all(&datasets_dir)
        .map_err(|e| format!("Failed to create datasets directory: {}", e))?;
    Ok(datasets_dir)
}

#[tauri::command]
pub async fn load_dataset(app: tauri::AppHandle, name: String) -> Result<DatasetContent, String> {
    let datasets_dir = get_datasets_dir(app)?;
    let csv_path = datasets_dir.join(format!("{}.csv", name));
    let json_path = datasets_dir.join(format!("{}.json", name));

    if csv_path.exists() {
        let content = fs::read_to_string(&csv_path)
            .map_err(|e| format!("Failed to read dataset: {}", e))?;
        Ok(DatasetContent {
            name,
            content,
            format: "csv".to_string(),
        })
    } else if json_path.exists() {
        let content = fs::read_to_string(&json_path)
            .map_err(|e| format!("Failed to read dataset: {}", e))?;
        Ok(DatasetContent {
            name,
            content,
            format: "json".to_string(),
        })
    } else {
        Err(format!("Dataset '{}' not found", name))
    }
}

#[tauri::command]
pub async fn save_dataset(
    app: tauri::AppHandle,
    name: String,
    content: String,
    format: String,
) -> Result<String, String> {
    let datasets_dir = get_datasets_dir(app)?;
    let ext = match format.as_str() {
        "json" => "json",
        _ => "csv",
    };
    let file_path = datasets_dir.join(format!("{}.{}", name, ext));

    fs::write(&file_path, &content)
        .map_err(|e| format!("Failed to save dataset: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn list_datasets(app: tauri::AppHandle) -> Result<Vec<Dataset>, String> {
    let datasets_dir = get_datasets_dir(app)?;

    let entries = fs::read_dir(&datasets_dir)
        .map_err(|e| format!("Failed to list datasets: {}", e))?;

    let mut datasets = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext == "csv" || ext == "json" {
                let name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                let metadata = entry.metadata().ok();
                let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                let modified = metadata
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs());

                datasets.push(Dataset {
                    name,
                    path: path.to_string_lossy().to_string(),
                    size,
                    modified,
                });
            }
        }
    }

    datasets.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(datasets)
}
