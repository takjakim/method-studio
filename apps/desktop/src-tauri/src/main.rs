// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

fn main() {
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
            commands::installer::get_engine_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Method Studio");
}
