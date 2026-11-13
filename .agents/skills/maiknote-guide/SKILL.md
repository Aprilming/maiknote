---
name: maiknote-guide
description: >-
  读取、搜索和整理用户在 MaikNote 中的本地笔记。当用户提到"我的笔记"、"查一下笔记"、
  "笔记里有没有"、想根据笔记内容回答问题、总结笔记、新建笔记或整理笔记时使用。
---

# MaikNote 笔记

## 笔记位置

```
~/Library/Mobile Documents/com~apple~CloudDocs/MaikNote/
```

这是 iCloud Drive 目录，笔记会自动同步到用户的其他 Apple 设备。

## 组织结构

```
MaikNote/
├── metadata.json        # 笔记索引（所有笔记的元数据）
├── directories.json     # 目录结构定义
├── assistants.json      # AI 助手配置（不要动）
├── images/              # 笔记中的图片附件
├── 笔记标题.md           # 根目录下的笔记
├── 工作/                 # 子目录（真实文件夹名 = 目录名）
│   ├── 会议记录.md
│   └── 项目计划/         # 可多级嵌套
│       └── Q4目标.md
└── ...
```

- 每条笔记是一个 `.md` 文件，**文件名就是标题**（无 frontmatter）
- 文件夹按真实名字嵌套，和 `directories.json` 中的目录树对应
- `images/` 存放笔记中的图片，不要搜索

## 索引文件 metadata.json

这是**笔记的唯一索引**，包含所有笔记的元数据。结构如下：

```json
{
  "version": 2,
  "notes": [
    {
      "id": "uuid",
      "title": "笔记标题",
      "createdAt": 1700000000000,
      "updatedAt": 1700000000000,
      "isPinned": false,
      "isLocked": false,
      "directoryId": "目录uuid 或缺省表示根目录",
      "fileName": "笔记标题.md",
      "trashedAt": null
    }
  ]
}
```

关键字段说明：
- `fileName`：磁盘上的实际文件名（含 `.md`）
- `directoryId`：所属目录 ID，需要查 `directories.json` 才能得到磁盘路径
- `trashedAt`：非空表示已删除（在回收站中），**默认忽略这些笔记**
- `isPinned`：用户收藏的笔记
- `isLocked`：锁定的笔记，**不要修改**

## 目录文件 directories.json

```json
{
  "version": 1,
  "directories": [
    {
      "id": "uuid",
      "name": "工作",
      "parentId": null,
      "createdAt": 1700000000000,
      "updatedAt": 1700000000000
    },
    {
      "id": "uuid2",
      "name": "项目计划",
      "parentId": "uuid",
      "createdAt": 1700000000000,
      "updatedAt": 1700000000000
    }
  ]
}
```

- `parentId` 为 `null` 表示根级目录
- 根据 `parentId` 链可以拼出磁盘路径，如 `工作/项目计划`
- 根目录下的笔记（`directoryId` 缺省）直接在 `MaikNote/` 下

## 如何定位一条笔记的磁盘路径

1. 读 `metadata.json`，找到目标笔记的 `fileName` 和 `directoryId`
2. 如果 `directoryId` 缺省或为空 → 路径为 `MaikNote/<fileName>`
3. 如果有 `directoryId` → 读 `directories.json`，沿 `parentId` 链向上拼出目录路径 → `MaikNote/<目录路径>/<fileName>`

## 如何查找笔记

1. **先读 `metadata.json`**，按 `title` 字段快速筛选候选笔记（忽略 `trashedAt` 非空的）
2. 如需全文搜索，用 grep/ripgrep 在笔记根目录中搜索：
   ```bash
   grep -rl "关键词" ~/Library/Mobile\ Documents/com~apple~CloudDocs/MaikNote/ --include="*.md"
   ```
3. 先看文件名判断相关性，再读全文
4. 引用笔记内容时，说明来自哪条笔记（标题和路径）
5. 找不到时如实说明，不要编造笔记内容

## 修改规则

- **默认只读**。创建、修改、删除笔记前，先向用户说明要做什么并等待确认
- `isLocked` 为 `true` 的笔记**绝对不能修改**
- 修改 `.md` 文件内容后，**必须同步更新 `metadata.json`**（至少更新 `updatedAt` 和 `title`）
- 标题 = 正文第一个非空行的纯文本（去掉 Markdown 语法，最长 50 字符）
- 新建笔记时：
  1. 生成新的 UUID 作为 `id`
  2. 文件名 = 标题 + `.md`（去掉 `/\:*?"<>|` 等非法字符）
  3. 同目录下文件名重复时加序号：`标题 2.md`
  4. 在 `metadata.json` 的 `notes` 数组中添加对应条目
- 不要改动 `assistants.json`、`images/` 目录、`.md` 以外的文件
