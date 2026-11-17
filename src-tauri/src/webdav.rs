//! WebDAV 同步：把一个工作空间的整个文件夹镜像到 WebDAV 目录。
//!
//! 三条硬规矩：
//! 1. 只同步开启同步的空间；每个空间在远端有自己固定的目录（remoteDir），改空间名不动远端路径。
//! 2. 不产生冲突副本：两边都改过时看谁更晚（后上传/后保存的那份算数），晚的覆盖早的。
//! 3. 删除双向传播，但带熔断：一次要删的文件超过一半就整批跳过，免得「本地没挂载」把远端清空。
//!
//! 请求全部在 Rust 侧发（同 net.rs 的规矩），webview 不开任何 url 通配。

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::future::join_all;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::workspace::ensure_path_allowed;

const CONFIG_FILE: &str = "webdav.json";
const MANIFEST_DIR: &str = "webdav-manifests";
const MANIFEST_VERSION: u32 = 1;
/// 远端状态目录（同步清单放这儿，不跟笔记混在一起）
const STATE_DIR: &str = ".maiknote";
const MAX_FILES: usize = 20_000;
const MAX_DEPTH: usize = 16;
/// 远端目录最多列这么多个，防止远端目录挂错时一路爬下去
const MAX_REMOTE_DIRS: usize = 400;
/// 远端 PROPFIND / MKCOL 的并发上限：家用 NAS 也别开太高，多了反而互相拖慢
const REMOTE_CONCURRENCY: usize = 6;
/// 上传/下载单文件上限：笔记都是文本，超过这个量级基本是误选了大文件
const MAX_BYTES: u64 = 32 * 1024 * 1024;
// ============================================================
// 配置：<app_config>/webdav.json（密码走钥匙串，不落这个文件）
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebdavWorkspaceConfig {
    #[serde(default)]
    pub enabled: bool,
    /// 远端目录（相对服务器根），首次开启同步时定下来就不再自动改
    #[serde(default)]
    pub remote_dir: String,
    #[serde(default)]
    pub last_sync_at: u64,
    #[serde(default)]
    pub last_error: String,
}

impl Default for WebdavWorkspaceConfig {
    fn default() -> Self {
        Self { enabled: false, remote_dir: String::new(), last_sync_at: 0, last_error: String::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebdavConfig {
    #[serde(default = "config_version")]
    pub version: u32,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub username: String,
    /// 自签证书的 NAS 很常见，允许用户在设置里自己承担
    #[serde(default)]
    pub insecure_tls: bool,
    #[serde(default)]
    pub workspaces: BTreeMap<String, WebdavWorkspaceConfig>,
}

fn config_version() -> u32 {
    1
}

impl Default for WebdavConfig {
    fn default() -> Self {
        Self {
            version: 1,
            url: String::new(),
            username: String::new(),
            insecure_tls: false,
            workspaces: BTreeMap::new(),
        }
    }
}

fn app_config(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("拿不到配置目录: {e}"))
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_config(app)?.join(CONFIG_FILE))
}

fn manifest_path(app: &AppHandle, workspace_id: &str) -> Result<PathBuf, String> {
    let safe: String = workspace_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    Ok(app_config(app)?.join(MANIFEST_DIR).join(format!("{safe}.json")))
}

#[tauri::command]
pub fn read_webdav_config(app: AppHandle) -> Result<WebdavConfig, String> {
    let path = config_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(serde_json::from_str::<WebdavConfig>(&text).unwrap_or_default()),
        Err(_) => Ok(WebdavConfig::default()),
    }
}

#[tauri::command]
pub fn write_webdav_config(app: AppHandle, content: String) -> Result<(), String> {
    let parsed: WebdavConfig =
        serde_json::from_str(&content).map_err(|e| format!("同步配置格式不对: {e}"))?;
    let path = config_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("建配置目录失败: {e}"))?;
    }
    let text = serde_json::to_string_pretty(&parsed).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| format!("写配置失败: {e}"))
}

// ============================================================
// 同步请求 / 报告
// ============================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    pub workspace_id: String,
    pub content_root: String,
    #[serde(default)]
    pub meta_root: Option<String>,
    pub remote_dir: String,
    pub url: String,
    pub username: String,
    pub password: String,
    /// 只下不上的例外：正在编辑的笔记别让远端版本盖掉
    #[serde(default)]
    pub skip_download: Vec<String>,
    #[serde(default)]
    pub insecure_tls: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    /// 用户中途点了「停止同步」
    pub cancelled: bool,
    pub workspace_id: String,
    pub remote_dir: String,
    pub uploaded: u32,
    pub downloaded: u32,
    pub deleted: u32,
    pub skipped: u32,
    /// 索引文件（metadata.json 等）被远端更新了，前端要重读一遍索引
    pub meta_changed: bool,
    pub errors: Vec<String>,
    pub downloaded_files: Vec<String>,
    pub finished_at: u64,
}

/// 同步进度：前端拿它显示「同步中 3/12 · 笔记A.md」
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    pub workspace_id: String,
    /// scan 清点本地 / transfer 传文件 / manifest 写清单 / done 收工
    pub phase: String,
    pub done: u32,
    pub total: u32,
    pub detail: String,
}

// ============================================================
// 同步清单：记住每次同步后两边的状态，用来判断「谁改了」
// ============================================================

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestEntry {
    #[serde(default)]
    size: u64,
    #[serde(default)]
    mtime: u64,
    #[serde(default)]
    etag: String,
    #[serde(default)]
    remote_size: u64,
    #[serde(default)]
    remote_mtime: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    files: BTreeMap<String, ManifestEntry>,
    /// 本机删掉的文件（带时间戳），用来把删除推到远端而不是把文件又拉回来
    #[serde(default)]
    deleted: BTreeMap<String, u64>,
}

fn load_manifest(path: &Path) -> Option<Manifest> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str::<Manifest>(&text).ok()
}

fn save_manifest(path: &Path, manifest: &Manifest) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("建清单目录失败: {e}"))?;
    }
    let text = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| format!("写同步清单失败: {e}"))
}

// ============================================================
// WebDAV 客户端
// ============================================================

#[derive(Debug, Clone)]
struct DavEntry {
    rel: String,
    is_dir: bool,
    etag: String,
    size: u64,
    mtime: u64,
}

/// 一次 PUT 之后从服务端拿到的实际状态，清单收敛靠它
#[derive(Debug, Clone)]
struct PutMeta {
    etag: String,
    size: u64,
    /// 服务端 last-modified（秒），0 = 没拿到
    mtime: u64,
}

struct Dav {
    client: reqwest::Client,
    /// 规整过的根地址，一定以 / 结尾
    base: String,
    base_path: String,
    user: String,
    pass: String,
}

impl Dav {
    fn new(url: &str, user: &str, pass: &str, insecure_tls: bool) -> Result<Self, String> {
        let trimmed = url.trim();
        if trimmed.is_empty() {
            return Err("还没填 WebDAV 地址".to_string());
        }
        let parsed = reqwest::Url::parse(trimmed).map_err(|e| format!("地址不合法: {e}"))?;
        // 内网 / 回环放行（自建 NAS 是正常用法），云元数据地址仍然拒
        crate::net::ensure_chat_target(&parsed)?;
        let mut base = parsed.as_str().to_string();
        if !base.ends_with('/') {
            base.push('/');
        }
        let base_path = parsed.path().trim_end_matches('/').to_string();
        let client = reqwest::Client::builder()
            // 元数据请求（PROPFIND/MKCOL/DELETE）的默认总预算；大文件传输会单独放长
            .timeout(Duration::from_secs(120))
            .connect_timeout(Duration::from_secs(15))
            // 只要服务端还在一点点吐数据就不算超时，卡死 40 秒才判失败
            .read_timeout(Duration::from_secs(40))
            .user_agent("MaikNote-WebDAV/1.0")
            .danger_accept_invalid_certs(insecure_tls)
            .build()
            .map_err(|e| format!("初始化 HTTP 客户端失败: {e}"))?;
        Ok(Self { client, base, base_path, user: user.to_string(), pass: pass.to_string() })
    }

    /// 相对路径 → 绝对地址；dir=true 时补尾部斜杠（多数服务端靠它区分集合）
    fn url(&self, rel: &str, dir: bool) -> String {
        let mut out = self.base.clone();
        let mut segs: Vec<&str> = rel.split('/').filter(|s| !s.is_empty()).collect();
        if segs.is_empty() {
            return out;
        }
        let last = segs.pop();
        for seg in segs {
            out.push_str(&encode_segment(seg));
            out.push('/');
        }
        if let Some(last) = last {
            out.push_str(&encode_segment(last));
            if dir {
                out.push('/');
            }
        }
        out
    }

    async fn send(
        &self,
        method: &str,
        url: &str,
        depth: Option<&str>,
        body: Option<Vec<u8>>,
        content_type: Option<&str>,
    ) -> Result<reqwest::Response, String> {
        let method = reqwest::Method::from_bytes(method.as_bytes())
            .map_err(|_| format!("不支持的请求方法: {method}"))?;
        let mut rb = self
            .client
            .request(method, url)
            .basic_auth(&self.user, Some(&self.pass));
        if let Some(d) = depth {
            rb = rb.header("Depth", d);
        }
        if let Some(ct) = content_type {
            rb = rb.header("Content-Type", ct);
        }
        if let Some(b) = body {
            rb = rb.body(b);
        }
        rb.send().await.map_err(|e| friendly_net_error(&e))
    }

    /// 大流量请求（GET/PUT）用独立预算：慢速链路下靠 read_timeout 兜底，不设总上限
    async fn send_long(&self, method: &str, url: &str, body: Option<Vec<u8>>, ct: Option<&str>) -> Result<reqwest::Response, String> {
        let method = reqwest::Method::from_bytes(method.as_bytes())
            .map_err(|_| format!("不支持的请求方法: {method}"))?;
        let mut rb = self
            .client
            .request(method, url)
            .timeout(Duration::from_secs(3600))
            .basic_auth(&self.user, Some(&self.pass));
        if let Some(ct) = ct {
            rb = rb.header("Content-Type", ct);
        }
        if let Some(b) = body {
            rb = rb.body(b);
        }
        rb.send().await.map_err(|e| friendly_net_error(&e))
    }

    async fn propfind(&self, rel: &str, depth: &str) -> Result<Vec<DavEntry>, String> {
        const BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop>
<d:resourcetype/><d:getetag/><d:getcontentlength/><d:getlastmodified/>
</d:prop></d:propfind>"#;
        let url = self.url(rel, true);
        let resp = self
            .send("PROPFIND", &url, Some(depth), Some(BODY.as_bytes().to_vec()), Some("application/xml; charset=utf-8"))
            .await?;
        let status = resp.status();
        if !status.is_success() {
            return Err(friendly_status(status));
        }
        let text = resp.text().await.map_err(|e| format!("读响应失败: {e}"))?;
        Ok(parse_multistatus(&text, &self.base_path))
    }

    async fn mkcol(&self, rel: &str) -> Result<(), String> {
        let url = self.url(rel, true);
        let resp = self.send("MKCOL", &url, None, None, None).await?;
        let status = resp.status();
        if status.is_success() || status.as_u16() == 405 {
            // 405 = 已经在了，正常
            return Ok(());
        }
        // 两台设备同时建同一个目录时，有的服务端会甩 500（EEXIST）：复查一下是不是已经在了
        if let Ok(entries) = self.propfind(rel, "0").await {
            if entries.iter().any(|e| e.is_dir) {
                return Ok(());
            }
        }
        Err(friendly_status(status))
    }

    /// 逐级建目录：A/B/C 会先建 A、再 A/B、再 A/B/C
    async fn ensure_dir_chain(&self, rel: &str) -> Result<(), String> {
        let mut acc = String::new();
        for seg in rel.split('/').filter(|s| !s.is_empty()) {
            if !acc.is_empty() {
                acc.push('/');
            }
            acc.push_str(seg);
            self.mkcol(&acc).await?;
        }
        Ok(())
    }

