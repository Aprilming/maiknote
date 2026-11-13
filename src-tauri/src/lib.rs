// rebuild trigger 1794532729
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
use serde::{Deserialize, Serialize};

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

#[cfg(target_os = "macos")]
const NS_WINDOW_COLLECTION_BEHAVIOR_CAN_JOIN_ALL_SPACES: usize = 1 << 0;

#[cfg(target_os = "macos")]
const NS_WINDOW_COLLECTION_BEHAVIOR_STATIONARY: usize = 1 << 4;

#[cfg(target_os = "macos")]
const NS_WINDOW_COLLECTION_BEHAVIOR_IGNORES_CYCLE: usize = 1 << 6;

/// 全局快捷键状态
struct GlobalShortcutState {
    current_shortcut: Mutex<Option<Shortcut>>,
    center_shortcut: Mutex<Option<Shortcut>>,
    pin_shortcut: Mutex<Option<Shortcut>>,
    edge_shortcut: Mutex<Option<Shortcut>>,
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

/// 文件名清洗：去掉路径分隔符与非法字符，截断长度，空则回落「未命名」
fn sanitize_file_name(name: &str) -> String {
    let mut cleaned = String::new();
    for ch in name.chars() {
        let bad = matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || ch.is_control();
        cleaned.push(if bad { '-' } else { ch });
    }
    let trimmed = cleaned.trim().trim_matches('.').trim();
    let mut limited: String = trimmed.chars().take(60).collect();
    limited = limited.trim().to_string();
    if limited.is_empty() {
        "未命名".to_string()
    } else {
        limited
    }
}

/// 生成最终的文件名：清洗 + 补齐 .md 后缀
fn resolve_file_name(file_name: &str) -> String {
    let stem = file_name.strip_suffix(".md").unwrap_or(file_name);
    let safe = sanitize_file_name(stem);
    format!("{}.md", safe)
}

/// Build note file path: base/<目录相对路径>/<文件名>
fn note_path(base_path: &str, dir: Option<&str>, file_name: &str) -> PathBuf {
    let mut path = PathBuf::from(base_path);
    if let Some(d) = dir {
        if !d.trim().is_empty() {
            path = path.join(d);
        }
    }
    path.join(resolve_file_name(file_name))
}

/// Read a single note file
#[tauri::command]
async fn read_note(base_path: String, dir: Option<String>, file_name: String) -> Result<String, String> {
    let path = note_path(&base_path, dir.as_deref(), &file_name);

    if !path.exists() {
        return Ok(String::new());
    }

    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Write a single note file（目录 / 文件名都走真实名字）
#[tauri::command]
async fn write_note(
    base_path: String,
    dir: Option<String>,
    file_name: String,
    content: String,
) -> Result<(), String> {
    let path = note_path(&base_path, dir.as_deref(), &file_name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, content).map_err(|e| e.to_string())
}

/// 把文件移动到系统废纸篓（~/.Trash），失败时回退为直接删除。
/// 返回废纸篓中的新路径（用于提示），回退删除时返回空串。
fn move_to_trash(path: &std::path::Path) -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|e| format!("读取 HOME 失败: {e}"))?;
    let trash_dir = PathBuf::from(home).join(".Trash");
    fs::create_dir_all(&trash_dir).map_err(|e| format!("创建废纸篓目录失败: {e}"))?;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "无法解析文件名".to_string())?;

    let mut target = trash_dir.join(file_name);
    if target.exists() {
        // 同名文件已存在：加时间戳后缀，避免覆盖废纸篓里的旧文件
        let stem = path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or("note")
            .to_string();
        let ext = path
            .extension()
            .and_then(|n| n.to_str())
            .unwrap_or("md")
            .to_string();
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        target = trash_dir.join(format!("{stem} {stamp}.{ext}"));
    }

    match fs::rename(path, &target) {
        Ok(()) => Ok(target.to_string_lossy().to_string()),
        Err(rename_err) => {
            // 跨卷或废纸篓不可写时回退：直接删除，删除失败则如实报错
            fs::remove_file(path)
                .map_err(|e| format!("移入废纸篓失败({rename_err})，删除也失败: {e}"))?;
            Ok(String::new())
        }
    }
}

/// Delete a note file —— 移入系统废纸篓，可从废纸篓还原
#[tauri::command]
async fn delete_note(base_path: String, dir: Option<String>, file_name: String) -> Result<String, String> {
    let path = note_path(&base_path, dir.as_deref(), &file_name);

    if !path.exists() {
        return Ok(String::new());
    }

    move_to_trash(&path)
}

/// 把任意文件移入系统废纸篓（用于清理磁盘残留笔记文件）
#[tauri::command]
async fn trash_file(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Ok(String::new());
    }
    move_to_trash(&p)
}

/// 磁盘上的笔记文件（用于发现 metadata 之外的残留文件）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteFileEntry {
    /// 文件名（含 .md，即标题）
    file_name: String,
    /// 所在目录的相对路径（根目录为 null），如 "工作/子目录"
    dir: Option<String>,
    path: String,
    size: u64,
    /// 修改时间（毫秒）
    modified: Option<u64>,
}

