# MaikNote 项目体检报告

> 生成日期：2026-11-17
> 项目：MaikNote — macOS 原生 AI Markdown 悬浮笔记
> 技术栈：Tauri 2.x + Vue 3 + TypeScript
> 代码基线：main 分支，HEAD `9954bb2`，约 3.8 万行
> 审查方式：只读静态审查，覆盖安全、UI 逻辑、功能缺失、多余代码四个维度

---

## 结论摘要

| 严重度 | 数量 | 核心问题 |
| --- | --- | --- |
| 🔴 高危 | 4 | XSS 绕过可触及 IPC、两处路径闸绕过可越界读写、写文件吞错静默丢数据 |
| 🟠 中危 | 6 | 读类命令绕过路径闸、CSP 被插件绕过、SSRF、密钥明文、退出丢编辑、异常未捕获 |
| 🟡 低危 | 3 | 图片上传无大小上限、日志泄露查询词、i18n 死键 |
| UI 逻辑 | 0 | 未发现实质缺陷（XSS 一条除外，见 H1） |
| 多余代码 | 2 | 一个纯包装层、一个死 i18n 键；依赖与版本均正常 |

---

## 一、高危问题

### H1. sanitizeHtml 的 URL 白名单可绕过 → 存储型 XSS

- **位置**：`src/utils/sanitizeHtml.ts:44`
- **现象**：该行用 `/^[a-z0-9.-]+:\d/i` 放行带端口的地址，但正则同时匹配了伪协议。实测 `javascript:1;alert(1)`、`javascript:1`、`vbscript:1` 全部返回 `true` 并被原样保留进 href；`localhost:3000/x` 也返回 `true`。`normalized`（:38）只去控制字符，`:39-41` 对 `data:` 另有专门限制，说明作者本意是协议白名单，这条通配规则把它破了。
- **触发点**：`EdgePanel.vue:193-207/:670` 渲染、`DesktopNote.vue:44-53/:296` 渲染、`GuidePanel.vue:131`（静态，低危）。
- **影响**：笔记正文写一行 `<a href="javascript:1;alert(1)">点击</a>`，在编辑区/悬停面板/桌面窗渲染后点击即可执行 JS，进而可调用 Tauri IPC。这是本次审查里唯一能把静态笔记升级成可执行攻击的入口，优先级最高。
- **修复**：删除该通配正则；用 `new URL()` 解析后严格比对协议白名单（http / https / mailto 等），确需 host:port 时单独写更严格的规则并先排除已知伪协议。

### H2. 工作空间迁移命令可越界批量改名 / 删目录

- **位置**：`src-tauri/src/lib.rs:1054-1121`（`migrate_note_layout`）
- **现象**：`base_path` 直接 `PathBuf::from(&base_path)`，没过 `workspace_base` 校验，笔记 id `m.id` 也没清洗。对比 `write_note:765` 是带了校验的。
- **影响**：传入工作空间外的路径，可批量 rename 文件并删除空目录，破坏工作空间外的用户文件。
- **修复**：加 `workspace_base` 校验 + `m.id` 白名单清洗 + `starts_with(root)` 兜底。

### H3. 工作空间配置可写 `path=/` 绕过全部路径闸

- **位置**：`src-tauri/src/workspace.rs:146-151`（`write_workspaces`）、`:98-118`（`allowed_roots` 来源）
- **现象**：`write_workspaces` 把 content 原样落盘，而 `allowed_roots` 又是从这个文件读取的。写入一条 `path=/` 就能把根目录注册成合法工作空间。
- **影响**：一旦根被注册为合法，所有基于 `workspace_base` 的路径校验全部失效，等于关掉了整个路径安全模型。
- **修复**：写盘前对每条 workspace 配置逐条做 `validate_workspace_dir`。

### H4. 写文件吞错 → 保存失败静默丢数据

- **位置**：`src/composables/useFileSystem.ts:110-118`（`writeNote`）、`:82-90`（`writeMetadata`）
- **现象**：两处 catch 只 `console.error` 不 rethrow，返回的 Promise 永远 resolve。而 `noteStore.ts:97`/`:494` 依赖抛错判断成功，`:295-313` 的重试链因此永不触发，`failed` 恒为 false，UI 没有任何失败提示。同文件 `deleteNote:124-131` 与 `saveNoteToCloud:500-511` 都正确抛错，说明这是不一致的缺陷。
- **影响**：iCloud 未挂载、磁盘满、权限错误时，用户以为保存成功，实际内容静默丢失，重启才发现。
- **修复**：catch 中 `throw e`（保留错误上下文），或改成返回 boolean 由调用方判断成败。