    /// 只建远端还缺的目录：existing 是上一步真正列出来的远端目录集合，差集之外一个请求都不发。
    /// 老写法每轮把所有目录重发一遍 MKCOL，靠服务端回 405 才知道目录已经有了，目录越多越慢。
    /// 按层建：父目录必须先存在，同一层并发。返回建失败的清单交给调用方记 error。
    async fn ensure_dirs_missing(
        &self,
        wanted: impl Iterator<Item = String>,
        existing: &BTreeSet<String>,
    ) -> Vec<String> {
        let mut missing: BTreeSet<String> = BTreeSet::new();
        for rel in wanted {
            for p in prefix_paths(&rel) {
                if !existing.contains(&p) {
                    missing.insert(p);
                }
            }
        }
        if missing.is_empty() {
            return Vec::new();
        }
        let mut layers: BTreeMap<usize, Vec<String>> = BTreeMap::new();
        for p in missing {
            layers.entry(p.matches('/').count()).or_default().push(p);
        }
        let mut errors: Vec<String> = Vec::new();
        for layer in layers.into_values() {
            for chunk in layer.chunks(REMOTE_CONCURRENCY) {
                let batch = chunk.iter().map(|p| self.mkcol(p));
                for (path, got) in chunk.iter().zip(join_all(batch).await) {
                    if let Err(e) = got {
                        errors.push(format!("建远端目录 {path} 失败：{e}"));
                    }
                }
            }
        }
        errors
    }

    /// 上传一份文件。返回服务端实际记下的状态，用来收敛下一轮清单。
    /// 有 ETag 就一趟 PUT 结束；没 ETag 才补一次 PROPFIND（原来无论有没有都要多问两趟）。
    async fn put(&self, rel: &str, body: Vec<u8>) -> Result<PutMeta, String> {
        let url = self.url(rel, false);
        let size = body.len() as u64;
        let resp = self
            .send_long("PUT", &url, Some(body), Some("application/octet-stream"))
            .await?;
        let status = resp.status();
        if !status.is_success() {
            return Err(friendly_status(status));
        }
        let etag = header_etag(&resp);
        let mtime = header_last_modified(&resp);
        if !etag.is_empty() {
            return Ok(PutMeta { etag, size, mtime });
        }
        // 服务端没回 ETag：补一次 PROPFIND，一次把 etag/size/mtime 都取回来
        match self.propfind(rel, "0").await {
            Ok(entries) => {
                if let Some(e) = entries.into_iter().find(|e| !e.is_dir) {
                    Ok(PutMeta {
                        etag: e.etag,
                        size: if e.size > 0 { e.size } else { size },
                        mtime: if mtime > 0 { mtime } else { e.mtime },
                    })
                } else {
                    Ok(PutMeta { etag: String::new(), size, mtime })
                }
            }
            Err(_) => Ok(PutMeta { etag: String::new(), size, mtime }),
        }
    }

    async fn get(&self, rel: &str) -> Result<Vec<u8>, String> {
        let url = self.url(rel, false);
        let mut last = String::new();
        // 慢链路 + 偶发断流：同一次同步里最多试 3 遍，别因为一次抖动就把文件判失败
        for _attempt in 1..=3 {
            match self.send_long("GET", &url, None, None).await {
                Ok(resp) => {
                    let status = resp.status();
                    if !status.is_success() {
                        return Err(friendly_status(status));
                    }
                    match resp.bytes().await {
                        Ok(bytes) => return Ok(bytes.to_vec()),
                        Err(e) => last = format!("下载失败: {e}"),
                    }
                }
                Err(e) => last = e,
            }
        }
        Err(last)
    }

    /// 按 Range 分片下载：单块失败只重试这一块，慢链路也能一块块啃下来
    async fn get_sized(&self, rel: &str, size: u64) -> Result<Vec<u8>, String> {
        if size == 0 {
            return self.get(rel).await;
        }
        const CHUNK: u64 = 256 * 1024;
        let url = self.url(rel, false);
        let mut out: Vec<u8> = Vec::with_capacity(size as usize);
        while (out.len() as u64) < size {
            if cancel_requested() {
                return Err("已手动停止同步".to_string());
            }
            let start = out.len() as u64;
            let end = (start + CHUNK - 1).min(size - 1);
            let mut last = String::new();
            let mut progressed = false;
            for _attempt in 1..=3 {
                let rb = self
                    .client
                    .request(reqwest::Method::GET, &url)
                    .timeout(Duration::from_secs(3600))
                    .basic_auth(&self.user, Some(&self.pass))
                    .header("Range", format!("bytes={start}-{end}"));
                let resp = match rb.send().await {
                    Ok(r) => r,
                    Err(e) => {
                        last = friendly_net_error(&e);
                        continue;
                    }
                };
                let status = resp.status();
                if status.is_success() && status.as_u16() != 206 {
                    // 服务端不支持 Range，直接给了整份
                    return match resp.bytes().await {
                        Ok(b) => Ok(b.to_vec()),
                        Err(e) => Err(format!("下载失败: {e}")),
                    };
                }
                if !status.is_success() {
                    return Err(friendly_status(status));
                }
                match resp.bytes().await {
                    Ok(b) if !b.is_empty() => {
                        out.extend_from_slice(&b);
                        progressed = true;
                        break;
                    }
                    Ok(_) => last = "服务器返回了空数据".to_string(),
                    Err(e) => last = format!("下载失败: {e}"),
                }
            }
            if !progressed {
                return Err(if last.is_empty() { "下载失败".to_string() } else { last });
            }
        }
        out.truncate(size as usize);
        Ok(out)
    }

    async fn delete(&self, rel: &str) -> Result<(), String> {
        let url = self.url(rel, false);
        let resp = self.send("DELETE", &url, None, None, None).await?;
        let status = resp.status();
        if status.is_success() || status.as_u16() == 404 {
            return Ok(());
        }
        Err(friendly_status(status))
    }

    /// 拉一棵远端子树：返回（文件表, 已经存在的目录集合）。
    /// 按层推进，同层目录并发发 PROPFIND —— 老写法一个目录一次往返，目录一多就是几十秒。
    /// 目录集合给调用方做差集，好跳过「远端明明有了还去 MKCOL」的往返。
    async fn list_tree(
        &self,
        rel: &str,
    ) -> Result<(BTreeMap<String, DavEntry>, BTreeSet<String>), String> {
        let mut files: BTreeMap<String, DavEntry> = BTreeMap::new();
        let mut dirs: BTreeSet<String> = BTreeSet::new();
        let mut level: Vec<String> = vec![rel.to_string()];
        let mut visited = 0usize;
        while !level.is_empty() {
            visited += level.len();
            if visited > MAX_REMOTE_DIRS {
                break;
            }
            let mut next: Vec<String> = Vec::new();
            for chunk in level.chunks(REMOTE_CONCURRENCY) {
                let batch = chunk.iter().map(|dir| self.propfind(dir, "1"));
                for (dir, got) in chunk.iter().zip(join_all(batch).await) {
                    for entry in got? {
                        if &entry.rel == dir {
                            continue;
                        }
                        // 状态目录（清单/索引）不算笔记，也不往里走；
                        // 但目录本身记下来，省得每轮再发一次 MKCOL 去问「你在不在」
                        let state_mark = format!("/{STATE_DIR}");
                        if entry.rel == STATE_DIR
                            || entry.rel.starts_with(&format!("{STATE_DIR}/"))
                            || entry.rel.ends_with(&state_mark)
                            || entry.rel.contains(&format!("{state_mark}/"))
                        {
                            if entry.is_dir && entry.rel.ends_with(&state_mark) {
                                dirs.insert(entry.rel.clone());
                            }
                            continue;
                        }
                        if entry.is_dir {
                            if dirs.insert(entry.rel.clone()) {
                                next.push(entry.rel.clone());
                            }
                        } else {
                            files.insert(entry.rel.clone(), entry);
                        }
                    }
                }
            }
            level = next;
        }
        Ok((files, dirs))
    }

    /// 只要文件表的老接口（强制上传/下载和测试还在用）
    async fn list_files(&self, rel: &str) -> Result<BTreeMap<String, DavEntry>, String> {
        Ok(self.list_tree(rel).await?.0)
    }
}

fn header_etag(resp: &reqwest::Response) -> String {
    resp.headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(normalize_etag)
        .unwrap_or_default()
}

/// PUT 响应里的 Last-Modified → epoch 秒；拿不到就是 0
fn header_last_modified(resp: &reqwest::Response) -> u64 {
    resp.headers()
        .get(reqwest::header::LAST_MODIFIED)
        .and_then(|v| v.to_str().ok())
        .and_then(parse_http_date)
        .unwrap_or(0)
}

/// 把 A/B/C 拆成 ["A", "A/B", "A/B/C"]，给目录去重用
fn prefix_paths(rel: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut acc = String::new();
    for seg in rel.split('/').filter(|s| !s.is_empty()) {
        if !acc.is_empty() {
            acc.push('/');
        }
        acc.push_str(seg);
        out.push(acc.clone());
    }
    out
}

fn normalize_etag(raw: &str) -> String {
    raw.trim()
        .trim_start_matches("W/")
        .trim_matches('"')
        .to_string()
}

fn friendly_net_error(err: &reqwest::Error) -> String {
    let text = err.to_string();
    if err.is_timeout() {
        return "服务器响应超时：连接卡住 40 秒没动静（链路太慢或被限速）".to_string();
    }
    if err.is_connect() {
        return format!("连不上服务器：{text}");
    }
    format!("请求失败：{text}")
}

fn friendly_status(status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        401 => "服务器不认这个账号密码（401）".to_string(),
        403 => "服务器拒绝访问（403），检查目录权限".to_string(),
        404 => "远端目录不存在（404）".to_string(),
        405 => "服务器不允许这个操作（405），可能不是 WebDAV 地址".to_string(),
        409 => "远端上级目录还没建（409）".to_string(),
        423 => "远端文件被锁住了（423）".to_string(),
        507 => "服务器空间不足（507）".to_string(),
        other => format!("服务器返回 {other}"),
    }
}

