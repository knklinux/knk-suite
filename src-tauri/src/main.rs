#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{env, fs, net::TcpStream, os::windows::process::CommandExt, path::{Path, PathBuf}, process::{Child, Command, Stdio}, sync::{Arc, Mutex}, thread, time::Duration};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const HOST: &str = "127.0.0.1";
const PORT: u16 = 8086;
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct BackendState(Arc<Mutex<Option<Child>>>);

// ═══════════════════════════════════════════════════════════════════════════
// WATCHDOG DE PROCESOS (Windows)
//
// Problema: si el exe muere a lo bruto (taskkill /F, crash, cierre forzado),
// el node hijo sobrevive y se queda en el :8086 — el siguiente arranque
// encuentra el puerto ocupado y sirve el backend VIEJO sin saberlo.
//
// Solución en dos capas:
//   1. JOB OBJECT con JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: el node se asigna
//      a un job cuyo handle vive dentro del exe. Cuando el exe muere —de la
//      manera que sea— el kernel cierra el handle y mata todo el árbol.
//   2. Barrido de arranque: huérfanos de sesiones anteriores (exe sin job,
//      fallo al crear el job…) se detectan por línea de comandos y se matan.
//
// En no-Windows: no-op. El cierre normal ya lo cubre stop_backend.
// ═══════════════════════════════════════════════════════════════════════════
#[cfg(windows)]
mod process_watchdog {
use std::os::windows::process::CommandExt;
    // FFI directa a kernel32 — evita el crate `windows` y sus conflictos de
    // versión con el que arrastra Tauri.
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(lpJobAttributes: *mut core::ffi::c_void, lpName: *const u16) -> isize;
        fn SetInformationJobObject(
            hJob: isize,
            JobObjectInformationClass: u32,
            lpJobObjectInformation: *mut core::ffi::c_void,
            cbJobObjectInformationLength: u32,
        ) -> i32;
        fn AssignProcessToJobObject(hJob: isize, hProcess: isize) -> i32;
    }

    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: u32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;

    #[repr(C)]
    struct IoCounter {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    struct JoBasicLimits {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32, // = SchedulingClass en JOBOBJECT_BASIC_LIMIT_INFORMATION
    }

    #[repr(C)]
    struct JoIoLimits {
        io_counter: IoCounter,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    // JOBOBJECT_EXTENDED_LIMIT_INFORMATION = basic + io + pad a 16 bytes.
    #[repr(C)]
    struct JoExtendedLimits {
        basic: JoBasicLimits,
        io: JoIoLimits,
        _pad_out: (), // (sin padding: el struct real son 144 bytes exactos)
    }

    /// Crea el job "asilo" con KILL_ON_JOB_CLOSE y mete al proceso dentro.
    /// Devuelve el handle crudo (isize); quien lo recibe debe retenerlo
    /// tanto como quiera que el árbol viva: al morir el exe el kernel
    /// cierra el último handle y mata node y cuanto él spawnée.
    pub fn bind_backend_child(child_handle: isize) -> Result<isize, String> {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
            if job == 0 {
                return Err("CreateJobObjectW falló".to_string());
            }
            let mut limits = JoExtendedLimits {
                basic: JoBasicLimits {
                    per_process_user_time_limit: 0,
                    per_job_user_time_limit: 0,
                    limit_flags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                    minimum_working_set_size: 0,
                    maximum_working_set_size: 0,
                    active_process_limit: 0,
                    affinity: 0,
                    priority_class: 0,
                    scheduling_class: 0,
                },
                io: JoIoLimits {
                    io_counter: IoCounter {
                        read_operation_count: 0,
                        write_operation_count: 0,
                        other_operation_count: 0,
                        read_transfer_count: 0,
                        write_transfer_count: 0,
                        other_transfer_count: 0,
                    },
                    process_memory_limit: 0,
                    job_memory_limit: 0,
                    peak_process_memory_used: 0,
                    peak_job_memory_used: 0,
                },
                _pad_out: (),
            };
            let ok = SetInformationJobObject(
                job,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                &mut limits as *mut JoExtendedLimits as *mut core::ffi::c_void,
                std::mem::size_of::<JoExtendedLimits>() as u32,
            );
            if ok == 0 {
                return Err("SetInformationJobObject falló".to_string());
            }
            if AssignProcessToJobObject(job, child_handle) == 0 {
                return Err("AssignProcessToJobObject falló".to_string());
            }
            Ok(job)
        }
    }

    /// ¿Este PID es un node nuestro (backend/index.js)? Consulta la línea de
    /// comandos vía PowerShell CIM — wmic está deprecado y ausente en Win11.
    #[allow(dead_code)] // utilidad de diagnóstico
    fn is_our_backend(pid: u32) -> bool {
        let out = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                    "(Get-CimInstance Win32_Process -Filter 'ProcessId={}').CommandLine",
            ])
            .creation_flags(super::CREATE_NO_WINDOW)
            .output();
        let Ok(out) = out else { return false };
        let s = String::from_utf8_lossy(&out.stdout).to_lowercase();
        s.contains("node") && s.contains("backend") && s.contains("index.js")
    }

    /// Mata los node huérfanos de sesiones anteriores (exe anterior sin job,
    /// backend arrancado a mano…). Lista node.exe por CIM y filtra por línea
    /// de comandos: jamás toca un node que no sea nuestro backend.
    pub fn sweep_orphans() {
        let out = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { \"$($PSItem.ProcessId)|$($PSItem.CommandLine)\" }",
            ])
            .creation_flags(super::CREATE_NO_WINDOW)
            .output();
        let Ok(out) = out else { return };
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            // Formato: "<pid>|<commandline>"
            let Some((pid_str, cmdline)) = line.split_once('|') else { continue };
            let Ok(pid) = pid_str.trim().parse::<u32>() else { continue };
            if std::process::id() == pid { continue; }
            let low = cmdline.to_lowercase();
            if !(low.contains("backend") && low.contains("index.js")) { continue; }
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/F"])
                .creation_flags(super::CREATE_NO_WINDOW)
                .output();
            eprintln!("[knkLinux] node huérfano del arranque anterior (PID {pid}): terminado");
        }
    }
}