fn collect_note_files(
    dir: &std::path::Path,
    dir_rel: Option<String>,
    out: &mut Vec<NoteFileEntry>,
    depth: u8,
) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match entry.file_name().into_string() {
            Ok(n) => n,
            Err(_) => continue,
        };
        if name.starts_with('.') {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            // 图片目录不算笔记目录
            if name == "images" || depth >= 8 {
                continue;
            }
            let child_rel = match &dir_rel {
                Some(parent) => format!("{}/{}", parent, name),
                None => name.clone(),
            };
            collect_note_files(&path, Some(child_rel), out, depth + 1);
            continue;
        }
        if !name.ends_with(".md") {
            continue;
        }
        let meta = entry.metadata().ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);
        out.push(NoteFileEntry {
            file_name: name,
            dir: dir_rel.clone(),
            path: path.to_string_lossy().to_string(),
            size,
            modified,
        });
    }
}

/// 列出磁盘上所有笔记文件
#[tauri::command]
async fn list_note_files(base_path: String) -> Result<Vec<NoteFileEntry>, String> {
    let base = PathBuf::from(&base_path);
    if !base.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    collect_note_files(&base, None, &mut out, 0);
    out.sort_by(|a, b| b.modified.unwrap_or(0).cmp(&a.modified.unwrap_or(0)));
    Ok(out)
}

/// Create a directory folder for note organization
#[tauri::command]
async fn create_directory_folder(base_path: String, dir: String) -> Result<(), String> {
    let path = PathBuf::from(base_path).join(&dir);
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Rename / move a directory folder（新旧都用相对路径）
#[tauri::command]
async fn rename_directory_folder(base_path: String, old_dir: String, new_dir: String) -> Result<(), String> {
    let root = PathBuf::from(&base_path);
    let old_path = root.join(&old_dir);
    let new_path = root.join(&new_dir);
    if old_path == new_path || !old_path.exists() {
        return Ok(());
    }
    if let Some(parent) = new_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

/// Delete a directory folder：.md 与子目录都上抬一级到父目录，然后删掉空文件夹
#[tauri::command]
async fn delete_directory_folder(base_path: String, dir: String, parent_dir: Option<String>) -> Result<(), String> {
    let root = PathBuf::from(&base_path);
    let dir_path = root.join(&dir);
    if !dir_path.exists() {
        return Ok(());
    }
    let dest_dir = match parent_dir.as_deref() {
        Some(p) if !p.trim().is_empty() => root.join(p),
        _ => root.clone(),
    };
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    if let Ok(entries) = fs::read_dir(&dir_path) {
        for entry in entries.flatten() {
            let file_path = entry.path();
            let name = entry.file_name();
            let mut dest = dest_dir.join(&name);
            // 同名冲突时加序号，绝不覆盖父目录里已有的笔记
            if dest.exists() {
                let stem = file_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("未命名")
                    .to_string();
                let ext = file_path
                    .extension()
                    .and_then(|s| s.to_str())
                    .map(|s| format!(".{}", s))
                    .unwrap_or_default();
                let mut i = 2;
                loop {
                    dest = dest_dir.join(format!("{} {}{}", stem, i, ext));
                    if !dest.exists() {
                        break;
                    }
                    i += 1;
                }
            }
            let _ = fs::rename(&file_path, &dest);
        }
    }

    fs::remove_dir_all(&dir_path).map_err(|e| e.to_string())
}

/// Move / rename a note file（目录与文件名都用真实名字）
#[tauri::command]
async fn move_note_file(
    base_path: String,
    from_dir: Option<String>,
    to_dir: Option<String>,
    file_name: String,
    new_file_name: Option<String>,
) -> Result<(), String> {
    let src = note_path(&base_path, from_dir.as_deref(), &file_name);
    let target_name = new_file_name.as_deref().unwrap_or(&file_name);
    let dest = note_path(&base_path, to_dir.as_deref(), target_name);

    if src == dest {
        return Ok(());
    }
    if !src.exists() {
        // 源不存在就什么都不做；内容会在下次保存时写到目标位置
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // 目标已存在（同名笔记）时不覆盖，加序号
    let mut final_dest = dest.clone();
    if final_dest.exists() {
        let stem = dest
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("未命名")
            .to_string();
        let mut i = 2;
        loop {
            let candidate = dest.with_file_name(format!("{} {}.md", stem, i));
            if !candidate.exists() {
                final_dest = candidate;
                break;
            }
            i += 1;
        }
    }

    fs::rename(&src, &final_dest).map_err(|e| e.to_string())
}

/// 迁移：把老布局（note_<id>.md、以目录 id 命名的扁平文件夹）改造成真实名字布局
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayoutMove {
    id: String,
    /// 老位置：目录 id（根目录为 null）
    from_dir: Option<String>,
    /// 新位置：目录相对路径（根目录为 null）
    to_dir: Option<String>,
    /// 新文件名（含 .md）
    to_file_name: String,
}

#[tauri::command]
async fn migrate_note_layout(base_path: String, moves: Vec<LayoutMove>) -> Result<usize, String> {
    let root = PathBuf::from(&base_path);
    if !root.exists() {
        return Ok(0);
    }
    let mut migrated = 0usize;
    for m in moves {
        let old_name = format!("note_{}.md", m.id);
        let candidates = [
            match m.from_dir.as_deref() {
                Some(d) if !d.trim().is_empty() => root.join(d).join(&old_name),
                _ => root.join(&old_name),
            },
            root.join(&old_name),
        ];
        let src = candidates.iter().find(|p| p.exists()).cloned();
        let Some(src) = src else { continue };

        let dest = note_path(&base_path, m.to_dir.as_deref(), &m.to_file_name);
        if src == dest {
            continue;
        }
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut final_dest = dest.clone();
        if final_dest.exists() {
            let stem = dest
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("未命名")
                .to_string();
            let mut i = 2;
            loop {
                let candidate = dest.with_file_name(format!("{} {}.md", stem, i));
                if !candidate.exists() {
                    final_dest = candidate;
                    break;
                }
                i += 1;
            }
        }
        if fs::rename(&src, &final_dest).is_ok() {
            migrated += 1;
        }
    }

    // 清理搬空的、以目录 id 命名的老文件夹
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "images" {
                continue;
            }
            let empty = fs::read_dir(&path)
                .map(|mut it| it.next().is_none())
                .unwrap_or(false);
            if empty {
                let _ = fs::remove_dir(&path);
            }
        }
    }

    Ok(migrated)
}

/// Set note file to read-only (444 permission)
#[tauri::command]
async fn set_note_readonly(base_path: String, dir: Option<String>, file_name: String) -> Result<(), String> {
    let path = note_path(&base_path, dir.as_deref(), &file_name);

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
            let _ = &path;
        }
    }

    Ok(())
}