// ============================================================
// XML / 编码 / 时间 的小工具
// ============================================================

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// 路径段编码：只留 unreserved 走原样，其余（中文、空格、# ? 等）一律 %XX
fn encode_segment(seg: &str) -> String {
    let mut out = String::with_capacity(seg.len());
    for byte in seg.as_bytes() {
        let c = *byte as char;
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~' | '!' | '$' | '&' | '\'' | '(' | ')' | '*' | '+' | ',' | ';' | '=' | ':' | '@') {
            out.push(c);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn decode_entities(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

/// 从 multistatus 里捞出每个 response 的 href / 是否集合 / etag / 大小 / 修改时间
fn parse_multistatus(body: &str, base_path: &str) -> Vec<DavEntry> {
    let mut out = Vec::new();
    let lower = body.to_ascii_lowercase();
    let mut cursor = 0usize;
    while let Some(open) = find_tag(&lower, "response", cursor) {
        let end = match find_close_tag(&lower, "response", open) {
            Some(e) => e,
            None => break,
        };
        let block = &body[open..end];
        cursor = end;
        let href = match tag_text(block, "href") {
            Some(h) => decode_entities(&percent_decode(h.trim())),
            None => continue,
        };
        let rel = rel_from_href(&href, base_path);
        let is_dir = block.to_ascii_lowercase().contains("collection");
        let etag = tag_text(block, "getetag").map(|e| normalize_etag(&e)).unwrap_or_default();
        let size = tag_text(block, "getcontentlength")
            .and_then(|s| s.trim().parse::<u64>().ok())
            .unwrap_or(0);
        let mtime = tag_text(block, "getlastmodified")
            .and_then(|s| parse_http_date(&s))
            .unwrap_or(0);
        out.push(DavEntry { rel, is_dir, etag, size, mtime });
    }
    out
}

/// 找到 <ns:tag ...> 里 tag 名字的起始位置（容忍 d: / D: / lp1: 这类命名空间前缀）
fn find_tag(lower: &str, tag: &str, from: usize) -> Option<usize> {
    let mut idx = from;
    while let Some(pos) = lower[idx..].find('<') {
        let at = idx + pos;
        let rest = &lower[at + 1..];
        let name_start = ns_prefix_len(rest);
        if rest[name_start..].starts_with(tag) {
            let after = rest[name_start + tag.len()..].chars().next();
            if matches!(after, Some('>') | Some(' ') | Some('\t') | Some('\r') | Some('\n') | Some('/')) {
                return Some(at + 1 + name_start);
            }
        }
        idx = at + 1;
    }
    None
}

/// 找到 </ns:tag> 并返回标签名之后的偏移
fn find_close_tag(lower: &str, tag: &str, from: usize) -> Option<usize> {
    let mut idx = from;
    while let Some(pos) = lower[idx..].find("</") {
        let at = idx + pos;
        let rest = &lower[at + 2..];
        let name_start = ns_prefix_len(rest);
        if rest[name_start..].starts_with(tag) {
            let after = rest[name_start + tag.len()..].chars().next();
            if matches!(after, Some('>') | Some(' ') | Some('\t') | Some('\r') | Some('\n')) {
                return Some(at + 2 + name_start + tag.len());
            }
        }
        idx = at + 2;
    }
    None
}

/// "d:href" 里那种命名空间前缀的长度（"d:" → 2，没有前缀 → 0）
fn ns_prefix_len(text: &str) -> usize {
    match text.find(':') {
        Some(colon)
            if colon > 0
                && colon <= 16
                && text[..colon]
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.')) =>
        {
            colon + 1
        }
        _ => 0,
    }
}

/// 取 <xxx:tag>值</xxx:tag> 里的值（忽略命名空间前缀）
fn tag_text(block: &str, tag: &str) -> Option<String> {
    let lower = block.to_ascii_lowercase();
    let open = find_tag(&lower, tag, 0)?;
    let gt = lower[open..].find('>')? + open;
    if lower[open..gt].ends_with('/') {
        return None;
    }
    let close_from = gt + 1;
    let close = find_close_tag(&lower, tag, close_from)?;
    let close_start = lower[close_from..close].rfind('<').map(|p| p + close_from)?;
    Some(decode_entities(block[gt + 1..close_start].trim()))
}

/// href 形如 https://host/dav/files/u/MaikNote/%E5%B7%A5/note.md → 相对 base 的路径
fn rel_from_href(href: &str, base_path: &str) -> String {
    let mut path = href.to_string();
    if let Some(rest) = path.strip_prefix("http://") {
        path = rest.splitn(2, '/').nth(1).unwrap_or("").to_string();
        path.insert(0, '/');
    } else if let Some(rest) = path.strip_prefix("https://") {
        path = rest.splitn(2, '/').nth(1).unwrap_or("").to_string();
        path.insert(0, '/');
    }
    let base = base_path.trim_end_matches('/');
    let rel = if base.is_empty() {
        path.as_str()
    } else if let Some(rest) = path.strip_prefix(base) {
        rest
    } else {
        path.as_str()
    };
    rel.trim_matches('/').to_string()
}

/// HTTP 日期 → epoch 秒（只认 RFC1123，够用了）
fn parse_http_date(value: &str) -> Option<u64> {
    let parts: Vec<&str> = value.split_whitespace().collect();
    if parts.len() < 5 {
        return None;
    }
    let day: i64 = parts[1].parse().ok()?;
    let month = match parts[2] {
        "Jan" => 1,
        "Feb" => 2,
        "Mar" => 3,
        "Apr" => 4,
        "May" => 5,
        "Jun" => 6,
        "Jul" => 7,
        "Aug" => 8,
        "Sep" => 9,
        "Oct" => 10,
        "Nov" => 11,
        "Dec" => 12,
        _ => return None,
    };
    let year: i64 = parts[3].parse().ok()?;
    let mut hms = parts[4].split(':');
    let hour: i64 = hms.next()?.parse().ok()?;
    let minute: i64 = hms.next()?.parse().ok()?;
    let second: i64 = hms.next()?.parse().ok()?;
    let days = days_from_civil(year, month, day);
    Some((days * 86_400 + hour * 3_600 + minute * 60 + second).max(0) as u64)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn now_epoch() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// 本地修改时间，毫秒：只精确到秒的话，同一秒内改两次（长度又恰好一样）会被当成没动过
fn mtime_of(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 远端的修改时间只到秒，跟本地毫秒值比较前先对齐
fn secs_of_ms(ms: u64) -> u64 {
    ms / 1000
}

/// 本地时间的「2026-11-17 1530」：备份目录名用它
#[cfg(target_os = "macos")]
fn format_stamp(epoch: u64) -> String {
    unsafe {
        let time: libc::time_t = epoch as libc::time_t;
        let mut tm: libc::tm = std::mem::zeroed();
        if libc::localtime_r(&time, &mut tm).is_null() {
            return format_stamp_utc(epoch);
        }
        format!(
            "{:04}-{:02}-{:02} {:02}{:02}",
            tm.tm_year + 1900,
            tm.tm_mon + 1,
            tm.tm_mday,
            tm.tm_hour,
            tm.tm_min
        )
    }
}

#[cfg(not(target_os = "macos"))]
fn format_stamp(epoch: u64) -> String {
    format_stamp_utc(epoch)
}

fn format_stamp_utc(epoch: u64) -> String {
    let days = (epoch / 86_400) as i64;
    let secs = epoch % 86_400;
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02} {:02}{:02}", secs / 3_600, (secs % 3_600) / 60)
}

// ============================================================
// 本地快照
// ============================================================

#[derive(Debug, Clone)]
struct LocalFile {
    path: PathBuf,
    size: u64,
    mtime: u64,
}

#[derive(Debug, Default)]
struct LocalSnapshot {
    /// key = "c/相对路径" 或 "m/文件名"
    files: BTreeMap<String, LocalFile>,
    /// 需要建出来的相对目录（内容目录那一侧）
    dirs: BTreeSet<String>,
}

fn walk_content(root: &Path) -> Result<LocalSnapshot, String> {
    let mut snap = LocalSnapshot::default();
    let mut stack: Vec<(PathBuf, String, usize)> = vec![(root.to_path_buf(), String::new(), 0)];
    while let Some((dir, rel, depth)) = stack.pop() {
        let read = match fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for entry in read.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "node_modules" {
                continue;
            }
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if file_type.is_symlink() {
                continue;
            }
            let child_rel = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            let path = entry.path();
            if file_type.is_dir() {
                if depth + 1 > MAX_DEPTH {
                    continue;
                }
                snap.dirs.insert(child_rel.clone());
                stack.push((path, child_rel, depth + 1));
            } else if file_type.is_file() {
                if snap.files.len() >= MAX_FILES {
                    continue;
                }
                let meta = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                if meta.len() > MAX_BYTES {
                    continue;
                }
                snap.files.insert(
                    format!("c/{child_rel}"),
                    LocalFile { path, size: meta.len(), mtime: mtime_of(&meta) },
                );
            }
        }
    }
    Ok(snap)
}

/// 索引目录（自定义空间的 metadata.json / directories.json / assistants.json）：
/// 只镜像这些 json，别的文件不进同步
fn walk_meta(root: &Path) -> Result<LocalSnapshot, String> {
    let mut snap = LocalSnapshot::default();
    let read = match fs::read_dir(root) {
        Ok(r) => r,
        Err(_) => return Ok(snap),
    };
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || !name.ends_with(".json") {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if !file_type.is_file() {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        snap.files.insert(
            format!("m/{name}"),
            LocalFile { path: entry.path(), size: meta.len(), mtime: mtime_of(&meta) },
        );
    }
    Ok(snap)
}

fn split_key(key: &str) -> (&str, &str) {
    match key.split_once('/') {
        Some((kind, rel)) => (kind, rel),
        None => ("c", key),
    }
}

/// 规整远端目录：去掉首尾斜杠，拒掉 . / .. 这类爬父目录的段
fn normalize_remote_dir(input: &str) -> Result<String, String> {
    let trimmed = input.trim().trim_matches('/');
    if trimmed.is_empty() {
        return Err("远端目录不能为空".to_string());
    }
    let mut segs: Vec<&str> = Vec::new();
    for seg in trimmed.split('/') {
        let seg = seg.trim();
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            return Err("远端目录不能包含 ..".to_string());
        }
        segs.push(seg);
    }
    if segs.is_empty() {
        return Err("远端目录不能为空".to_string());
    }
    Ok(segs.join("/"))
}

/// 上传成功后记的清单条目：远端数值以服务端回报为准，拿不到再退回本地值
fn uploaded_entry(etag: String, size: u64, mtime: u64, remote: Option<(u64, u64, String)>) -> ManifestEntry {
    let (rsize, rmtime, retag) = match remote {
        Some((s, m, e)) => (s, m, if e.is_empty() { etag } else { e }),
        None => (size, secs_of_ms(mtime), etag),
    };
    ManifestEntry {
        size,
        mtime,
        etag: retag,
        remote_size: rsize,
        remote_mtime: rmtime,
    }
}

fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("建目录失败: {e}"))?;
    }
    let tmp = target.with_extension("mn-sync-tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("写临时文件失败: {e}"))?;
    fs::rename(&tmp, target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("落盘失败: {e}")
    })
}

// ============================================================
// 命令入口
// ============================================================

#[tauri::command]
pub async fn webdav_test(
    url: String,
    username: String,
    password: String,
    insecure_tls: bool,
) -> Result<String, String> {
    let dav = Dav::new(&url, &username, &password, insecure_tls)?;
    let entries = dav.propfind("", "1").await?;
    let dirs = entries.iter().filter(|e| e.is_dir).count();
    let files = entries.len().saturating_sub(dirs);
    Ok(format!("已连上：根目录有 {dirs} 个文件夹、{files} 个文件"))
}

// ---- 手动停止：一个进程只跑一路同步，用一个全局开关就够 ----
static CANCEL_REQUESTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn request_cancel() {
    CANCEL_REQUESTED.store(true, std::sync::atomic::Ordering::SeqCst);
}

fn cancel_requested() -> bool {
    CANCEL_REQUESTED.load(std::sync::atomic::Ordering::SeqCst)
}

fn clear_cancel() {
    CANCEL_REQUESTED.store(false, std::sync::atomic::Ordering::SeqCst);
}

/// 停止正在跑的同步：传输中的请求会自然结束，之后每个文件前都会检查这个开关
#[tauri::command]
pub fn webdav_cancel_sync() {
    request_cancel();
}

#[tauri::command]
pub async fn webdav_sync(app: AppHandle, req: SyncRequest) -> Result<SyncReport, String> {
    let content_root = ensure_path_allowed(&app, Path::new(&req.content_root))?;
    let meta_root = match req.meta_root.as_deref() {
        Some(p) if !p.trim().is_empty() => Some(ensure_path_allowed(&app, Path::new(p))?),
        _ => None,
    };
    // 目录索引跟内容同根时不单独算一份
    let meta_root = match meta_root {
        Some(p) if p != content_root => Some(p),
        _ => None,
    };
    let manifest_file = manifest_path(&app, &req.workspace_id)?;
    // 进度走事件推给界面：同步可能几十秒，光转圈看不出来在干嘛
    let window_owner = app.clone();
    let emit = move |progress: SyncProgress| {
        let _ = window_owner.emit("webdav://progress", progress);
    };
    sync_core(req, content_root, meta_root, manifest_file, &emit).await
}

/// 同步主体：路径闸和清单位置之外的部分全在这里，方便拿临时目录 + 本地 WebDAV 服务做端到端测试
/// 单个 key 对账的结果。网络/落盘在并发任务里做，共享状态回主线程串行合并。
#[derive(Default)]
struct KeyOutcome {
    key: String,
    del_remove: bool,
    del_insert: Option<u64>,
    entry: Option<ManifestEntry>,
    uploaded: u32,
    downloaded: u32,
    skipped: u32,
    meta_changed: bool,
    downloaded_file: Option<String>,
    errors: Vec<String>,
}

