//! 密钥存取：AI Key / 百度搜索 Key 只放 macOS 钥匙串，不写 localStorage，也不写 iCloud 文件。
//!
//! 走系统自带的 security 命令，省掉额外的 crate 依赖；service 固定为 MaikNote，
//! account 由前端给定（只允许字母数字和 . - _）。

use std::process::Command;

const SERVICE: &str = "MaikNote";
const SECURITY: &str = "/usr/bin/security";

/// 账号名会直接进命令行参数，先限死字符集
fn account_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return Err("账号名不合法".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
    {
        return Err("账号名不合法".to_string());
    }
    Ok(trimmed.to_string())
}

fn run(args: &[&str]) -> Result<std::process::Output, String> {
    Command::new(SECURITY)
        .args(args)
        .output()
        .map_err(|e| format!("调用钥匙串失败: {e}"))
}

fn stderr_text(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stderr).trim().to_string()
}

/// 写入（已存在则更新）。value 为空等同于删除。
#[tauri::command]
pub fn secret_set(account: String, value: String) -> Result<(), String> {
    let account = account_name(&account)?;
    if value.is_empty() {
        return secret_delete(account);
    }
    let out = run(&[
        "add-generic-password",
        "-U",
        "-s",
        SERVICE,
        "-a",
        &account,
        "-w",
        &value,
    ])?;
    if !out.status.success() {
        return Err(format!("写入钥匙串失败: {}", stderr_text(&out)));
    }
    Ok(())
}

/// 读取；没有这条记录时返回 None，不当作错误
#[tauri::command]
pub fn secret_get(account: String) -> Result<Option<String>, String> {
    let account = account_name(&account)?;
    let out = run(&["find-generic-password", "-s", SERVICE, "-a", &account, "-w"])?;
    if !out.status.success() {
        // exit 44 = errSecItemNotFound；钥匙串锁着也算读不到，交给调用方回落
        return Ok(None);
    }
    let value = String::from_utf8_lossy(&out.stdout)
        .trim_end_matches(['\n', '\r'])
        .to_string();
    if value.is_empty() {
        Ok(None)
    } else {
        Ok(Some(value))
    }
}

/// 删除；不存在也算成功
#[tauri::command]
pub fn secret_delete(account: String) -> Result<(), String> {
    let account = account_name(&account)?;
    let out = run(&["delete-generic-password", "-s", SERVICE, "-a", &account])?;
    if out.status.success() {
        return Ok(());
    }
    let detail = stderr_text(&out);
    // 找不到这项是正常情况，其余错误如实报出
    if detail.contains("could not be found") || detail.contains("The specified item could not be found in the keychain") {
        return Ok(());
    }
    Err(format!("删除钥匙串项失败: {detail}"))
}