---

## 二、中危问题

### M5. 7 个读类 / 改权限命令绕过路径闸

- **位置**：`lib.rs:627`（read_metadata）、`:653`（read_directories）、`:673`（read_assistants）、`:746`（read_note）、`:908`（list_note_files）、`:1127`（set_note_readonly）、`:1149`（set_note_readwrite）
- **现象**：这 7 个命令都直接用 `PathBuf::from(base_path)`，没有 `workspace_base` 校验。`dir`/`file_name` 虽经 `sanitize_rel_dir(:717)`/`resolve_file_name(:709)` 清洗，但清洗不覆盖 `base_path` 本身。
- **影响**：可读取任意 metadata / assistants / md 文件、枚举任意目录、修改任意文件权限。
- **修复**：与写命令一致，统一加 `workspace_base` 校验。

### M6. CSP 被 HTTP 插件绕过 + 全域名 fetch

- **位置**：`src-tauri/capabilities/default.json:24-31`、`tauri.conf.json:83`
- **现象**：`http:allow-fetch` 同时写了 `https://*` 和 `http://*` 全通，精确白名单失效；前端 fetch 通过 `plugin-http` 走 IPC，不受页面 CSP 的 `connect-src` 约束。使用点：`useBaiduSearch.ts:1`、`linkPreview.ts:1`、`TiptapEditor.vue:51`。
- **影响**：任意外联，可把 apiKey 外带到攻击者服务器，也为 SSRF 提供了通道。
- **修复**：删除通配规则，只保留实际使用的域名。

### M7. 网络信息接口 SSRF

- **位置**：`lib.rs:1628-1667`（`get_network_info` / `fetch_public_ip`）
- **现象**：按前端传来的 URL 用 reqwest 发请求，仅用 `starts_with(http)` 判断合法性。
- **影响**：可请求 `169.254.169.254` 云元数据、`127.0.0.1` 本机 / 内网服务。
- **修复**：忽略前端传入的 URL，固定使用默认可信地址。

### M8. API Key 明文落盘

- **位置**：`settingStore.ts:391`、`assistantsStore.ts:168-172`
- **现象**：`:391` 把含 `aiKey`（:190）和 `baiduSearchKey`（:196）的 settings 用 `localStorage.setItem` 明文保存；`assistantsStore` 的 `saveAssistants` 把 key 明文写进 iCloud 的 `assistants.json`。`useBaiduSearch.ts:14/:46` 以 `Authorization: Bearer` 发送这些密钥，`TiptapEditor.vue:914/:946` 也是直接取用。
- **影响**：任何能读 iCloud 目录或 localStorage 的进程都能窃取密钥；iCloud 同步还会把凭据扩散到多设备。
- **修复**：密钥改存系统钥匙串（Tauri keychain 插件或 `security` 命令），配置文件与 localStorage 只放占位标识。

### M9. 退出 / 关闭应用不 flush 待保存队列

- **位置**：`TitleBar.vue:106-113`（closeWindow，`quit` 分支）、`useShortcuts.ts:215-228`（Cmd+W）
- **现象**：直接 `await invoke("exit_app")`，没有 `await noteStore.flushPendingSave()`。`noteStore` 的 500ms debounce 和 `pendingSaveNotes` 存在内存里，进程退出即丢。对比切 workspace 路径（`useWorkspaceSwitch.ts:46/:153`、`useWorkspaceTransfer.ts:278`）都有 flush。
- **影响**：编辑后短时间内退出（尤其把 autoSaveInterval 设大时）内容丢失且无提示。
- **修复**：`exit_app` 之前先 `await noteStore.flushPendingSave()`。

### M10. 未捕获的 Promise 链

- **位置**：`useEdgePanel.ts:273-312`、`noteStore.ts:255`
- **现象**：`useEdgePanel.ts` 的 `void (async()=>{...})()` 里 6 个 `listen` 没有 try/catch；`noteStore.ts:255` 的 `setTimeout(()=>void runPendingSave(), delay)` 也没有 catch。
- **影响**：异常变成 unhandled rejection，只在控制台一闪而过，监听失败 / 保存失败难以定位。
- **修复**：IIFE 和 setTimeout 回调补 `.catch(err => console.error(...))`，并置错误状态给用户提示。

