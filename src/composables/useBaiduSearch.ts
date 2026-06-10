import { fetch } from '@tauri-apps/plugin-http'

const BAIDU_SEARCH_URL = 'https://qianfan.baidubce.com/v2/ai_search/mcp'

/**
 * 发送 MCP 请求（带 id，等待响应）
 */
async function mcpRequest(method: string, params: unknown, apiKey: string): Promise<unknown> {
  const id = crypto.randomUUID()
  const body = { jsonrpc: '2.0', id, method, params }

  console.log(`[BaiduSearch] MCP 请求:`, JSON.stringify({ method, id }).slice(0, 200))
  const response = await fetch(BAIDU_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '无法读取错误详情')
    throw new Error(`请求失败: ${response.status} ${errText.slice(0, 200)}`)
  }

  const rawText = await response.text()
  const parsed = JSON.parse(rawText)
  console.log(`[BaiduSearch] MCP 响应 ${method}:`, rawText.slice(0, 200))

  if (parsed.error) {
    throw new Error(`MCP 错误: ${parsed.error.message} (code: ${parsed.error.code})`)
  }

  return parsed.result
}

/**
 * 发送 MCP 通知（无 id，不等待响应）
 */
async function mcpNotify(method: string, params: unknown, apiKey: string): Promise<void> {
  const body = { jsonrpc: '2.0', method, params }

  console.log(`[BaiduSearch] MCP 通知:`, method)
  const response = await fetch(BAIDU_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '无法读取错误详情')
    console.warn(`[BaiduSearch] 通知发送失败:`, errText.slice(0, 200))
  }
}

/**
 * 调用百度 AI Search MCP（含初始化握手）
 */
export async function callBaiduSearch(
  query: string,
  apiKey: string,
  options?: {
    model?: string
    instruction?: string
    temperature?: number
    top_p?: number
    resource_type_filter?: Array<{ type: string; top_k: number }>
  }
): Promise<string> {
  try {
    // Step 1: 初始化
    console.log('[BaiduSearch] 初始化 MCP 连接...')
    await mcpRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'maiknote', version: '1.0' },
    }, apiKey)

    // Step 2: 发送 initialized 通知（无 id，不等待响应）
    console.log('[BaiduSearch] 发送 initialized 通知...')
    await mcpNotify('notifications/initialized', {}, apiKey)

    // Step 3: 查询可用工具
    console.log('[BaiduSearch] 查询工具列表...')
    let toolName = 'AIsearch'
    try {
      const toolsResult = await mcpRequest('tools/list', {}, apiKey) as { tools?: Array<{ name: string }> }
      if (toolsResult?.tools?.length) {
        toolName = toolsResult.tools[0].name
        console.log('[BaiduSearch] 发现工具:', toolName)
      }
    } catch {
      console.log('[BaiduSearch] tools/list 失败，使用默认工具名 AIsearch')
    }

    // Step 4: 调用搜索工具
    console.log('[BaiduSearch] 调用工具:', toolName, 'query:', query)
    const result = await mcpRequest('tools/call', {
      name: toolName,
      arguments: {
        query,
        ...(options?.model && { model: options.model }),
        ...(options?.instruction && { instruction: options.instruction }),
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.top_p !== undefined && { top_p: options.top_p }),
        ...(options?.resource_type_filter && { resource_type_filter: options.resource_type_filter }),
      },
    }, apiKey) as { content?: Array<{ type: string; text: string }>; isError?: boolean }

    if (result?.isError) {
      throw new Error('搜索返回错误')
    }

    if (result?.content) {
      const texts = result.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n')
      if (!texts) {
        throw new Error('搜索未返回文本结果')
      }
      console.log('[BaiduSearch] 搜索结果长度:', texts.length)
      return texts
    }

    throw new Error('搜索响应格式异常')
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('网络请求失败，请检查网络连接')
    }
    throw error
  }
}