/// Set note file to read-write (644 permission)
#[tauri::command]
async fn set_note_readwrite(base_path: String, dir: Option<String>, file_name: String) -> Result<(), String> {
    let path = note_path(&base_path, dir.as_deref(), &file_name);

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
            let _ = &path;
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

/// 折叠态窗口在小活条两边各留的余量（逻辑像素），与前端 STRIP_PADDING 保持一致
const EDGE_STRIP_PADDING: f64 = 3.0;
/// 小白条粗细默认值（逻辑像素，与前端 DEFAULT_STRIP_W 保持一致）
const EDGE_STRIP_WIDTH_DEFAULT: f64 = 5.0;
/// 边缘面板展开态宽度默认值（逻辑像素，与前端默认值保持一致）
const EDGE_EXPANDED_WIDTH: f64 = 320.0;
/// 触发段占可用长边的默认比例（%）
const EDGE_TRIGGER_SPAN_DEFAULT: f64 = 33.0;

/// 贴边方向：0=右 1=左 2=上 3=下
static EDGE_SIDE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
/// 展开态厚度（逻辑像素，可在设置里调）
static EDGE_PANEL_THICKNESS: Mutex<f64> = Mutex::new(EDGE_EXPANDED_WIDTH);
/// 小白条粗细（逻辑像素，设置里可调）；折叠态窗口厚度 = 这个值 + 两边余量
static EDGE_STRIP_WIDTH: Mutex<f64> = Mutex::new(EDGE_STRIP_WIDTH_DEFAULT);
/// 触发段长度占可用长边的比例（%，10-100，可在设置里调，沿边居中）
static EDGE_TRIGGER_SPAN_PERCENT: Mutex<f64> = Mutex::new(EDGE_TRIGGER_SPAN_DEFAULT);

/// 侧边栏总开关：关掉后贴边条隐藏，热区与快捷键一律失效
static EDGE_ENABLED: AtomicBool = AtomicBool::new(true);
/// 快捷键钉住的展开态：钉住后鼠标移开也不再收起
static EDGE_PINNED: AtomicBool = AtomicBool::new(false);
/// 边缘窗口当前厚度（逻辑像素）：用于区分展开/折叠态，避免收起动画中被热区误判重新展开
static EDGE_CURRENT_WIDTH: Mutex<f64> = Mutex::new(EDGE_STRIP_WIDTH_DEFAULT + EDGE_STRIP_PADDING);
/// 上次实际下发的窗口几何 (x, y, w, h)：完全相同时不再重复设置，避免窗口反复重排导致闪烁
static EDGE_LAST_GEOM: Mutex<Option<(i32, i32, u32, u32)>> = Mutex::new(None);
/// 主动收起后的静默期（毫秒时间戳）：期间一律视为「不展开」，
/// 防止收起动画结束时鼠标恰好压在最右侧细条上，把面板又弹开
static EDGE_SUPPRESS_UNTIL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// 快捷键当前是否处于按下状态：长按产生的重复 Pressed 事件不再翻转面板
static EDGE_HOTKEY_DOWN: AtomicBool = AtomicBool::new(false);
/// 上次快捷键切换的时间戳（毫秒），用于吞掉同一次按键的重复事件
static EDGE_TOGGLE_AT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// 边缘窗口当前是否可见
static EDGE_VISIBLE: AtomicBool = AtomicBool::new(false);
/// 光标当前是否落在边缘热区内（用于去重 emit）
static EDGE_HOVERED: AtomicBool = AtomicBool::new(false);
/// 热区矩形（逻辑坐标，CGEvent 的左上原点）：[x0, x1, y0, y1] = 窗口当前实际占位
static EDGE_HOTZONE: Mutex<[f64; 4]> = Mutex::new([0.0, 0.0, 0.0, 0.0]);
/// 触发带矩形（逻辑坐标）：永远按设置里的「触发宽度」算，不随面板展开变宽。
/// 展开态下它只用于「保持」，不再把整块面板当成触发范围，
/// 否则只要光标停在展开区域里就等同于一直在触发，设置里的触发宽度形同虚设
static EDGE_TRIGGER_ZONE: Mutex<[f64; 4]> = Mutex::new([0.0, 0.0, 0.0, 0.0]);
/// 热区轮询线程是否已启动
static EDGE_TRACKER_STARTED: AtomicBool = AtomicBool::new(false);

/// 读取全局光标位置（Quartz 全局坐标 points，左上原点），复用文件内已有的 CGEvent 声明
fn edge_cursor_location() -> Option<(f64, f64)> {
    unsafe {
        let ev = CGEventCreate(std::ptr::null());
        if ev.is_null() {
            return None;
        }
        let p = CGEventGetLocation(ev);
        CFRelease(ev as *const std::ffi::c_void);
        Some((p.x, p.y))
    }
}

/// 系统级热区轮询：不依赖网页的 mouseenter 事件，鼠标靠近屏幕右边缘就直接展开
fn start_edge_hover_tracker(app: AppHandle) {
    if EDGE_TRACKER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let mut ticks: u32 = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(60));
            ticks = ticks.wrapping_add(1);
            let trigger = edge_trigger_thickness();
            let mut current = trigger;
            let mut inside = false;
            let cursor = edge_cursor_location();
            if EDGE_ENABLED.load(Ordering::Relaxed) && EDGE_VISIBLE.load(Ordering::Relaxed) {
                current = *EDGE_CURRENT_WIDTH.lock().unwrap_or_else(|e| e.into_inner());
                let band = *EDGE_TRIGGER_ZONE.lock().unwrap_or_else(|e| e.into_inner());
                let body = *EDGE_HOTZONE.lock().unwrap_or_else(|e| e.into_inner());
                if let Some((x, y)) = cursor {
                    let hit = |z: [f64; 4]| z[3] > z[2] && z[1] > z[0]
                        && x >= z[0] && x <= z[1] && y >= z[2] && y <= z[3];
                    // 触发只认设置的触发带宽；已经展开时，落在面板本身上也算停留
                    let in_band = hit(band);
                    let in_body = current > trigger + 0.5 && hit(body);
                    inside = in_band || in_body;
                }
            }
            // 钉住时始终视为「需要展开」，鼠标移开也不收起
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let suppressed = now_ms < EDGE_SUPPRESS_UNTIL.load(Ordering::SeqCst);
            let effective = if suppressed {
                false
            } else {
                EDGE_PINNED.load(Ordering::Relaxed) || inside
            };
            // 兜底收起：不依赖前端的 setTimeout + invoke。
            // 边缘窗口没有焦点，webview 的定时器会被系统节流，一旦收起那次调用被吞掉，
            // 窗口就会一直停在面板宽度，那块透明区域全都算热区——表现就是「触发宽度调到最小也没用」。
            if !effective && !suppressed && EDGE_VISIBLE.load(Ordering::Relaxed) && current > trigger + 0.5 {
                if let Some(win) = app.get_webview_window("edge") {
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        let _ = apply_edge_layout(&handle, &win, trigger);
                    });
                }
            }
            let changed = EDGE_HOVERED.swap(effective, Ordering::Relaxed) != effective;
            // 状态变化时立即通知；此外每 20 拍补一次心跳，
            // 避免前端热更新重挂载后错过一次状态、面板卡在折叠宽度
            if changed || ticks % 20 == 0 {
                let _ = app.emit_to("edge", "maiknote:edge-hover", effective);
            }
        }
    });
}

