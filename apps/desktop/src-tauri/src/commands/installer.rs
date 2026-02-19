// Commands for checking bundled R/Python engines

use std::process::Command;
use serde::{Deserialize, Serialize};

use crate::commands::bundled_engines::{find_bundled_rscript, find_bundled_python};

#[derive(Debug, Serialize, Deserialize)]
pub struct EngineInstallStatus {
    pub r_installed: bool,
    pub r_version: Option<String>,
    pub r_packages_installed: bool,
    pub python_installed: bool,
    pub python_version: Option<String>,
    pub python_packages_installed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EnginePaths {
    pub r_path: Option<String>,
    pub python_path: Option<String>,
}

// Note: Packages are pre-installed in bundled engines, so we only need to verify engines exist

#[tauri::command]
pub async fn check_install_status(app_handle: tauri::AppHandle) -> Result<EngineInstallStatus, String> {
    // Check bundled R installation
    let rscript_path = find_bundled_rscript(&app_handle);
    let (r_installed, r_version) = if let Some(ref path) = rscript_path {
        let r_check = Command::new(path).arg("--version").output();
        match r_check {
            Ok(output) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stderr).trim().to_string();
                (true, Some(version))
            }
            _ => (false, None),
        }
    } else {
        (false, None)
    };

    // Packages are pre-installed in bundled R
    let r_packages_installed = r_installed;

    // Check bundled Python installation
    let python_path = find_bundled_python(&app_handle);
    let (python_installed, python_version) = if let Some(ref path) = python_path {
        let py_check = Command::new(path).arg("--version").output();
        match py_check {
            Ok(output) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                (true, Some(version))
            }
            _ => (false, None),
        }
    } else {
        (false, None)
    };

    // Packages are pre-installed in bundled Python
    let python_packages_installed = python_installed;

    Ok(EngineInstallStatus {
        r_installed,
        r_version,
        r_packages_installed,
        python_installed,
        python_version,
        python_packages_installed,
    })
}

#[tauri::command]
pub async fn get_engine_paths(app_handle: tauri::AppHandle) -> Result<EnginePaths, String> {
    let r_path = find_bundled_rscript(&app_handle).map(|p| p.to_string_lossy().to_string());
    let python_path = find_bundled_python(&app_handle).map(|p| p.to_string_lossy().to_string());

    Ok(EnginePaths {
        r_path,
        python_path,
    })
}

// DEPRECATED: Runtime installation is no longer supported
// All engines and packages are bundled with the application
/*
#[tauri::command]
pub async fn install_r() -> Result<String, String> {
    Err("Runtime installation is deprecated. All engines are bundled with the application.".to_string())
}

#[tauri::command]
pub async fn install_python() -> Result<String, String> {
    Err("Runtime installation is deprecated. All engines are bundled with the application.".to_string())
}

#[tauri::command]
pub async fn install_r_packages() -> Result<String, String> {
    Err("Runtime package installation is deprecated. All packages are pre-installed in bundled engines.".to_string())
}

#[tauri::command]
pub async fn install_python_packages() -> Result<String, String> {
    Err("Runtime package installation is deprecated. All packages are pre-installed in bundled engines.".to_string())
}

#[tauri::command]
pub async fn install_homebrew() -> Result<String, String> {
    Err("Homebrew installation is no longer needed. All engines are bundled with the application.".to_string())
}
*/
