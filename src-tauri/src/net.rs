//! 需要访问外网的命令都收在这里，走 Rust 侧发请求。
//!
//! 这样 capabilities 就不必给 webview 开任何 url 通配（插件 http 走 IPC，
//! 不受页面 CSP 限制，一旦开 `https://*` 就等于把出网能力交给渲染进程），
//! 同时外网目标由这里统一做 SSRF 检查。

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

/// 链接预览最多抓这么多字符，再多解析也只会更慢
const PAGE_MAX_CHARS: usize = 400_000;
/// 链接预览最多跟几次跳转
const PAGE_MAX_REDIRECTS: usize = 3;

fn cancels() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static CANCELS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    CANCELS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 解析主机名并逐条检查；literal IP 直接查
fn resolve_and_check(host: &str, port: u16, allowed: fn(IpAddr) -> bool) -> Result<(), String> {
    use std::net::ToSocketAddrs;

    if let Ok(ip) = host.parse::<IpAddr>() {
        return if allowed(ip) {
            Ok(())
        } else {
            Err(format!("拒绝访问该地址: {host}"))
        };
    }

    let addrs = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("域名解析失败: {e}"))?;
    let mut resolved = false;
    for addr in addrs {
        resolved = true;
        if !allowed(addr.ip()) {
            return Err(format!("拒绝访问该地址: {}", addr.ip()));
        }
    }
    if !resolved {
        return Err("域名没有解析结果".to_string());
    }
    Ok(())
}

/// 抓网页用的地址检查：只能是公网主机，内网、回环、链路本地一律拒
fn ensure_public_target(url: &reqwest::Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("只支持 http / https 地址".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "地址缺少主机名".to_string())?
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "地址端口不合法".to_string())?;
    resolve_and_check(&host, port, crate::is_public_ip)
}

/// AI 端点用的地址检查：允许内网和回环（自建 / 本机模型是正常用法），
/// 但云元数据地址（169.254.0.0/16、fe80::/10）和 0.0.0.0 这类还是拒掉
pub(crate) fn ensure_chat_target(url: &reqwest::Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("只支持 http / https 地址".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "地址缺少主机名".to_string())?
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "地址端口不合法".to_string())?;
    resolve_and_check(&host, port, is_chat_target_ip)
}

fn is_chat_target_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            !(v4.is_link_local() || v4.is_unspecified() || v4.is_multicast() || v4.octets()[0] == 0)
        }
        IpAddr::V6(v6) => {
            let seg = v6.segments();
            !(v6.is_unspecified()
                || v6.is_multicast()
                || (seg[0] & 0xffc0) == 0xfe80
                || (seg[0] & 0xfe00) == 0xfc00)
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEvent {
    Chunk { data: String },
    Done,
    Error { message: String },
}

/// 流式聊天补全：请求在 Rust 侧发，内容按 SSE 片段推回前端
#[tauri::command]
pub async fn ai_chat_stream(
    request_id: String,
    url: String,
    api_key: String,
    body: String,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|e| format!("地址不合法: {e}"))?;
    ensure_chat_target(&parsed)?;

    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = cancels().lock().map_err(|_| "内部状态异常".to_string())?;
        map.insert(request_id.clone(), flag.clone());
    }

    let result = stream_chat(&parsed, &api_key, &body, flag, &on_event).await;

    if let Ok(mut map) = cancels().lock() {
        map.remove(&request_id);
    }
    result
}

/// 取消一次流式请求（前端中断、组件卸载都走这里）
#[tauri::command]
pub fn ai_chat_cancel(request_id: String) -> Result<(), String> {
    if let Ok(map) = cancels().lock() {
        if let Some(flag) = map.get(&request_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}

async fn stream_chat(
    url: &reqwest::Url,
    api_key: &str,
    body: &str,
    cancelled: Arc<AtomicBool>,
    on_event: &Channel<StreamEvent>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        // 不跟随跳转：跳转目标不再经过上面的地址检查
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let mut request = client
        .post(url.clone())
        .header("Content-Type", "application/json");
    if !api_key.is_empty() {
        request = request.header("Authorization", format!("Bearer {api_key}"));
    }

    let mut response = request
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        let brief: String = text.chars().take(200).collect();
        let message = format!("API错误: {status} {brief}");
        let _ = on_event.send(StreamEvent::Error {
            message: message.clone(),
        });
        return Err(message);
    }

    // 字节流可能在任意位置切开一个多字节字符，所以留一段不完整的尾巴
    let mut pending: Vec<u8> = Vec::new();
    loop {
        if cancelled.load(Ordering::Relaxed) {
            break;
        }
        let chunk = response
            .chunk()
            .await
            .map_err(|e| format!("读取响应流失败: {e}"))?;
        let Some(bytes) = chunk else { break };

        pending.extend_from_slice(&bytes);
        let valid = match std::str::from_utf8(&pending) {
            Ok(_) => pending.len(),
            Err(e) => e.valid_up_to(),
        };
        if valid == 0 {
            continue;
        }
        let text = String::from_utf8_lossy(&pending[..valid]).to_string();
        pending.drain(..valid);
        if !text.is_empty() {
            let _ = on_event.send(StreamEvent::Chunk { data: text });
        }
    }

    if !pending.is_empty() {
        let text = String::from_utf8_lossy(&pending).to_string();
        let _ = on_event.send(StreamEvent::Chunk { data: text });
    }

    if !cancelled.load(Ordering::Relaxed) {
        let _ = on_event.send(StreamEvent::Done);
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageFetch {
    pub html: String,
    pub final_url: String,
}

/// 抓链接预览要用的 HTML：Rust 侧发请求 + 逐跳检查跳转目标
#[tauri::command]
pub async fn fetch_page_html(url: String, max_chars: Option<usize>) -> Result<PageFetch, String> {
    let limit = max_chars
        .unwrap_or(PAGE_MAX_CHARS)
        .clamp(1_000, PAGE_MAX_CHARS);

    let mut current = reqwest::Url::parse(url.trim()).map_err(|e| format!("地址不合法: {e}"))?;
    ensure_public_target(&current)?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    for _ in 0..=PAGE_MAX_REDIRECTS {
        let mut response = client
            .get(current.clone())
            .header("Accept", "text/html,application/xhtml+xml")
            .header("User-Agent", UA)
            .send()
            .await
            .map_err(|e| format!("请求失败: {e}"))?;

        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string);
            if let Some(location) = location {
                let next = current
                    .join(&location)
                    .map_err(|e| format!("跳转地址不合法: {e}"))?;
                ensure_public_target(&next)?;
                current = next;
                continue;
            }
        }

        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status().as_u16()));
        }

        let final_url = response.url().to_string();
        let mut html = String::new();
        while let Some(bytes) = response
            .chunk()
            .await
            .map_err(|e| format!("读取响应失败: {e}"))?
        {
            html.push_str(&String::from_utf8_lossy(&bytes));
            if html.chars().count() >= limit {
                break;
            }
        }

        return Ok(PageFetch {
            html: html.chars().take(limit).collect(),
            final_url,
        });
    }

    Err("跳转次数过多".to_string())
}
