pub mod autostart;

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
use serde::Serialize;

/// 出口 IP 信息（来自远程 API）
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
struct PublicIpInfo {
    country: String,
    province: String,
    city: String,
    ip: String,
    isp: String,
    scene: String,
    company: String,
}

/// 本地网卡信息
#[derive(Debug, Clone, Serialize)]
struct LocalInterface {
    name: String,
    ips: Vec<String>,
}

/// 网络信息汇总
#[derive(Debug, Clone, Serialize)]
struct NetworkInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    public_ip: Option<PublicIpInfo>,
    local_interfaces: Vec<LocalInterface>,
}


#[cfg(target_os = "macos")]
extern "C" {
    fn CGShieldingWindowLevel() -> i32;
    fn CGDisplayRegisterReconfigurationCallback(
        callback: Option<
            unsafe extern "C" fn(u32, u32, *mut std::ffi::c_void),
        >,
        user_info: *mut std::ffi::c_void,
    ) -> i32;
    fn CGGetActiveDisplayList(
        max_displays: u32,
        active_displays: *mut u32,
        display_count: *mut u32,
    ) -> i32;
    fn CGDisplayBounds(display: u32) -> CGRect;
    fn CGRectContainsPoint(rect: CGRect, point: CGPoint) -> bool;
    fn CGEventCreate(allocator: *const std::ffi::c_void) -> *mut std::ffi::c_void;
    fn CGEventGetLocation(event: *mut std::ffi::c_void) -> CGPoint;
    fn CFRelease(cf: *const std::ffi::c_void);
}

/// CoreGraphics 几何结构（macOS 原生坐标，单位 points，原点在主屏左下）
#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct CGSize {
    width: f64,
    height: f64,
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

// 让 CGPoint 可作为 objc2 msg_send! 的参数（用于 NSWindow setFrameOrigin:）
#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for CGPoint {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "CGPoint",
        &[
            <f64 as objc2::encode::Encode>::ENCODING,
            <f64 as objc2::encode::Encode>::ENCODING,
        ],
    );
}

// 让 CGSize / CGRect 可作为 objc2 msg_send! 的返回值（用于读取 NSWindow frame）
#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for CGSize {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "CGSize",
        &[
            <f64 as objc2::encode::Encode>::ENCODING,
            <f64 as objc2::encode::Encode>::ENCODING,
        ],
    );
}

#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for CGRect {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "CGRect",
        &[
            <CGPoint as objc2::encode::Encode>::ENCODING,
            <CGSize as objc2::encode::Encode>::ENCODING,
        ],
    );
}

#[cfg(target_os = "macos")]
static DISPLAY_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

#[cfg(target_os = "macos")]
#[allow(non_upper_case_globals)]
const kCGDisplayBeginConfiguration: u32 = 1 << 0;

#[cfg(target_os = "macos")]
const NS_WINDOW_COLLECTION_BEHAVIOR_FULL_SCREEN_AUXILIARY: usize = 1 << 8;

/// 全局快捷键状态
struct GlobalShortcutState {
    current_shortcut: Mutex<Option<Shortcut>>,
    center_shortcut: Mutex<Option<Shortcut>>,
    pin_shortcut: Mutex<Option<Shortcut>>,
}

/// 用户设置的窗口透明度（失焦时需要补偿）
struct WindowAlphaState {
    alpha: Mutex<f64>,
}

/// 每个「显示器 + Space」的窗口最后位置（[x, y]，Quartz 全局坐标 points，原点在主屏左下）。
/// ready 用于跳过启动阶段 window-state 恢复 / 强制居中产生的 Moved 事件，避免误记或误写盘。
struct WindowPositionState {
    positions: Mutex<HashMap<String, [f64; 2]>>,
    ready: AtomicBool,
}


/// 解析快捷键字符串 (格式: "Option+Cmd+A" 或 "Alt+Cmd+A")，失败返回错误
fn parse_shortcut_str(shortcut_str: &str) -> Result<Shortcut, String> {
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
    Ok(Shortcut::new(Some(modifiers), key_code))
}

