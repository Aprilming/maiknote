# MarkNote

一款 macOS 原生 Markdown 悬浮便签应用。一个完全是vibe coding开发的小笔记软件。支持icloud同步

## 设计概念
- 召之即来，挥之即走
- 所见即所得
- 如无必要，勿增实体

## 技术栈

- **框架**: Tauri 2.x + Vue 3.x + TypeScript
- **编辑器**: Vditor
- **状态管理**: Pinia 2.x
- **样式**: UnoCSS
- **数据存储**: 本地 .md 文件（iCloud 目录）


## 因签名问题，无法打开app

```bash
sudo xattr -r -d com.apple.quarantine /Applications/MarkNote.app/
```

## 开发环境

### 前置要求

- Node.js 20+
- Rust 1.70+
- macOS 12+

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run tauri dev
```

### 构建

```bash
npm run tauri build -- --target aarch64-apple-darwin
npm run tauri build -- --target x86_64-apple-darwin
```


## 功能特性（已实现）

- ✅ 基础项目结构
- ✅ 无边框窗口
- ✅ 搜索功能
- ✅ 所见即所得编辑器
- ✅ 自动保存（防抖）
- ✅ 快捷键支持
- ✅ iCloud 目录文件存储
- ✅ AI 优化
- ✅ 全局快捷键唤起
- ✅ 笔记置顶
- ✅ 关键词系统
- ✅ 导入导出

## 功能特性（计划中）

- ⏳ 深色/浅色主题支持
- ⏳ code 向typora 看齐

## 快捷键

| 快捷键       | 功能   |
|-----------|------|
| Cmd+Opt+A | 主页面  |
| Cmd+N     | 新建笔记 |
| Cmd+F     | 搜索   |
| Cmd+[/]   | 切换笔记 |
| Esc | 清除搜索 |

## 数据存储

笔记存储在 iCloud 目录中：
```
~/Library/Mobile Documents/com~apple~CloudDocs/MarkNote/
├── metadata.json          # 笔记索引
├── note_<uuid1>.md        # 笔记内容
└── note_<uuid2>.md
```
