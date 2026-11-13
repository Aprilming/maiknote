//! Skill 软链接同步
//!
//! 把应用内置的 `maiknote-guide` skill 用**软链接**挂到各个 CLI 的 skills 目录，
//! 源文件始终只有一份（.app 内置资源），改一处等于处处生效，不做复制。
//!
//! 支持的落点：
//! ```text
//! Claude Code   ~/.claude/skills/maiknote-guide      -> 源目录
//! Codex         $CODEX_HOME/skills/maiknote-guide    -> 源目录（默认 ~/.codex）
//! DSH           $DSH_HOME/skills/maiknote-guide      -> 源目录（默认 ~/.dsh）
//! Gemini CLI    ~/.gemini/skills/maiknote-guide      -> 源目录
//! 公共          ~/.agents/skills/maiknote-guide      -> 源目录
//! ```
//!
//! 只在用户点按钮时创建，启动不做任何自动写入。

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// skill 目录名（也是软链接的名字）
pub const SKILL_NAME: &str = "maiknote-guide";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillTarget {
    /// claude / codex / dsh / gemini / public
    pub key: String,
    pub label: String,
    /// 软链接落点（完整路径）
    pub path: String,
    /// linked（已链到本 skill）| missing（还没建）| foreign（链到别处）| occupied（被真实目录占用）
    pub state: String,
    /// 附加说明：foreign 时是当前指向，occupied 时提示占用
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSyncStatus {
    pub skill_name: String,
    /// 内置 skill 源目录
    pub source: String,
    pub source_exists: bool,
    pub targets: Vec<SkillTarget>,
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"))
}

fn env_dir(var: &str, fallback: &str) -> PathBuf {
    match std::env::var_os(var) {
        Some(v) if !v.is_empty() => PathBuf::from(v),
        _ => home_dir().join(fallback),
    }
}

/// 五个落点：key / 展示名 / 软链接完整路径
fn target_defs() -> Vec<(String, String, PathBuf)> {
    let home = home_dir();
    vec![
        (
            "claude".into(),
            "Claude Code".into(),
            home.join(".claude").join("skills").join(SKILL_NAME),
        ),
        (
            "codex".into(),
            "Codex".into(),
            env_dir("CODEX_HOME", ".codex").join("skills").join(SKILL_NAME),
        ),
        (
            "dsh".into(),
            "DSH".into(),
            env_dir("DSH_HOME", ".dsh").join("skills").join(SKILL_NAME),
        ),
        (
            "gemini".into(),
            "Gemini CLI".into(),
            home.join(".gemini").join("skills").join(SKILL_NAME),
        ),
        (
            "public".into(),
            "公共 Skill (~/.agents)".into(),
            home.join(".agents").join("skills").join(SKILL_NAME),
        ),
    ]
}

/// 找内置 skill 的源目录：先看 .app 打包资源，再退回开发模式下的仓库路径
fn resolve_source(app: &AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("skills").join(SKILL_NAME);
        if p.join("SKILL.md").is_file() {
            return p;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(".agents")
        .join("skills")
        .join(SKILL_NAME)
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

fn inspect(path: &Path, source: &Path) -> (String, Option<String>) {
    match fs::symlink_metadata(path) {
        Err(_) => ("missing".to_string(), None),
        Ok(meta) if meta.file_type().is_symlink() => match fs::read_link(path) {
            Ok(dest) => {
                let arrow = dest.display().to_string();
                if same_dir(&dest, source) {
                    ("linked".to_string(), Some(arrow))
                } else {
                    ("foreign".to_string(), Some(arrow))
                }
            }
            Err(e) => ("foreign".to_string(), Some(e.to_string())),
        },
        Ok(_) => ("occupied".to_string(), None),
    }
}

fn build_status(app: &AppHandle) -> SkillSyncStatus {
    let source = resolve_source(app);
    let source_exists = source.join("SKILL.md").is_file();
    let targets = target_defs()
        .into_iter()
        .map(|(key, label, path)| {
            let (state, detail) = inspect(&path, &source);
            SkillTarget {
                key,
                label,
                path: path.display().to_string(),
                state,
                detail,
            }
        })
        .collect();
    SkillSyncStatus {
        skill_name: SKILL_NAME.to_string(),
        source: source.display().to_string(),
        source_exists,
        targets,
    }
}

fn lookup(key: &str) -> Result<PathBuf, String> {
    target_defs()
        .into_iter()
        .find(|(k, _, _)| k == key)
        .map(|(_, _, p)| p)
        .ok_or_else(|| format!("未知的同步目标: {key}"))
}

fn now_stamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 读取当前同步状态（纯只读，不会改动任何文件）
#[tauri::command]
pub fn skill_sync_status(app: AppHandle) -> SkillSyncStatus {
    build_status(&app)
}

/// 给某个目标创建软链接（用户手动点击才调用）
#[tauri::command]
pub fn skill_sync_link(app: AppHandle, key: String) -> Result<SkillSyncStatus, String> {
    let source = resolve_source(&app);
    if !source.join("SKILL.md").is_file() {
        return Err(format!("内置 skill 缺失: {}", source.display()));
    }
    let dest = lookup(&key)?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败 {}: {e}", parent.display()))?;
    }

    match fs::symlink_metadata(&dest) {
        // 已经是软链接：指向本 skill 就算完成，指向别处则改链
        Ok(meta) if meta.file_type().is_symlink() => {
            let current = fs::read_link(&dest).unwrap_or_default();
            if !same_dir(&current, &source) {
                fs::remove_file(&dest).map_err(|e| format!("移除旧链接失败: {e}"))?;
            }
        }
        // 真实目录/文件占位：改名备份，绝不直接删用户文件
        Ok(_) => {
            let backup = dest.with_file_name(format!("{SKILL_NAME}.backup-{}", now_stamp()));
            fs::rename(&dest, &backup)
                .map_err(|e| format!("路径已被占用且备份失败 {}: {e}", dest.display()))?;
        }
        Err(_) => {}
    }

    if fs::symlink_metadata(&dest).is_err() {
        #[cfg(unix)]
        std::os::unix::fs::symlink(&source, &dest)
            .map_err(|e| format!("创建软链接失败 {}: {e}", dest.display()))?;
        #[cfg(not(unix))]
        return Err("当前平台不支持软链接".to_string());
    }

    Ok(build_status(&app))
}

/// 断开某个目标的软链接（只删软链接本身，不回删源文件）
#[tauri::command]
pub fn skill_sync_unlink(app: AppHandle, key: String) -> Result<SkillSyncStatus, String> {
    let source = resolve_source(&app);
    let dest = lookup(&key)?;
    if let Ok(meta) = fs::symlink_metadata(&dest) {
        if meta.file_type().is_symlink() {
            let current = fs::read_link(&dest).unwrap_or_default();
            if same_dir(&current, &source) {
                fs::remove_file(&dest).map_err(|e| format!("移除软链接失败: {e}"))?;
            }
        }
    }
    Ok(build_status(&app))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn inspect_reports_linked_foreign_occupied() {
        let tmp = std::env::temp_dir().join(format!("maiknote-skill-test-{}", now_stamp()));
        let source = tmp.join("source").join(SKILL_NAME);
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("SKILL.md"), "---\nname: maiknote-guide\n---\n").unwrap();

        let dest = tmp.join("home").join(".claude").join("skills").join(SKILL_NAME);
        fs::create_dir_all(dest.parent().unwrap()).unwrap();

        assert_eq!(inspect(&dest, &source).0, "missing");

        std::os::unix::fs::symlink(&source, &dest).unwrap();
        assert_eq!(inspect(&dest, &source).0, "linked");

        let other = tmp.join("other");
        fs::create_dir_all(&other).unwrap();
        fs::remove_file(&dest).unwrap();
        std::os::unix::fs::symlink(&other, &dest).unwrap();
        assert_eq!(inspect(&dest, &source).0, "foreign");

        fs::remove_file(&dest).unwrap();
        fs::create_dir_all(&dest).unwrap();
        assert_eq!(inspect(&dest, &source).0, "occupied");

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn target_defs_cover_all_clients() {
        let keys: Vec<String> = target_defs().into_iter().map(|(k, _, _)| k).collect();
        assert_eq!(keys, vec!["claude", "codex", "dsh", "gemini", "public"]);
        for (_, _, path) in target_defs() {
            assert!(path.ends_with(SKILL_NAME), "{} 应以 skill 名结尾", path.display());
        }
    }
}