/// 一个 key 的完整对账：只读并发前的快照 + 网络/落盘，产出结果，不碰共享状态。
#[allow(clippy::too_many_arguments)]
async fn sync_one(
    dav: &Dav,
    key: String,
    root_rel: &str,
    content_root: &Path,
    meta_root: Option<&Path>,
    local_file: Option<LocalFile>,
    remote_entry: Option<DavEntry>,
    prev: Option<ManifestEntry>,
    was_deleted: bool,
    skip_download: bool,
) -> KeyOutcome {
    let mut out = KeyOutcome { key: key.clone(), ..Default::default() };
    let (kind, rel) = split_key(&key);
    let (kind, rel) = (kind.to_string(), rel.to_string());
    let remote_rel = remote_rel_of(root_rel, &key);

    match (local_file, remote_entry) {
        // 只在本地：传上去
        (Some(lf), None) => {
            out.del_remove = true;
            let bytes = match fs::read(&lf.path) {
                Ok(b) => b,
                Err(e) => {
                    out.errors.push(format!("读不到 {rel}：{e}"));
                    return out;
                }
            };
            match dav.put(&remote_rel, bytes).await {
                Ok(meta) => {
                    out.uploaded = 1;
                    let r = if meta.mtime > 0 {
                        Some((meta.size, meta.mtime, meta.etag.clone()))
                    } else { None };
                    out.entry = Some(uploaded_entry(meta.etag, lf.size, lf.mtime, r));
                }
                Err(e) => out.errors.push(format!("上传 {rel} 失败：{e}")),
            }
        }
        // 只在远端
        (None, Some(re)) => {
            if was_deleted {
                // 本机删过，远端还有 → 一并删掉
                if let Err(e) = dav.delete(&remote_rel).await {
                    out.errors.push(format!("删远端 {rel} 失败：{e}"));
                }
                return out;
            }
            if prev.is_some() && kind == "c" {
                // 清单里登记过、本地却没了 → 按「本地删除」处理（已在第 4 步统一删）
                out.del_insert = Some(now_epoch());
                return out;
            }
            if skip_download {
                out.skipped = 1;
                if let Some(p) = prev {
                    out.entry = Some(p);
                }
                return out;
            }
            let target = local_target(content_root, meta_root, &key);
            match dav.get_sized(&remote_rel, re.size).await {
                Ok(bytes) => {
                    if let Err(e) = write_atomic(&target, &bytes) {
                        out.errors.push(format!("落盘 {rel} 失败：{e}"));
                        return out;
                    }
                    out.downloaded = 1;
                    if kind == "m" { out.meta_changed = true; }
                    if kind == "c" { out.downloaded_file = Some(rel.clone()); }
                    let meta = fs::metadata(&target).ok();
                    out.entry = Some(ManifestEntry {
                        size: meta.as_ref().map(|m| m.len()).unwrap_or(bytes.len() as u64),
                        mtime: meta.as_ref().map(mtime_of).unwrap_or_else(|| now_epoch() * 1000),
                        etag: re.etag.clone(),
                        remote_size: re.size,
                        remote_mtime: re.mtime,
                    });
                }
                Err(e) => out.errors.push(format!("下载 {rel} 失败：{e}")),
            }
        }
        // 两边都有
        (Some(lf), Some(re)) => {
            out.del_remove = true;
            // 头一回同步（清单里没有这一条）：按修改时间猜谁新
            if prev.is_none() {
                let remote_newer = re.mtime > secs_of_ms(lf.mtime) + 2;
                if remote_newer && !skip_download {
                    let target = local_target(content_root, meta_root, &key);
                    match dav.get_sized(&remote_rel, re.size).await {
                        Ok(bytes) => {
                            if let Err(e) = write_atomic(&target, &bytes) {
                                out.errors.push(format!("落盘 {rel} 失败：{e}"));
                            } else {
                                out.downloaded = 1;
                                if kind == "m" { out.meta_changed = true; }
                                if kind == "c" { out.downloaded_file = Some(rel.clone()); }
                                let meta = fs::metadata(&target).ok();
                                out.entry = Some(ManifestEntry {
                                    size: meta.as_ref().map(|m| m.len()).unwrap_or(bytes.len() as u64),
                                    mtime: meta.as_ref().map(mtime_of).unwrap_or_else(|| now_epoch() * 1000),
                                    etag: re.etag.clone(),
                                    remote_size: re.size,
                                    remote_mtime: re.mtime,
                                });
                                return out;
                            }
                        }
                        Err(e) => out.errors.push(format!("下载 {rel} 失败：{e}")),
                    }
                }
                match fs::read(&lf.path) {
                    Ok(bytes) => match dav.put(&remote_rel, bytes).await {
                        Ok(meta) => {
                            out.uploaded = 1;
                            let r = if meta.mtime > 0 {
                                Some((meta.size, meta.mtime, meta.etag.clone()))
                            } else { None };
                            out.entry = Some(uploaded_entry(meta.etag, lf.size, lf.mtime, r));
                        }
                        Err(e) => out.errors.push(format!("上传 {rel} 失败：{e}")),
                    },
                    Err(e) => out.errors.push(format!("读不到 {rel}：{e}")),
                }
                return out;
            }

            let entry = prev.unwrap_or_default();
            let local_changed = entry.size != lf.size || entry.mtime != lf.mtime;
            let remote_changed = if !entry.etag.is_empty() && !re.etag.is_empty() {
                entry.etag != re.etag
            } else {
                entry.remote_size != re.size || entry.remote_mtime != re.mtime
            };

            // 元数据只是「可疑」，内容才是裁判：大小三方一致就直接比字节
            if (local_changed || remote_changed)
                && lf.size == re.size
                && lf.size == entry.size
                && lf.size > 0
            {
                if let Ok(remote_bytes) = dav.get_sized(&remote_rel, re.size).await {
                    if fs::read(&lf.path).map(|b| b == remote_bytes).unwrap_or(false) {
                        out.entry = Some(ManifestEntry {
                            size: lf.size,
                            mtime: lf.mtime,
                            etag: if re.etag.is_empty() { entry.etag.clone() } else { re.etag.clone() },
                            remote_size: re.size,
                            remote_mtime: re.mtime,
                        });
                        return out;
                    }
                }
            }

            if !local_changed && !remote_changed {
                out.entry = Some(ManifestEntry {
                    size: lf.size,
                    mtime: lf.mtime,
                    etag: re.etag.clone(),
                    remote_size: re.size,
                    remote_mtime: re.mtime,
                });
                return out;
            }

            // 只有远端改了：下下来（正在编辑的笔记除外）
            if !local_changed && remote_changed {
                if skip_download {
                    out.skipped = 1;
                    out.entry = Some(entry);
                    return out;
                }
                let target = local_target(content_root, meta_root, &key);
                match dav.get_sized(&remote_rel, re.size).await {
                    Ok(bytes) => {
                        if let Err(e) = write_atomic(&target, &bytes) {
                            out.errors.push(format!("落盘 {rel} 失败：{e}"));
                            out.entry = Some(entry);
                            return out;
                        }
                        out.downloaded = 1;
                        if kind == "m" { out.meta_changed = true; }
                        if kind == "c" { out.downloaded_file = Some(rel.clone()); }
                        let meta = fs::metadata(&target).ok();
                        out.entry = Some(ManifestEntry {
                            size: meta.as_ref().map(|m| m.len()).unwrap_or(bytes.len() as u64),
                            mtime: meta.as_ref().map(mtime_of).unwrap_or_else(|| now_epoch() * 1000),
                            etag: re.etag.clone(),
                            remote_size: re.size,
                            remote_mtime: re.mtime,
                        });
                    }
                    Err(e) => {
                        out.errors.push(format!("下载 {rel} 失败：{e}"));
                        out.entry = Some(entry);
                    }
                }
                return out;
            }

            // 两边都动过：不搞副本，只看谁更晚——后保存/后上传的那份算数，输的整份被覆盖
            if local_changed && remote_changed {
                // 远端更晚：拿远端盖掉本地（正在编辑的这份除外，留给下一轮上传）
                if re.mtime > secs_of_ms(lf.mtime) + 2 && !skip_download {
                    let target = local_target(content_root, meta_root, &key);
                    match dav.get_sized(&remote_rel, re.size).await {
                        Ok(bytes) => {
                            if let Err(e) = write_atomic(&target, &bytes) {
                                out.errors.push(format!("落盘 {rel} 失败：{e}"));
                                out.entry = Some(entry);
                                return out;
                            }
                            out.downloaded = 1;
                            if kind == "m" { out.meta_changed = true; }
                            if kind == "c" { out.downloaded_file = Some(rel.clone()); }
                            let meta = fs::metadata(&target).ok();
                            out.entry = Some(ManifestEntry {
                                size: meta.as_ref().map(|m| m.len()).unwrap_or(bytes.len() as u64),
                                mtime: meta.as_ref().map(mtime_of).unwrap_or_else(|| now_epoch() * 1000),
                                etag: re.etag.clone(),
                                remote_size: re.size,
                                remote_mtime: re.mtime,
                            });
                            return out;
                        }
                        Err(e) => {
                            out.errors.push(format!("下载 {rel} 失败：{e}"));
                            out.entry = Some(entry);
                            return out;
                        }
                    }
                }
                // 本地更晚（或正在编辑中）：落到下面统一的上传分支，直接覆盖远端
            }

            // 本地这份传上去（无论是本地单改还是两边都改里本地更晚）
            match fs::read(&lf.path) {
                Ok(bytes) => match dav.put(&remote_rel, bytes).await {
                    Ok(meta) => {
                        out.uploaded = 1;
                        let r = if meta.mtime > 0 {
                            Some((meta.size, meta.mtime, meta.etag.clone()))
                        } else { None };
                        out.entry = Some(uploaded_entry(meta.etag, lf.size, lf.mtime, r));
                    }
                    Err(e) => out.errors.push(format!("上传 {rel} 失败：{e}")),
                },
                Err(e) => out.errors.push(format!("读不到 {rel}：{e}")),
            }
        }
        (None, None) => {}
    }
    out
}

/// 远端现状：文件表 + 已经存在的目录集合（目录集合用来跳过重复 MKCOL）
struct RemoteTree {
    files: BTreeMap<String, DavEntry>,
    dirs: BTreeSet<String>,
}

/// 乐观地列一遍远端：根目录还不存在（首次同步）就先建出那条链再列。
/// 目录都在的常态下，这一段只有「列」没有「建」，省掉每轮固定几次 MKCOL 往返。
async fn fetch_remote(dav: &Dav, root_rel: &str) -> Result<RemoteTree, String> {
    let mut tree = match dav.list_tree(root_rel).await {
        Ok((files, dirs)) => RemoteTree { files, dirs },
        Err(_) => {
            dav.ensure_dir_chain(root_rel).await?;
            let (files, dirs) = dav.list_tree(root_rel).await?;
            RemoteTree { files, dirs }
        }
    };
    // 从 root_rel 往上每一级都算「远端已有」——list_tree 只从 root_rel 往下列，
    // 不补这一段，每轮都会对 MaikNote 这类祖先白发一次 MKCOL 才知道它早就在。
    for p in prefix_paths(root_rel) {
        tree.dirs.insert(p);
    }
    Ok(tree)
}

