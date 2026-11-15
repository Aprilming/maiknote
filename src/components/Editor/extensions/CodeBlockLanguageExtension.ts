// src/components/Editor/extensions/CodeBlockLanguageExtension.ts
// 代码块语言的数据与查询工具。
//
// 语言选择器本身不在这里渲染：早先用 Decoration.widget 把按钮塞进代码块内部，
// 空代码块里就只剩一个不可编辑的按钮，光标落不进代码块、点也点不中。
// 现在由 TiptapEditor.vue 用挂在 body 上的浮层渲染，位置按代码块 DOM 的矩形算。

// 常见编程语言列表
export const PROGRAMMING_LANGUAGES = [
  { id: 'bash', name: 'bash', alias: ['shell', 'sh', 'zsh', 'bash'] },
  { id: 'python', name: 'Python', alias: ['py'] },
  { id: 'go', name: 'Go', alias: ['golang'] },
  { id: 'javascript', name: 'JavaScript', alias: ['js'] },
  { id: 'typescript', name: 'TypeScript', alias: ['ts'] },
  { id: 'c', name: 'C', alias: [] },
  { id: 'powershell', name: 'PowerShell', alias: ['ps1'] },
  { id: 'java', name: 'Java', alias: [] },
  { id: 'rust', name: 'Rust', alias: ['rs'] },
  { id: 'ruby', name: 'Ruby', alias: ['rb'] },
  { id: 'cpp', name: 'C++', alias: ['c++', 'cplusplus'] },
  { id: 'csharp', name: 'C#', alias: ['cs'] },
  { id: 'php', name: 'PHP', alias: [] },
  { id: 'swift', name: 'Swift', alias: [] },
  { id: 'kotlin', name: 'Kotlin', alias: ['kt'] },
  { id: 'scala', name: 'Scala', alias: [] },
  { id: 'sql', name: 'SQL', alias: [] },
  { id: 'html', name: 'HTML', alias: [] },
  { id: 'css', name: 'CSS', alias: [] },
  { id: 'scss', name: 'SCSS', alias: ['sass'] },
  { id: 'json', name: 'JSON', alias: [] },
  { id: 'yaml', name: 'YAML', alias: ['yml'] },
  { id: 'xml', name: 'XML', alias: [] },
  { id: 'markdown', name: 'Markdown', alias: ['md'] },
  { id: 'dockerfile', name: 'Dockerfile', alias: ['docker'] },
  { id: 'nginx', name: 'Nginx', alias: ['nginx conf'] },
  { id: 'lua', name: 'Lua', alias: [] },
  { id: 'perl', name: 'Perl', alias: ['pl'] },
  { id: 'r', name: 'R', alias: [] },
  { id: 'matlab', name: 'MATLAB', alias: [] },
  { id: 'julia', name: 'Julia', alias: [] },
  { id: 'haskell', name: 'Haskell', alias: ['hs'] },
  { id: 'elixir', name: 'Elixir', alias: ['ex'] },
  { id: 'erlang', name: 'Erlang', alias: ['erl'] },
  { id: 'clojure', name: 'Clojure', alias: ['clj'] },
  { id: 'dart', name: 'Dart', alias: [] },
  { id: 'vue', name: 'Vue', alias: [] },
  { id: 'jsx', name: 'JSX', alias: [] },
  { id: 'tsx', name: 'TSX', alias: [] },
  { id: 'graphql', name: 'GraphQL', alias: ['gql'] },
  { id: 'terraform', name: 'Terraform', alias: ['tf'] },
  { id: 'plaintext', name: '纯文本', alias: ['text', 'txt'] },
]

// 搜索语言
export function searchLanguages(query: string): typeof PROGRAMMING_LANGUAGES {
  if (!query.trim()) return PROGRAMMING_LANGUAGES
  const lower = query.toLowerCase()
  return PROGRAMMING_LANGUAGES.filter(
    (lang) =>
      lang.name.toLowerCase().includes(lower) ||
      lang.id.toLowerCase().includes(lower) ||
      lang.alias.some((a) => a.toLowerCase().includes(lower))
  )
}

// 语言 id → 展示名（javascript → JavaScript）
export function displayNameOf(languageId: string) {
  return PROGRAMMING_LANGUAGES.find((lang) => lang.id === languageId)?.name ?? languageId
}
