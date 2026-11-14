//! 把设置里选的 Logo 变成真正的 App 图标。
//!
//! 两条路径：
//! 1. 运行期：NSApplication.setApplicationIconImage 立刻换掉运行中进程的图标（Dock / Cmd-Tab）。
//! 2. 磁盘上：把选中的 .icns 写进 .app 包的 Contents/Resources/icon.icns，再用 LaunchServices
//!    重建缓存 —— 访达 / 启动台 / 程序坞里那个图标本身也变了。
//!
//! 故意不动代码签名：重新签名会改掉 cdhash，全盘访问之类的系统授权会被清掉；只换资源文件的话
//! 应用照常启动（已实测），授权也保留。原图标备份成 icon.icns.mn-original，换回去只需复原它。

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

/// 允许的 Logo 预设 id，与前端 src/utils/noteLogoPresets.ts 一一对应。
pub const LOGO_VARIANTS: [&str; 11] = [
    "violet", "mint", "sunset", "ocean", "dawn", "graphite", "n9blue", "n9green", "n9orange",
    "n9pink", "n9white",
];

const BUNDLE_BACKUP_NAME: &str = "icon.icns.mn-original";

#[derive(Debug, Clone, serde::Serialize)]
pub struct AppIconReport {
    /// 生效的预设 id
    pub variant: String,
    /// 运行中进程的图标是否已切换
    pub runtime: bool,
    /// 被改写的 .app 路径；开发模式下没有包，返回 null
    pub bundle: Option<String>,
    /// 包内 icon.icns 是否真的被替换（已经是这个图标时为 false）
    pub bundle_updated: bool,
    /// 给界面直接显示的一句话
    pub message: String,
}

fn is_known_variant(variant: &str) -> bool {
    LOGO_VARIANTS.contains(&variant)
}

/// 候选 icns 路径：打包后的资源目录 → 包内 Resources → 开发期源码目录。
fn icns_candidates(app: &tauri::AppHandle, variant: &str) -> Vec<PathBuf> {
    let file = format!("{}.icns", variant);
    let mut out: Vec<PathBuf> = Vec::new();

    if let Ok(dir) = app.path().resource_dir() {
        out.push(dir.join("logos").join(&file));
        out.push(dir.join(&file));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(bundle) = find_bundle_root(&exe) {
            out.push(bundle.join("Contents/Resources/logos").join(&file));
        }
        if let Some(dir) = exe.parent() {
            out.push(dir.join("logos").join(&file));
        }
    }
    out.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("icons/logos")
            .join(&file),
    );
    out
}