async fn sync_core(
    req: SyncRequest,
    content_root: PathBuf,
    meta_root: Option<PathBuf>,
    manifest_file: PathBuf,
    emit: &(dyn Fn(SyncProgress) + Sync),
) -> Result<SyncReport, String> {
    clear_cancel();
    let root_rel = normalize_remote_dir(&req.remote_dir)?;
    let dav = Dav::new(&req.url, &req.username, &req.password, req.insecure_tls)?;

    let mut report = SyncReport {
        workspace_id: req.workspace_id.clone(),
        remote_dir: root_rel.clone(),
        ..Default::default()
    };

    // ---- 1. 本地快照（纯本地磁盘，毫秒级）----
    emit(SyncProgress {
        workspace_id: req.workspace_id.clone(),
        phase: "scan".to_string(),
        done: 0,
        total: 0,
        detail: String::new(),
    });
    let mut local = walk_content(&content_root)?;
    if let Some(meta) = &meta_root {
        let meta_snap = walk_meta(meta)?;
        local.files.extend(meta_snap.files);
    }

    let mut manifest = load_manifest(&manifest_file).unwrap_or_default();

    // 本地一个文件都读不到、但清单里明明有：多半是路径失效或没权限，绝不能顺着「删远端」往下走
    if local.files.is_empty() && !manifest.files.is_empty() {
        return Err("本地空间里一个文件都没读到（路径失效或没有访问权限），这次同步不执行".to_string());
    }

    // ---- 2. 远端现状：列目录 + 只补建缺的目录 ----
    // 这一段全是网络往返（慢的根源就在这儿），跟「清点本地」不是一回事，所以单独报 remote 阶段
    emit(SyncProgress {
        workspace_id: req.workspace_id.clone(),
        phase: "remote".to_string(),
        done: 0,
        // 这一步拿不到可分的进度（并发列目录，谁先回来说不准），给 0 让进度条停在原地别乱跳
        total: 0,
        detail: String::new(),
    });
    let remote = fetch_remote(&dav, &root_rel).await?;
    let mut existing_dirs = remote.dirs;
    let remote_files = remote.files;

    // 探一次状态目录：探得到就说明 .maiknote 和 .maiknote/meta 都在，这轮一个 MKCOL 都不用发
    let mut meta_entries: Vec<DavEntry> = Vec::new();
    if meta_root.is_some() {
        if let Ok(entries) = dav.propfind(&format!("{root_rel}/{STATE_DIR}/meta"), "1").await {
            existing_dirs.insert(format!("{root_rel}/{STATE_DIR}"));
            existing_dirs.insert(format!("{root_rel}/{STATE_DIR}/meta"));
            meta_entries = entries;
        }
    }

    // 本地有、远端没有的目录才建；状态目录只放清单（有独立索引目录时再要 meta）
    let mut wanted: Vec<String> = local
        .dirs
        .iter()
        .map(|d| format!("{root_rel}/{d}"))
        .collect();
    wanted.push(format!("{root_rel}/{STATE_DIR}"));
    if meta_root.is_some() {
        wanted.push(format!("{root_rel}/{STATE_DIR}/meta"));
    }
    report.errors.extend(dav.ensure_dirs_missing(wanted.into_iter(), &existing_dirs).await);

    // ---- 3. 远端文件表 ----
    let mut remote_map: BTreeMap<String, DavEntry> = BTreeMap::new();
    let prefix = format!("{root_rel}/");
    for (rel, entry) in remote_files {
        if let Some(rest) = rel.strip_prefix(&prefix) {
            // 远端清单里那些 .maiknote 状态文件不算笔记
            if rest.starts_with(STATE_DIR) {
                continue;
            }
            remote_map.insert(format!("c/{rest}"), entry);
        }
    }
    let meta_prefix = format!("{STATE_DIR}/meta/");
    for entry in meta_entries {
        if entry.is_dir {
            continue;
        }
        if let Some(name) = entry.rel.strip_prefix(&format!("{root_rel}/{meta_prefix}")) {
            let name = name.trim_start_matches('/').to_string();
            if name.ends_with(".json") {
                remote_map.insert(format!("m/{name}"), entry);
            }
        }
    }

    // ---- 4. 删除熔断：一次要删太多就先不动 ----
    let mut pending_deletes: Vec<String> = Vec::new();
    for (key, _) in manifest.files.iter() {
        if local.files.contains_key(key) {
            continue;
        }
        if remote_map.contains_key(key) {
            pending_deletes.push(key.clone());
        }
    }
    let delete_budget_ok = pending_deletes.len() <= 3
        || (manifest.files.len() >= 10 && pending_deletes.len() * 2 <= manifest.files.len());
    if !delete_budget_ok {
        report.errors.push(format!(
            "有 {} 个文件在本地不见了，超过总数一半，这次没有删远端文件（确认无误后再同步一次）",
            pending_deletes.len()
        ));
        pending_deletes.clear();
    } else {
        for key in &pending_deletes {
            let rel = remote_rel_of(&root_rel, key);
            match dav.delete(&rel).await {
                Ok(()) => {
                    manifest.files.remove(key);
                    manifest.deleted.insert(key.clone(), now_epoch());
                    remote_map.remove(key);
                    report.deleted += 1;
                }
                Err(e) => {
                    report.errors.push(format!("删远端 {} 失败：{e}", split_key(key).1));
                }
            }
        }
    }

    // ---- 5. 逐文件对账（网络 I/O 分批并发，共享状态回主线程串行合并）----
    let mut keys: BTreeSet<String> = BTreeSet::new();
    keys.extend(local.files.keys().cloned());
    keys.extend(remote_map.keys().cloned());

    let mut next_entries: BTreeMap<String, ManifestEntry> = BTreeMap::new();
    let mut meta_changed = false;

    // 家用 NAS 并发别开太高：4 路已经能把高延迟链路的往返重叠起来
    const CONCURRENCY: usize = 4;
    let total_keys = keys.len() as u32;
    let mut done_keys: u32 = 0;
    let mut iter = keys.into_iter().peekable();
    while iter.peek().is_some() {
        if cancel_requested() {
            report.cancelled = true;
            report.errors.push("已手动停止同步".to_string());
            break;
        }
        let batch: Vec<String> = iter.by_ref().take(CONCURRENCY).collect();
        let futs: Vec<_> = batch
            .iter()
            .map(|key| {
                let (kind, rel) = split_key(key);
                let skip = kind == "c"
                    && req.skip_download.iter().any(|s| s.trim_start_matches('/') == rel);
                sync_one(
                    &dav,
                    key.clone(),
                    &root_rel,
                    &content_root,
                    meta_root.as_deref(),
                    local.files.get(key).cloned(),
                    remote_map.get(key).cloned(),
                    manifest.files.get(key).cloned(),
                    manifest.deleted.contains_key(key),
                    skip,
                )
            })
            .collect();
        let outcomes = join_all(futs).await;
        for outcome in outcomes {
            done_keys += 1;
            let (_, rel) = split_key(&outcome.key);
            if done_keys % 4 == 0 || done_keys == total_keys {
                emit(SyncProgress {
                    workspace_id: req.workspace_id.clone(),
                    phase: "transfer".to_string(),
                    done: done_keys,
                    total: total_keys,
                    detail: rel.to_string(),
                });
            }
            if outcome.del_remove {
                manifest.deleted.remove(&outcome.key);
            }
            if let Some(ts) = outcome.del_insert {
                manifest.deleted.insert(outcome.key.clone(), ts);
            }
            if let Some(e) = outcome.entry {
                next_entries.insert(outcome.key.clone(), e);
            }
            report.uploaded += outcome.uploaded;
            report.downloaded += outcome.downloaded;
            report.skipped += outcome.skipped;
            if outcome.meta_changed {
                meta_changed = true;
            }
            if let Some(f) = outcome.downloaded_file {
                report.downloaded_files.push(f);
            }
            report.errors.extend(outcome.errors);
        }
    }
    emit(SyncProgress {
        workspace_id: req.workspace_id.clone(),
        phase: "manifest".to_string(),
        done: total_keys,
        total: total_keys,
        detail: String::new(),
    });

    // ---- 6. 保存清单（本地一份、远端一份，换机器也能接着用） ----
    manifest.version = MANIFEST_VERSION;
    manifest.files = next_entries;
    if let Err(e) = save_manifest(&manifest_file, &manifest) {
        report.errors.push(e);
    }
    if let Ok(text) = serde_json::to_string_pretty(&manifest) {
        let remote_manifest = format!("{root_rel}/{STATE_DIR}/manifest.json");
        if let Err(e) = dav.put(&remote_manifest, text.into_bytes()).await {
            report.errors.push(format!("上传同步清单失败：{e}"));
        }
    }

    report.meta_changed = meta_changed;
    report.finished_at = now_epoch();
    emit(SyncProgress {
        workspace_id: req.workspace_id.clone(),
        phase: "done".to_string(),
        done: total_keys,
        total: total_keys,
        detail: String::new(),
    });
    Ok(report)
}

// ============================================================
// 强制三连：本地盖云端 / 云端盖本地 / 清空云端
// 普通同步是两边对账，这三个是「按我说的来」：不比对，全量动作
// ============================================================

#[tauri::command]
pub async fn webdav_force(
    app: AppHandle,
    req: SyncRequest,
    mode: String,
) -> Result<SyncReport, String> {
    let content_root = ensure_path_allowed(&app, Path::new(&req.content_root))?;
    let meta_root = match req.meta_root.as_deref() {
        Some(p) if !p.trim().is_empty() => Some(ensure_path_allowed(&app, Path::new(p))?),
        _ => None,
    };
    let meta_root = match meta_root {
        Some(p) if p != content_root => Some(p),
        _ => None,
    };
    let manifest_file = manifest_path(&app, &req.workspace_id)?;
    let window_owner = app.clone();
    let emit = move |progress: SyncProgress| {
        let _ = window_owner.emit("webdav://progress", progress);
    };
    force_core(req, content_root, meta_root, manifest_file, &mode, &emit).await
}

async fn force_core(
    req: SyncRequest,
    content_root: PathBuf,
    meta_root: Option<PathBuf>,
    manifest_file: PathBuf,
    mode: &str,
    emit: &(dyn Fn(SyncProgress) + Sync),
) -> Result<SyncReport, String> {
    // 上一轮点过「停止」的话开关会一直挂着：强制动作不看这个残留，否则点什么都是空转
    clear_cancel();
    let root_rel = normalize_remote_dir(&req.remote_dir)?;
    let dav = Dav::new(&req.url, &req.username, &req.password, req.insecure_tls)?;
    let mut report = SyncReport {
        workspace_id: req.workspace_id.clone(),
        remote_dir: root_rel.clone(),
        ..Default::default()
    };
    match mode {
        "push" => {
            force_push(&req, &dav, &root_rel, &content_root, meta_root.as_deref(), &manifest_file, &mut report, emit).await?
        }
        "pull" => {
            force_pull(&req, &dav, &root_rel, &content_root, meta_root.as_deref(), &manifest_file, &mut report, emit).await?
        }
        "wipe" => force_wipe(&req, &dav, &root_rel, &manifest_file, &mut report, emit).await?,
        other => return Err(format!("不认识的强制同步模式：{other}")),
    }
    report.finished_at = now_epoch();
    emit(SyncProgress {
        workspace_id: req.workspace_id.clone(),
        phase: "done".to_string(),
        done: 0,
        total: 0,
        detail: String::new(),
    });
    Ok(report)
}

fn force_phase(workspace_id: &str, phase: &str, done: u32, total: u32, detail: &str) -> SyncProgress {
    SyncProgress {
        workspace_id: workspace_id.to_string(),
        phase: phase.to_string(),
        done,
        total,
        detail: detail.to_string(),
    }
}

/// 一次要动的文件太多就收手：远端目录挂错时，别一下清掉半个空间
fn too_many_to_delete(count: usize, baseline: usize) -> bool {
    count > 3 && count * 2 > baseline
}

/// 覆盖/删除之前先把本地旧版本存一份，动作是可回退的
fn backup_into(backup_root: &Path, key: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let (kind, rel) = split_key(key);
    if rel.split('/').any(|seg| seg == "..") || rel.starts_with('/') {
        return Err(format!("拒绝备份可疑路径：{rel}"));
    }
    let target = backup_root.join(if kind == "m" { "meta" } else { "content" }).join(rel);
    write_atomic(&target, bytes)?;
    Ok(target)
}

