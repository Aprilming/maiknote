use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

/// 全局快捷键状态
struct GlobalShortcutState {
    current_shortcut: Mutex<Option<Shortcut>>,
}


/// 注册/更新全局快捷键
#[tauri::command]
async fn register_global_shortcut(
    app: AppHandle,
    shortcut_state: State<'_, GlobalShortcutState>,
    shortcut_str: String,
) -> Result<(), String> {
    // 解析快捷键字符串 (格式: "Option+Cmd+A" 或 "Alt+Cmd+A")
    let parts: Vec<&str> = shortcut_str.split('+').collect();

    let mut modifiers = Modifiers::empty();
    let mut key_code: Option<Code> = None;

    for part in &parts {
        match *part {
            "Ctrl" | "Control" => modifiers |= Modifiers::CONTROL,
            "Option" | "Alt" => modifiers |= Modifiers::ALT,
            "Shift" => modifiers |= Modifiers::SHIFT,
            "Cmd" | "Meta" | "CommandOrControl" => modifiers |= Modifiers::META,
            // 最后一个是按键
            _ => {
                let p = *part;
                key_code = match p {
                    // 字母键
                    "A" => Some(Code::KeyA),
                    "B" => Some(Code::KeyB),
                    "C" => Some(Code::KeyC),
                    "D" => Some(Code::KeyD),
                    "E" => Some(Code::KeyE),
                    "F" => Some(Code::KeyF),
                    "G" => Some(Code::KeyG),
                    "H" => Some(Code::KeyH),
                    "I" => Some(Code::KeyI),
                    "J" => Some(Code::KeyJ),
                    "K" => Some(Code::KeyK),
                    "L" => Some(Code::KeyL),
                    "M" => Some(Code::KeyM),
                    "N" => Some(Code::KeyN),
                    "O" => Some(Code::KeyO),
                    "P" => Some(Code::KeyP),
                    "Q" => Some(Code::KeyQ),
                    "R" => Some(Code::KeyR),
                    "S" => Some(Code::KeyS),
                    "T" => Some(Code::KeyT),
                    "U" => Some(Code::KeyU),
                    "V" => Some(Code::KeyV),
                    "W" => Some(Code::KeyW),
                    "X" => Some(Code::KeyX),
                    "Y" => Some(Code::KeyY),
                    "Z" => Some(Code::KeyZ),
                    // 数字键
                    "0" => Some(Code::Digit0),
                    "1" => Some(Code::Digit1),
                    "2" => Some(Code::Digit2),
                    "3" => Some(Code::Digit3),
                    "4" => Some(Code::Digit4),
                    "5" => Some(Code::Digit5),
                    "6" => Some(Code::Digit6),
                    "7" => Some(Code::Digit7),
                    "8" => Some(Code::Digit8),
                    "9" => Some(Code::Digit9),
                    // 功能键
                    "Space" => Some(Code::Space),
                    "Enter" | "Return" => Some(Code::Enter),
                    "Tab" => Some(Code::Tab),
                    "Escape" | "Esc" => Some(Code::Escape),
                    // 修饰键（作为主要按键时）
                    "MetaLeft" | "MetaRight" | "Meta" => Some(Code::MetaLeft),
                    "ControlLeft" | "ControlRight" | "Ctrl" => Some(Code::ControlLeft),
                    "AltLeft" | "AltRight" | "Alt" | "Option" => Some(Code::AltLeft),
                    "ShiftLeft" | "ShiftRight" | "Shift" => Some(Code::ShiftLeft),
                    _ => None,
                };
            }
        }
    }

    let key_code = key_code.ok_or("Invalid key code")?;
    let shortcut = Shortcut::new(Some(modifiers), key_code);

    // 取消之前的快捷键
    {
        let mut current = shortcut_state.current_shortcut.lock().unwrap();
        if let Some(old) = current.take() {
            let _ = app.global_shortcut().unregister(old);
        }
    }

    // 注册新快捷键
    let app_handle = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                println!("Global shortcut triggered!");
                if let Some(window) = app_handle.get_webview_window("main") {
                    // Toggle 逻辑
                    let is_visible = window.is_visible().unwrap_or(false);
                    if is_visible {
                        let _ = window.hide();
                    } else {
                        let app_clone = app_handle.clone();
                        let _ = app_handle.run_on_main_thread(move || {
                            show_window_current_space_impl(&app_clone);
                        });
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;

    // 保存当前快捷键
    {
        let mut current = shortcut_state.current_shortcut.lock().unwrap();
        *current = Some(shortcut);
    }

    println!("Global shortcut registered: {}", shortcut_str);
    Ok(())
}

/// 切换窗口显示状态
#[tauri::command]
async fn toggle_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let is_visible = window.is_visible().unwrap_or(false);
        if is_visible {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
    Ok(())
}

/// 在当前空间显示窗口（macOS专用）
#[cfg(target_os = "macos")]
fn show_window_current_space_impl(app: &AppHandle) {
    use cocoa::base::id;
    use cocoa::appkit::NSApp;
    use objc2::msg_send;

    if let Some(window) = app.get_webview_window("main") {
        let ns_window = window.ns_window().unwrap() as id;
        let ns_window_ptr = ns_window as *mut objc2::runtime::AnyObject;
        let nil: *mut objc2::runtime::AnyObject = std::ptr::null_mut();
        let ns_app = unsafe { NSApp() } as *mut objc2::runtime::AnyObject;

        unsafe {
            // 切换到 MoveToActiveSpace，显示后出现在当前 space
            let _: () = msg_send![ns_window_ptr, setCollectionBehavior: 2usize];
            // 先设置 alpha 为 0 再隐藏，避免黑色闪烁
            let _: () = msg_send![ns_window_ptr, setAlphaValue: 0.0 as cocoa::appkit::CGFloat];
            let _: () = msg_send![ns_window_ptr, orderOut: nil];
            let _: () = msg_send![ns_app, activateIgnoringOtherApps: true];
            let _: () = msg_send![ns_window_ptr, makeKeyAndOrderFront: nil];
            // 立即设置为完全不透明，避免黑色背景露出
            let _: () = msg_send![ns_window_ptr, setAlphaValue: 1.0 as cocoa::appkit::CGFloat];
            // 恢复成 CanJoinAllSpaces，避免下次还绑在这个 space
            let _: () = msg_send![ns_window_ptr, setCollectionBehavior: 1usize];
        }

        let _ = window.set_focus();
    }
}

#[cfg(not(target_os = "macos"))]
async fn show_window_current_space_impl(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Get the iCloud path for storing notes
#[tauri::command]
async fn get_icloud_path() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let path = format!("{}/Library/Mobile Documents/com~apple~CloudDocs/MaikNote", home);

    // Create directory if it doesn't exist
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;

    Ok(path)
}

/// Read metadata.json file
#[tauri::command]
async fn read_metadata(base_path: String) -> Result<String, String> {
    let path = PathBuf::from(base_path).join("metadata.json");

    if !path.exists() {
        // Return empty metadata if file doesn't exist
        return Ok(r#"{"version":1,"notes":[]}"#.to_string());
    }

    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Write metadata.json file
#[tauri::command]
async fn write_metadata(base_path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(base_path).join("metadata.json");
    fs::write(path, content).map_err(|e| e.to_string())
}

/// Read assistants.json file
#[tauri::command]
async fn read_assistants(base_path: String) -> Result<String, String> {
    let path = PathBuf::from(base_path).join("assistants.json");

    if !path.exists() {
        return Ok(r#"{"version":1,"assistants":[]}"#.to_string());
    }

    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Write assistants.json file
#[tauri::command]
async fn write_assistants(base_path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(base_path).join("assistants.json");
    fs::write(path, content).map_err(|e| e.to_string())
}

/// Read a single note file
#[tauri::command]
async fn read_note(base_path: String, id: String) -> Result<String, String> {
    let path = PathBuf::from(base_path).join(format!("note_{}.md", id));

    if !path.exists() {
        return Ok(String::new());
    }

    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Write a single note file
#[tauri::command]
async fn write_note(base_path: String, id: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(base_path).join(format!("note_{}.md", id));
    fs::write(path, content).map_err(|e| e.to_string())
}

/// Delete a note file
#[tauri::command]
async fn delete_note(base_path: String, id: String) -> Result<(), String> {
    let path = PathBuf::from(base_path).join(format!("note_{}.md", id));

    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Ensure images folder exists and return the path
#[tauri::command]
async fn ensure_images_folder(base_path: String) -> Result<String, String> {
    let path = PathBuf::from(&base_path).join("images");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Save image to the images folder
#[tauri::command]
async fn save_image(base_path: String, image_data: String, filename: String) -> Result<String, String> {
    // Ensure images folder exists
    let images_path = PathBuf::from(&base_path).join("images");
    fs::create_dir_all(&images_path).map_err(|e| e.to_string())?;

    // Decode base64 image data
    let data_parts: Vec<&str> = image_data.split(',').collect();
    let base64_data = if data_parts.len() > 1 {
        data_parts[1]
    } else {
        &image_data
    };

    let image_bytes = base64_decode(base64_data)?;

    // Write the file
    let file_path = images_path.join(&filename);
    fs::write(&file_path, &image_bytes).map_err(|e| e.to_string())?;

    // Return relative path
    Ok(format!("images/{}", filename))
}

/// Simple base64 decoder
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    // Remove whitespace
    let input: String = input.chars().filter(|c| !c.is_whitespace()).collect();

    // Calculate padding
    let padding = if input.ends_with('=') {
        if input.ends_with("==") { 2 } else { 1 }
    } else { 0 };

    let mut output = Vec::new();
    let mut buffer: u32 = 0;
    let mut bits_collected = 0;

    for c in input.chars() {
        if c == '=' { break; }

        let value = ALPHABET.iter().position(|&x| x as char == c)
            .ok_or_else(|| format!("Invalid base64 character: {}", c))? as u32;

        buffer = (buffer << 6) | value;
        bits_collected += 6;

        if bits_collected >= 8 {
            bits_collected -= 8;
            output.push((buffer >> bits_collected) as u8);
            buffer &= (1 << bits_collected) - 1;
        }
    }

    // Remove padding bytes if any
    if padding > 0 && !output.is_empty() {
        output.truncate(output.len() - padding);
    }

    Ok(output)
}

/// Set window alpha transparency (0.0 - 1.0)
#[tauri::command]
async fn set_window_alpha(app: AppHandle, alpha: f64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        // Clamp alpha to valid range
        let clamped_alpha = alpha.max(0.1).min(1.0);

        #[cfg(target_os = "macos")]
        {
            use cocoa::appkit::CGFloat;
            use objc2::msg_send;
            use std::ffi::c_void;

            let ns_window_raw = window.ns_window().map_err(|e| e.to_string())?;
            let ns_window: *mut objc2::runtime::AnyObject = ns_window_raw as *mut c_void as *mut objc2::runtime::AnyObject;
            unsafe {
                let alpha_value: CGFloat = clamped_alpha as CGFloat;
                let _: () = msg_send![ns_window, setAlphaValue: alpha_value];
            }
        }

        #[cfg(not(target_os = "macos"))]
        let _ = (app, clamped_alpha);
    }
    Ok(())
}

/// 检测是否是开机自启启动
fn is_autolaunch_start(args: &[String]) -> bool {
    args.iter().any(|arg| arg == "--flag1")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 预先检测是否是开机自启，以便在 setup 中使用
    let launch_args: Vec<String> = std::env::args().collect();
    let is_autolaunch = is_autolaunch_start(&launch_args);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--flag1"])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(GlobalShortcutState {
            current_shortcut: Mutex::new(None),
        })
        .setup(move |app| {
            // 隐藏 macOS Dock 图标
            #[cfg(target_os = "macos")]
            {
                use cocoa::appkit::{NSApp, NSApplication, NSApplicationActivationPolicy};
                unsafe {
                    let ns_app = NSApp();
                    NSApplication::setActivationPolicy_(ns_app, NSApplicationActivationPolicy::NSApplicationActivationPolicyAccessory);
                }
            }

            // 应用原生磨玻璃效果
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                use cocoa::base::id;
                use objc2::msg_send;

                apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::HudWindow,
                    None,
                    Some(12.0),
                ).expect("vibrancy failed");

                // 初始化时不绑定任何 space
                let ns_window = window.ns_window().unwrap() as id;
                let ns_window_ptr = ns_window as *mut objc2::runtime::AnyObject;
                unsafe {
                    // NSWindowCollectionBehaviorCanJoinAllSpaces = 1
                    // 初始设成这个，让窗口不被绑定到启动时的 space
                    let _: () = msg_send![ns_window_ptr, setCollectionBehavior: 1usize];
                }

                // 如果是开机自启启动，立即隐藏窗口，等待快捷键唤起
                if is_autolaunch {
                    let _ = window.hide();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_icloud_path,
            read_metadata,
            write_metadata,
            read_assistants,
            write_assistants,
            read_note,
            write_note,
            delete_note,
            ensure_images_folder,
            save_image,
            register_global_shortcut,
            toggle_window,
            set_window_alpha
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
