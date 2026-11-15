//! 工作空间：空间列表持久化、自定义目录扫描建索引、跨空间复制/移动。
//!
//! 只有 iCloud 空间（默认空间）的内容与索引都在 iCloud 目录里；用户自选文件夹作为自定义空间时，
//! 笔记文件留在用户选定的目录，索引文件（metadata.json / directories.json）放在应用配置目录
//! `<app_config>/workspace-meta/<workspaceId>/`，避免往用户的文件夹里塞私货。

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// 扫描时最多下钻的目录层数
const SCAN_MAX_DEPTH: usize = 8;
/// 扫描时最多收录的 .md 文件数，超过就标记 truncated
const SCAN_MAX_FILES: usize = 5000;
/// 读取每个文件头部多少字节来提取标题
const HEAD_BYTES: usize = 4096;

#[derive(Serialize, Clone)]
pub struct ScannedFile {
    /// 相对内容根目录的路径，统一用 / 分隔
    pub rel_path: String,
    /// 文件头部内容，前端用它提取标题
    pub head: String,
    /// 修改时间（毫秒），0 表示取不到
    pub modified: u64,
}

#[derive(Serialize, Clone)]
pub struct ScanResult {
    pub files: Vec<ScannedFile>,
    pub dirs: Vec<String>,
    pub truncated: bool,
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("取应用配置目录失败: {}", e))
}

fn meta_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("workspace-meta"))
}

fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(path)
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn to_slash(p: impl AsRef<Path>) -> String {
    p.as_ref()
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/")
}

/// 读取工作空间列表文件内容（不存在返回空串，前端按空列表处理）
#[tauri::command]
pub fn read_workspaces(app: AppHandle) -> Result<String, String> {
    let file = config_dir(&app)?.join("workspaces.json");
    if !file.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&file).map_err(|e| format!("读取工作空间配置失败: {}", e))
}

#[tauri::command]
pub fn write_workspaces(app: AppHandle, content: String) -> Result<(), String> {
    let dir = config_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    fs::write(dir.join("workspaces.json"), content).map_err(|e| format!("保存工作空间配置失败: {}", e))
}

/// 自定义空间的索引目录根：<app_config>/workspace-meta
#[tauri::command]
pub fn workspace_meta_root(app: AppHandle) -> Result<String, String> {
    Ok(to_slash(meta_root(&app)?))
}

#[tauri::command]
pub fn ensure_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(expand_home(&path)).map_err(|e| format!("创建目录失败: {}", e))
}

/// 校验用户选的文件夹能当工作空间：存在、是目录、不在 iCloud 里、可写。返回规范化绝对路径。
#[tauri::command]
pub fn validate_workspace_dir(path: String) -> Result<String, String> {
    let target = expand_home(&path);
    let canonical = fs::canonicalize(&target).map_err(|_| "文件夹不存在".to_string())?;
    if !canonical.is_dir() {
        return Err("请选择一个文件夹".to_string());
    }
    // 自定义空间只接受 iCloud 之外的文件夹（iCloud 里只有默认空间）
    let text = to_slash(&canonical);
    if text.contains("com~apple~CloudDocs") {
        return Err("请选择 iCloud 之外的文件夹".to_string());
    }
    let probe = canonical.join(".maiknote-write-probe");
    fs::write(&probe, b"ok").map_err(|_| "没有写入权限".to_string())?;
    let _ = fs::remove_file(&probe);
    Ok(to_slash(&canonical))
}

