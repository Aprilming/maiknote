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

/// 单个探测点的结果，前端按结果给状态点上色
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FdaProbe {
    pub path: String,
    /// ok = 能读；denied = EPERM（没权限）；missing = 路径不存在
    pub result: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullDiskAccessStatus {
    /// 是否有完全磁盘访问
    pub granted: bool,
    /// 是否探测出了明确结论（受保护路径全都不存在时为 false）
    pub detectable: bool,
    /// 命中的探测点（调试用）
    pub probe: String,
    /// 全部探测点的结果，前端逐个渲染状态点
    pub probes: Vec<FdaProbe>,
    /// 当前 app 的 .app 路径（拖进系统设置用）
    pub app_path: String,
    /// 当前可执行文件路径，开发态没有 .app，用它替代 app_path
    pub exe_path: String,
    /// true 表示跑在正式 .app 里，false 表示开发态
    pub bundled: bool,
    /// 开发态时，权限实际记在哪个宿主 App 名下（终端 / IDE）
    pub parent_app: Option<String>,
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

fn probe_once(path: &PathBuf) -> &'static str {
    match std::fs::File::open(path) {
        Ok(_) => "ok",
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => "denied",
        Err(_) => "missing",
    }
}

/// 逐个探测：能读到 = 有权限；EPERM = 没权限；不存在 = 换下一个
fn detect() -> (bool, bool, PathBuf) {
    let mut last = PathBuf::new();
    for path in probes() {
        last = path.clone();
        match probe_once(&path) {
            "ok" => return (true, true, path),
            "denied" => return (false, true, path),
            // NotFound 之类：这个探测点不适用，继续下一个
            _ => {}
        }
    }
    (false, false, last)
}

/// 全部探测点逐个出结果，列表顺序和 probes() 一致
fn detect_all() -> Vec<FdaProbe> {
    probes()
        .into_iter()
        .map(|path| FdaProbe {
            path: path.display().to_string(),
            result: probe_once(&path).to_string(),
        })
        .collect()
}

/// 开发态下权限记在宿主程序（终端 / IDE）名下，沿着父进程链往上找最近的 .app
fn parent_app_name() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let mut pid = std::process::id().to_string();
        for _ in 0..6 {
            let ppid = ps_field("-o", "ppid=", &pid)?;
            if ppid.is_empty() || ppid == "0" || ppid == "1" {
                return None;
            }
            let comm = ps_field("-o", "comm=", &ppid)?;
            if let Some(idx) = comm.find(".app/") {
                let head = &comm[..idx];
                if let Some(name) = head.rsplit('/').next() {
                    if !name.is_empty() {
                        return Some(name.to_string());
                    }
                }
            }
            pid = ppid;
        }
        None
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

#[cfg(target_os = "macos")]
fn ps_field(flag: &str, field: &str, pid: &str) -> Option<String> {
    let output = std::process::Command::new("ps")
        .args([flag, field, "-p", pid])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
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
    let exe_path = std::env::current_exe().unwrap_or_default();
    FullDiskAccessStatus {
        granted,
        detectable,
        probe: probe.display().to_string(),
        probes: detect_all(),
        app_path: app_path.display().to_string(),
        exe_path: exe_path.display().to_string(),
        bundled,
        parent_app: if bundled { None } else { parent_app_name() },
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

/// 重启应用（改完完全磁盘访问等设置后，让新权限生效）
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.restart();
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
