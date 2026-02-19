// Library crate for Method Studio
// Used for Tauri mobile support and testing

pub mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::engine::run_r_script,
            commands::engine::run_python_script,
            commands::engine::check_engine_status,
            commands::engine::run_analysis,
            commands::storage::load_dataset,
            commands::storage::save_dataset,
            commands::storage::list_datasets,
            commands::installer::check_install_status,
            commands::installer::install_r,
            commands::installer::install_python,
            commands::installer::install_r_packages,
            commands::installer::install_python_packages,
            commands::installer::install_homebrew,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Method Studio");
}