/// 取边缘面板应贴附的显示器：优先主窗口所在屏幕，其次边缘窗口、主显示器
fn edge_monitor<R: tauri::Runtime>(
    app: &AppHandle<R>,
    win: &tauri::WebviewWindow<R>,
) -> Option<tauri::Monitor> {
    app.get_webview_window("main")
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| win.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
}

/// 把边缘窗口布局成「贴右边缘 + 全高 + 指定逻辑宽度」，右边缘保持锚定
fn edge_side() -> u8 {
    EDGE_SIDE.load(Ordering::SeqCst)
}

fn edge_panel_thickness() -> f64 {
    *EDGE_PANEL_THICKNESS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// 折叠态厚度：固定 1px 细条，不再跟着设置走
fn edge_trigger_thickness() -> f64 {
    let strip = *EDGE_STRIP_WIDTH.lock().unwrap_or_else(|e| e.into_inner());
    (strip + EDGE_STRIP_PADDING).clamp(6.0, 24.0)
}

/// 触发段占比（%，10-100）
fn edge_trigger_span_percent() -> f64 {
    (*EDGE_TRIGGER_SPAN_PERCENT
        .lock()
        .unwrap_or_else(|e| e.into_inner()))
    .clamp(10.0, 100.0)
}

/// 按贴边方向算窗口矩形（物理像素）：0=右 1=左 2=上 3=下
fn edge_rect(side: u8, work: (i32, i32, i32, i32), thickness_px: u32) -> (i32, i32, u32, u32) {
    let (wx, wy, ww, wh) = work;
    let t = thickness_px.max(1);
    match side {
        0 => (wx + ww - t as i32, wy, t, wh as u32),
        1 => (wx, wy, t, wh as u32),
        2 => (wx, wy, ww as u32, t),
        _ => (wx, wy + wh - t as i32, ww as u32, t),
    }
}

/// 沿边居中截出的触发段（逻辑坐标）：左右贴边取竖直中段，上下贴边取水平中段。
/// 段长按设置里的「触发高度」百分比算，两端留空不触发。
fn edge_trigger_span(side: u8, area: [f64; 4]) -> [f64; 4] {
    let [lx, ly, lw, lh] = area;
    let pct = edge_trigger_span_percent();
    match side {
        0 | 1 => {
            let len = (lh * pct / 100.0).clamp(1.0_f64.min(lh), lh);
            let y0 = ly + (lh - len) / 2.0;
            [lx, y0, lw, len]
        }
        _ => {
            let len = (lw * pct / 100.0).clamp(1.0_f64.min(lw), lw);
            let x0 = lx + (lw - len) / 2.0;
            [x0, ly, len, lh]
        }
    }
}

/// 按贴边方向算触发/命中区域（逻辑坐标，CGEvent 左上原点）
fn edge_zone(side: u8, area: [f64; 4], thickness: f64) -> [f64; 4] {
    let [lx, ly, lw, lh] = area;
    match side {
        0 => [lx + lw - thickness, lx + lw, ly, ly + lh],
        1 => [lx, lx + thickness, ly, ly + lh],
        2 => [lx, lx + lw, ly, ly + thickness],
        _ => [lx, lx + lw, ly + lh - thickness, ly + lh],
    }
}

/// 按当前贴边方向与厚度算窗口矩形（物理像素）与热区（逻辑坐标）
fn apply_edge_layout<R: tauri::Runtime>(
    app: &AppHandle<R>,
    win: &tauri::WebviewWindow<R>,
    thickness: f64,
) -> Result<(), String> {
    let monitor = edge_monitor(app, win).ok_or_else(|| "no monitor available".to_string())?;
    let scale = monitor.scale_factor();
    let work = monitor.work_area();

    let t = ((thickness * scale).round() as u32).max(1);
    let wx = work.position.x;
    let wy = work.position.y;
    let ww = work.size.width as i32;
    let wh = work.size.height as i32;

    let side = edge_side();
    let (x, y, w, h) = edge_rect(side, (wx, wy, ww, wh), t);

    let geom = (x, y, w, h);
    let unchanged = {
        let mut last = EDGE_LAST_GEOM.lock().unwrap_or_else(|e| e.into_inner());
        if *last == Some(geom) {
            true
        } else {
            *last = Some(geom);
            false
        }
    };
    if !unchanged {
        win.set_size(tauri::Size::Physical(tauri::PhysicalSize {
            width: w,
            height: h,
        }))
        .map_err(|e| e.to_string())?;
        win.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
            .map_err(|e| e.to_string())?;
    }

    // 同步热区（逻辑坐标）：窗口占位 + 固定触发带
    let lx = work.position.x as f64 / scale;
    let ly = work.position.y as f64 / scale;
    let lw = work.size.width as f64 / scale;
    let lh = work.size.height as f64 / scale;
    let zone = edge_zone(side, [lx, ly, lw, lh], thickness);
    if let Ok(mut z) = EDGE_HOTZONE.lock() {
        *z = zone;
    }
    // 触发带：法线方向固定贴边 3pt，长度取设置里的「触发高度」百分比、沿边居中，
    // 面板展开（thickness = 面板宽度）也不会把触发范围撑大。
    let span = edge_trigger_span(side, [lx, ly, lw, lh]);
    let band = edge_zone(side, span, edge_trigger_thickness());
    if let Ok(mut z) = EDGE_TRIGGER_ZONE.lock() {
        *z = band;
    }
    if let Ok(mut current) = EDGE_CURRENT_WIDTH.lock() {
        *current = thickness;
    }
    Ok(())
}

#[link(name = "objc")]
extern "C" {
    fn sel_registerName(name: *const std::os::raw::c_char) -> *const std::ffi::c_void;
    fn class_replaceMethod(
        cls: *const std::ffi::c_void,
        name: *const std::ffi::c_void,
        imp: *const std::ffi::c_void,
        types: *const std::os::raw::c_char,
    ) -> *const std::ffi::c_void;
}

/// 让边缘窗口在非激活状态下也能接住第一次点击（否则点复制要先点一下激活窗口）
#[cfg(target_os = "macos")]
extern "C" fn edge_accepts_first_mouse(
    _this: *mut objc2::runtime::AnyObject,
    _cmd: objc2::runtime::Sel,
    _event: *mut objc2::runtime::AnyObject,
) -> i8 {
    1
}

/// 递归给视图树里的每个视图类挂上 acceptsFirstMouse: YES
#[cfg(target_os = "macos")]
fn enable_first_mouse(view: *mut objc2::runtime::AnyObject) {
    use objc2::msg_send;
    if view.is_null() {
        return;
    }
    unsafe {
        let cls: *const std::ffi::c_void = msg_send![view, class];
        if !cls.is_null() {
            let sel =
                sel_registerName(b"acceptsFirstMouse:\0".as_ptr() as *const std::os::raw::c_char);
            let types = b"c@:@\0".as_ptr() as *const std::os::raw::c_char;
            let imp = edge_accepts_first_mouse as *const std::ffi::c_void;
            class_replaceMethod(cls, sel, imp, types);
        }

        let subviews: *mut objc2::runtime::AnyObject = msg_send![view, subviews];
        if subviews.is_null() {
            return;
        }
        let count: usize = msg_send![subviews, count];
        for index in 0..count.min(64) {
            let child: *mut objc2::runtime::AnyObject = msg_send![subviews, objectAtIndex: index];
            enable_first_mouse(child);
        }
    }
}

/// 给边缘窗口上样式：毛玻璃 + 悬浮层级 + 所有 Space 可见（只做一次）
#[cfg(target_os = "macos")]
fn style_edge_window(win: &tauri::WebviewWindow) {
    use cocoa::base::id;
    use objc2::msg_send;

    // 磨玻璃底（失败不影响功能）
    let _ = apply_vibrancy(
        win,
        NSVisualEffectMaterial::Popover,
        Some(NSVisualEffectState::Active),
        Some(0.0),
    );

    if let Ok(ns_window) = win.ns_window() {
        let ns_window_ptr = ns_window as id as *mut objc2::runtime::AnyObject;
        unsafe {
            // NSFloatingWindowLevel：悬浮在普通窗口之上，不进全屏/菜单栏层级
            let _: () = msg_send![ns_window_ptr, setLevel: 3i64];
            // 所有 Space 可见 + 不随窗口切换移动 + 不参与 Cmd+` 循环
            let _: () = msg_send![
                ns_window_ptr,
                setCollectionBehavior: NS_WINDOW_COLLECTION_BEHAVIOR_CAN_JOIN_ALL_SPACES
                    | NS_WINDOW_COLLECTION_BEHAVIOR_STATIONARY
                    | NS_WINDOW_COLLECTION_BEHAVIOR_IGNORES_CYCLE
            ];
            // 应用失焦时不隐藏，保证边缘条一直在
            let _: () = msg_send![ns_window_ptr, setHidesOnDeactivate: 0i8];
            // 非激活态下第一次点击也要落到网页上（复制按钮 / 选文本）
            let content_view: *mut objc2::runtime::AnyObject = msg_send![ns_window_ptr, contentView];
            enable_first_mouse(content_view);
        }
    }
}

static EDGE_WINDOW_STYLED: AtomicBool = AtomicBool::new(false);

/// 初始化边缘面板窗口：样式 + 贴右边缘布局 + 显示
/// AppKit 调用必须在主线程，所以这里统一 dispatch 回主线程执行
#[tauri::command]
fn init_edge_window(app: AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if !EDGE_ENABLED.load(Ordering::Relaxed) {
            return;
        }
        let Some(win) = handle.get_webview_window("edge") else {
            return;
        };
        #[cfg(target_os = "macos")]
        if !EDGE_WINDOW_STYLED.swap(true, Ordering::Relaxed) {
            style_edge_window(&win);
        }
        let _ = apply_edge_layout(&handle, &win, edge_trigger_thickness());
        let _ = win.show();
        EDGE_VISIBLE.store(true, Ordering::Relaxed);
        EDGE_HOVERED.store(false, Ordering::Relaxed);
        start_edge_hover_tracker(handle.clone());
    })
    .map_err(|e| e.to_string())
}

