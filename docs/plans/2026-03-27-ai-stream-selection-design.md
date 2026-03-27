# AI 流式回复选区处理设计

## 目标

根据用户是否有选中文本，分两种情况处理 AI 回复：

1. **无选中内容**：清空编辑器，从头流式插入 AI 回复
2. **有选中内容**：仅删除选中内容，保留其余内容，在原选中起始位置流式插入 AI 回复

## 核心问题

当前实现使用 `indexOf` 字符串匹配查找选中文本位置，但当选中内容包含特殊字符、格式（如代码块、链接、加粗等）时，Markdown 源码与渲染后文本不同，导致 `indexOf` 找不到匹配，`pendingSelectionText` 被错误清空，最终"有选中内容"被错误当作"无选中内容"处理，清空整个编辑器。

## 解决方案

使用 Vditor 原生 `getSelection()` API 获取准确的选区信息，避免字符串匹配。

## 变量设计

移除不可靠的字符串匹配变量，新增：

```typescript
let userHadSelection = false   // 用户发起 AI 请求时是否有选中文本
```

保留但不依赖：

```typescript
let contentBeforeSelection = '' // 选中内容之前的内容（仅用于拼接最终结果）
let contentAfterSelection = ''  // 选中内容之后的内容
```

## 实现逻辑

### handleAI 修改

1. 检查 AI 配置
2. 获取选区信息：`vditorInstance.getSelection()`
3. 设置 `userHadSelection = !!selection`
4. 如果有选中文本，保存 `contentBeforeSelection` 和 `contentAfterSelection`

### callAI 修改

#### 初始化阶段

```typescript
if (vditorInstance) {
  if (userHadSelection && contentBeforeSelection !== undefined) {
    // 有选中内容：编辑器内容保持不变（不做 setValue）
    // 删除操作由用户选择 AI 菜单时立即执行
  } else if (!userHadSelection) {
    // 无选中内容：清空编辑器
    vditorInstance.setValue('')
  }
}
```

#### 流式输出阶段

```typescript
while (true) {
  // ... read chunk ...
  fullContent += content

  if (vditorInstance) {
    if (userHadSelection) {
      // 有选中：拼接 选中前内容 + AI回复
      vditorInstance.setValue(contentBeforeSelection + fullContent)
    } else {
      // 无选中：直接显示 AI 回复
      vditorInstance.setValue(fullContent)
    }
  }
}
```

#### 完成阶段

```typescript
// 生成完成后，如果有选中后的内容，需要完整拼接
if (contentAfterSelection && vditorInstance) {
  const finalContent = contentBeforeSelection + fullContent + contentAfterSelection
  vditorInstance.setValue(finalContent)
  emit('update', finalContent)
}
```

## 关键点

1. **`userHadSelection` 在 handleAI 入口处确定**，一旦设置就不再改变
2. **不依赖 `pendingSelectionText` 是否为空**来判断是否有选中文本
3. **使用 `!!vditorInstance.getSelection()`** 获取布尔值，区分有无选中
4. **流式输出时只拼接，不重复重建**

## 文件变更

- `src/components/Editor/VditorEditor.vue`
  - 修改 `handleAI()` 函数
  - 修改 `callAI()` 函数中的判断逻辑
  - 移除 `pendingSelectionText` 相关的歧义判断
