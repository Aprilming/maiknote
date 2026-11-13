//! macOS 隐私权限：完全磁盘访问（Full Disk Access, TCC）
//!
//! AI 读写 iCloud 里的笔记（`~/Library/Mobile Documents/…`）时会被 TCC 拦截，
//! 需要用户在「系统设置 → 隐私与安全性 → 完全磁盘访问」里手动勾选。
//! 系统不允许程序自己授权，所以这里只做三件事：
//! 1. 探测本 app 当前有没有完全磁盘访问（读受保护路径，看是否 EPERM）
//! 2. 一键跳到对应的系统设置面板
//! 3. 把 app 所在位置在 Finder 里亮出来，方便拖进列表
//!
//! 前端跳转后轮询状态，用户勾完回来会自动变成「已授权」。

use serde::Serialize;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullDiskAccessStatus {
    /// 是否有完全磁盘访问
    pub granted: bool,
    /// 是否探测出了明确结论（受保护路径全都不存在时为 false）
    pub detectable: bool,
    /// 命中的探测点（调试用）
    pub probe: String,
    /// 当前 app 的 .app 路径（拖进系统设置用）
    pub app_path: String,
    /// true 表示跑在正式 .app 里，false 表示开发态
    pub bundled: bool,
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"))
}

/// 受 TCC 保护、未授权时读会 EPERM 的路径，按顺序找第一个存在的
fn probes() -> Vec<PathBuf> {
    let home = home_dir();
    vec![
        home.join("Library/Application Support/com.apple.TCC/TCC.db"),
        home.join("Library/Mail"),
        home.join("Library/Safari"),
        home.join("Library/Messages/chat.db"),
        home.join("Library/Group Containers/group.com.apple.notes"),
    ]
}

/// 逐个探测：能读到 = 有权限；EPERM = 没权限；不存在 = 换下一个
fn detect() -> (bool, bool, PathBuf) {
    let mut last = PathBuf::new();
    for path in probes() {
        last = path.clone();
        match std::fs::File::open(&path) {
            Ok(_) => return (true, true, path),
            Err(e) => {
                if e.kind() == std::io::ErrorKind::PermissionDenied {
                    return (false, true, path);
                }
                // NotFound 之类：这个探测点不适用，继续下一个
            }
        }
    }
    (false, false, last)
}

/// 从可执行文件往上找 `*.app`，找不到就把可执行文件所在目录当结果
fn app_bundle_path() -> (PathBuf, bool) {
    let exe = std::env::current_exe().unwrap_or_default();
    for ancestor in exe.ancestors() {
        if ancestor.extension().and_then(|e| e.to_str()) == Some("app") {
            return (ancestor.to_path_buf(), true);
        }
    }
    let dir = exe.parent().map(|p| p.to_path_buf()).unwrap_or(exe);
    (dir, false)
}

#[tauri::command]
pub fn full_disk_access_status(_app: AppHandle) -> FullDiskAccessStatus {
    let (granted, detectable, probe) = detect();
    let (app_path, bundled) = app_bundle_path();
    FullDiskAccessStatus {
        granted,
        detectable,
        probe: probe.display().to_string(),
        app_path: app_path.display().to_string(),
        bundled,
    }
}

/// 打开「系统设置 → 隐私与安全性 → 完全磁盘访问」
#[tauri::command]
pub fn open_full_disk_access_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("打开系统设置失败: {e}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("仅 macOS 支持".to_string())
    }
}

/// 在 Finder 里显示 app 本身，方便直接拖进完全磁盘访问列表
#[tauri::command]
pub fn reveal_app_in_finder() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let (path, bundled) = app_bundle_path();
        let mut cmd = std::process::Command::new("open");
        if bundled {
            cmd.arg("-R");
        }
        cmd.arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("打开 Finder 失败: {e}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("仅 macOS 支持".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_reports_a_probe_path() {
        let (granted, detectable, probe) = detect();
        println!("granted={granted} detectable={detectable} probe={}", probe.display());
        // 本机一定有这几个受保护路径，至少能给出明确结论
        assert!(detectable, "受保护路径全都不存在，说明探测点选错了");
        assert!(!probe.as_os_str().is_empty());
    }

    #[test]
    fn app_bundle_path_is_absolute() {
        let (path, _bundled) = app_bundle_path();
        assert!(path.is_absolute(), "{} 应为绝对路径", path.display());
    }
}
