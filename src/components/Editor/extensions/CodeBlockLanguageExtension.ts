// src/components/Editor/extensions/CodeBlockLanguageExtension.ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const codeBlockLanguageKey = new PluginKey('codeBlockLanguage')

// 常见编程语言列表
export const PROGRAMMING_LANGUAGES = [
  { id: 'shell', name: 'Shell', alias: ['bash', 'sh', 'zsh'] },
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

export const CodeBlockLanguageExtension = Extension.create({
  name: 'codeBlockLanguage',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codeBlockLanguageKey,
        props: {
          decorations(state) {
            const decorations: Decoration[] = []

            state.doc.forEach((node, offset) => {
              if (node.type.name === 'codeBlock') {
                // 获取当前语言
                const currentLanguage = node.attrs.language || 'plaintext'

                // 在代码块内容开始处放置装饰，用 CSS 定位到外部
                const langSelector = Decoration.widget(
                  offset + 1,
                  () => {
                    const container = document.createElement('div')
                    container.className = 'code-block-language-selector'
                    container.setAttribute('contenteditable', 'false')

                    // 语言标签按钮
                    const langLabel = document.createElement('button')
                    langLabel.className = 'code-block-lang-btn'
                    langLabel.textContent = currentLanguage
                    langLabel.title = '点击选择语言'

                    // 下拉菜单
                    const dropdown = document.createElement('div')
                    dropdown.className = 'code-block-lang-dropdown'
                    dropdown.style.display = 'none'

                    // 搜索框
                    const searchInput = document.createElement('input')
                    searchInput.className = 'code-block-lang-search'
                    searchInput.type = 'text'
                    searchInput.placeholder = '搜索语言...'

                    // 语言列表容器
                    const listContainer = document.createElement('div')
                    listContainer.className = 'code-block-lang-list'

                    // 保存当前代码块的位置信息
                    const codeBlockPos = offset

                    // 渲染语言列表
                    function renderList(languages: typeof PROGRAMMING_LANGUAGES, activeLangId: string) {
                      listContainer.innerHTML = ''
                      languages.forEach((lang) => {
                        const item = document.createElement('div')
                        item.className = 'code-block-lang-item'
                        if (lang.id === activeLangId) {
                          item.classList.add('active')
                        }
                        item.textContent = lang.name
                        item.dataset.langId = lang.id
                        item.addEventListener('click', (e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          // 触发自定义事件，让 editor 处理语言变更
                          const event = new CustomEvent('codeblock-language-change', {
                            detail: {
                              pos: codeBlockPos,
                              language: lang.id,
                            },
                            bubbles: true,
                          })
                          container.dispatchEvent(event)
                          langLabel.textContent = lang.id
                          dropdown.style.display = 'none'
                        })
                        listContainer.appendChild(item)
                      })
                    }

                    // 初始渲染
                    renderList(PROGRAMMING_LANGUAGES, currentLanguage)

                    // 搜索功能
                    searchInput.addEventListener('input', (e) => {
                      const query = (e.target as HTMLInputElement).value
                      const filtered = searchLanguages(query)
                      renderList(filtered, currentLanguage)
                    })

                    // 点击标签切换下拉
                    langLabel.addEventListener('click', (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const isShown = dropdown.style.display === 'block'
                      dropdown.style.display = isShown ? 'none' : 'block'
                      if (!isShown) {
                        searchInput.value = ''
                        searchInput.focus()
                        renderList(PROGRAMMING_LANGUAGES, currentLanguage)
                      }
                    })

                    // 阻止下拉菜单点击冒泡
                    dropdown.addEventListener('click', (e) => {
                      e.stopPropagation()
                    })

                    dropdown.appendChild(searchInput)
                    dropdown.appendChild(listContainer)
                    container.appendChild(langLabel)
                    container.appendChild(dropdown)

                    // 点击外部关闭
                    document.addEventListener('click', function onClickOutside(e: MouseEvent) {
                      if (!container.contains(e.target as Node)) {
                        dropdown.style.display = 'none'
                        document.removeEventListener('click', onClickOutside)
                      }
                    })

                    return container
                  },
                  { side: 1, key: `language-${offset}` }
                )

                decorations.push(langSelector)
              }
            })

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