/// 更新边缘面板的贴边方向与尺寸（设置页改动时调用）
#[tauri::command]
fn set_edge_prefs(
    app: AppHandle,
    side: String,
    panel_width: f64,
    trigger_span: f64,
    strip_width: f64,
    enabled: bool,
) -> Result<(), String> {
    let side_id = match side.as_str() {
        "left" => 1u8,
        "top" => 2u8,
        "bottom" => 3u8,
        _ => 0u8,
    };
    EDGE_SIDE.store(side_id, Ordering::SeqCst);
    if let Ok(mut v) = EDGE_PANEL_THICKNESS.lock() {
        *v = panel_width.clamp(120.0, 1200.0);
    }
    if let Ok(mut v) = EDGE_TRIGGER_SPAN_PERCENT.lock() {
        *v = trigger_span.clamp(10.0, 100.0);
    }
    if let Ok(mut v) = EDGE_STRIP_WIDTH.lock() {
        *v = strip_width.clamp(3.0, 16.0);
    }
    EDGE_ENABLED.store(enabled, Ordering::Relaxed);
    // 几何变了就强制重排一次
    if let Ok(mut last) = EDGE_LAST_GEOM.lock() {
        *last = None;
    }
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Some(win) = handle.get_webview_window("edge") {
            // 总开关关掉：窗口直接收起来，状态一并复位
            if !enabled {
                EDGE_VISIBLE.store(false, Ordering::Relaxed);
                EDGE_HOVERED.store(false, Ordering::Relaxed);
                EDGE_PINNED.store(false, Ordering::Relaxed);
                let _ = win.hide();
                return;
            }
            // 只看窗口此刻到底有多厚，不看 hover 状态：
            // hover 只是个瞬时信号，拿它决定厚度会在拖设置滑块时把窗口撑成面板宽度并留在那儿
            let current = *EDGE_CURRENT_WIDTH.lock().unwrap_or_else(|e| e.into_inner());
            let open = EDGE_PINNED.load(Ordering::Relaxed)
                || current > edge_trigger_thickness() + 0.5;
            let thickness = if open {
                edge_panel_thickness()
            } else {
                edge_trigger_thickness()
            };
            let _ = apply_edge_layout(&handle, &win, thickness);
        }
    })
    .map_err(|e| e.to_string())
}