/// 本地 → 云端：云端按本地镜像，远端多出来的删掉
#[allow(clippy::too_many_arguments)]
async fn force_push(
    req: &SyncRequest,
    dav: &Dav,
    root_rel: &str,
    content_root: &Path,
    meta_root: Option<&Path>,
    manifest_file: &Path,
    report: &mut SyncReport,
    emit: &(dyn Fn(SyncProgress) + Sync),
) -> Result<(), String> {
    emit(force_phase(&req.workspace_id, "scan", 0, 0, ""));
    let mut local = walk_content(content_root)?;
    if let Some(meta) = meta_root {
        local.files.extend(walk_meta(meta)?.files);
    }

    // 远端目录单独算一段：这里的时间全花在网络往返上，不是「清点本地」
    emit(force_phase(&req.workspace_id, "remote", 0, 0, ""));
    let remote = fetch_remote(dav, root_rel).await?;
    // 状态目录得先有（清单要 PUT 进去）；强制操作不常做，直接把那条链补一遍最稳
    dav.ensure_dir_chain(&format!("{root_rel}/{STATE_DIR}/meta")).await?;
    let wanted: Vec<String> = local.dirs.iter().map(|d| format!("{root_rel}/{d}")).collect();
    report.errors.extend(dav.ensure_dirs_missing(wanted.into_iter(), &remote.dirs).await);

    let total = local.files.len() as u32;
    let mut done = 0u32;
    let mut next: BTreeMap<String, ManifestEntry> = BTreeMap::new();
    for (key, lf) in local.files.iter() {
        if cancel_requested() {
            report.cancelled = true;
            report.errors.push("已手动停止同步".to_string());
            break;
        }
        let (_, rel) = split_key(key);
        done += 1;
        emit(force_phase(&req.workspace_id, "transfer", done, total, rel));
        if lf.size > MAX_BYTES {
            report.skipped += 1;
            continue;
        }
        let remote_rel = remote_rel_of(root_rel, key);
        match fs::read(&lf.path) {
            Ok(bytes) => match dav.put(&remote_rel, bytes).await {
                Ok(pm) => {
                    report.uploaded += 1;
                    let st = if pm.mtime > 0 {
                        Some((pm.size, pm.mtime, pm.etag.clone()))
                    } else {
                        None
                    };
                    next.insert(key.clone(), uploaded_entry(pm.etag, lf.size, lf.mtime, st));
                }
                Err(e) => report.errors.push(format!("上传 {rel} 失败：{e}")),
            },
            Err(e) => report.errors.push(format!("读不到 {rel}：{e}")),
        }
    }

    // 云端多出来的（本地没有的）清掉，才算镜像。
    // 直接用开头那次列表的结果：这轮刚传上去的文件都在 local.files 里，不会被误判成「多余」，
    // 再列一遍纯属多一次全量往返。
    let mut extra: Vec<String> = Vec::new();
    let prefix = format!("{root_rel}/");
    for rel in remote.files.into_keys() {
        if let Some(rest) = rel.strip_prefix(&prefix) {
            if !local.files.contains_key(&format!("c/{rest}")) {
                extra.push(rel);
            }
        }
    }
    if too_many_to_delete(extra.len(), local.files.len().max(extra.len())) {
        report.errors.push(format!(
            "云端有 {} 个本地没有的文件，数量太反常，这次没有删除它们；先用普通同步确认远端目录挂对了再试",
            extra.len()
        ));
    } else {
        for rel in extra {
            match dav.delete(&rel).await {
                Ok(()) => report.deleted += 1,
                Err(e) => report.errors.push(format!("删除远端 {rel} 失败：{e}")),
            }
        }
    }

    // 索引文件同样按本地镜像
    if meta_root.is_some() {
        if let Ok(entries) = dav.propfind(&format!("{root_rel}/{STATE_DIR}/meta"), "1").await {
            let meta_prefix = format!("{STATE_DIR}/meta/");
            for entry in entries {
                if entry.is_dir {
                    continue;
                }
                let name = entry.rel.trim_start_matches(&format!("{root_rel}/")).to_string();
                if let Some(name) = name.strip_prefix(&meta_prefix) {
                    if !local.files.contains_key(&format!("m/{name}")) {
                        let _ = dav.delete(&entry.rel).await;
                        report.deleted += 1;
                    }
                }
            }
        }
    }

    let manifest = Manifest {
        version: MANIFEST_VERSION,
        files: next,
        deleted: BTreeMap::new(),
    };
    save_manifest(manifest_file, &manifest)?;
    if let Ok(text) = serde_json::to_string_pretty(&manifest) {
        let remote_manifest = format!("{root_rel}/{STATE_DIR}/manifest.json");
        if let Err(e) = dav.put(&remote_manifest, text.into_bytes()).await {
            report.errors.push(format!("上传同步清单失败：{e}"));
        }
    }
    Ok(())
}

/// 云端 → 本地：本地按云端镜像，本地多出来的先备份再删
#[allow(clippy::too_many_arguments)]
async fn force_pull(
    req: &SyncRequest,
    dav: &Dav,
    root_rel: &str,
    content_root: &Path,
    meta_root: Option<&Path>,
    manifest_file: &Path,
    report: &mut SyncReport,
    emit: &(dyn Fn(SyncProgress) + Sync),
) -> Result<(), String> {
    emit(force_phase(&req.workspace_id, "scan", 0, 0, ""));
    let mut local = walk_content(content_root)?;
    if let Some(meta) = meta_root {
        local.files.extend(walk_meta(meta)?.files);
    }

    // 拉远端清单：全是网络往返，单独一段
    emit(force_phase(&req.workspace_id, "remote", 0, 0, ""));
    let mut remote_map: BTreeMap<String, DavEntry> = BTreeMap::new();
    let prefix = format!("{root_rel}/");
    for (rel, entry) in dav.list_files(root_rel).await? {
        if entry.is_dir {
            continue;
        }
        if let Some(rest) = rel.strip_prefix(&prefix) {
            remote_map.insert(format!("c/{rest}"), entry);
        }
    }
    if meta_root.is_some() {
        if let Ok(entries) = dav.propfind(&format!("{root_rel}/{STATE_DIR}/meta"), "1").await {
            let meta_prefix = format!("{STATE_DIR}/meta/");
            for entry in entries {
                if entry.is_dir {
                    continue;
                }
                let rel_in_state = entry.rel.trim_start_matches(&format!("{root_rel}/"));
                if let Some(name) = rel_in_state.strip_prefix(&meta_prefix) {
                    remote_map.insert(format!("m/{name}"), entry);
                }
            }
        }
    }
    if remote_map.is_empty() {
        return Err(format!(
            "远端 {root_rel} 里一个文件都没有，为免把本地清空，这次不动本地"
        ));
    }

    let backup_root = manifest_file
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
        .join("webdav-backups")
        .join(&req.workspace_id)
        .join(format_stamp(now_epoch()).replace(' ', "-"));

    let total = remote_map.len() as u32;
    let mut done = 0u32;
    let mut next: BTreeMap<String, ManifestEntry> = BTreeMap::new();
    let mut downloaded_files: Vec<String> = Vec::new();
    let mut meta_hit = false;
    for (key, re) in remote_map.iter() {
        if cancel_requested() {
            report.cancelled = true;
            report.errors.push("已手动停止同步".to_string());
            break;
        }
        let (_, rel) = split_key(key);
        done += 1;
        emit(force_phase(&req.workspace_id, "transfer", done, total, rel));
        let remote_rel = remote_rel_of(root_rel, key);
        let bytes = match dav.get_sized(&remote_rel, re.size).await {
            Ok(b) => b,
            Err(e) => {
                report.errors.push(format!("下载 {rel} 失败：{e}"));
                continue;
            }
        };
        let target = local_target(content_root, meta_root, key);
        // 覆盖之前留个旧版备份，覆盖也能反悔
        if let Ok(old) = fs::read(&target) {
            if old != bytes {
                if let Err(e) = backup_into(&backup_root, key, &old) {
                    report.errors.push(format!("备份本地 {rel} 失败：{e}"));
                }
            }
        }
        match write_atomic(&target, &bytes) {
            Ok(()) => {
                report.downloaded += 1;
                if key.starts_with("c/") {
                    downloaded_files.push(rel.to_string());
                } else {
                    meta_hit = true;
                }
                let mt = fs::metadata(&target).map(|m| mtime_of(&m)).unwrap_or(0);
                next.insert(
                    key.clone(),
                    ManifestEntry {
                        size: bytes.len() as u64,
                        mtime: mt,
                        etag: re.etag.clone(),
                        remote_size: re.size,
                        remote_mtime: re.mtime,
                    },
                );
            }
            Err(e) => report.errors.push(format!("写本地 {rel} 失败：{e}")),
        }
    }

    // 本地多出来的：备份后删掉，本地才是云端的镜像
    let mut extra_local: Vec<(String, LocalFile)> = Vec::new();
    for (key, lf) in local.files.iter() {
        if !remote_map.contains_key(key) {
            extra_local.push((key.clone(), lf.clone()));
        }
    }
    if too_many_to_delete(extra_local.len(), local.files.len().max(extra_local.len())) {
        report.errors.push(format!(
            "本地有 {} 个云端没有的文件，数量太反常，这次没有删除它们；先用普通同步确认远端目录挂对了再试",
            extra_local.len()
        ));
    } else {
        for (key, lf) in extra_local {
            let (_, rel) = split_key(&key);
            if let Ok(bytes) = fs::read(&lf.path) {
                if let Err(e) = backup_into(&backup_root, &key, &bytes) {
                    report.errors.push(format!("备份本地 {rel} 失败：{e}"));
                    continue;
                }
            }
            match fs::remove_file(&lf.path) {
                Ok(()) => report.deleted += 1,
                Err(e) => report.errors.push(format!("删除本地 {rel} 失败：{e}")),
            }
        }
    }

    report.meta_changed = meta_hit;
    report.downloaded_files = downloaded_files;
    let manifest = Manifest {
        version: MANIFEST_VERSION,
        files: next,
        deleted: BTreeMap::new(),
    };
    save_manifest(manifest_file, &manifest)?;
    if let Ok(text) = serde_json::to_string_pretty(&manifest) {
        let remote_manifest = format!("{root_rel}/{STATE_DIR}/manifest.json");
        if let Err(e) = dav.put(&remote_manifest, text.into_bytes()).await {
            report.errors.push(format!("上传同步清单失败：{e}"));
        }
    }
    Ok(())
}

/// 清空云端：远端空间目录里的东西全删，本地不动
async fn force_wipe(
    req: &SyncRequest,
    dav: &Dav,
    root_rel: &str,
    manifest_file: &Path,
    report: &mut SyncReport,
    emit: &(dyn Fn(SyncProgress) + Sync),
) -> Result<(), String> {
    emit(force_phase(&req.workspace_id, "remote", 0, 0, ""));
    let mut files: Vec<String> = Vec::new();
    let mut dirs: Vec<String> = Vec::new();
    let mut queue: Vec<String> = vec![root_rel.to_string()];
    let mut rounds = 0;
    while let Some(dir) = queue.pop() {
        rounds += 1;
        if rounds > 400 {
            break;
        }
        let entries = dav.propfind(&dir, "1").await?;
        for entry in entries {
            if entry.rel == dir {
                continue;
            }
            if entry.is_dir {
                dirs.push(entry.rel.clone());
                queue.push(entry.rel.clone());
            } else {
                files.push(entry.rel);
            }
        }
    }

    let total = (files.len() + dirs.len()) as u32;
    let mut done = 0u32;
    for rel in files {
        if cancel_requested() {
            report.cancelled = true;
            report.errors.push("已手动停止同步".to_string());
            break;
        }
        done += 1;
        emit(force_phase(&req.workspace_id, "transfer", done, total, &rel));
        match dav.delete(&rel).await {
            Ok(()) => report.deleted += 1,
            Err(e) => report.errors.push(format!("删除 {rel} 失败：{e}")),
        }
    }
    if report.cancelled {
        // 被叫停了：一个文件都没删掉就别动清单，不然界面上「已停止」，云端却像清空过一样
        if report.deleted == 0 {
            emit(force_phase(&req.workspace_id, "manifest", total, total, ""));
            return Ok(());
        }
    } else {
        // 目录从深到浅删，删不掉也不影响文件已经清空
        dirs.sort_by_key(|d| std::cmp::Reverse(d.matches('/').count()));
        for dir in dirs {
            let _ = dav.delete(&dir).await;
        }
    }
    emit(force_phase(&req.workspace_id, "manifest", total, total, ""));

    // 清单一起清零：不然下一轮同步会以为「远端被删了」，反手把本地删光
    let blank = Manifest {
        version: MANIFEST_VERSION,
        ..Default::default()
    };
    save_manifest(manifest_file, &blank)?;
    Ok(())
}

