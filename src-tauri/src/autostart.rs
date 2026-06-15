/// 开机自启管理
///
/// macOS 13+: 使用 SMAppService API，在系统设置 > 登录项中可见
/// 回退方案: LaunchAgent plist（仅兼容旧版 macOS，用 open 命令启动避免终端弹出）

use std::path::PathBuf;
use std::fs;

const APP_NAME: &str = "MaikNote";
const LAUNCH_ARG: &str = "--flag1";

// ====== macOS SMAppService (macOS 13+) ======

#[cfg(target_os = "macos")]
mod apple {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, AnyClass};
    use objc2::msg_send;
    use std::ffi::CStr;

    fn sm_class() -> Option<&'static AnyClass> {
        let name = CStr::from_bytes_with_nul(b"SMAppService\0").ok()?;
        AnyClass::get(name)
    }

    #[link(name = "ServiceManagement", kind = "framework")]
    extern "C" {}

    /// SMAppService 是否可用（macOS 13+）
    pub fn is_available() -> bool {
        sm_class().is_some()
    }

    /// 通过 SMAppService 注册登录项
    pub fn enable() -> Result<(), String> {
        unsafe {
            let cls = sm_class().ok_or_else(|| "SMAppService 不可用".to_string())?;
            let service: Retained<AnyObject> = msg_send![cls, mainAppService];
            let mut error: *mut AnyObject = std::ptr::null_mut();
            let ok: bool = msg_send![&*service, registerAndReturnError: &mut error];
            if ok { Ok(()) } else { Err("SMAppService 注册失败".to_string()) }
        }
    }

    /// 通过 SMAppService 注销登录项
    pub fn disable() -> Result<(), String> {
        unsafe {
            let cls = sm_class().ok_or_else(|| "SMAppService 不可用".to_string())?;
            let service: Retained<AnyObject> = msg_send![cls, mainAppService];
            let mut error: *mut AnyObject = std::ptr::null_mut();
            let ok: bool = msg_send![&*service, unregisterAndReturnError: &mut error];
            if ok { Ok(()) } else { Err("SMAppService 注销失败".to_string()) }
        }
    }

    /// 检查 SMAppService 登录项是否已注册
    pub fn is_enrolled() -> Result<bool, String> {
        unsafe {
            let cls = sm_class().ok_or_else(|| "SMAppService 不可用".to_string())?;
            let service: Retained<AnyObject> = msg_send![cls, mainAppService];
            let status: i64 = msg_send![&*service, status];
            // SMAppServiceStatusEnrolled = 1
            Ok(status == 1)
        }
    }

    /// 检测是否由 launchd 启动（SMAppService 方式）
    pub fn is_launched_by_launchd() -> bool {
        unsafe { libc::getppid() == 1 }
    }
}

#[cfg(not(target_os = "macos"))]
mod apple {
    pub fn is_available() -> bool { false }
    pub fn enable() -> Result<(), String> { Err("不支持".to_string()) }
    pub fn disable() -> Result<(), String> { Err("不支持".to_string()) }
    pub fn is_enrolled() -> Result<bool, String> { Ok(false) }
    pub fn is_launched_by_launchd() -> bool { false }
}

// ====== 回退方案: LaunchAgent plist ======

fn plist_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home)
        .join("Library/LaunchAgents")
        .join(format!("{}.plist", APP_NAME))
}

/// 尝试从当前可执行路径向上找到 .app bundle
/// 路径模式: MaikNote.app/Contents/MacOS/maiknote
fn find_app_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut path = exe.as_path();
    for _ in 0..3 {
        path = path.parent()?;
    }
    if path.extension().map_or(false, |ext| ext == "app") && path.exists() {
        Some(path.to_path_buf())
    } else {
        None
    }
}

fn enable_plist() -> Result<(), String> {
    let app_bundle = find_app_bundle()
        .ok_or_else(|| "未找到 .app bundle（可能在开发模式下运行）".to_string())?;

    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{app}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/open</string>
        <string>-a</string>
        <string>{bundle}</string>
        <string>--args</string>
        <string>{arg}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>LimitLoadToSessionType</key>
    <string>Aqua</string>
</dict>
</plist>"#,
        app = APP_NAME,
        bundle = app_bundle.to_string_lossy(),
        arg = LAUNCH_ARG
    );

    let path = plist_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建 LaunchAgents 目录失败: {}", e))?;
    }
    fs::write(&path, plist)
        .map_err(|e| format!("写入 plist 失败: {}", e))?;

    #[cfg(target_os = "macos")]
    {
        let uid = unsafe { libc::getuid() };
        let p = path.to_string_lossy();
        let _ = std::process::Command::new("launchctl")
            .args(["bootstrap", &format!("gui/{}", uid), &p])
            .output();
    }

    Ok(())
}

fn disable_plist() -> Result<(), String> {
    let path = plist_path();
    if path.exists() {
        #[cfg(target_os = "macos")]
        {
            let uid = unsafe { libc::getuid() };
            let p = path.to_string_lossy();
            let _ = std::process::Command::new("launchctl")
                .args(["bootout", &format!("gui/{}", uid), &p])
                .output();
        }
        fs::remove_file(&path)
            .map_err(|e| format!("删除 plist 失败: {}", e))?;
    }
    Ok(())
}

fn is_plist_enabled() -> bool {
    plist_path().exists()
}

// ====== 对外 API ======

/// 启用开机自启
///
/// macOS 13+ 使用 SMAppService（系统设置 > 登录项可见）
/// 旧版 macOS 使用 LaunchAgent plist 回退
pub fn enable() -> Result<(), String> {
    if apple::is_available() {
        // 先清理可能遗留的 plist，避免双重启动
        let _ = disable_plist();
        return apple::enable();
    }
    enable_plist()
}

/// 禁用开机自启
pub fn disable() -> Result<(), String> {
    if apple::is_available() {
        let _ = apple::disable();
    }
    disable_plist()
}

/// 检查开机自启是否已启用
pub fn is_enabled() -> bool {
    if apple::is_available() {
        return apple::is_enrolled().unwrap_or(false);
    }
    is_plist_enabled()
}

/// 检测当前进程是否由开机自启启动
pub fn is_autolaunch() -> bool {
    // 方式 1: 命令行参数 --flag1（plist 方式）
    if std::env::args().any(|a| a == LAUNCH_ARG) {
        return true;
    }
    // 方式 2: 父进程为 launchd（SMAppService 方式）
    if apple::is_available() && apple::is_launched_by_launchd() {
        return true;
    }
    false
}

/// Tauri command: 启用开机自启
#[tauri::command]
pub fn enable_autostart() -> Result<(), String> {
    enable()
}

/// Tauri command: 禁用开机自启
#[tauri::command]
pub fn disable_autostart() -> Result<(), String> {
    disable()
}

/// Tauri command: 检查开机自启状态
#[tauri::command]
pub fn is_autostart_enabled() -> bool {
    is_enabled()
}
