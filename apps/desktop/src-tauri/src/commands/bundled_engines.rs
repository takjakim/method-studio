use std::path::PathBuf;
use tauri::Manager;

// Platform-specific directory name
#[cfg(all(target_arch = "aarch64", target_os = "macos"))]
const PLATFORM_DIR: &str = "macos-arm64";

#[cfg(all(target_arch = "x86_64", target_os = "macos"))]
const PLATFORM_DIR: &str = "macos-x64";

#[cfg(all(target_arch = "x86_64", target_os = "windows"))]
const PLATFORM_DIR: &str = "windows-x64";

// Linux fallback - bundled engines not supported, will return None
#[cfg(all(target_arch = "x86_64", target_os = "linux"))]
const PLATFORM_DIR: &str = "linux-x64";

// Fallback for any other platform
#[cfg(not(any(
    all(target_arch = "aarch64", target_os = "macos"),
    all(target_arch = "x86_64", target_os = "macos"),
    all(target_arch = "x86_64", target_os = "windows"),
    all(target_arch = "x86_64", target_os = "linux")
)))]
const PLATFORM_DIR: &str = "unsupported";

#[cfg(target_os = "windows")]
const RSCRIPT_EXECUTABLE: &str = "Rscript.exe";

#[cfg(not(target_os = "windows"))]
const RSCRIPT_EXECUTABLE: &str = "Rscript";

#[cfg(target_os = "windows")]
const PYTHON_EXECUTABLE: &str = "python.exe";

#[cfg(not(target_os = "windows"))]
const PYTHON_EXECUTABLE: &str = "python3";

/// Get the bundled engines base directory
pub fn get_bundled_engines_dir(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    // Try production path first (in resource_dir)
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        // Check for _up_/_up_ prefixed structure (from ../../bundled-engines in tauri.conf.json)
        let up_up_path = resource_dir.join("_up_").join("_up_").join("bundled-engines");
        if up_up_path.exists() {
            return Some(up_up_path);
        }

        // Check for _up_ prefixed structure
        let up_path = resource_dir.join("_up_").join("bundled-engines");
        if up_path.exists() {
            return Some(up_path);
        }

        // Check for direct structure
        let direct_path = resource_dir.join("bundled-engines");
        if direct_path.exists() {
            return Some(direct_path);
        }
    }

    // Development fallback: walk up from executable to find apps/desktop/bundled-engines
    if let Ok(exe_path) = std::env::current_exe() {
        let mut current = exe_path.parent()?;

        // Walk up the directory tree
        for _ in 0..10 {
            // Check for apps/desktop/bundled-engines (production-like structure)
            let apps_path = current.join("apps").join("desktop").join("bundled-engines");
            if apps_path.exists() {
                return Some(apps_path);
            }

            // Check for bundled-engines directly (fallback)
            let bundled_path = current.join("bundled-engines");
            if bundled_path.exists() {
                return Some(bundled_path);
            }

            current = current.parent()?;
        }
    }

    None
}

/// Locate the bundled Rscript executable
pub fn find_bundled_rscript(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    let engines_dir = get_bundled_engines_dir(app_handle)?;
    let rscript_path = engines_dir
        .join(PLATFORM_DIR)
        .join("r")
        .join("bin")
        .join(RSCRIPT_EXECUTABLE);

    if rscript_path.exists() {
        Some(rscript_path)
    } else {
        None
    }
}

/// Locate the bundled Python executable
pub fn find_bundled_python(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    let engines_dir = get_bundled_engines_dir(app_handle)?;

    // Windows embeddable Python has python.exe in root, not in bin/
    #[cfg(target_os = "windows")]
    let python_path = engines_dir
        .join(PLATFORM_DIR)
        .join("python")
        .join(PYTHON_EXECUTABLE);

    // Unix systems have python3 in bin/
    #[cfg(not(target_os = "windows"))]
    let python_path = engines_dir
        .join(PLATFORM_DIR)
        .join("python")
        .join("bin")
        .join(PYTHON_EXECUTABLE);

    if python_path.exists() {
        Some(python_path)
    } else {
        None
    }
}

/// Get the bundled R library path (where packages are installed)
pub fn get_bundled_r_library(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    let engines_dir = get_bundled_engines_dir(app_handle)?;
    let library_path = engines_dir
        .join(PLATFORM_DIR)
        .join("r")
        .join("library");

    if library_path.exists() {
        Some(library_path)
    } else {
        None
    }
}

/// Get the bundled Python site-packages path
pub fn get_bundled_python_site_packages(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    let engines_dir = get_bundled_engines_dir(app_handle)?;

    // Python site-packages location varies by platform
    #[cfg(target_os = "windows")]
    let site_packages_path = engines_dir
        .join(PLATFORM_DIR)
        .join("python")
        .join("Lib")
        .join("site-packages");

    #[cfg(not(target_os = "windows"))]
    let site_packages_path = {
        // On Unix systems, we need to find the pythonX.Y directory
        let python_lib = engines_dir
            .join(PLATFORM_DIR)
            .join("python")
            .join("lib");

        if let Ok(entries) = std::fs::read_dir(&python_lib) {
            // Find the first pythonX.Y directory
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(name) = path.file_name() {
                        if name.to_string_lossy().starts_with("python") {
                            let site_packages = path.join("site-packages");
                            if site_packages.exists() {
                                return Some(site_packages);
                            }
                        }
                    }
                }
            }
        }

        // Fallback to python3.x pattern
        python_lib.join("python3").join("site-packages")
    };

    if site_packages_path.exists() {
        Some(site_packages_path)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_platform_constants() {
        // Just verify constants are defined correctly
        #[cfg(all(target_arch = "aarch64", target_os = "macos"))]
        assert_eq!(PLATFORM_DIR, "macos-arm64");

        #[cfg(all(target_arch = "x86_64", target_os = "macos"))]
        assert_eq!(PLATFORM_DIR, "macos-x64");

        #[cfg(all(target_arch = "x86_64", target_os = "windows"))]
        assert_eq!(PLATFORM_DIR, "windows-x64");
    }

    #[test]
    fn test_executable_names() {
        #[cfg(target_os = "windows")]
        {
            assert_eq!(RSCRIPT_EXECUTABLE, "Rscript.exe");
            assert_eq!(PYTHON_EXECUTABLE, "python.exe");
        }

        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(RSCRIPT_EXECUTABLE, "Rscript");
            assert_eq!(PYTHON_EXECUTABLE, "python3");
        }
    }
}