---

## 三、低危问题

### L11. save_image 的 base64 无大小上限

- **位置**：`lib.rs:1180-1201`
- **现象**：base64 图片数据没有大小限制，超大图可造成内存 / CPU DoS。文件名已过 `sanitize_file_name(:692)` 清洗，路径穿越已挡住。
- **修复**：限制解码后大小（建议 20MB）。

### L12. console.log 打印用户查询词

- **位置**：`useBaiduSearch.ts:101`、`:29`
- **现象**：`:101` 打印工具名与 `query`，`:29` 打印响应前 200 字符；生产构建仍会输出。apiKey 本身没有被打印。
- **影响**：用户笔记 / 搜索内容泄露到控制台。
- **修复**：删除，或用 `import.meta.env.DEV` 包裹。

### L13. i18n 死键 search.monthDay

- **位置**：`src/i18n/locales/zh-CN.ts:442`
- **现象**：只在中文语言包定义，en-US 缺失，代码从未引用（`formatDate` 用的是 `toLocaleDateString`）。
- **修复**：删除该键。

---

## 四、UI 逻辑

全维度检查后未发现实质缺陷：

- 所有 `v-html` 均安全：`SearchPage.vue:103-108` 的 `highlightKeyword` 先 `escapeHtml` 再拼 `<mark>` 标签；`DesktopNote.vue:44-53`、`EdgePanel.vue:193-207` 都调用 `sanitizeHtml(md.render(...))`；`GuidePanel.vue:131` 是静态内容。
- 事件监听配对完整：`App.vue`、`TiptapEditor.vue`、`EdgePanel.vue`、`Settings.vue`、`DesktopNote.vue` 的 `addEventListener` / `removeEventListener` 全部成对。
- Tauri 事件配对完整：`useEdgePanel`、`useDesktopNotes`、`App.vue` 的 `listen` / `unlisten` 全部成对，无泄漏。
- **唯一例外是 H1**：它表面是 HTML 消毒，实际是能打到 IPC 的安全口子，因此归入高危。

---

## 五、多余代码 / 功能缺失

- `MilkdownEditor.vue` 是纯包装层：`App.vue:23` 导入它，其内部 `:892` 只是渲染 `TiptapEditor.vue`。有合并空间，但不算死代码。
- npm 依赖全部在源码有引用，无冗余依赖。
- `package.json` / `tauri.conf.json` / `Cargo.toml` 版本号一致（均为 `0.10.21`）。
- 未发现明确的功能缺失；本次审查范围里唯一影响可用性的问题是 H4（保存失败无提示）。

---

## 六、核查通过项

以下点专门查过，结论是没问题，列出以便复核：

- 写命令的文件名清洗到位：`sanitize_file_name(:692)` 替换 `/ \ : * ? " < > |` 及控制字符、trim 点、截断 60 字符，路径穿越已挡。
- `workspace.rs` 的 `remove_workspace_meta(:167-180)` 走白名单、`ensure_path_allowed(:123-134)` 做了 canonicalize。
- `permissions.rs` 的 `Command::new`（`ps` / `open`，:129/:173/:191）参数硬编码并用 `.arg` 分离，无命令注入。
- `skills_sync.rs` 的 `lookup(:158)` 只处理 5 个固定 key。
- 签名密钥 `keys/maiknote.key` 已被 `.gitignore` 的 `keys/` 忽略，`git ls-files` 查询为空，源码无硬编码密钥；`tauri.conf.json` 的 updater 只配了 pubkey。
- shell 插件只开了 `open: true`，没有 `execute` / `spawn`。

---

## 七、修复优先级建议

| 批次 | 条目 | 说明 |
| --- | --- | --- |
| P0 — 立即 | H1、H2、H3、H4 | 前三个是权限 / 执行边界被突破，第四个是正在发生的数据丢失 |
| P1 — 尽快 | M5 ~ M10 | 收敛读取边界、CSP、SSRF、密钥存储与保存可靠性 |
| P2 — 择机 | L11 ~ L13、MilkdownEditor 合并 | 加固与清理，不影响主流程 |

> 说明：H1 与 H3 / H5 类问题存在叠加效应——XSS 提供渲染进程内的执行点，路径闸绕过提供文件与权限面，两者串联会把单点缺陷放大成完整攻击链，因此 P0 建议一并处理。