/// 设置边缘面板宽度（展开 / 折叠动画逐帧调用）
#[tauri::command]
fn set_edge_width(app: AppHandle, width: f64) -> Result<(), String> {
    let clamped = width.clamp(1.0, 1400.0);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Some(win) = handle.get_webview_window("edge") {
            let _ = apply_edge_layout(&handle, &win, clamped);
        }
    })
    .map_err(|e| e.to_string())
}

/// 隐藏边缘面板窗口（没有任何收藏笔记时）
#[tauri::command]
fn hide_edge_window(app: AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        EDGE_VISIBLE.store(false, Ordering::Relaxed);
        EDGE_HOVERED.store(false, Ordering::Relaxed);
        EDGE_PINNED.store(false, Ordering::Relaxed);
        if let Some(win) = handle.get_webview_window("edge") {
            let _ = win.hide();
        }
        let _ = handle.emit("maiknote:edge-pinned", false);
    })
    .map_err(|e| e.to_string())
}

/// 切换边缘面板：未钉住 -> 展开并钉住；已钉住 -> 收起并解除钉住
fn toggle_edge_panel_impl(app: &AppHandle) {
    // 同一次按键可能被上报两次（按住重复 / 重复注册），250ms 内只认第一次
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    if !EDGE_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    let last = EDGE_TOGGLE_AT.swap(now, Ordering::SeqCst);
    if now.saturating_sub(last) < 120 {
        return;
    }
    let pinned = !EDGE_PINNED.load(Ordering::Relaxed);
    EDGE_PINNED.store(pinned, Ordering::Relaxed);
    if pinned {
        EDGE_VISIBLE.store(true, Ordering::Relaxed);
    }
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(win) = handle.get_webview_window("edge") {
            #[cfg(target_os = "macos")]
            if !EDGE_WINDOW_STYLED.swap(true, Ordering::Relaxed) {
                style_edge_window(&win);
            }
            let width = if pinned { edge_panel_thickness() } else { edge_trigger_thickness() };
            let _ = apply_edge_layout(&handle, &win, width);
            if pinned {
                let _ = win.show();
                EDGE_HOVERED.store(true, Ordering::Relaxed);
                start_edge_hover_tracker(handle.clone());
            }
        }
        let _ = handle.emit("maiknote:edge-pinned", pinned);
        let _ = handle.emit_to("edge", "maiknote:edge-hover", pinned);
    });
}

