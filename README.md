<div align="right">
  <a href="README_EN.md">English</a>
</div>

<div align="center">
  <h1>MarkNote</h1>
  <p>一款 macOS 原生的 AI Markdown 悬浮便签应用</p>
  <p>
    <img src="https://img.shields.io/badge/Platform-macOS-black?style=flat-square&logo=apple" />
    <img src="https://img.shields.io/badge/Tauri-2.x-blue?style=flat-square" />
    <img src="https://img.shields.io/badge/Vue-3.x-42b883?style=flat-square&logo=vue.js" />
    <img src="https://img.shields.io/badge/iCloud-同步-0071e3?style=flat-square&logo=icloud" />
  </p>
</div>

---

## 简介

MarkNote 是一款 macOS 原生悬浮便签应用，支持所见即所得 Markdown 编辑、AI 辅助写作与 iCloud 自动同步。灵感来源于 [Antinote](https://antinote.io/)，在其基础上深度整合了 AI 能力。感谢 Antinote 的启发！

> 本项目完全通过 vibe coding 方式开发。

## 设计理念

- **召之即来，挥之即走** — 全局快捷键随时唤起/隐藏
- **所见即所得** — 实时渲染 Markdown，无需切换预览
- **如无必要，勿增实体** — 极简界面，专注内容本身

## 演示

![演示动图](resources/xw_20260324182911.gif)

## 截图

| 主页面 | 搜索 | 设置 |
|:---:|:---:|:---:|
| ![主页面](resources/img1.png) | ![搜索](resources/img2.png) | ![设置](resources/img3.png) |

**右键 AI 功能**

![AI功能](resources/img.png)

## 快捷键

| 快捷键 | 功能 |
|:---|:---|
| `Cmd+Opt+A` | 唤起 / 隐藏主窗口 |
| `Cmd+N` | 新建笔记 |
| `Cmd+F` | 搜索笔记 |
| `Cmd+[` / `Cmd+]` | 切换上 / 下一条笔记 |
| `Cmd+Backspace` | 删除当前笔记 |
| `Cmd+P` | Pin 置顶 |
| `Cmd+,` | 打开设置 |
| `Esc` | 清除搜索 |

> 触摸板左右滑动 / 鼠标横向滚动也可切换笔记。

## 功能特性

**已实现**

- ✅ 无边框悬浮窗口
- ✅ 所见即所得 Markdown 编辑器（Vditor）
- ✅ 自动保存（防抖）
- ✅ 全局快捷键唤起
- ✅ 笔记搜索
- ✅ 笔记置顶（Pin）
- ✅ 关键词系统
- ✅ AI 辅助写作（右键菜单）
- ✅ iCloud 目录文件存储
- ✅ 导入 / 导出

**计划中**

- ⏳ 深色 / 浅色主题切换
- ⏳ 代码块样式对齐 Typora 风格

## 数据存储

笔记存储在 iCloud 目录下，天然支持多设备同步：

```
~/Library/Mobile Documents/com~apple~CloudDocs/MarkNote/
├── metadata.json       # 笔记索引
├── note_<uuid>.md      # 笔记内容
└── ...
```

## 技术栈

| 层级 | 技术 |
|:---|:---|
| 框架 | Tauri 2.x + Vue 3.x + TypeScript |
| 编辑器 | Vditor |
| 状态管理 | Pinia 2.x |
| 样式 | UnoCSS |
| 存储 | 本地 `.md` 文件（iCloud 目录） |

## 开发指南

### 前置要求

- Node.js 20+
- Rust 1.70+
- macOS 12+

### 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run tauri dev

# 构建（Apple Silicon）
npm run tauri build -- --target aarch64-apple-darwin

# 构建（Intel）
npm run tauri build -- --target x86_64-apple-darwin
```

## 常见问题

### 提示"无法打开"（签名问题）

macOS Gatekeeper 阻止了未签名的应用，执行以下命令解除隔离：

```bash
sudo xattr -r -d com.apple.quarantine /Applications/MarkNote.app/
```
