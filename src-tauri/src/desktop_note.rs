//! 桌面笔记卡片：把某一篇笔记「钉」到桌面上，显示成一张常驻卡片（类似系统小组件）。
//!
//! 实现方式是一条独立窗口，label 固定为 `note-widget-<noteId>`，
//! 前端按 label 前缀挂载 `DesktopNote.vue`：
//! - macOS 上把窗口层级压到桌面图标上一层（`kCGDesktopIconWindowLevel + 1`），
//!   于是它盖在壁纸上、待在所有应用窗口下面，就是「桌面小组件」的观感；
//! - 窗口无边框、透明、可拖动（前端标题区用 `data-tauri-drag-region`）、可缩放；
//! - 关闭窗口时前端把 id 从设置里删掉，重启应用按设置里的列表逐个还原。

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// 桌面笔记窗口 label 前缀，前端靠它区分窗口类型
pub const LABEL_PREFIX: &str = "note-widget-";

/// 卡片默认尺寸（逻辑像素）
const DEFAULT_WIDTH: f64 = 300.0;
const DEFAULT_HEIGHT: f64 = 240.0;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Default for DesktopBounds {
    fn default() -> Self {
        Self {
            x: 120.0,
            y: 120.0,
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
        }
    }
}

pub fn label_for(note_id: &str) -> String {
    format!("{LABEL_PREFIX}{note_id}")
}

/// 从窗口 label 里取回笔记 id（不是桌面笔记窗口就返回 None）
pub fn note_id_of(label: &str) -> Option<&str> {
    label.strip_prefix(LABEL_PREFIX).filter(|id| !id.is_empty())
}

/// 当前已经打开的桌面笔记 id
pub fn open_note_ids(app: &AppHandle) -> Vec<String> {
    let mut ids: Vec<String> = app
        .webview_windows()
        .keys()
        .filter_map(|label| note_id_of(label).map(|id| id.to_string()))
        .collect();
    ids.sort();
    ids
}

/// 把窗口按到桌面层：所有应用窗口之下、桌面图标之上。
///
/// `kCGDesktopIconWindowLevel = -2147483603`，桌面小组件就活在这个层级附近，
/// +1 让它盖住桌面图标本身，但仍然在普通窗口下面。
#[cfg(target_os = "macos")]
/// kCGDesktopIconWindowLevel：桌面图标所在层级
const DESKTOP_ICON_WINDOW_LEVEL: i64 = -2_147_483_603;

fn set_window_level(window: &tauri::WebviewWindow, level: i64) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    if let Ok(ptr) = window.ns_window() {
        let ns_window = ptr as *mut AnyObject;
        unsafe {
            let _: () = msg_send![ns_window, setLevel: level];
        }
    }
}

/// 浮在所有普通窗口之上（NSFloatingWindowLevel）
const FLOATING_WINDOW_LEVEL: i64 = 3;

/// 三档层级各自对应的 AppKit window level：
/// - `top`    浮在所有应用窗口之上
/// - `normal` 普通图层（和其他窗口平等，会被别的应用盖住）
/// - `desktop` 桌面层：桌面图标之上、所有应用窗口之下
fn level_value(level: &str) -> i64 {
    match level {
        "top" => FLOATING_WINDOW_LEVEL,
        "normal" => 0,
        _ => DESKTOP_ICON_WINDOW_LEVEL + 1,
    }
}

/// 按设置决定卡片层级。
/// 注意：`setLevel:` 只能在主线程调，tokio 工作线程上调用会被 AppKit 直接 SIGTRAP。
fn apply_level(app: &AppHandle, window: &tauri::WebviewWindow, level: &str) {
    let window = window.clone();
    let level = level.to_string();
    let _ = app.run_on_main_thread(move || {
        if level == "top" {
            // 浮窗模式：置顶 + 明确的 floating 层级（只靠 set_always_on_top 在部分系统版本上仍是 0 层）
            let _ = window.set_always_on_top(true);
        } else {
            let _ = window.set_always_on_top(false);
        }
        set_window_level(&window, level_value(&level));
    });
}

/// 窗口 show 出来后 AppKit 会把层级打回 0，所以在刚打开的两三秒里多压几次。
fn apply_level_settling(app: &AppHandle, window: &tauri::WebviewWindow, level: &str) {
    let app_handle = app.clone();
    let target = window.clone();
    let level = level.to_string();
    std::thread::spawn(move || {
        for _ in 0..5 {
            std::thread::sleep(std::time::Duration::from_millis(500));
            apply_level(&app_handle, &target, &level);
        }
    });
}

/// 打开（或重新显示）某篇笔记的桌面卡片窗口
#[tauri::command]
pub async fn desktop_note_open(
    app: AppHandle,
    note_id: String,
    bounds: Option<DesktopBounds>,
    level: Option<String>,
) -> Result<String, String> {
    let label = label_for(&note_id);

    // 已经开过：直接显示，不要重复建窗口（否则会多出一份 DOM 和事件监听）
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        return Ok(label);
    }

    let bounds = bounds.unwrap_or_default();
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("")
        .inner_size(bounds.width.max(160.0), bounds.height.max(120.0))
        .position(bounds.x, bounds.y)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .resizable(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .visible_on_all_workspaces(false)
        .build()
        .map_err(|e| format!("创建桌面笔记窗口失败: {e}"))?;

    let want_level = level.unwrap_or_else(|| "desktop".to_string());
    apply_level(&app, &window, &want_level);

    // 前端 show() 之后 AppKit 会把窗口重新 order 到普通层级，等它稳定再压几次
    apply_level_settling(&app, &window, &want_level);

    Ok(label)
}

/// 关掉某篇笔记的桌面卡片窗口
#[tauri::command]
pub async fn desktop_note_close(app: AppHandle, note_id: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label_for(&note_id)) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 切换所有桌面卡片的层级（设置里的层级三档：top / normal / desktop）
#[tauri::command]
pub async fn desktop_note_apply_level(app: AppHandle, level: String) -> Result<usize, String> {
    let mut count = 0;
    for label in app.webview_windows().keys().cloned().collect::<Vec<_>>() {
        if note_id_of(&label).is_none() {
            continue;
        }
        if let Some(window) = app.get_webview_window(&label) {
            apply_level(&app, &window, &level);
            count += 1;
        }
    }
    Ok(count)
}

/// 当前打开的桌面笔记 id 列表（主窗口启动时用来对账）
#[tauri::command]
pub fn desktop_note_list(app: AppHandle) -> Vec<String> {
    open_note_ids(&app)
}

/// 桌面卡片上点「打开」：回到主窗口并选中这篇笔记
#[tauri::command]
pub fn desktop_note_open_in_main(
    app: AppHandle,
    note_id: String,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        crate::show_window_current_space_impl(&app);
    }
    app.emit_to("main", "maiknote:open-note", note_id)
        .map_err(|e| e.to_string())
}
