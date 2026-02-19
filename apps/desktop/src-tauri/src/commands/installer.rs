// Commands for checking and installing R/Python

use std::process::Command;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

/// Find Rscript executable, checking common installation paths
pub fn find_rscript() -> Option<PathBuf> {
    // Try PATH first
    if let Ok(output) = Command::new("Rscript").arg("--version").output() {
        if output.status.success() {
            return Some(PathBuf::from("Rscript"));
        }
    }

    // Common R installation paths on macOS
    #[cfg(target_os = "macos")]
    {
        let paths = [
            "/usr/local/bin/Rscript",
            "/opt/homebrew/bin/Rscript",
            "/Library/Frameworks/R.framework/Versions/Current/Resources/bin/Rscript",
            "/opt/R/arm64/bin/Rscript",
            "/opt/R/x86_64/bin/Rscript",
        ];
        for path in paths {
            let p = PathBuf::from(path);
            if p.exists() {
                return Some(p);
            }
        }
    }

    // Common R installation paths on Windows
    #[cfg(target_os = "windows")]
    {
        // Check common R installation directories
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            let r_dir = PathBuf::from(&program_files).join("R");
            if r_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(&r_dir) {
                    for entry in entries.flatten() {
                        let rscript = entry.path().join("bin").join("Rscript.exe");
                        if rscript.exists() {
                            return Some(rscript);
                        }
                    }
                }
            }
        }
    }

    None
}

/// Find Python executable, checking common installation paths
pub fn find_python() -> Option<PathBuf> {
    let cmd = if cfg!(target_os = "windows") { "python" } else { "python3" };

    // Try PATH first
    if let Ok(output) = Command::new(cmd).arg("--version").output() {
        if output.status.success() {
            return Some(PathBuf::from(cmd));
        }
    }

    // Common Python installation paths on macOS
    #[cfg(target_os = "macos")]
    {
        let paths = [
            "/usr/local/bin/python3",
            "/opt/homebrew/bin/python3",
            "/usr/bin/python3",
            "/Library/Frameworks/Python.framework/Versions/Current/bin/python3",
        ];
        for path in paths {
            let p = PathBuf::from(path);
            if p.exists() {
                return Some(p);
            }
        }
    }

    // Common Python installation paths on Windows
    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let python_dir = PathBuf::from(&local_app_data).join("Programs").join("Python");
            if python_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(&python_dir) {
                    for entry in entries.flatten() {
                        let python = entry.path().join("python.exe");
                        if python.exists() {
                            return Some(python);
                        }
                    }
                }
            }
        }
    }

    None
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EngineInstallStatus {
    pub r_installed: bool,
    pub r_version: Option<String>,
    pub r_packages_installed: bool,
    pub r_missing_packages: Vec<String>,
    pub python_installed: bool,
    pub python_version: Option<String>,
    pub python_packages_installed: bool,
    pub python_missing_packages: Vec<String>,
    pub homebrew_installed: bool,  // macOS only
    pub winget_available: bool,    // Windows only
}

const R_REQUIRED_PACKAGES: &[&str] = &["jsonlite", "psych", "lavaan", "lme4", "boot", "mediation"];
const PYTHON_REQUIRED_PACKAGES: &[&str] = &["pandas", "numpy", "scipy", "statsmodels", "semopy", "factor_analyzer", "pingouin"];

#[tauri::command]
pub async fn check_install_status() -> Result<EngineInstallStatus, String> {
    // Check R installation
    let rscript_path = find_rscript();
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

    // Check R packages
    let (r_packages_installed, r_missing_packages) = if let Some(ref path) = rscript_path {
        check_r_packages_internal(path)
    } else {
        (false, R_REQUIRED_PACKAGES.iter().map(|s| s.to_string()).collect())
    };

    // Check Python installation
    let python_path = find_python();
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

    // Check Python packages
    let (python_packages_installed, python_missing_packages) = if let Some(ref path) = python_path {
        check_python_packages_internal(path)
    } else {
        (false, PYTHON_REQUIRED_PACKAGES.iter().map(|s| s.to_string()).collect())
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
        r_packages_installed,
        r_missing_packages,
        python_installed,
        python_version,
        python_packages_installed,
        python_missing_packages,
        homebrew_installed,
        winget_available,
    })
}

fn check_r_packages_internal(rscript_path: &PathBuf) -> (bool, Vec<String>) {
    let mut missing = Vec::new();

    for pkg in R_REQUIRED_PACKAGES {
        let check_script = format!(
            "if (!requireNamespace('{}', quietly = TRUE)) quit(status = 1)",
            pkg
        );
        let result = Command::new(rscript_path)
            .args(["-e", &check_script])
            .output();

        match result {
            Ok(output) if output.status.success() => {}
            _ => missing.push(pkg.to_string()),
        }
    }

    (missing.is_empty(), missing)
}

fn check_python_packages_internal(python_path: &PathBuf) -> (bool, Vec<String>) {
    let mut missing = Vec::new();

    for pkg in PYTHON_REQUIRED_PACKAGES {
        let check_script = format!(
            "import importlib.util; exit(0 if importlib.util.find_spec('{}') else 1)",
            pkg
        );
        let result = Command::new(python_path)
            .args(["-c", &check_script])
            .output();

        match result {
            Ok(output) if output.status.success() => {}
            _ => missing.push(pkg.to_string()),
        }
    }

    (missing.is_empty(), missing)
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
pub async fn install_r_packages() -> Result<String, String> {
    let rscript_path = find_rscript()
        .ok_or_else(|| "Rscript not found. Please install R first.".to_string())?;

    let packages_str = R_REQUIRED_PACKAGES.join("', '");
    let install_script = format!(
        "install.packages(c('{}'), repos = 'https://cloud.r-project.org/')",
        packages_str
    );

    let result = Command::new(&rscript_path)
        .args(["-e", &install_script])
        .output()
        .map_err(|e| format!("Failed to run Rscript: {}", e))?;

    if result.status.success() {
        Ok("R packages installed successfully".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&result.stderr);
        Err(format!("Failed to install R packages: {}", stderr))
    }
}

#[tauri::command]
pub async fn install_python_packages() -> Result<String, String> {
    let python_path = find_python()
        .ok_or_else(|| "Python not found. Please install Python first.".to_string())?;

    let packages: Vec<&str> = PYTHON_REQUIRED_PACKAGES.to_vec();

    // Build pip install command with SSL workaround for Windows
    let mut cmd = Command::new(&python_path);
    cmd.args(["-m", "pip", "install", "--user"]);

    // Add trusted hosts to bypass SSL issues on Windows
    #[cfg(target_os = "windows")]
    {
        cmd.args([
            "--trusted-host", "pypi.org",
            "--trusted-host", "pypi.python.org",
            "--trusted-host", "files.pythonhosted.org",
        ]);
    }

    cmd.args(&packages);

    let result = cmd.output()
        .map_err(|e| format!("Failed to run pip: {}", e))?;

    if result.status.success() {
        Ok("Python packages installed successfully".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let stdout = String::from_utf8_lossy(&result.stdout);
        Err(format!("Failed to install Python packages:\n{}\n{}", stderr, stdout))
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
