//! 菜单栏图标（macOS status item）。
//!
//! **为什么需要它**：主进程把 Dock 图标藏掉了（NSApplicationActivationPolicyAccessory），
//! 而主窗口又是「失焦就自动收起」。两者叠在一起，用户一点别处就再无入口，
//! 只能看着一个什么都没有的桌面、以为应用崩了。这颗菜单栏图标是应用唯一常驻的门。

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

/// 模板图：纯黑 + alpha。声明成模板后由 macOS 按菜单栏明暗自动染色，不用准备两套。
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray-template.png");

const TRAY_ID: &str = "maiknote-tray";

#[derive(Clone, Copy, PartialEq)]
enum Lang {
    Zh,
    En,
}

impl Lang {
    fn parse(value: &str) -> Self {
        if value.starts_with("en") {
            Lang::En
        } else {
            Lang::Zh
        }
    }

    /// (显示主窗口, 使用教程, 退出)
    fn labels(self) -> (&'static str, &'static str, &'static str) {
        match self {
            Lang::Zh => ("显示主窗口", "使用教程…", "退出 MaikNote"),
            Lang::En => ("Show Main Window", "User Guide…", "Quit MaikNote"),
        }
    }
}

fn build_menu(app: &AppHandle, lang: Lang) -> tauri::Result<Menu<tauri::Wry>> {
    let (show, guide, quit) = lang.labels();
    let show_item = MenuItem::with_id(app, "show-main", show, true, None::<&str>)?;
    let guide_item = MenuItem::with_id(app, "open-guide", guide, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", quit, true, None::<&str>)?;
    Menu::with_items(app, &[&show_item, &guide_item, &separator, &quit_item])
}

/// 前端切语言时同步菜单文案（设置里选 English 的话，菜单栏不该还是中文）。
#[tauri::command]
pub fn set_tray_language(app: AppHandle, lang: String) -> Result<(), String> {
    let menu = build_menu(&app, Lang::parse(&lang)).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 建菜单栏图标。失败不致命，调用方打日志继续跑。
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    create(app, Lang::Zh)?;
    Ok(())
}

fn create(app: &AppHandle, lang: Lang) -> tauri::Result<tauri::tray::TrayIcon<tauri::Wry>> {
    let menu = build_menu(app, lang)?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(TRAY_ICON)?)
        .icon_as_template(true)
        .tooltip("MaikNote · ⌥⌘A")
        .menu(&menu)
        // 左键留给「切换窗口」，右键才出菜单（和系统里其它常驻应用一致）
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show-main" => reveal(app),
            "open-guide" => {
                reveal(app);
                if let Err(err) = app.emit_to("main", "marknote:open-guide", ()) {
                    eprintln!("[tray] open-guide event failed: {err}");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle(tray.app_handle());
            }
        })
        .build(app)
}

/// 设置里的「菜单栏图标」开关：关掉就把这颗 status item 收起来，重新打开再摆出来。
/// 图标已经在的话只切可见性，省得反复销毁重建。
fn set_enabled(app: &AppHandle, enabled: bool, lang: Lang) -> tauri::Result<()> {
    if enabled {
        match app.tray_by_id(TRAY_ID) {
            Some(tray) => {
                // 隐藏期间可能改过语言，顺手对齐菜单文案
                tray.set_menu(Some(build_menu(app, lang)?))?;
                tray.set_visible(true)?;
            }
            None => {
                create(app, lang)?;
            }
        }
    } else if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_visible(false)?;
    }
    Ok(())
}

/// 前端开关的入口。默认开，设置存在前端，挂载后立刻同步一次。
#[tauri::command]
pub fn set_tray_icon_enabled(app: AppHandle, enabled: bool, lang: String) -> Result<(), String> {
    set_enabled(&app, enabled, Lang::parse(&lang)).map_err(|e| e.to_string())
}

/// 把主窗口摊到当前 Space 最前面并激活应用（托盘点击 / 菜单项共用）。
pub fn reveal(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    crate::show_window_current_space_impl(app);

    #[cfg(not(target_os = "macos"))]
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 左键：窗口正开着且有焦点 -> 收起；否则叫回来。
fn toggle(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    if visible && focused {
        let _ = window.hide();
    } else {
        reveal(app);
    }
}

/// 冷启动：窗口按配置本来就可见，这里只负责「浮到最上面 + 抢到焦点」。
/// 不碰位置尺寸——window-state 恢复的位置要留住。
pub fn reveal_on_launch(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.set_focus();
    #[cfg(target_os = "macos")]
    raise_native(&window);
}

#[cfg(target_os = "macos")]
fn raise_native(window: &tauri::WebviewWindow) {
    use cocoa::appkit::NSApp;
    use cocoa::base::id;
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    unsafe {
        // Accessory 应用没有 Dock 图标，普通 show() 不会自己浮上来，
        // orderFrontRegardless 才不管当前激活的是谁。
        if let Ok(ns_window) = window.ns_window() {
            let ptr = ns_window as id as *mut AnyObject;
            let _: () = msg_send![ptr, orderFrontRegardless];
        }
        let ns_app = NSApp() as id as *mut AnyObject;
        let _: () = msg_send![ns_app, activateIgnoringOtherApps: true];
    }
}