/// key → 远端相对路径
fn remote_rel_of(root_rel: &str, key: &str) -> String {
    let (kind, rel) = split_key(key);
    match kind {
        "m" => format!("{root_rel}/{STATE_DIR}/meta/{rel}"),
        _ => format!("{root_rel}/{rel}"),
    }
}

/// key → 本地绝对路径
fn local_target(content_root: &Path, meta_root: Option<&Path>, key: &str) -> PathBuf {
    let (kind, rel) = split_key(key);
    match kind {
        "m" => match meta_root {
            Some(root) => root.join(rel),
            None => content_root.join(rel),
        },
        _ => content_root.join(rel),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试里不关心进度
    fn noop_progress(_progress: SyncProgress) {}

    /// 上传后必须记住服务端回报的时间戳：否则下一轮同步会一直以为远端变了
    #[test]
    fn uploaded_entry_prefers_server_metadata() {
        let e = uploaded_entry("".to_string(), 100, 1_700_000_000_500, Some((100, 1_700_000_030, String::new())));
        assert_eq!(e.size, 100);
        assert_eq!(e.remote_size, 100);
        assert_eq!(e.remote_mtime, 1_700_000_030);
        assert_eq!(e.mtime, 1_700_000_000_500);
        // 服务端没回话就退回本地值，至少能继续跑
        let e2 = uploaded_entry("e1".to_string(), 100, 1_700_000_000_500, None);
        assert_eq!(e2.remote_mtime, 1_700_000_000);
        assert_eq!(e2.etag, "e1");
    }

    #[test]
    fn segment_encoding_round_trips_chinese() {
        let encoded = encode_segment("工作 空间#1");
        assert_eq!(encoded, "%E5%B7%A5%E4%BD%9C%20%E7%A9%BA%E9%97%B4%231");
        assert_eq!(percent_decode(&encoded), "工作 空间#1");
    }

    #[test]
    fn multistatus_parses_files_and_dirs() {
        let body = r#"<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav/files/u/MaikNote/%E5%B7%A5%E4%BD%9C/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/files/u/MaikNote/%E5%B7%A5%E4%BD%9C/%E7%AC%94%E8%AE%B0.md</d:href>
    <d:propstat><d:prop>
      <d:resourcetype/>
      <d:getetag>"abc123"</d:getetag>
      <d:getcontentlength>42</d:getcontentlength>
      <d:getlastmodified>Sun, 17 Nov 2026 07:30:00 GMT</d:getlastmodified>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>"#;
        let entries = parse_multistatus(body, "/dav/files/u");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].rel, "MaikNote/工作");
        assert!(entries[0].is_dir);
        assert_eq!(entries[1].rel, "MaikNote/工作/笔记.md");
        assert!(!entries[1].is_dir);
        assert_eq!(entries[1].etag, "abc123");
        assert_eq!(entries[1].size, 42);
        assert!(entries[1].mtime > 1_700_000_000);
    }

    #[test]
    fn http_date_parses_to_epoch() {
        let epoch = parse_http_date("Sun, 17 Nov 2026 07:30:00 GMT").unwrap();
        assert_eq!(format_stamp_utc(epoch), "2026-11-17 0730");
    }

    #[test]
    fn remote_dir_is_normalized() {
        assert_eq!(normalize_remote_dir("/MaikNote//默认空间/").unwrap(), "MaikNote/默认空间");
        assert!(normalize_remote_dir("  ").is_err());
        assert!(normalize_remote_dir("a/../b").is_err());
    }

    #[test]
    fn remote_paths_keep_meta_apart() {
        assert_eq!(remote_rel_of("MaikNote/工作", "c/笔记.md"), "MaikNote/工作/笔记.md");
        assert_eq!(
            remote_rel_of("MaikNote/工作", "m/metadata.json"),
            "MaikNote/工作/.maiknote/meta/metadata.json"
        );
        assert_eq!(split_key("m/metadata.json"), ("m", "metadata.json"));
        assert_eq!(split_key("c/a/b.md"), ("c", "a/b.md"));
    }

    /// 真握手一次：本地起 wsgidav 后跑，命令见文件顶部注释
    /// `cargo test --offline webdav::tests::live_smoke -- --ignored --nocapture`
    /// 地址可用 MAIKNOTE_DAV_URL 覆盖，默认 http://127.0.0.1:8899/
    #[test]
    #[ignore]
    fn live_smoke() {
        let url = std::env::var("MAIKNOTE_DAV_URL").unwrap_or_else(|_| "http://127.0.0.1:8899/".to_string());
        tauri::async_runtime::block_on(async move {
            let dav = Dav::new(&url, "", "", false).expect("client");
            let root = "MaikNote/工作 空间#1";
            let body = "# 一\n你好\n".as_bytes().to_vec();

            dav.ensure_dir_chain(root).await.expect("mkcol chain");
            dav.ensure_dir_chain(root).await.expect("mkcol idempotent");

            let target = format!("{root}/笔记 一.md");
            let etag = dav.put(&target, body.clone()).await.expect("put");
            println!("etag={etag:?}");

            let got = dav.get(&target).await.expect("get");
            assert_eq!(String::from_utf8_lossy(&got), "# 一\n你好\n");

            let listing = dav.list_files(root).await.expect("list");
            let keys: Vec<String> = listing.keys().cloned().collect();
            println!("listing={keys:?}");
            let (_, entry) = listing
                .iter()
                .find(|(k, _)| k.ends_with("笔记 一.md"))
                .expect("中文文件名要在列表里");
            assert!(!entry.is_dir);
            assert_eq!(entry.size, body.len() as u64, "size 应对上");
            assert!(entry.mtime > 1_600_000_000, "getlastmodified 应解析成时间戳，实际 {}", entry.mtime);

            dav.put(&target, "# 二\n".as_bytes().to_vec()).await.expect("overwrite");
            assert_eq!(String::from_utf8_lossy(&dav.get(&target).await.expect("get2")), "# 二\n");

            dav.delete(&target).await.expect("delete");
            assert!(dav.list_files(root).await.expect("list2").is_empty());
            dav.delete(&target).await.expect("delete missing is ok");
            dav.delete(root).await.expect("cleanup");
        });
    }

    /// 端到端：临时目录 + 本地 WebDAV 服务跑完整对账（改、删、远端新增、冲突双保存）
    /// `cargo test --offline webdav::tests::sync_roundtrip -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn sync_roundtrip() {
        let url = std::env::var("MAIKNOTE_DAV_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8899/".to_string());
        let base = std::env::temp_dir().join(format!("maiknote-sync-{}", std::process::id()));
        let content = base.join("content");
        let manifest_file = base.join("manifest.json");
        let root = format!("MaikNote/同步测试-{}", std::process::id());
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(content.join("子目录")).unwrap();
        fs::write(content.join("笔记A.md"), "# A\n本地第一版\n").unwrap();
        fs::write(content.join("子目录/笔记B.md"), "# B\n").unwrap();

        let mk = |skip: Vec<String>| SyncRequest {
            workspace_id: "test".to_string(),
            content_root: content.to_string_lossy().to_string(),
            meta_root: None,
            remote_dir: root.clone(),
            url: url.clone(),
            username: String::new(),
            password: String::new(),
            skip_download: skip,
            insecure_tls: false,
        };

        tauri::async_runtime::block_on(async {
            // ① 首次：两个文件都传上去（顺便验证进度事件真的发出来了）
            let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<SyncProgress>::new()));
            let sink = seen.clone();
            let collect = move |progress: SyncProgress| {
                sink.lock().unwrap().push(progress);
            };
            let r1 = sync_core(mk(vec![]), content.clone(), None, manifest_file.clone(), &collect)
                .await
                .expect("first sync");
            let events = seen.lock().unwrap().clone();
            println!(
                "progress: {:?}",
                events.iter().map(|p| (p.phase.clone(), p.done, p.total)).collect::<Vec<_>>()
            );
            let first_phase = events.first().map(|p| p.phase.clone()).unwrap_or_default();
            assert_eq!(first_phase, "scan", "第一个进度应是扫描: {:?}", events);
            assert!(events.iter().any(|p| p.phase == "transfer" && p.total == 2), "{:?}", events);
            let last = events.last().cloned().expect("有进度事件");
            assert_eq!(last.phase, "done", "{:?}", last);
            assert_eq!(last.workspace_id, "test");
            println!("r1 uploaded={} downloaded={} errors={:?}", r1.uploaded, r1.downloaded, r1.errors);
            assert_eq!(r1.uploaded, 2, "首次应上传 2 个文件: {:?}", r1);
            assert_eq!(r1.downloaded, 0);
            assert!(r1.errors.is_empty(), "{:?}", r1.errors);

            // ② 什么都没变：不该有任何动作
            let r2 = sync_core(mk(vec![]), content.clone(), None, manifest_file.clone(), &noop_progress)
                .await
                .expect("second sync");
            println!("r2 uploaded={} downloaded={} deleted={}", r2.uploaded, r2.downloaded, r2.deleted);
            assert_eq!((r2.uploaded, r2.downloaded, r2.deleted), (0, 0, 0), "第二次不该动: {:?}", r2);
            assert!(r2.errors.is_empty(), "{:?}", r2.errors);

            let dav = Dav::new(&url, "", "", false).unwrap();

            // ③ 远端多了个文件：下到本地
            dav.put(&format!("{root}/远端新笔记.md"), "# 远端\n".as_bytes().to_vec())
                .await
                .unwrap();
            let r3 = sync_core(mk(vec![]), content.clone(), None, manifest_file.clone(), &noop_progress)
                .await
                .expect("third sync");
            println!("r3 downloaded={} files={:?} errors={:?}", r3.downloaded, r3.downloaded_files, r3.errors);
            assert_eq!(r3.downloaded, 1);
            assert!(r3.downloaded_files.iter().any(|p| p == "远端新笔记.md"), "{:?}", r3.downloaded_files);
            assert_eq!(
                fs::read_to_string(content.join("远端新笔记.md")).unwrap(),
                "# 远端\n"
            );

            // ④ 本地改了：传上去
            fs::write(content.join("笔记A.md"), "# A\n本地第二版\n").unwrap();
            let r4 = sync_core(mk(vec![]), content.clone(), None, manifest_file.clone(), &noop_progress)
                .await
                .expect("fourth sync");
            println!("r4 uploaded={} errors={:?}", r4.uploaded, r4.errors);
            assert_eq!(r4.uploaded, 1, "{:?}", r4);
            assert_eq!(
                String::from_utf8_lossy(&dav.get(&format!("{root}/笔记A.md")).await.unwrap()),
                "# A\n本地第二版\n"
            );

            // ⑤ 本地删了：远端跟着删
            fs::remove_file(content.join("子目录/笔记B.md")).unwrap();
            let r5 = sync_core(mk(vec![]), content.clone(), None, manifest_file.clone(), &noop_progress)
                .await
                .expect("fifth sync");
            println!("r5 deleted={} errors={:?}", r5.deleted, r5.errors);
            assert_eq!(r5.deleted, 1, "{:?}", r5);
            let listing = dav.list_files(&root).await.unwrap();
            assert!(!listing.keys().any(|k| k.ends_with("笔记B.md")), "{:?}", listing.keys().collect::<Vec<_>>());
            assert!(!content.join("子目录/笔记B.md").exists());

            // 两边同时改同一份时只看谁更晚，输的整份被覆盖，绝不另存副本
            let set_mtime = |p: &Path, offset: i64| {
                let base = if offset >= 0 {
                    SystemTime::now() + Duration::from_secs(offset as u64)
                } else {
                    SystemTime::now() - Duration::from_secs((-offset) as u64)
                };
                let file = fs::File::options().write(true).open(p).unwrap();
                file.set_modified(base).unwrap();
            };
            let no_copies = |listing: &BTreeMap<String, DavEntry>| {
                assert!(
                    !listing.keys().any(|k| k.contains("冲突副本")),
                    "远端不该有冲突副本: {:?}",
                    listing.keys().collect::<Vec<_>>()
                );
            };
            let local_note = content.join("笔记A.md");

            // ⑥-1 远端更晚：远端盖本地
            fs::write(&local_note, "# A\n本地第三版\n").unwrap();
            set_mtime(&local_note, -3600);
            dav.put(&format!("{root}/笔记A.md"), "# A\n远端改过\n".as_bytes().to_vec())
                .await
                .unwrap();
            let r6 = sync_core(mk(vec![]), content.clone(), None, manifest_file.clone(), &noop_progress)
                .await
                .expect("sixth sync");
            println!("r6 uploaded={} downloaded={} errors={:?}", r6.uploaded, r6.downloaded, r6.errors);
            assert_eq!(r6.downloaded, 1, "{:?}", r6);
            assert_eq!(fs::read_to_string(&local_note).unwrap(), "# A\n远端改过\n");
            assert_eq!(
                String::from_utf8_lossy(&dav.get(&format!("{root}/笔记A.md")).await.unwrap()),
                "# A\n远端改过\n"
            );

            // ⑥-2 本地更晚：本地盖远端
            dav.put(&format!("{root}/笔记A.md"), "# A\n远端再改\n".as_bytes().to_vec())
                .await
                .unwrap();
            fs::write(&local_note, "# A\n本地第四版\n").unwrap();
            set_mtime(&local_note, 3600);
            let r6b = sync_core(mk(vec![]), content.clone(), None, manifest_file.clone(), &noop_progress)
                .await
                .expect("sixth sync b");
            println!("r6b uploaded={} downloaded={} errors={:?}", r6b.uploaded, r6b.downloaded, r6b.errors);
            assert_eq!(r6b.uploaded, 1, "{:?}", r6b);
            assert_eq!(fs::read_to_string(&local_note).unwrap(), "# A\n本地第四版\n");
            assert_eq!(
                String::from_utf8_lossy(&dav.get(&format!("{root}/笔记A.md")).await.unwrap()),
                "# A\n本地第四版\n"
            );
            // 本地和远端都不该多出副本文件
            assert!(
                fs::read_dir(&content)
                    .unwrap()
                    .flatten()
                    .all(|e| !e.file_name().to_string_lossy().contains("冲突副本")),
                "本地不该有冲突副本"
            );
            no_copies(&dav.list_files(&root).await.unwrap());

            // ⑦ 正在编辑的笔记不让远端盖掉
            dav.put(&format!("{root}/笔记A.md"), "# A\n远端又改\n".as_bytes().to_vec())
                .await
                .unwrap();
            let r7 = sync_core(mk(vec!["笔记A.md".to_string()]), content.clone(), None, manifest_file.clone(), &noop_progress)
                .await
                .expect("seventh sync");
            println!("r7 skipped={} downloaded={}", r7.skipped, r7.downloaded);
            assert_eq!(r7.skipped, 1, "{:?}", r7);
            assert_eq!(fs::read_to_string(&local_note).unwrap(), "# A\n本地第四版\n");

            dav.delete(&root).await.unwrap();
        });

         let _ = fs::remove_dir_all(&base);
    }

    /// 拿真实服务器量一下每个请求的耗时（只读，不改远端）
    /// MAIKNOTE_DAV_URL=... MAIKNOTE_DAV_USER=... MAIKNOTE_DAV_PASS=... cargo test --offline webdav::tests::real_probe -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_probe() {
        let url = match std::env::var("MAIKNOTE_DAV_URL") {
            Ok(v) => v,
            Err(_) => return,
        };
        let user = std::env::var("MAIKNOTE_DAV_USER").unwrap_or_default();
        let pass = std::env::var("MAIKNOTE_DAV_PASS").unwrap_or_default();
        let dir = std::env::var("MAIKNOTE_DAV_DIR").unwrap_or_else(|_| "MaikNote/".to_string());
        tauri::async_runtime::block_on(async move {
            let dav = Dav::new(&url, &user, &pass, false).expect("client");
            for (label, rel, depth) in [
                ("root", "", "1"),
                ("dir depth0", dir.as_str(), "0"),
                ("dir depth1", dir.as_str(), "1"),
            ] {
                let t = std::time::Instant::now();
                match dav.propfind(rel, depth).await {
                    Ok(entries) => println!("{label}: {} entries in {:?}", entries.len(), t.elapsed()),
                    Err(e) => println!("{label}: FAILED in {:?} -> {e}", t.elapsed()),
                }
            }
            let png = format!("{dir}/images/img_1794904123386_e4hmd3.png");
            for i in 1..=1 {
                let t = std::time::Instant::now();
                match dav.get(&png).await {
                    Ok(b) => println!("get png #{i}: {} bytes in {:?}", b.len(), t.elapsed()),
                    Err(e) => println!("get png #{i} FAILED in {:?} -> {e}", t.elapsed()),
                }
            }
            let probe_file = format!("{dir}/.maiknote-probe.txt");
            let t = std::time::Instant::now();
            match dav.put(&probe_file, b"probe".to_vec()).await {
                Ok(_) => println!("put probe in {:?}", t.elapsed()),
                Err(e) => println!("put probe FAILED in {:?} -> {e}", t.elapsed()),
            }
            let t = std::time::Instant::now();
            let _ = dav.delete(&probe_file).await;
            println!("delete probe in {:?}", t.elapsed());
            let t = std::time::Instant::now();
            match dav.list_files(&dir).await {
                Ok(map) => {
                    println!("list_files: {} files in {:?}", map.len(), t.elapsed());
                    for (k, e) in map.iter().take(8) {
                        println!("  {k} size={} mtime={}", e.size, e.mtime);
                    }
                }
                Err(e) => println!("list_files FAILED in {:?} -> {e}", t.elapsed()),
            }
        });
    }

    /// 端到端：三个强制动作（本地盖云端 / 云端盖本地 / 清空云端）
    /// `cargo test --offline webdav::tests::force_modes -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn force_modes_roundtrip() {
        let url = std::env::var("MAIKNOTE_DAV_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8899/".to_string());
        let base = std::env::temp_dir().join(format!("maiknote-force-{}", std::process::id()));
        let content = base.join("content");
        let manifest_file = base.join("manifest.json");
        let root = format!("MaikNote/强制测试-{}", std::process::id());
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&content).unwrap();
        fs::write(content.join("笔记A.md"), "# A\n本地版\n").unwrap();
        fs::write(content.join("笔记B.md"), "# B\n").unwrap();

        let mk = || SyncRequest {
            workspace_id: "force".to_string(),
            content_root: content.to_string_lossy().to_string(),
            meta_root: None,
            remote_dir: root.clone(),
            url: url.clone(),
            username: String::new(),
            password: String::new(),
            skip_download: Vec::new(),
            insecure_tls: false,
        };

        tauri::async_runtime::block_on(async {
            // ① 本地盖云端：云端被本地内容覆盖，云端多出来的被删
            let r1 = force_core(mk(), content.clone(), None, manifest_file.clone(), "push", &noop_progress)
                .await
                .expect("force push");
            println!("push1 uploaded={} deleted={} errors={:?}", r1.uploaded, r1.deleted, r1.errors);
            assert_eq!(r1.uploaded, 2, "{:?}", r1);

            let dav = Dav::new(&url, "", "", false).unwrap();
            dav.put(&format!("{root}/笔记A.md"), "# A\n云端乱改\n".as_bytes().to_vec())
                .await
                .unwrap();
            dav.put(&format!("{root}/云端多余.md"), "# 多\n".as_bytes().to_vec())
                .await
                .unwrap();
            let r2 = force_core(mk(), content.clone(), None, manifest_file.clone(), "push", &noop_progress)
                .await
                .expect("force push 2");
            println!("push2 uploaded={} deleted={} errors={:?}", r2.uploaded, r2.deleted, r2.errors);
            assert_eq!(r2.deleted, 1, "云端多出来的应删掉: {:?}", r2);
            assert_eq!(
                String::from_utf8_lossy(&dav.get(&format!("{root}/笔记A.md")).await.unwrap()),
                "# A\n本地版\n",
                "云端要被本地覆盖"
            );

            // ② 云端盖本地：本地被覆盖，本地多出来的备份后删除
            fs::write(content.join("本地多余.md"), "# 只有本地有\n").unwrap();
            dav.put(&format!("{root}/笔记A.md"), "# A\n云端权威版\n".as_bytes().to_vec())
                .await
                .unwrap();
            dav.put(&format!("{root}/笔记C.md"), "# C\n只在云端\n".as_bytes().to_vec())
                .await
                .unwrap();
            let r3 = force_core(mk(), content.clone(), None, manifest_file.clone(), "pull", &noop_progress)
                .await
                .expect("force pull");
            println!("pull downloaded={} deleted={} errors={:?}", r3.downloaded, r3.deleted, r3.errors);
            assert_eq!(fs::read_to_string(content.join("笔记A.md")).unwrap(), "# A\n云端权威版\n");
            assert_eq!(fs::read_to_string(content.join("笔记C.md")).unwrap(), "# C\n只在云端\n");
            assert!(!content.join("本地多余.md").exists(), "云端没有的本地文件应删掉");
            assert_eq!(r3.deleted, 1, "{:?}", r3);
            let backups = base.join("webdav-backups").join("force");
            let mut found_backup = false;
            if let Ok(days) = fs::read_dir(&backups) {
                for day in days.flatten() {
                    if day.path().join("content/笔记A.md").exists() {
                        found_backup = true;
                    }
                }
            }
            assert!(found_backup, "覆盖前的本地旧版本要留备份");

            // ③ 清空云端：远端清空、本地不动、清单清零（否则下一轮会把本地删光）
            let r4 = force_core(mk(), content.clone(), None, manifest_file.clone(), "wipe", &noop_progress)
                .await
                .expect("force wipe");
            println!("wipe deleted={} errors={:?}", r4.deleted, r4.errors);
            assert!(dav.list_files(&root).await.unwrap().is_empty(), "云端应清空");
            assert!(content.join("笔记A.md").exists(), "清空云端不动本地");
            let manifest = load_manifest(&manifest_file).expect("manifest 还在");
            assert!(manifest.files.is_empty(), "清单要清零");

            // ④ 清空后跑一次普通同步：本地应重新传上去，而不是被云端删掉
            let r5 = sync_core(mk(), content.clone(), None, manifest_file.clone(), &noop_progress)
                .await
                .expect("sync after wipe");
            println!("after wipe uploaded={} deleted={}", r5.uploaded, r5.deleted);
            assert_eq!(r5.uploaded, 3, "本地三个文件都要重新传上去: {:?}", r5);
            assert!(content.join("笔记B.md").exists());

            dav.delete(&root).await.unwrap();
        });

        let _ = fs::remove_dir_all(&base);
    }


    /// 上一轮点过「停止」留下的开关不能把强制动作带偏：强制动作一进来就自己清零
    #[test]
    fn force_core_clears_stale_cancel_flag() {
        request_cancel();
        assert!(cancel_requested(), "前提：开关先挂上");
        let dir = std::env::temp_dir().join(format!("mk-force-cancel-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let req = SyncRequest {
            workspace_id: "force".to_string(),
            content_root: dir.to_string_lossy().to_string(),
            meta_root: None,
            remote_dir: "MaikNote/probe".to_string(),
            url: "http://127.0.0.1:9/".to_string(),
            username: String::new(),
            password: String::new(),
            skip_download: Vec::new(),
            insecure_tls: false,
        };
        let r = tauri::async_runtime::block_on(force_core(
            req,
            dir.clone(),
            None,
            dir.join("manifest.json"),
            "不认识的模式",
            &noop_progress,
        ));
        assert!(r.is_err());
        assert!(!cancel_requested(), "强制动作开始时必须把残留的停止开关清掉");
        let _ = fs::remove_dir_all(&dir);
    }

}
