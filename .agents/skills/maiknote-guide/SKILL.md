---
name: maiknote-guide
description: >-
  读取、搜索和整理用户在 MaikNote 中的本地笔记。笔记分布在多个"工作空间"里
  （iCloud 默认空间 + 用户自选的任意文件夹）。当用户提到"我的笔记"、"查一下笔记"、
  "笔记里有没有"、想根据笔记内容回答问题、总结笔记、新建笔记或整理笔记时使用。
---

# MaikNote 笔记

笔记不再只有一处：一个是 **iCloud 默认空间**，其余是用户自己挑的文件夹（工作空间）。
空间可以随时新增、删除、重命名，**所以每次动手前先列一次清单，不要硬编码路径、不要凭记忆**。

## 第一步：列出当前所有工作空间

```bash
python3 - <<'PY'
import json, os
cfg    = os.path.expanduser("~/Library/Application Support/com.april.maiknote/workspaces.json")
icloud = os.path.expanduser("~/Library/Mobile Documents/com~apple~CloudDocs/MaikNote")
meta   = os.path.expanduser("~/Library/Application Support/com.april.maiknote/workspace-meta")
rows = [("默认空间", "icloud", icloud, icloud)]
if os.path.exists(cfg):
    for w in json.load(open(cfg)).get("workspaces", []):
        rows.append((w["name"], w["id"], w["path"], os.path.join(meta, w["id"])))
for name, wid, root, idx in rows:
    print("\t".join([name, wid, root, idx, "OK" if os.path.isdir(root) else "MISSING"]))
PY
```

输出四列（制表符分隔）：`名称  id  内容根  索引目录`，末列是状态。

- **内容根**：`.md` 笔记真实所在目录。读文件、grep、列目录都在这里。
- **索引目录**：`metadata.json` 和 `directories.json` 所在目录。
  - 默认空间：两者相同，都在 iCloud 里（`<内容根>/metadata.json`）
  - 自定义空间：索引在 App 配置目录 `workspace-meta/<id>/`，**不和用户的笔记文件混在一起**
- 状态 `MISSING`：目录当前不存在（外接盘未挂载 / 同步没下来）。跳过它，并如实告知用户。

> 空间清单是动态的。用户随时可能新增或删掉空间，**每个任务开始时重跑一次**，不要缓存结论。

## 空间内部结构（两种空间一样）

```
<内容根>/
├── 笔记标题.md          # 根级笔记，文件名即标题（无 frontmatter）
├── 工作/                # 子目录，真实文件夹名 = 目录名，可多级嵌套
│   ├── 会议记录.md
│   └── 项目计划/
│       └── Q4目标.md
└── images/              # 仅默认空间有：笔记图片，不搜索
```

自定义空间是**用户自己的真实文件夹**，里面除了 `.md` 还可能有 PDF、代码、附件、隐藏文件——
只读 `.md`，不要动别的东西，也不要往里写临时文件。

## metadata.json（笔记索引）

每个空间一份，位于该空间的**索引目录**里：

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

- `fileName`：磁盘上的实际文件名（含 `.md`）
- `directoryId`：所属目录 ID，要查同空间的 `directories.json` 才知道磁盘路径
- `trashedAt` 非空 = 已进回收站，**默认忽略**
- `isLocked` 为 `true` 的笔记**不要修改**

## directories.json（目录树）

同目录下，`version: 1` + `directories: [{ id, name, parentId, createdAt, updatedAt }]`。
`parentId` 为 `null` 是根级目录；沿 `parentId` 链向上拼出相对路径，如 `工作/项目计划`。

## 定位一条笔记

1. 读该空间的 `metadata.json`，取 `fileName` 与 `directoryId`
2. 无 `directoryId` → `<内容根>/<fileName>`
3. 有 `directoryId` → 拼出目录路径 → `<内容根>/<目录路径>/<fileName>`
4. **磁盘为准**：索引可能落后于磁盘（用户可能在 App 外改过自定义空间的文件夹）。
   索引里查不到就直接按文件名/目录在磁盘上找，别断言"笔记不存在"。

## 查找笔记

1. 用户点名了空间 → 只在该空间内找；没点名 → 所有空间都找，并在回答里**标注来自哪个空间**
2. 先用 `metadata.json` 的 `title` 快速筛候选（忽略 `trashedAt` 非空的）
3. 需要全文搜索时，在清单里的每个内容根上 grep：
   ```bash
   grep -rl "关键词" "<内容根1>" "<内容根2>" --include="*.md"
   ```
4. 先看标题/文件名判断相关性，再读全文
5. 引用时说明来源（空间名 + 笔记标题/路径）；找不到就如实说，不要编造

## 修改规则

- **默认只读**。新建、修改、删除前先说明要做什么，等用户确认
- `isLocked: true` 的笔记绝对不能改
- 新建笔记放进哪个空间：用户指定 > 用户当前在用的空间 > 默认空间
- 新建笔记：
  1. 生成新 UUID 作为 `id`，文件名 = 标题 + `.md`（去掉 `/\:*?"<>|` 等非法字符）
  2. 同目录重名时加序号：`标题 2.md`
  3. 写 `.md` 文件到内容根下
  4. 在该空间 `metadata.json` 的 `notes` 里加条目
- 改 `.md` 后同步更新该空间 `metadata.json`（至少 `updatedAt`、`title`）；标题 = 正文第一个非空行纯文本（去 Markdown，最长 50 字）
- 删除笔记：优先移入回收站（`trashedAt` 置时间戳），不要直接 `rm`
- 跨空间复制/移动笔记或文件夹：**让用户在 App 里操作**（右键 → 复制到/移动到工作空间），界面会同时维护两边的索引和目录树。手动 `cp` 只适合用户明确要求、且接受索引不同步的场景
- 不要动 `assistants.json`、`images/`、`.md` 以外的文件；自定义空间里的非笔记文件一律不碰