/// 快捷键：展开/隐藏边缘面板
#[tauri::command]
fn toggle_edge_panel(app: AppHandle) -> Result<(), String> {
    toggle_edge_panel_impl(&app);
    Ok(())
}

/// 面板上的隐藏按钮：解除钉住并收回到细条
#[tauri::command]
fn collapse_edge_panel(app: AppHandle) -> Result<(), String> {
    EDGE_PINNED.store(false, Ordering::Relaxed);
    let until = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64 + 700)
        .unwrap_or(0);
    EDGE_SUPPRESS_UNTIL.store(until, Ordering::SeqCst);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        EDGE_HOVERED.store(false, Ordering::Relaxed);
        if let Some(win) = handle.get_webview_window("edge") {
            let _ = apply_edge_layout(&handle, &win, edge_trigger_thickness());
        }
        let _ = handle.emit("maiknote:edge-pinned", false);
        let _ = handle.emit_to("edge", "maiknote:edge-hover", false);
    })
    .map_err(|e| e.to_string())
}

/// 注册全局边缘面板快捷键（无系统焦点时也可展开/隐藏）
#[tauri::command]
async fn register_edge_shortcut(
    app: AppHandle,
    shortcut_state: State<'_, GlobalShortcutState>,
    shortcut_str: String,
) -> Result<(), String> {
    if shortcut_str.trim().is_empty() {
        let mut current = shortcut_state.edge_shortcut.lock().unwrap();
        if let Some(old) = current.take() {
            let _ = app.global_shortcut().unregister(old);
        }
        return Ok(());
    }

    let shortcut = parse_shortcut_str(&shortcut_str)?;

    {
        let mut current = shortcut_state.edge_shortcut.lock().unwrap();
        if let Some(old) = current.take() {
            let _ = app.global_shortcut().unregister(old);
        }
    }

    let app_handle = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| match event.state {
            ShortcutState::Pressed => {
                // 长按时系统会连续上报 Pressed：只有「从抬起变成第一次按下」才算一次切换
                if !EDGE_HOTKEY_DOWN.swap(true, Ordering::SeqCst) {
                    toggle_edge_panel_impl(&app_handle);
                }
            }
            ShortcutState::Released => {
                EDGE_HOTKEY_DOWN.store(false, Ordering::SeqCst);
            }
        })
        .map_err(|e| e.to_string())?;

    {
        let mut current = shortcut_state.edge_shortcut.lock().unwrap();
        *current = Some(shortcut);
    }

    println!("Edge panel shortcut registered: {}", shortcut_str);
    Ok(())
}