fn walk_dir(root: &Path, dir: &Path, depth: usize, head_bytes: usize, out: &mut ScanResult) {
    if depth > SCAN_MAX_DEPTH || out.truncated {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    let mut children: Vec<fs::DirEntry> = entries.flatten().collect();
    children.sort_by_key(|e| e.file_name());
    for entry in children {
        if out.truncated {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let path = entry.path();
        let rel = match path.strip_prefix(root) {
            Ok(r) => to_slash(r),
            Err(_) => continue,
        };
        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }
        let meta = entry.metadata().ok();
        if ft.is_dir() {
            out.dirs.push(rel);
            walk_dir(root, &path, depth + 1, head_bytes, out);
        } else if ft.is_file() {
            let lower = name.to_lowercase();
            if !lower.ends_with(".md") {
                continue;
            }
            if out.files.len() >= SCAN_MAX_FILES {
                out.truncated = true;
                return;
            }
            let head = fs::read(&path)
                .map(|bytes| {
                    let end = bytes.len().min(head_bytes);
                    String::from_utf8_lossy(&bytes[..end]).to_string()
                })
                .unwrap_or_default();
            out.files.push(ScannedFile {
                rel_path: rel,
                head,
                modified: meta.as_ref().map(modified_ms).unwrap_or(0),
            });
        }
    }
}

/// 递归扫描一个文件夹，返回里面的 .md 与目录结构（只读，不改动任何文件）
#[tauri::command]
pub fn scan_workspace_dir(path: String, max_head_bytes: Option<usize>) -> Result<ScanResult, String> {
    let canonical = fs::canonicalize(expand_home(&path)).map_err(|_| "文件夹不存在".to_string())?;
    if !canonical.is_dir() {
        return Err("请选择一个文件夹".to_string());
    }
    let head_bytes = max_head_bytes
        .filter(|n| *n > 0)
        .map(|n| n.min(65536))
        .unwrap_or(HEAD_BYTES);
    let mut out = ScanResult {
        files: Vec::new(),
        dirs: Vec::new(),
        truncated: false,
    };
    walk_dir(&canonical, &canonical, 0, head_bytes, &mut out);
    Ok(out)
}

/// 目标位置重名时生成「名字 2.md」/「名字 2」
fn unique_target(dst: &Path) -> PathBuf {
    if !dst.exists() {
        return dst.to_path_buf();
    }
    let parent = dst.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let stem = dst
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = dst
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();
    for i in 2..1000 {
        let candidate = parent.join(format!("{} {}{}", stem, i, ext));
        if !candidate.exists() {
            return candidate;
        }
    }
    dst.to_path_buf()
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("创建目录失败: {}", e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("读取目录失败: {}", e))?.flatten() {
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else {
            fs::copy(&path, &target).map_err(|e| format!("复制失败: {}", e))?;
        }
    }
    Ok(())
}

/// 把一个文件或整个文件夹复制（或移动）到另一个空间，返回落盘后的相对路径
#[tauri::command]
pub fn copy_workspace_entry(
    src_base: String,
    src_rel: String,
    dst_base: String,
    dst_rel: String,
    move_it: bool,
) -> Result<String, String> {
    let src = expand_home(&src_base).join(src_rel.replace('\\', "/"));
    let dst_root = expand_home(&dst_base);
    let dst_dir = if dst_rel.is_empty() {
        dst_root.clone()
    } else {
        dst_root.join(dst_rel.replace('\\', "/"))
    };
    if !src.exists() {
        return Err("源文件不存在".to_string());
    }
    fs::create_dir_all(&dst_dir).map_err(|e| format!("创建目标目录失败: {}", e))?;
    let name = src
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or_else(|| "源路径没有文件名".to_string())?;
    let final_path = unique_target(&dst_dir.join(&name));

    if src.is_dir() {
        copy_dir_recursive(&src, &final_path)?;
        if move_it {
            fs::remove_dir_all(&src).map_err(|e| format!("删除源目录失败: {}", e))?;
        }
    } else {
        fs::copy(&src, &final_path).map_err(|e| format!("复制失败: {}", e))?;
        if move_it {
            fs::remove_file(&src).map_err(|e| format!("删除源文件失败: {}", e))?;
        }
    }

    Ok(final_path
        .strip_prefix(&dst_root)
        .map(to_slash)
        .unwrap_or_else(|_| to_slash(&final_path)))
}
#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("maiknote_ws_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn s(p: &PathBuf) -> String {
        p.to_string_lossy().to_string()
    }

    #[test]
    fn scan_finds_nested_markdown_and_skips_noise() {
        let root = tmp("scan");
        fs::create_dir_all(root.join("a/b")).unwrap();
        fs::create_dir_all(root.join(".hidden")).unwrap();
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::write(root.join("root.md"), "# 根笔记\n").unwrap();
        fs::write(root.join("a/b/deep.md"), "# 深层\n").unwrap();
        fs::write(root.join(".hidden/x.md"), "# 隐藏\n").unwrap();
        fs::write(root.join("node_modules/y.md"), "# 依赖\n").unwrap();
        fs::write(root.join("note.txt"), "x").unwrap();

        let res = scan_workspace_dir(s(&root), None).unwrap();
        let mut rels: Vec<String> = res.files.iter().map(|f| f.rel_path.clone()).collect();
        rels.sort();
        assert_eq!(rels, vec!["a/b/deep.md".to_string(), "root.md".to_string()]);
        assert!(res.dirs.contains(&"a".to_string()));
        assert!(res.dirs.contains(&"a/b".to_string()));
        assert!(!res.truncated);
        let head = &res.files.iter().find(|f| f.rel_path == "root.md").unwrap().head;
        assert!(head.contains("根笔记"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_renames_duplicates_and_moves() {
        let src = tmp("src");
        let dst = tmp("dst");
        fs::create_dir_all(src.join("folder/sub")).unwrap();
        fs::write(src.join("note.md"), "# n\n").unwrap();
        fs::write(src.join("folder/sub/inner.md"), "# i\n").unwrap();

        let p1 = copy_workspace_entry(s(&src), "note.md".into(), s(&dst), String::new(), false).unwrap();
        assert_eq!(p1, "note.md");
        let p2 = copy_workspace_entry(s(&src), "note.md".into(), s(&dst), String::new(), false).unwrap();
        assert_eq!(p2, "note 2.md");

        let d1 = copy_workspace_entry(s(&src), "folder".into(), s(&dst), "target/deep".into(), false).unwrap();
        assert_eq!(d1, "target/deep/folder");
        assert!(dst.join("target/deep/folder/sub/inner.md").exists());

        let m1 = copy_workspace_entry(s(&src), "note.md".into(), s(&dst), String::new(), true).unwrap();
        assert_eq!(m1, "note 3.md");
        assert!(!src.join("note.md").exists());
        assert!(src.join("folder/sub/inner.md").exists());

        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dst);
    }

    #[test]
    fn validate_rejects_icloud_and_accepts_normal_folder() {
        let icloud = std::env::temp_dir().join("com~apple~CloudDocs_probe");
        let _ = fs::remove_dir_all(&icloud);
        fs::create_dir_all(&icloud).unwrap();
        let err = validate_workspace_dir(s(&icloud)).unwrap_err();
        assert!(err.contains("iCloud"), "unexpected: {}", err);
        let _ = fs::remove_dir_all(&icloud);

        let ok = tmp("validate_ok");
        let canonical = fs::canonicalize(&ok).unwrap();
        assert_eq!(validate_workspace_dir(s(&ok)).unwrap(), to_slash(&canonical));
        assert!(!ok.join(".maiknote-write-probe").exists());
        let _ = fs::remove_dir_all(&ok);
    }
}