fn resolve_icns(app: &tauri::AppHandle, variant: &str) -> Result<PathBuf, String> {
    for candidate in icns_candidates(app, variant) {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(format!("找不到 {} 的图标资源", variant))
}

/// 从可执行文件往上找 .app 包根目录（开发模式下的 target/debug 没有包）。
fn find_bundle_root(exe: &Path) -> Option<PathBuf> {
    exe.ancestors()
        .find(|p| p.extension().map(|e| e == "app").unwrap_or(false))
        .map(|p| p.to_path_buf())
}

#[cfg(target_os = "macos")]
fn set_runtime_icon(app: &tauri::AppHandle, bytes: Vec<u8>) -> Result<(), String> {
    use cocoa::appkit::{NSApp, NSApplication, NSImage};
    use cocoa::base::nil;
    use cocoa::foundation::NSData;

    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        let result = unsafe {
            let data = NSData::dataWithBytes_length_(
                nil,
                bytes.as_ptr() as *const std::ffi::c_void,
                bytes.len() as u64,
            );
            let image = NSImage::initWithData_(NSImage::alloc(nil), data);
            if image == nil {
                Err("图标数据无法解码".to_string())
            } else {
                let ns_app = NSApp();
                ns_app.setApplicationIconImage_(image);
                Ok(())
            }
        };
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;

    rx.recv_timeout(std::time::Duration::from_secs(3))
        .map_err(|e| e.to_string())?
}

#[cfg(not(target_os = "macos"))]
fn set_runtime_icon(_app: &tauri::AppHandle, _bytes: Vec<u8>) -> Result<(), String> {
    Err("仅支持 macOS".to_string())
}

/// 让访达 / 启动台丢掉旧的图标缓存。
fn refresh_launch_services(bundle: &Path) {
    let _ = Command::new("touch").arg(bundle).status();
    let lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
    let _ = Command::new(lsregister).arg("-f").arg(bundle).status();
}

/// 把 icns 写进 .app 包。返回是否真的替换了。
fn patch_bundle(bundle: &Path, bytes: &[u8]) -> Result<bool, String> {
    let resources = bundle.join("Contents/Resources");
    let target = resources.join("icon.icns");

    if let Ok(current) = fs::read(&target) {
        if current == bytes {
            return Ok(false);
        }
    }

    fs::create_dir_all(&resources).map_err(|e| e.to_string())?;
    let backup = resources.join(BUNDLE_BACKUP_NAME);
    let had_original = target.is_file();
    if had_original && !backup.is_file() {
        fs::copy(&target, &backup).map_err(|e| e.to_string())?;
    }

    if let Err(err) = fs::write(&target, bytes) {
        // 写不进去就把原来的图标还原，别留下半个图标
        if backup.is_file() {
            let _ = fs::copy(&backup, &target);
        }
        return Err(format!("写入应用图标失败：{}", err));
    }

    refresh_launch_services(bundle);
    Ok(true)
}

#[tauri::command]
pub fn apply_app_icon(app: tauri::AppHandle, variant: String) -> Result<AppIconReport, String> {
    if !is_known_variant(&variant) {
        return Err(format!("未知的 Logo 预设：{}", variant));
    }

    let path = resolve_icns(&app, &variant)?;
    let bytes = fs::read(&path).map_err(|e| format!("读取图标失败：{}", e))?;

    let runtime_error = set_runtime_icon(&app, bytes.clone()).err();

    let mut bundle_path: Option<PathBuf> = None;
    let mut bundle_updated = false;
    let mut bundle_error: Option<String> = None;

    if let Ok(exe) = std::env::current_exe() {
        if let Some(bundle) = find_bundle_root(&exe) {
            match patch_bundle(&bundle, &bytes) {
                Ok(changed) => {
                    bundle_updated = changed;
                    bundle_path = Some(bundle);
                }
                Err(err) => {
                    bundle_path = Some(bundle);
                    bundle_error = Some(err);
                }
            }
        }
    }

    let message = match (&bundle_path, bundle_updated, &bundle_error) {
        (_, _, Some(err)) => err.clone(),
        (Some(_), true, None) => "已写入 App 包，访达 / 启动台里的图标就是这个配色".to_string(),
        (Some(_), false, None) => "App 图标已经是这个配色".to_string(),
        (None, _, None) => match runtime_error {
            None => "开发模式下只切换了运行期图标；打包安装后会直接写进 App 包".to_string(),
            Some(ref err) => format!("切换运行期图标失败：{}", err),
        },
    };

    Ok(AppIconReport {
        variant,
        runtime: runtime_error.is_none(),
        bundle: bundle_path.map(|p| p.to_string_lossy().to_string()),
        bundle_updated,
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_bundle_root_from_executable() {
        let exe = Path::new("/Applications/MaikNote.app/Contents/MacOS/maiknote");
        assert_eq!(
            find_bundle_root(exe),
            Some(PathBuf::from("/Applications/MaikNote.app"))
        );
    }

    #[test]
    fn dev_target_has_no_bundle() {
        let exe = Path::new("/Users/april/WebstormProjects/marknote/src-tauri/target/debug/maiknote");
        assert_eq!(find_bundle_root(exe), None);
    }

    #[test]
    fn rejects_unknown_variant() {
        assert!(is_known_variant("violet"));
        assert!(!is_known_variant("../evil"));
    }

    #[test]
    fn patches_fake_bundle_and_keeps_backup() {
        let dir = std::env::temp_dir().join("mn-icon-test.app");
        let res = dir.join("Contents/Resources");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&res).unwrap();
        fs::write(res.join("icon.icns"), b"old-icon").unwrap();

        let changed = patch_bundle(&dir, b"new-icon").unwrap();
        assert!(changed);
        assert_eq!(fs::read(res.join("icon.icns")).unwrap(), b"new-icon");
        assert_eq!(
            fs::read(res.join(BUNDLE_BACKUP_NAME)).unwrap(),
            b"old-icon"
        );

        // 同样的图标再写一次不重复动作
        assert!(!patch_bundle(&dir, b"new-icon").unwrap());
        let _ = fs::remove_dir_all(&dir);
    }
}