#[cfg(not(windows))]
mod process_watchdog {
    /// No-op fuera de Windows.
    pub fn bind_backend_child(_child_handle: isize) -> Result<isize, String> { Ok(0) }
    pub fn sweep_orphans() {}
}


/// Handle del Job Object que envuelve al node, retenido por el exe.
/// El cierre normal (Drop al salir de main) y la muerte bruta del proceso
/// liberan el último handle → el kernel mata el árbol del backend.
static JOB_HANDLE: Mutex<Option<isize>> = Mutex::new(None);

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


/// Log del watchdog a fichero: en un exe GUI el stderr no se ve.
fn wd_log(msg: &str, log_path: &Path) {
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
        use std::io::Write;
        let _ = writeln!(f, "[{ts}] {msg}", ts = chrono_free_now());
    }
}

fn chrono_free_now() -> String {
    let d = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    format!("{}s", d.as_secs())
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
        .and_then(|mut child| {
            // Watchdog: asigna el node a un Job Object "asilo". Si el exe
            // muere de cualquier manera, el kernel mata el árbol completo.
            let raw = {
                use std::os::windows::io::AsRawHandle;
                child.as_raw_handle() as isize
            };
            match process_watchdog::bind_backend_child(raw) {
                Ok(job) => {
                    if let Ok(mut h) = JOB_HANDLE.lock() { *h = Some(job); }

                    eprintln!("[knkLinux] watchdog: node en Job Object (kill-on-exe-death activo)");
                    wd_log(&format!("watchdog: node PID {} asignado a Job Object (kill-on-exe-death activo)", child.id()), &root.join("backend-watchdog.log"));
                }

                Err(e) => {
                    eprintln!("[knkLinux] watchdog no disponible: {e}");
                    wd_log(&format!("watchdog NO disponible: {e} — el node puede quedar huérfano si el exe muere"), &root.join("backend-watchdog.log"));
                }
            }
            Ok(child)
        })
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
            // Watchdog: limpia node huérfanos de sesiones anteriores antes
            // de arrancar el nuestro (evita hablar con un backend VIEJO).
            process_watchdog::sweep_orphans();
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