/// 注册/更新全局快捷键
#[tauri::command]
async fn register_global_shortcut(
    app: AppHandle,
    shortcut_state: State<'_, GlobalShortcutState>,
    shortcut_str: String,
) -> Result<(), String> {
    if shortcut_str.trim().is_empty() {
        // 快捷键为空：仅取消注册，不再注册新快捷键
        let mut current = shortcut_state.current_shortcut.lock().unwrap();
        if let Some(old) = current.take() {
            let _ = app.global_shortcut().unregister(old);
        }
        return Ok(());
    }

    let shortcut = parse_shortcut_str(&shortcut_str)?;

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
                    let app_clone = app_handle.clone();
                    let _ = app_handle.run_on_main_thread(move || {
                        if let Some(window) = app_clone.get_webview_window("main") {
                            #[cfg(target_os = "macos")]
                            {
                                use objc2::msg_send;
                                use objc2::runtime::AnyObject;
                                use cocoa::base::id;

                                let ns_window = window.ns_window().unwrap() as id;
                                let ns_window_ptr = ns_window as *mut AnyObject;
                                let is_on_space: bool = unsafe { msg_send![ns_window_ptr, isOnActiveSpace] };
                                let is_visible: bool = unsafe { msg_send![ns_window_ptr, isVisible] };
                                if is_on_space && is_visible {
                                    let _ = window.hide();
                                    return;
                                }
                                show_window_current_space_impl(&app_clone);
                            }
                            #[cfg(not(target_os = "macos"))]
                            show_window_current_space_impl(&app_clone);
                        }
                    });
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

/// 注册全局居中快捷键
#[tauri::command]
async fn register_center_shortcut(
    app: AppHandle,
    shortcut_state: State<'_, GlobalShortcutState>,
    shortcut_str: String,
) -> Result<(), String> {
    if shortcut_str.is_empty() {
        // 取消注册
        let mut current = shortcut_state.center_shortcut.lock().unwrap();
        if let Some(old) = current.take() {
            let _ = app.global_shortcut().unregister(old);
        }
        return Ok(());
    }

    let shortcut = parse_shortcut_str(&shortcut_str)?;

    // 取消之前的居中快捷键
    {
        let mut current = shortcut_state.center_shortcut.lock().unwrap();
        if let Some(old) = current.take() {
            let _ = app.global_shortcut().unregister(old);
        }
    }

    // 注册新居中快捷键
    let app_handle = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let app_clone = app_handle.clone();
                let _ = app_handle.run_on_main_thread(move || {
                    if let Some(window) = app_clone.get_webview_window("main") {
                        #[cfg(target_os = "macos")]
                        {
                            use objc2::msg_send;
                            use objc2::runtime::AnyObject;
                            use cocoa::base::id;

                            let ns_window = window.ns_window().unwrap() as id;
                            let ns_window_ptr = ns_window as *mut AnyObject;
                            let is_on_space: bool = unsafe { msg_send![ns_window_ptr, isOnActiveSpace] };
                            let is_visible: bool = unsafe { msg_send![ns_window_ptr, isVisible] };
                            if is_on_space && is_visible {
                                let _ = window.center();
                                return;
                            }
                            show_window_current_space_impl(&app_clone);
                        }
                        #[cfg(not(target_os = "macos"))]
                        {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = window.center();
                    }
                });
            }
        })
        .map_err(|e| e.to_string())?;

    {
        let mut current = shortcut_state.center_shortcut.lock().unwrap();
        *current = Some(shortcut);
    }

    println!("Center shortcut registered: {}", shortcut_str);
    Ok(())
}

/// 注册全局置顶快捷键（无系统焦点时也可切换窗口置顶）
#[tauri::command]
async fn register_pin_shortcut(
    app: AppHandle,
    shortcut_state: State<'_, GlobalShortcutState>,
    shortcut_str: String,
) -> Result<(), String> {
    if shortcut_str.is_empty() {
        // 取消注册
        let mut current = shortcut_state.pin_shortcut.lock().unwrap();
        if let Some(old) = current.take() {
            let _ = app.global_shortcut().unregister(old);
        }
        return Ok(());
    }

    let shortcut = parse_shortcut_str(&shortcut_str)?;

    // 取消之前的置顶快捷键
    {
        let mut current = shortcut_state.pin_shortcut.lock().unwrap();
        if let Some(old) = current.take() {
            let _ = app.global_shortcut().unregister(old);
        }
    }

    // 注册新置顶快捷键
    let app_handle = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let app_clone = app_handle.clone();
                let _ = app_handle.run_on_main_thread(move || {
                    if let Some(window) = app_clone.get_webview_window("main") {
                        match window.is_always_on_top() {
                            Ok(current) => {
                                let new_value = !current;
                                if window.set_always_on_top(new_value).is_ok() {
                                    // 打开置顶时窗口可能已被「失焦自动隐藏」藏起来，
                                    // 这里一并显示并聚焦，否则只改原生置顶状态，用户看不到反应
                                    if new_value {
                                        let _ = window.show();
                                        let _ = window.unminimize();
                                        let _ = window.set_focus();
                                    }
                                    let _ = app_clone.emit("on-always-on-top-changed", new_value);
                                }
                            }
                            Err(e) => println!("Failed to read always on top: {}", e),
                        }
                    }
                });
            }
        })
        .map_err(|e| e.to_string())?;

    {
        let mut current = shortcut_state.pin_shortcut.lock().unwrap();
        *current = Some(shortcut);
    }

    println!("Pin shortcut registered: {}", shortcut_str);
    Ok(())
}