/// 读取系统剪贴板文本（边缘面板右键「粘贴」用）
#[tauri::command]
fn read_clipboard(app: AppHandle) -> Result<String, String> {
    use objc2::msg_send;
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    app.run_on_main_thread(move || {
        let text = unsafe {
            let pb: *mut objc2::runtime::AnyObject =
                msg_send![objc2::class!(NSPasteboard), generalPasteboard];
            if pb.is_null() {
                String::new()
            } else {
                let ty_c = std::ffi::CString::new("public.utf8-plain-text").unwrap();
                let ty: *mut objc2::runtime::AnyObject = msg_send![
                    objc2::class!(NSString),
                    stringWithUTF8String: ty_c.as_ptr()
                ];
                let value: *mut objc2::runtime::AnyObject = msg_send![pb, stringForType: ty];
                if value.is_null() {
                    String::new()
                } else {
                    let bytes: *const std::os::raw::c_char = msg_send![value, UTF8String];
                    if bytes.is_null() {
                        String::new()
                    } else {
                        std::ffi::CStr::from_ptr(bytes).to_string_lossy().into_owned()
                    }
                }
            }
        };
        let _ = tx.send(text);
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(2))
        .map_err(|e| e.to_string())
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
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["edge"])
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(GlobalShortcutState {
            current_shortcut: Mutex::new(None),
            center_shortcut: Mutex::new(None),
            pin_shortcut: Mutex::new(None),
            edge_shortcut: Mutex::new(None),
        })
        .manage(WindowAlphaState {
            alpha: Mutex::new(1.0),
        })
        .manage(WindowPositionState {
            positions: Mutex::new(HashMap::new()),
            ready: AtomicBool::new(false),
        })
        .on_window_event(|window, event| {
            // 边缘面板窗口的移动/缩放不代表主窗口位置，直接跳过
            if window.label() != "main" {
                return;
            }
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
            trash_file,
            list_note_files,
            create_directory_folder,
            rename_directory_folder,
            delete_directory_folder,
            move_note_file,
            migrate_note_layout,
            set_note_readonly,
            set_note_readwrite,
            ensure_images_folder,
            save_image,
            register_global_shortcut,
            register_center_shortcut,
            register_pin_shortcut,
            register_edge_shortcut,
            toggle_edge_panel,
            collapse_edge_panel,
            center_window,
            toggle_window,
            exit_app,
            set_window_alpha,
            init_edge_window,
            set_edge_width,
            set_edge_prefs,
            hide_edge_window,
            read_clipboard,
            autostart::enable_autostart,
            autostart::disable_autostart,
            autostart::is_autostart_enabled,
            get_network_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod edge_layout_tests {
    use super::*;

    /// 1920×1080 屏，菜单栏 25px，工作区 (0,25,1920,1055)
    const WORK: (i32, i32, i32, i32) = (0, 25, 1920, 1055);

    #[test]
    fn right_side_sticks_to_right_edge() {
        assert_eq!(edge_rect(0, WORK, 320), (1600, 25, 320, 1055));
        assert_eq!(edge_rect(0, WORK, 12), (1908, 25, 12, 1055));
    }

    #[test]
    fn left_side_sticks_to_left_edge() {
        assert_eq!(edge_rect(1, WORK, 320), (0, 25, 320, 1055));
    }

    #[test]
    fn top_side_spans_width_at_top() {
        assert_eq!(edge_rect(2, WORK, 320), (0, 25, 1920, 320));
    }

    #[test]
    fn bottom_side_spans_width_at_bottom() {
        assert_eq!(edge_rect(3, WORK, 320), (0, 760, 1920, 320));
    }

    #[test]
    fn hotzones_follow_the_same_edge() {
        let area = [0.0, 25.0, 1920.0, 1055.0];
        assert_eq!(edge_zone(0, area, 12.0), [1908.0, 1920.0, 25.0, 1080.0]);
        assert_eq!(edge_zone(1, area, 12.0), [0.0, 12.0, 25.0, 1080.0]);
        assert_eq!(edge_zone(2, area, 12.0), [0.0, 1920.0, 25.0, 37.0]);
        assert_eq!(edge_zone(3, area, 12.0), [0.0, 1920.0, 1068.0, 1080.0]);
    }

    #[test]
    fn thickness_is_clamped_to_at_least_one_pixel() {
        assert_eq!(edge_rect(0, WORK, 0), (1919, 25, 1, 1055));
    }
}
