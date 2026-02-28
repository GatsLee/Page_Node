use std::sync::Mutex;
use tauri::Manager;
use tauri::State;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

pub struct BackendPort(pub Mutex<u16>);

#[tauri::command]
fn get_backend_port(state: State<BackendPort>) -> u16 {
    *state.0.lock().unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(BackendPort(Mutex::new(0u16)))
        .setup(|app| {
            let handle = app.handle().clone();

            // Dev mode: dev.sh sets PAGENODE_BACKEND_PORT — use it directly.
            // Prod mode: spawn the PyInstaller sidecar, read PORT= from stdout.
            if let Ok(port_str) = std::env::var("PAGENODE_BACKEND_PORT") {
                if let Ok(port) = port_str.trim().parse::<u16>() {
                    *handle.state::<BackendPort>().0.lock().unwrap() = port;
                    return Ok(());
                }
            }

            // Production: spawn backend sidecar and wait for PORT= line on stdout.
            tauri::async_runtime::spawn(async move {
                let (mut rx, _child) = handle
                    .shell()
                    .sidecar("pagenode-backend")
                    .expect("pagenode-backend sidecar binary not found")
                    .spawn()
                    .expect("failed to spawn pagenode-backend sidecar");

                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line_bytes) => {
                            let line = String::from_utf8_lossy(&line_bytes);
                            if let Some(port_str) = line.trim().strip_prefix("PORT=") {
                                if let Ok(port) = port_str.trim().parse::<u16>() {
                                    *handle.state::<BackendPort>().0.lock().unwrap() = port;
                                    break;
                                }
                            }
                        }
                        CommandEvent::Error(err) => {
                            eprintln!("[pagenode] backend sidecar error: {err}");
                            break;
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_backend_port])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