/// 退出应用
#[tauri::command]
async fn exit_app(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

/// 居中窗口
#[tauri::command]
async fn center_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.center().map_err(|e| e.to_string())?;
    }
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
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    if let Some(window) = app.get_webview_window("main") {
        let ns_window = window.ns_window().unwrap() as id;
        let ns_window_ptr = ns_window as *mut AnyObject;

        // 多显示器时：优先恢复到鼠标所在显示器当前 Space 的上一次位置，没有则居中
        let cursor_display = cursor_display_info();
        if let Some((display_id, bounds)) = cursor_display {
            restore_window_position(app, &window, ns_window_ptr, display_id, bounds);
        }

        let alpha_state = app.state::<WindowAlphaState>();
        let saved_alpha = *alpha_state.alpha.lock().unwrap();
        let restore_alpha = saved_alpha.max(0.1).min(1.0) as f64;

        unsafe {
            let level = CGShieldingWindowLevel();
            let _: () = msg_send![ns_window_ptr, setLevel: level as i64];
            let _: () = msg_send![ns_window_ptr, setCollectionBehavior: NS_WINDOW_COLLECTION_BEHAVIOR_FULL_SCREEN_AUXILIARY];
            let _: () = msg_send![ns_window_ptr, orderFrontRegardless];
            let _: () = msg_send![ns_window_ptr, setAlphaValue: restore_alpha];
        }

        // 延迟 100ms 等待 Window Server 完全处理窗口，然后用 CGS 加入鼠标所在显示器的 Space
        let app_handle = app.clone();
        let ns_window_ptr_addr = ns_window_ptr as usize;
        let cursor_display_id = cursor_display.map(|(id, _)| id);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(100));
            let _ = app_handle.run_on_main_thread(move || {
                use objc2::msg_send;
                use objc2::runtime::AnyObject;
                use cocoa::base::nil;
                use cocoa::appkit::NSApp;
                use std::ffi::CString;
                let ptr = ns_window_ptr_addr as *mut AnyObject;
                let nil_ptr = nil as *mut AnyObject;
                let ns_app = unsafe { NSApp() } as *mut AnyObject;
                unsafe {
                    // 激活并聚焦窗口
                    let _: () = msg_send![ns_app, activateIgnoringOtherApps: true];
                    let _: () = msg_send![ptr, makeKeyAndOrderFront: nil_ptr];

                    // 窗口已完全就绪，用 CGS 加入当前 Space
                    let lib_name = CString::new("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight").unwrap();
                    let handle = libc::dlopen(lib_name.as_ptr(), libc::RTLD_LAZY);
                    if !handle.is_null() {
                        let sym0 = CString::new("CGSMainConnectionID").unwrap();
                        let sym1 = CString::new("CGSGetActiveSpace").unwrap();
                        let sym2 = CString::new("CGSAddWindowsToSpaces").unwrap();
                        let sym3 = CString::new("CGSGetDisplayActiveSpace").unwrap();
                        let ptr0 = libc::dlsym(handle, sym0.as_ptr());
                        let ptr1 = libc::dlsym(handle, sym1.as_ptr());
                        let ptr2 = libc::dlsym(handle, sym2.as_ptr());
                        let ptr3 = libc::dlsym(handle, sym3.as_ptr());
                        if !ptr0.is_null() && !ptr1.is_null() && !ptr2.is_null() {
                            type Fn0 = extern "C" fn() -> u32;
                            type Fn1 = extern "C" fn(u32) -> u64;
                            type Fn2 = extern "C" fn(u32, *const libc::c_void, *const libc::c_void);
                            let cgs_main_conn: Fn0 = std::mem::transmute(ptr0);
                            let cgs_get_space: Fn1 = std::mem::transmute(ptr1);
                            let cgs_add_windows: Fn2 = std::mem::transmute(ptr2);

                            let window_id: u32 = msg_send![ptr, windowNumber];
                            let cid = cgs_main_conn();
                            // 优先取鼠标所在显示器的 active Space；CGSGetActiveSpace 多显示器下指向主屏，窗口不会跟随鼠标
                            let active_space = match cursor_display_id {
                                Some(display_id) if !ptr3.is_null() => {
                                    type Fn3 = extern "C" fn(u32, u32) -> u64;
                                    let cgs_get_display_space: Fn3 = std::mem::transmute(ptr3);
                                    cgs_get_display_space(cid, display_id)
                                }
                                _ => cgs_get_space(cid),
                            };

                            let cf_lib = CString::new("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation").unwrap();
                            let cf_handle = libc::dlopen(cf_lib.as_ptr(), libc::RTLD_LAZY);
                            type CFNumberCreate = extern "C" fn(*const libc::c_void, i64, *const libc::c_void) -> *const libc::c_void;
                            type CFArrayCreate = extern "C" fn(*const libc::c_void, *const *const libc::c_void, i64, *const libc::c_void) -> *const libc::c_void;
                            type CFRelease = extern "C" fn(*const libc::c_void);
                            let cf_number_create: CFNumberCreate = std::mem::transmute(libc::dlsym(cf_handle, CString::new("CFNumberCreate").unwrap().as_ptr()));
                            let cf_array_create: CFArrayCreate = std::mem::transmute(libc::dlsym(cf_handle, CString::new("CFArrayCreate").unwrap().as_ptr()));
                            let cf_release: CFRelease = std::mem::transmute(libc::dlsym(cf_handle, CString::new("CFRelease").unwrap().as_ptr()));

                            let wid_64 = window_id as i64;
                            let space_64 = active_space as i64;
                            let wid_num = cf_number_create(std::ptr::null(), 4, &wid_64 as *const i64 as *const libc::c_void);
                            let space_num = cf_number_create(std::ptr::null(), 4, &space_64 as *const i64 as *const libc::c_void);
                            let win_arr = cf_array_create(std::ptr::null(), &wid_num, 1, std::ptr::null());
                            let space_arr = cf_array_create(std::ptr::null(), &space_num, 1, std::ptr::null());
                            cgs_add_windows(cid, win_arr, space_arr);
                            cf_release(win_arr);
                            cf_release(space_arr);
                            cf_release(wid_num);
                            cf_release(space_num);
                            libc::dlclose(cf_handle);
                        }
                        libc::dlclose(handle);
                    }
                }
            });
        });
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

