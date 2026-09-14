#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{env, fs, net::TcpStream, os::windows::process::CommandExt, path::{Path, PathBuf}, process::{Child, Command, Stdio}, sync::{Arc, Mutex}, thread, time::Duration};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const HOST: &str = "127.0.0.1";
const PORT: u16 = 8086;
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct BackendState(Arc<Mutex<Option<Child>>>);

#[derive(Clone, Serialize)]
struct BackendStatus {
    running: bool,
    url: String,
    reason: Option<String>,
}

fn normalize(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy().to_string();
    PathBuf::from(s.strip_prefix("\\\\?\\").unwrap_or(&s))
}

fn app_root(app: &AppHandle) -> PathBuf {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let rd = normalize(resource_dir);
        if rd.join("backend").join("index.js").exists() { return rd; }
    }
    normalize(Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap_or(Path::new(".")).to_path_buf())
}

fn backend_entry(app: &AppHandle) -> PathBuf { app_root(app).join("backend").join("index.js") }

fn node_executable() -> String {
    if let Ok(value) = env::var("KNK_NODE_EXE") { if !value.trim().is_empty() { return value; } }
    if cfg!(target_os = "windows") {
        let candidates = [
            "C:\\Program Files\\nodejs\\node.exe",
            "C:\\Program Files (x86)\\nodejs\\node.exe",
        ];
        for c in &candidates {
            if Path::new(c).exists() { return c.to_string(); }
        }
        "node.exe".to_string()
    } else {
        "node".to_string()
    }
}

fn spawn_backend_process(app: &AppHandle) -> Result<Child, String> {
    let entry = backend_entry(app);
    if !entry.exists() { return Err(format!("No existe el backend: {}", entry.display())); }
    let root = app_root(app);
    let node_modules_path = root.join("node_modules");
    let exe = node_executable();
    let entry_s = entry.to_string_lossy().to_string();
    let log_path = root.join("backend.log");
    let log_file = std::fs::File::create(&log_path)
        .and_then(|f| f.try_clone())
        .unwrap_or_else(|_| std::fs::File::open("nul").unwrap());

    Command::new(&exe)
        .arg(&entry_s)
        .current_dir(root.clone())
        .env("KNK_HOST", HOST)
        .env("KNK_PORT", PORT.to_string())
        .env("NODE_PATH", node_modules_path)
        .env("KNK_BACKEND_ROOT", root.join("backend"))
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file.try_clone().unwrap_or_else(|_| std::fs::File::open("nul").unwrap())))
        .stderr(Stdio::from(log_file))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|error| format!("No se pudo arrancar Node/backend: {error}"))
}

fn health_ready() -> bool { TcpStream::connect((HOST, PORT)).is_ok() }

fn wait_for_backend(max_secs: u32) -> Result<(), String> {
    let attempts = max_secs * 4;
    for _ in 0..attempts {
        if health_ready() { return Ok(()); }
        thread::sleep(Duration::from_millis(250));
    }
    Err(format!("Backend no responde en http://{HOST}:{PORT} tras {max_secs}s"))
}

fn start_backend(app: &AppHandle, state: &BackendState) -> BackendStatus {
    if health_ready() {
        return BackendStatus { running: true, url: format!("http://{HOST}:{PORT}"), reason: Some("backend ya estaba activo".to_string()) };
    }
    match spawn_backend_process(app).and_then(|child| {
        *state.0.lock().map_err(|_| "lock backend inválido".to_string())? = Some(child);
        wait_for_backend(20)?;
        Ok(())
    }) {
        Ok(()) => BackendStatus { running: true, url: format!("http://{HOST}:{PORT}"), reason: None },
        Err(error) => BackendStatus { running: false, url: format!("http://{HOST}:{PORT}"), reason: Some(error) },
    }
}

fn stop_backend(state: &BackendState) {
    if let Ok(mut child) = state.0.lock() {
        if let Some(mut process) = child.take() { let _ = process.kill(); let _ = process.wait(); }
    }
}

fn restart_backend(app: &AppHandle, state: &BackendState) {
    let _ = state.0.lock().map(|mut guard| {
        if let Some(mut process) = guard.take() {
            let _ = process.kill();
            let _ = process.wait();
        }
    });
    thread::sleep(Duration::from_secs(1));
    if let Ok(child) = spawn_backend_process(app) {
        let _ = state.0.lock().map(|mut guard| { *guard = Some(child); });
    }
}

#[tauri::command]
fn backend_status() -> BackendStatus { BackendStatus { running: health_ready(), url: format!("http://{HOST}:{PORT}"), reason: None } }

#[tauri::command]
fn open_assistant(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("assistant") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(&app, "assistant", WebviewUrl::External(format!("http://{HOST}:{PORT}/#assistant").parse().map_err(|e| format!("URL inválida: {e}"))?))
        .title("KNK Assistant")
        .inner_size(380.0, 520.0)
        .min_inner_size(320.0, 380.0)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(true)
        .build()
        .map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn close_assistant(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("assistant") { window.close().map_err(|e| e.to_string())?; }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendState(Arc::new(Mutex::new(None))))
        .invoke_handler(tauri::generate_handler![backend_status, open_assistant, close_assistant])
        .setup(|app| {
            let state = app.state::<BackendState>();
            let status = start_backend(&app.handle(), &state);
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.navigate(format!("http://{HOST}:{PORT}").parse().map_err(|e| format!("URL inválida: {e}"))?);
            }
            if !status.running {
                eprintln!("[knkLinux] {}", status.reason.unwrap_or_else(|| "backend no disponible".to_string()));
            }

            // Watchdog: every 10s check if backend is alive, restart if dead
            let watchdog_handle = app.handle().clone();
            let state_clone = app.state::<BackendState>().inner().0.clone();
            thread::spawn(move || {
                loop {
                    thread::sleep(Duration::from_secs(10));
                    if !health_ready() {
                        if let Ok(mut child) = spawn_backend_process(&watchdog_handle) {
                            let _ = state_clone.lock().map(|mut guard| { *guard = Some(child); });
                            let _ = wait_for_backend(15);
                        }
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) && window.label() == "main" {
                stop_backend(&window.app_handle().state::<BackendState>());
            }
        })
        .run(tauri::generate_context!())
        .expect("error al ejecutar knkLinux Tauri");
}
