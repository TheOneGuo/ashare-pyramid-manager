// server/src/llm.ts · OpenAI-compatible LLM helper
// 用于：fxbaogao 研报 PDF 文本 → 结构化精读（DeepSeek 默认）
//
// 配置（走 .env，绝不 commit）：
//   LLM_API_KEY=sk-...
//   LLM_BASE_URL=https://gpt-agent.cc/v1
//   LLM_MODEL=MiniMax-M3
//
// 接口：chatJson({ system, user, jsonHint?, maxTokens? }) → 解析后的对象/字符串
//       没有 key 时返回 null（不抛错，让上层走 mock 兜底）

import { env } from 'node:process'

const API_KEY = (env.LLM_API_KEY || '').trim()
// 兼容两种写法：
//   LLM_BASE_URL=https://api.deepseek.com           → 拼 https://api.deepseek.com/v1/chat/completions
//   LLM_BASE_URL=https://gpt-agent.cc/v1            → 拼 https://gpt-agent.cc/v1/chat/completions
//   LLM_BASE_URL=https://gpt-agent.cc/v1/           → 同上
const RAW_BASE = (env.LLM_BASE_URL || 'https://gpt-agent.cc/v1').trim().replace(/\/+$/, '')
// 如果用户已经写了 /v1，就不再拼；否则拼 /v1
const BASE_URL = /\/v\d+$/i.test(RAW_BASE) ? RAW_BASE : `${RAW_BASE}/v1`
const MODEL = (env.LLM_MODEL || 'MiniMax-M3').trim()

export function isLlmAvailable(): boolean {
  return API_KEY.length > 0
}

export function llmConfigInfo(): { ok: boolean; base: string; model: string } {
  return { ok: isLlmAvailable(), base: BASE_URL, model: MODEL }
}

interface ChatJsonArgs {
  system: string
  user: string
  jsonHint?: boolean // 强制 JSON 输出
  maxTokens?: number
  temperature?: number
}

export async function chatJson<T = any>(args: ChatJsonArgs): Promise<T | null> {
  if (!isLlmAvailable()) return null
  const url = `${BASE_URL}/chat/completions`
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: args.system },
      { role: 'user', content: args.user },
    ],
    temperature: args.temperature ?? 0.3,
    max_tokens: args.maxTokens ?? 2000,
    ...(args.jsonHint ? { response_format: { type: 'json_object' } } : {}),
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
    })
    if (!r.ok) {
      // 不抛错，返回 null 让上层走兜底
      console.warn('[llm] chat failed', r.status, await r.text().catch(() => ''))
      return null
    }
    const data: any = await r.json()
    const text: string = data?.choices?.[0]?.message?.content || ''
    if (!text) return null
    if (args.jsonHint) {
      // 模型可能包 ```json ...``` 围栏，做多次剥离
      let stripped = text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .replace(/^```/i, '')
        .replace(/```$/i, '')
        .trim()
      try { return JSON.parse(stripped) as T } catch (e: any) {
        console.warn('[llm] json parse fail, first 200 chars:', stripped.slice(0, 200))
        return null
      }
    }
    return text as unknown as T
  } catch (e: any) {
    console.warn('[llm] chat error', e?.message || e)
    return null
  }
}