/// Read directories.json file
#[tauri::command]
async fn read_directories(base_path: String) -> Result<String, String> {
    let path = PathBuf::from(base_path).join("directories.json");

    if !path.exists() {
        return Ok(r#"{"version":1,"directories":[]}"#.to_string());
    }

    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Write directories.json file
#[tauri::command]
async fn write_directories(base_path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(base_path).join("directories.json");
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

/// Build note file path, optionally inside a directory
fn note_path(base_path: &str, id: &str, dir: Option<&str>) -> PathBuf {
    let mut path = PathBuf::from(base_path);
    if let Some(d) = dir {
        path = path.join(d);
    }
    path.join(format!("note_{}.md", id))
}

/// Read a single note file
#[tauri::command]
async fn read_note(base_path: String, id: String, dir: Option<String>) -> Result<String, String> {
    let path = if let Some(ref d) = dir {
        note_path(&base_path, &id, Some(d))
    } else {
        note_path(&base_path, &id, None)
    };

    if !path.exists() {
        return Ok(String::new());
    }

    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Write a single note file (optionally inside a directory)
#[tauri::command]
async fn write_note(base_path: String, id: String, content: String, dir: Option<String>) -> Result<(), String> {
    let path = if let Some(ref d) = dir {
        // Ensure the directory exists
        let dir_path = PathBuf::from(&base_path).join(d);
        fs::create_dir_all(&dir_path).map_err(|e| e.to_string())?;
        note_path(&base_path, &id, Some(d))
    } else {
        note_path(&base_path, &id, None)
    };
    fs::write(path, content).map_err(|e| e.to_string())
}

/// Delete a note file (optionally from a directory)
#[tauri::command]
async fn delete_note(base_path: String, id: String, dir: Option<String>) -> Result<(), String> {
    let path = if let Some(ref d) = dir {
        note_path(&base_path, &id, Some(d))
    } else {
        note_path(&base_path, &id, None)
    };

    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Create a directory folder for note organization
#[tauri::command]
async fn create_directory_folder(base_path: String, dir_id: String) -> Result<(), String> {
    let path = PathBuf::from(base_path).join(&dir_id);
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Rename a directory folder
#[tauri::command]
async fn rename_directory_folder(base_path: String, old_dir_id: String, new_dir_id: String) -> Result<(), String> {
    let root = PathBuf::from(&base_path);
    let old_path = root.join(&old_dir_id);
    let new_path = root.join(&new_dir_id);
    if old_path.exists() {
        fs::rename(&old_path, &new_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Delete a directory folder and move its note files to root
#[tauri::command]
async fn delete_directory_folder(base_path: String, dir_id: String) -> Result<(), String> {
    let root = PathBuf::from(&base_path);
    let dir_path = root.join(&dir_id);
    if !dir_path.exists() {
        return Ok(());
    }

    // Move all .md files from the directory to root
    if let Ok(entries) = fs::read_dir(&dir_path) {
        for entry in entries.flatten() {
            let file_path = entry.path();
            if file_path.extension().map(|e| e == "md").unwrap_or(false) {
                let file_name = file_path.file_name().unwrap().to_os_string();
                let dest = root.join(&file_name);
                let _ = fs::rename(&file_path, &dest);
            }
        }
    }

    // Remove the directory (should be empty now)
    fs::remove_dir_all(&dir_path).map_err(|e| e.to_string())
}

/// Move a note file between directories (dir can be None for root)
#[tauri::command]
async fn move_note_file(base_path: String, id: String, from_dir: Option<String>, to_dir: Option<String>) -> Result<(), String> {
    let src = note_path(&base_path, &id, from_dir.as_deref());
    let dest = if let Some(ref d) = to_dir {
        let dir_path = PathBuf::from(&base_path).join(d);
        fs::create_dir_all(&dir_path).map_err(|e| e.to_string())?;
        note_path(&base_path, &id, Some(d))
    } else {
        note_path(&base_path, &id, None)
    };

    if src.exists() {
        fs::rename(&src, &dest).map_err(|e| e.to_string())?;
    } else if src != dest {
        // Source doesn't exist, write empty at destination
        fs::write(&dest, "").map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Set note file to read-only (444 permission)
#[tauri::command]
async fn set_note_readonly(base_path: String, id: String) -> Result<(), String> {
    let path = PathBuf::from(base_path).join(format!("note_{}.md", id));

    if path.exists() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&path).map_err(|e| e.to_string())?.permissions();
            perms.set_mode(0o444);
            fs::set_permissions(&path, perms).map_err(|e| e.to_string())?;
        }
        #[cfg(not(unix))]
        {
            let _ = (path, id);
        }
    }

    Ok(())
}

/// Set note file to read-write (644 permission)
#[tauri::command]
async fn set_note_readwrite(base_path: String, id: String) -> Result<(), String> {
    let path = PathBuf::from(base_path).join(format!("note_{}.md", id));

    if path.exists() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&path).map_err(|e| e.to_string())?.permissions();
            perms.set_mode(0o644);
            fs::set_permissions(&path, perms).map_err(|e| e.to_string())?;
        }
        #[cfg(not(unix))]
        {
            let _ = (path, id);
        }
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
async fn set_window_alpha(
    app: AppHandle,
    alpha_state: State<'_, WindowAlphaState>,
    alpha: f64,
) -> Result<(), String> {
    // 保存用户设置的 alpha 值
    {
        let mut saved = alpha_state.alpha.lock().unwrap();
        *saved = alpha;
    }

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

/// 判断窗口矩形是否与某显示器相交
#[cfg(target_os = "macos")]
fn window_intersects_monitor(
    pos: &tauri::PhysicalPosition<i32>,
    size: &tauri::PhysicalSize<u32>,
    monitor: &tauri::Monitor,
) -> bool {
    let mpos = *monitor.position();
    let msize = *monitor.size();
    let window_right = pos.x as i64 + size.width as i64;
    let window_bottom = pos.y as i64 + size.height as i64;
    let m_right = mpos.x as i64 + msize.width as i64;
    let m_bottom = mpos.y as i64 + msize.height as i64;
    (window_right > mpos.x as i64)
        && ((pos.x as i64) < m_right)
        && (window_bottom > mpos.y as i64)
        && ((pos.y as i64) < m_bottom)
}

/// 获取某个点所在的显示器 CGDirectDisplayID 及其屏幕区域（Quartz 全局坐标，points）
#[cfg(target_os = "macos")]
fn display_info_at_point(point: CGPoint) -> Option<(u32, CGRect)> {
    let mut count: u32 = 0;
    if unsafe { CGGetActiveDisplayList(0, std::ptr::null_mut(), &mut count) } != 0 || count == 0 {
        return None;
    }
    let mut ids = vec![0u32; count as usize];
    if unsafe { CGGetActiveDisplayList(count, ids.as_mut_ptr(), &mut count) } != 0 {
        return None;
    }
    ids.iter().copied().find_map(|id| {
        let bounds = unsafe { CGDisplayBounds(id) };
        if unsafe { CGRectContainsPoint(bounds, point) } {
            Some((id, bounds))
        } else {
            None
        }
    })
}

/// 获取与窗口矩形相交的显示器 CGDirectDisplayID 及其屏幕区域（Quartz 全局坐标，points）
#[cfg(target_os = "macos")]
fn display_intersecting_rect(origin: CGPoint, size: CGSize) -> Option<(u32, CGRect)> {
    let mut count: u32 = 0;
    if unsafe { CGGetActiveDisplayList(0, std::ptr::null_mut(), &mut count) } != 0 || count == 0 {
        return None;
    }
    let mut ids = vec![0u32; count as usize];
    if unsafe { CGGetActiveDisplayList(count, ids.as_mut_ptr(), &mut count) } != 0 {
        return None;
    }
    ids.iter().copied().find_map(|id| {
        let bounds = unsafe { CGDisplayBounds(id) };
        if rect_visible_in_bounds(origin, size, bounds) {
            Some((id, bounds))
        } else {
            None
        }
    })
}

/// 获取鼠标当前所在显示器的 CGDirectDisplayID 及其屏幕区域（Quartz 全局坐标，points）
#[cfg(target_os = "macos")]
fn cursor_display_info() -> Option<(u32, CGRect)> {
    // CGEventGetLocation 返回 Quartz 全局坐标，与 CGDisplayBounds 同一坐标系
    let point = unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            return None;
        }
        let loc = CGEventGetLocation(event);
        CFRelease(event as *const std::ffi::c_void);
        loc
    };

    display_info_at_point(point)
}

/// 读取窗口在 points 下的尺寸（外层尺寸 / scale）
#[cfg(target_os = "macos")]
fn window_size_points(window: &tauri::WebviewWindow) -> Option<CGSize> {
    let size = window.outer_size().ok()?;
    let scale = window.scale_factor().ok()?;
    Some(CGSize {
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    })
}

/// 读取 NSWindow 的 frame（Quartz 全局坐标 points，原点在屏幕左下）
#[cfg(target_os = "macos")]
fn ns_window_frame(ns_window_ptr: *mut objc2::runtime::AnyObject) -> Option<(CGPoint, CGSize)> {
    use objc2::msg_send;
    let frame: CGRect = unsafe { msg_send![ns_window_ptr, frame] };
    Some((frame.origin, frame.size))
}

/// 将窗口移动到指定原点（Quartz 全局坐标 points）
#[cfg(target_os = "macos")]
fn move_window_to_origin(ns_window_ptr: *mut objc2::runtime::AnyObject, origin: CGPoint) {
    use objc2::msg_send;
    unsafe {
        let _: () = msg_send![ns_window_ptr, setFrameOrigin: origin];
    }
}

/// 将窗口移动到指定屏幕区域的中心（原生坐标，避免 Tauri 坐标转换误差）
#[cfg(target_os = "macos")]
fn move_window_to_center(
    window: &tauri::WebviewWindow,
    ns_window_ptr: *mut objc2::runtime::AnyObject,
    bounds: CGRect,
) {
    let Some(size) = window_size_points(window) else { return };
    let origin = CGPoint {
        x: bounds.origin.x + (bounds.size.width - size.width) / 2.0,
        y: bounds.origin.y + (bounds.size.height - size.height) / 2.0,
    };
    move_window_to_origin(ns_window_ptr, origin);
}

/// 判断窗口矩形（points）是否与显示器区域相交
#[cfg(target_os = "macos")]
fn rect_visible_in_bounds(origin: CGPoint, size: CGSize, bounds: CGRect) -> bool {
    let right = origin.x + size.width;
    let top = origin.y + size.height;
    right > bounds.origin.x
        && origin.x < bounds.origin.x + bounds.size.width
        && top > bounds.origin.y
        && origin.y < bounds.origin.y + bounds.size.height
}

/// 从 SkyLight 私有框架动态取一个符号
#[cfg(target_os = "macos")]
fn skylight_dlsym(name: &str) -> *mut std::ffi::c_void {
    use std::ffi::CString;
    let lib = CString::new("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight").unwrap();
    let handle = unsafe { libc::dlopen(lib.as_ptr(), libc::RTLD_LAZY) };
    if handle.is_null() {
        return std::ptr::null_mut();
    }
    let sym = CString::new(name).unwrap();
    unsafe { libc::dlsym(handle, sym.as_ptr()) }
}

/// 获取 SkyLight 主连接 ID
#[cfg(target_os = "macos")]
fn cgs_main_connection_id() -> Option<u32> {
    static FN: OnceLock<Option<extern "C" fn() -> u32>> = OnceLock::new();
    let f = FN.get_or_init(|| {
        let ptr = skylight_dlsym("CGSMainConnectionID");
        if ptr.is_null() {
            None
        } else {
            Some(unsafe { std::mem::transmute(ptr) })
        }
    });
    (*f).map(|f| f())
}

/// 获取指定显示器当前活动 Space 的 ID
#[cfg(target_os = "macos")]
fn cgs_active_space_for_display(display_id: u32) -> Option<u64> {
    let cid = cgs_main_connection_id()?;

    // 优先取指定显示器的 active Space；部分系统无该符号，回退到 CGSGetActiveSpace
    static DISPLAY_FN: OnceLock<Option<unsafe extern "C" fn(u32, u32) -> u64>> = OnceLock::new();
    let display_fn = *DISPLAY_FN.get_or_init(|| {
        let ptr = skylight_dlsym("CGSGetDisplayActiveSpace");
        if ptr.is_null() {
            None
        } else {
            Some(unsafe { std::mem::transmute(ptr) })
        }
    });
    if let Some(f) = display_fn {
        return Some(unsafe { f(cid, display_id) });
    }

    // 回退：取当前 active Space（老系统 / 无显示器维度 API 时）
    static ACTIVE_FN: OnceLock<Option<extern "C" fn(u32) -> u64>> = OnceLock::new();
    let active_fn = *ACTIVE_FN.get_or_init(|| {
        let ptr = skylight_dlsym("CGSGetActiveSpace");
        if ptr.is_null() {
            None
        } else {
            Some(unsafe { std::mem::transmute(ptr) })
        }
    });
    active_fn.map(|f| f(cid))
}

/// 唤起时恢复窗口位置：有该 Space 的上次位置则恢复，否则居中
#[cfg(target_os = "macos")]
fn restore_window_position(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    ns_window_ptr: *mut objc2::runtime::AnyObject,
    display_id: u32,
    bounds: CGRect,
) {
    let saved = cgs_active_space_for_display(display_id).and_then(|space_id| {
        let key = format!("{}:{}", display_id, space_id);
        app.state::<WindowPositionState>()
            .positions
            .lock()
            .unwrap()
            .get(&key)
            .copied()
    });

    if let Some([x, y]) = saved {
        let origin = CGPoint { x, y };
        if let Some(size) = window_size_points(window) {
            if rect_visible_in_bounds(origin, size, bounds) {
                move_window_to_origin(ns_window_ptr, origin);
                return;
            }
        }
    }
    move_window_to_center(window, ns_window_ptr, bounds);
}

/// 记录窗口当前所在「显示器 + Space」的位置（Moved / Resized 时调用）
#[cfg(target_os = "macos")]
fn remember_window_position<R: tauri::Runtime>(window: &tauri::Window<R>) {
    if !window
        .state::<WindowPositionState>()
        .ready
        .load(Ordering::Relaxed)
    {
        return;
    }
    let Ok(ns_window) = window.ns_window() else { return };
    let ns_window_ptr = ns_window as *mut objc2::runtime::AnyObject;
    let Some((origin, size)) = ns_window_frame(ns_window_ptr) else { return };
    if size.width <= 0.0 || size.height <= 0.0 {
        return;
    }
    let Some((display_id, _)) = display_intersecting_rect(origin, size) else { return };
    let Some(space_id) = cgs_active_space_for_display(display_id) else { return };
    window
        .state::<WindowPositionState>()
        .positions
        .lock()
        .unwrap()
        .insert(
            format!("{}:{}", display_id, space_id),
            [origin.x, origin.y],
        );
}

/// 持久化位置表到磁盘（失焦 / 关闭时调用）
#[cfg(target_os = "macos")]
fn persist_window_positions<R: tauri::Runtime>(window: &tauri::Window<R>) {
    if !window
        .state::<WindowPositionState>()
        .ready
        .load(Ordering::Relaxed)
    {
        return;
    }
    let Ok(dir) = window.app_handle().path().app_config_dir() else { return };
    let positions = window
        .state::<WindowPositionState>()
        .positions
        .lock()
        .unwrap()
        .clone();
    if let Ok(json) = serde_json::to_string_pretty(&positions) {
        let _ = fs::write(dir.join("window_positions.json"), json);
    }
}

/// 从磁盘加载位置表
#[cfg(target_os = "macos")]
fn load_window_positions(path: &std::path::Path) -> HashMap<String, [f64; 2]> {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<HashMap<String, [f64; 2]>>(&s).ok())
        .unwrap_or_default()
}

/// 检查窗口是否在可见显示区域内，若不在则居中到主屏幕
#[cfg(target_os = "macos")]
fn ensure_window_visible(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    let Ok(pos) = window.outer_position() else { return };
    let Ok(size) = window.outer_size() else { return };
    let Ok(monitors) = window.available_monitors() else { return };
    if monitors.is_empty() {
        return;
    }

    // 检查窗口是否与任一显示器的可见区域相交
    let is_on_screen = monitors
        .iter()
        .any(|m| window_intersects_monitor(&pos, &size, m));

    if !is_on_screen {
        // 窗口不在任何可见显示器内，居中到第一个显示器
        if let Some(primary) = monitors.first() {
            let mpos = primary.position();
            let msize = primary.size();
            let x = mpos.x + (msize.width as i32 - size.width as i32) / 2;
            let y = mpos.y + (msize.height as i32 - size.height as i32) / 2;
            let _ = window.set_position(tauri::Position::Physical(
                tauri::PhysicalPosition {
                    x: x.max(mpos.x),
                    y: y.max(mpos.y),
                },
            ));
        }
    }
}

/// 显示器配置变化回调（拔插显示器、分辨率变化等）
#[cfg(target_os = "macos")]
unsafe extern "C" fn display_reconfiguration_callback(
    _display: u32,
    flags: u32,
    _user_info: *mut std::ffi::c_void,
) {
    // 跳过配置开始阶段，只在配置完成后处理
    if (flags & kCGDisplayBeginConfiguration) != 0 {
        return;
    }

    if let Some(handle) = DISPLAY_APP_HANDLE.get() {
        let handle_for_spawn = handle.clone();
        std::thread::spawn(move || {
            // 等待显示器配置稳定
            std::thread::sleep(std::time::Duration::from_millis(500));
            let handle_for_main = handle_for_spawn.clone();
            let _ = handle_for_spawn.run_on_main_thread(move || {
                ensure_window_visible(&handle_for_main);
            });
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// 获取网络信息（出口IP + 本地网卡）
#[tauri::command]
async fn get_network_info() -> Result<NetworkInfo, String> {
    let public_ip = fetch_public_ip().await.ok();
    let local_interfaces = list_local_interfaces().unwrap_or_default();
    Ok(NetworkInfo {
        public_ip,
        local_interfaces,
    })
}

/// 请求远程 API 获取出口 IP 信息
async fn fetch_public_ip() -> Result<PublicIpInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get("https://ip.911505.xyz/ip/location")
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;

    let info = resp
        .json::<PublicIpInfo>()
        .await
        .map_err(|e| format!("解析响应失败: {e}"))?;

    Ok(info)
}

/// 枚举本地所有网卡，收集 IPv4 和 IPv6 地址
fn list_local_interfaces() -> Result<Vec<LocalInterface>, String> {
    let mut interfaces: Vec<LocalInterface> = Vec::new();

    for iface in if_addrs::get_if_addrs().map_err(|e| e.to_string())? {
        // 跳过 loopback 接口
        if iface.is_loopback() {
            continue;
        }

        let ip = iface.ip().to_string();

        if let Some(existing) = interfaces.iter_mut().find(|i| i.name == iface.name) {
            existing.ips.push(ip);
        } else {
            interfaces.push(LocalInterface {
                name: iface.name.clone(),
                ips: vec![ip],
            });
        }
    }

    Ok(interfaces)
}

pub fn run() {
    // 检测是否是开机自启启动
    let is_autolaunch = autostart::is_autolaunch();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(GlobalShortcutState {
            current_shortcut: Mutex::new(None),
            center_shortcut: Mutex::new(None),
            pin_shortcut: Mutex::new(None),
        })
        .manage(WindowAlphaState {
            alpha: Mutex::new(1.0),
        })
        .manage(WindowPositionState {
            positions: Mutex::new(HashMap::new()),
            ready: AtomicBool::new(false),
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            {
                match event {
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                        remember_window_position(window);
                    }
                    tauri::WindowEvent::Focused(false) => {
                        persist_window_positions(window);
                    }
                    _ => {}
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
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
                    Some(NSVisualEffectState::Active),
                    Some(12.0),
                ).expect("vibrancy failed");

                // 窗口可作为全屏 Space 的辅助窗口，具体显示在哪个 Space 由唤起时的 CGSAddWindowsToSpaces 决定
                let ns_window = window.ns_window().unwrap() as id;
                let ns_window_ptr = ns_window as *mut objc2::runtime::AnyObject;
                unsafe {
                    let level = CGShieldingWindowLevel();
                    let _: () = msg_send![ns_window_ptr, setLevel: level as i64];
                    let _: () = msg_send![ns_window_ptr, setCollectionBehavior: NS_WINDOW_COLLECTION_BEHAVIOR_FULL_SCREEN_AUXILIARY];
                }

                // 如果是开机自启启动，立即隐藏窗口，等待快捷键唤起
                if is_autolaunch {
                    let _ = window.hide();
                }
            }

            // 注册显示器变化回调，拔插显示器/分辨率变化时自适应窗口位置
            #[cfg(target_os = "macos")]
            {
                DISPLAY_APP_HANDLE.set(app.handle().clone()).ok();
                unsafe {
                    CGDisplayRegisterReconfigurationCallback(
                        Some(display_reconfiguration_callback),
                        std::ptr::null_mut(),
                    );
                }
                // 启动时也检查一次（window-state 可能恢复了一个屏幕外的位置）
                ensure_window_visible(app.handle());
                // 冷启动强制居中（window-state 恢复的位置并非居中，需覆盖）
                if let Some(w) = app.get_webview_window("main") {
                    w.center().ok();
                }

                // 加载各「显示器 + Space」的历史位置
                if let Ok(dir) = app.path().app_config_dir() {
                    let positions = load_window_positions(&dir.join("window_positions.json"));
                    *app.state::<WindowPositionState>().positions.lock().unwrap() = positions;
                }

                // 启动阶段的强制居中 / window-state 恢复会触发 Moved，延迟启用位置记录
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1000));
                    let inner = handle.clone();
                    let _ = handle.run_on_main_thread(move || {
                        inner
                            .state::<WindowPositionState>()
                            .ready
                            .store(true, Ordering::Relaxed);
                    });
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_icloud_path,
            read_metadata,
            write_metadata,
            read_directories,
            write_directories,
            read_assistants,
            write_assistants,
            read_note,
            write_note,
            delete_note,
            create_directory_folder,
            rename_directory_folder,
            delete_directory_folder,
            move_note_file,
            set_note_readonly,
            set_note_readwrite,
            ensure_images_folder,
            save_image,
            register_global_shortcut,
            register_center_shortcut,
            register_pin_shortcut,
            center_window,
            toggle_window,
            exit_app,
            set_window_alpha,
            autostart::enable_autostart,
            autostart::disable_autostart,
            autostart::is_autostart_enabled,
            get_network_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
