# CLI 速查

## 开发

```bash
# 安装依赖
npm install

# 启动开发模式（热重载）
npm run tauri dev

# 仅启动前端 dev server（不启动 Tauri）
npm run dev
```

## 构建

```bash
# 仅前端类型检查 + 构建（不打包 .app）
npm run build

# 构建 Apple Silicon (.dmg)
npm run tauri build -- --target aarch64-apple-darwin

# 构建 Intel (.dmg)
npm run tauri build -- --target x86_64-apple-darwin
```

构建产物在 `src-tauri/target/<target>/release/bundle/dmg/` 下。

## 版本发布

```bash
# 1. 打 tag。发布构建会从 tag 自动注入版本号，例如 v0.10.22 → 0.10.22
git tag v0.x.x

# 2. 推送（触发 GitHub Actions 自动构建+发布）
git push origin main --tags
```

本地开发构建默认读取 `version.json`。需要临时覆盖版本号时可运行：

```bash
APP_VERSION=0.x.x npm run tauri build
npm run sync-version -- v0.x.x
```

> CI 配置见 `.github/workflows/build.yml`。
> - push 到 main → 仅构建 aarch64 做验证
> - push v* tag → 并行构建 aarch64 + x86_64，自动创建 Release

## 数据

```bash
# 笔记存储位置（iCloud）
ls ~/Library/Mobile\ Documents/com~apple~CloudDocs/MaikNote/
```

## 常见问题

```bash
# Gatekeeper 拦截未签名应用
sudo xattr -r -d com.apple.quarantine /Applications/MaikNote.app/
```

## 技术栈速览

| 用途 | 工具 |
|------|------|
| 框架 | Tauri 2.x + Vue 3 + TypeScript |
| 编辑器 | Tiptap |
| 状态管理 | Pinia |
| 样式 | UnoCSS |
| 构建 | Vite + vue-tsc |
| CI | GitHub Actions (macOS runners) |


### 删除tag
本地 + 线上
git tag -l "0.2.*" | xargs git push origin --delete

### 本地仓库彻底清理掉那些远程已经不存在的标签引用
git fetch -p -P