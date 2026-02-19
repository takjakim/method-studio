// Commands for checking and installing R/Python

use std::process::Command;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct EngineInstallStatus {
    pub r_installed: bool,
    pub r_version: Option<String>,
    pub python_installed: bool,
    pub python_version: Option<String>,
    pub homebrew_installed: bool,  // macOS only
    pub winget_available: bool,    // Windows only
}

#[tauri::command]
pub async fn check_install_status() -> Result<EngineInstallStatus, String> {
    // Check R installation
    let r_check = Command::new("Rscript").arg("--version").output();
    let (r_installed, r_version) = match r_check {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stderr).trim().to_string();
            (true, Some(version))
        }
        _ => (false, None),
    };

    // Check Python installation
    let py_cmd = if cfg!(target_os = "windows") { "python" } else { "python3" };
    let py_check = Command::new(py_cmd).arg("--version").output();
    let (python_installed, python_version) = match py_check {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            (true, Some(version))
        }
        _ => (false, None),
    };

    // Check Homebrew (macOS)
    let homebrew_installed = if cfg!(target_os = "macos") {
        Command::new("brew").arg("--version").output().map(|o| o.status.success()).unwrap_or(false)
    } else {
        false
    };

    // Check winget (Windows)
    let winget_available = if cfg!(target_os = "windows") {
        Command::new("winget").arg("--version").output().map(|o| o.status.success()).unwrap_or(false)
    } else {
        false
    };

    Ok(EngineInstallStatus {
        r_installed,
        r_version,
        python_installed,
        python_version,
        homebrew_installed,
        winget_available,
    })
}

#[tauri::command]
pub async fn install_r() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        // Try Homebrew first
        let result = Command::new("brew")
            .args(["install", "r"])
            .output()
            .map_err(|e| format!("Failed to run brew: {}", e))?;

        if result.status.success() {
            Ok("R installed successfully via Homebrew".to_string())
        } else {
            Err(String::from_utf8_lossy(&result.stderr).to_string())
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Try winget
        let result = Command::new("winget")
            .args(["install", "--id", "RProject.R", "-e", "--accept-source-agreements", "--accept-package-agreements"])
            .output()
            .map_err(|e| format!("Failed to run winget: {}", e))?;

        if result.status.success() {
            Ok("R installed successfully via winget".to_string())
        } else {
            Err(String::from_utf8_lossy(&result.stderr).to_string())
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("Automatic installation not supported on this platform".to_string())
    }
}

#[tauri::command]
pub async fn install_python() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let result = Command::new("brew")
            .args(["install", "python3"])
            .output()
            .map_err(|e| format!("Failed to run brew: {}", e))?;

        if result.status.success() {
            Ok("Python installed successfully via Homebrew".to_string())
        } else {
            Err(String::from_utf8_lossy(&result.stderr).to_string())
        }
    }

    #[cfg(target_os = "windows")]
    {
        let result = Command::new("winget")
            .args(["install", "--id", "Python.Python.3.12", "-e", "--accept-source-agreements", "--accept-package-agreements"])
            .output()
            .map_err(|e| format!("Failed to run winget: {}", e))?;

        if result.status.success() {
            Ok("Python installed successfully via winget".to_string())
        } else {
            Err(String::from_utf8_lossy(&result.stderr).to_string())
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("Automatic installation not supported on this platform".to_string())
    }
}

#[tauri::command]
pub async fn install_homebrew() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let result = Command::new("sh")
            .args(["-c", "/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""])
            .output()
            .map_err(|e| format!("Failed to install Homebrew: {}", e))?;

        if result.status.success() {
            Ok("Homebrew installed successfully".to_string())
        } else {
            Err("Please install Homebrew manually from https://brew.sh".to_string())
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Homebrew is only available on macOS".to_string())
    }
}
