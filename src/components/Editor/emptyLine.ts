// 空行标记：Markdown 语法本身无法表达“空段落”（连续空行会被折叠成段落分隔），
// 所以空行在 .md 源码里必须带一个“序外标记”，才能在 源码 ↔ 渲染模式 之间稳定往返。
//
// 这里用零宽空格字符本身 U+200B（不是 &#8203; 这类实体，源码模式下用户看到的就是空行）：
// - 不能复用 &nbsp;，因为它已经被 Tab 缩进占用（见 tabInsert.ts 的 SOURCE_TAB_INSERT_TEXT）；
// - 零宽空格渲染不出任何东西，源码模式里那一行看起来就是普通空行；
// - 加载时由 EmptyLineNormalizer / AlignedParagraph 的 parse.updateDOM 还原成真正的空段落。
export const EMPTY_LINE_MARK = '\u200b'
export const EMPTY_LINE_CHAR = '\u200b'

const ZERO_WIDTH_RE = /\u200b/g
const ZERO_WIDTH_ENTITY_RE = /&#(?:8203|x200b);/gi
// 只认零宽空格与 ASCII 空白；\u00A0（Tab 缩进标记）必须当作内容保留
const PADDING_ONLY_RE = /^[\u0009\u000a\u000d\u0020]*$/

/** 判断一段文本是否“只有空行标记/空白”，即不含任何实际内容（兼容旧文件里的 &#8203; 实体） */
export function isBlankEmptyLineText(text?: string | null): boolean {
  if (!text) return true
  return PADDING_ONLY_RE.test(text.replace(ZERO_WIDTH_ENTITY_RE, '').replace(ZERO_WIDTH_RE, ''))
}
