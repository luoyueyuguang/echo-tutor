import { getSettings } from './db'

export interface LlmConfig {
  root: string
  apiKey: string
  model: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export function resolveLlm(): LlmConfig | null {
  const s = getSettings()
  const apiKey = s.llmApiKey.trim()
  const model = s.llmModel.trim()
  if (!apiKey || !model) return null
  let root = (s.llmBaseUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, '')
  if (root.endsWith('/chat/completions')) root = root.slice(0, -'/chat/completions'.length)
  if (!root) root = 'https://api.openai.com/v1'
  return { root, apiKey, model }
}

export function resolveTts(): LlmConfig | null {
  const s = getSettings()
  const apiKey = (s.ttsApiKey || s.llmApiKey).trim()
  if (!apiKey) return null
  let root = (s.ttsBaseUrl || s.llmBaseUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, '')
  if (root.endsWith('/audio/speech')) root = root.slice(0, -'/audio/speech'.length)
  if (root.endsWith('/chat/completions')) root = root.slice(0, -'/chat/completions'.length)
  if (!root) root = 'https://api.openai.com/v1'
  return { root, apiKey, model: (s.ttsModel || 'gpt-4o-mini-tts').trim() }
}

export class LlmError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'LlmError'
    this.status = status
  }
}

function timeoutSignal(ms: number, outer?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  return outer ? AbortSignal.any([outer, timeout]) : timeout
}

async function errorFrom(res: Response): Promise<LlmError> {
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 600)
  } catch {}
  if (res.status === 401 || res.status === 403) return new LlmError('API key rejected by the model provider.', res.status)
  if (res.status === 404) return new LlmError('Model or endpoint not found. Check base URL and model name.', res.status)
  if (res.status === 429) return new LlmError('Rate limited by the model provider. Try again shortly.', res.status)
  return new LlmError(`Model provider error ${res.status}${detail ? `: ${detail}` : ''}`, res.status)
}

export interface StreamOptions {
  temperature?: number
  signal?: AbortSignal
  timeoutMs?: number
  maxTokens?: number
}

export async function streamChat(
  cfg: LlmConfig,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  opts: StreamOptions = {},
): Promise<string> {
  const res = await fetch(`${cfg.root}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      stream: true,
      temperature: opts.temperature ?? 0.7,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
    signal: timeoutSignal(opts.timeoutMs ?? 120_000, opts.signal),
  })

  if (!res.ok) throw await errorFrom(res)

  const type = res.headers.get('content-type') ?? ''
  if (type.includes('application/json')) {
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      error?: { message?: string }
    }
    if (data.error) throw new LlmError(data.error.message ?? 'Model provider error')
    const text = data.choices?.[0]?.message?.content ?? ''
    if (text) onDelta(text)
    return text
  }

  if (!res.body) throw new LlmError('Model provider returned an empty stream.')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let finished = false

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') {
      finished = true
      return
    }
    let parsed: {
      choices?: { delta?: { content?: string | null }; message?: { content?: string } }[]
      error?: { message?: string }
    }
    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }
    if (parsed.error) throw new LlmError(parsed.error.message ?? 'Model provider error')
    const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? ''
    if (delta) {
      full += delta
      onDelta(delta)
    }
  }

  while (!finished) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx = buffer.indexOf('\n\n')
    while (idx !== -1) {
      const chunk = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      for (const line of chunk.split('\n')) handleLine(line)
      idx = buffer.indexOf('\n\n')
    }
  }
  if (buffer.trim()) {
    for (const line of buffer.split('\n')) handleLine(line)
  }
  if (!full.trim()) throw new LlmError('Model returned no text. Check that the model supports chat completions.')
  return full
}

function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  const objStart = cleaned.indexOf('{')
  const arrStart = cleaned.indexOf('[')
  const start = objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart)
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'))
  if (start === -1 || end === -1 || end < start) throw new LlmError('Model did not return valid JSON.')
  const slice = cleaned.slice(start, end + 1)
  try {
    return JSON.parse(slice)
  } catch (err) {
    throw new LlmError(`Model returned malformed JSON: ${(err as Error).message}`)
  }
}

export async function completeJson<T>(
  cfg: LlmConfig,
  messages: ChatMessage[],
  opts: StreamOptions & { jsonMode?: boolean } = {},
): Promise<T> {
  const body = (useJsonMode: boolean) => ({
    model: cfg.model,
    messages,
    stream: false,
    temperature: opts.temperature ?? 0.2,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
  })

  const send = async (useJsonMode: boolean) =>
    fetch(`${cfg.root}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body(useJsonMode)),
      signal: timeoutSignal(opts.timeoutMs ?? 120_000, opts.signal),
    })

  let res = await send(opts.jsonMode !== false)
  if (!res.ok && (res.status === 400 || res.status === 422) && opts.jsonMode !== false) {
    res = await send(false)
  }
  if (!res.ok) throw await errorFrom(res)

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!text.trim()) throw new LlmError('Model returned an empty response.')
  return extractJson(text) as T
}

export async function transcribeAudio(cfg: LlmConfig, file: Blob, filename: string, language = 'en'): Promise<string> {
  const form = new FormData()
  form.append('file', file, filename)
  form.append('model', 'whisper-1')
  form.append('language', language)
  const res = await fetch(`${cfg.root}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: form,
    signal: timeoutSignal(90_000),
  })
  if (!res.ok) throw await errorFrom(res)
  const data = (await res.json()) as { text?: string }
  return data.text ?? ''
}

export async function synthesizeSpeech(
  cfg: LlmConfig,
  text: string,
  voice: string,
  speed = 1,
  instructions?: string,
): Promise<{ audio: ArrayBuffer; contentType: string }> {
  const send = (withInstructions: boolean) =>
    fetch(`${cfg.root}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model || 'gpt-4o-mini-tts',
        input: text,
        voice: voice || 'alloy',
        speed,
        response_format: 'mp3',
        ...(withInstructions && instructions ? { instructions } : {}),
      }),
      signal: timeoutSignal(90_000),
    })

  let res = await send(Boolean(instructions))
  if (!res.ok && (res.status === 400 || res.status === 422) && instructions) res = await send(false)
  if (!res.ok) throw await errorFrom(res)
  return { audio: await res.arrayBuffer(), contentType: res.headers.get('content-type') ?? 'audio/mpeg' }
}
