import type {
  AppSettings,
  ChatStreamEvent,
  ContentBundle,
  EssayRow,
  Exam,
  GradeResult,
  ReviewItemRow,
  ReviewItemWithPreview,
  SessionMode,
  SessionReport,
  SessionRow,
  SettingsInput,
  StatsPayload,
  TurnRow,
} from './shared/types'

export class ApiError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    let message = `请求失败（${res.status}）`
    let code = 'http_error'
    try {
      const body = (await res.json()) as { message?: string; error?: string }
      if (body.message) message = body.message
      if (body.error) code = body.error
    } catch {}
    throw new ApiError(message, res.status, code)
  }
  return (await res.json()) as T
}

export interface SessionEnvelope {
  session: SessionRow
  opening: string
  turns?: TurnRow[]
}

export interface MetaPayload {
  modes: SessionMode[]
  exams: Exam[]
  counts: Record<string, number>
  settings: AppSettings
}

export interface EssayListRow extends Omit<EssayRow, 'text' | 'grade'> {
  grade: GradeResult
}

export const api = {
  health: () => request<{ ok: boolean; llm: boolean; version: string }>('/api/health'),

  getSettings: () => request<AppSettings>('/api/settings'),
  saveSettings: (input: SettingsInput) =>
    request<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(input) }),
  testLlm: () => request<{ ok: boolean; reply: string }>('/api/llm/test', { method: 'POST', body: '{}' }),

  getContent: () => request<ContentBundle>('/api/content'),
  getMeta: () => request<MetaPayload>('/api/meta'),

  createSession: (mode: SessionMode, exam: Exam | null, meta: Record<string, unknown>) =>
    request<SessionEnvelope>('/api/sessions', { method: 'POST', body: JSON.stringify({ mode, exam, meta }) }),
  getSession: (id: number) => request<{ session: SessionRow; turns: TurnRow[] }>(`/api/sessions/${id}`),
  addTurn: (id: number, role: 'user' | 'assistant', text: string, audioMs?: number) =>
    request<TurnRow>(`/api/sessions/${id}/turns`, {
      method: 'POST',
      body: JSON.stringify({ role, text, audioMs }),
    }),
  endSession: (id: number) => request<SessionReport>(`/api/sessions/${id}/end`, { method: 'POST', body: '{}' }),
  getSessionReport: (id: number) => request<SessionReport>(`/api/sessions/${id}/report`),
  deleteSession: (id: number) => request<{ ok: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' }),
  listSessions: () => request<SessionRow[]>('/api/sessions'),

  gradeWriting: (promptId: string, text: string, durationSec: number | null) =>
    request<{ essayId: number; grade: GradeResult }>('/api/writing/grade', {
      method: 'POST',
      body: JSON.stringify({ promptId, text, durationSec }),
    }),
  listEssays: () => request<EssayListRow[]>('/api/essays'),
  getEssay: (id: number) => request<EssayRow>(`/api/essays/${id}`),
  deleteEssay: (id: number) => request<{ ok: boolean }>(`/api/essays/${id}`, { method: 'DELETE' }),

  dueReviews: () => request<ReviewItemWithPreview[]>('/api/review/due'),
  allReviews: () => request<ReviewItemRow[]>('/api/review'),
  addReview: (input: { kind: 'error' | 'vocab' | 'phrase'; front: string; back: string; note?: string }) =>
    request<{ id: number }>('/api/review', { method: 'POST', body: JSON.stringify(input) }),
  gradeReview: (id: number, rating: 1 | 2 | 3 | 4) =>
    request<{ ok: boolean; dueAt: number }>(`/api/review/${id}/grade`, {
      method: 'POST',
      body: JSON.stringify({ rating }),
    }),
  deleteReview: (id: number) => request<{ ok: boolean }>(`/api/review/${id}`, { method: 'DELETE' }),

  stats: () => request<StatsPayload>('/api/stats'),

  tts: async (text: string, voice: string, speed: number, instructions?: string): Promise<ArrayBuffer> => {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, speed, instructions }),
    })
    if (!res.ok) {
      let message = '语音合成失败。'
      try {
        const body = (await res.json()) as { message?: string }
        if (body.message) message = body.message
      } catch {}
      throw new ApiError(message, res.status, 'tts_error')
    }
    return res.arrayBuffer()
  },

  asr: async (blob: Blob): Promise<string> => {
    const form = new FormData()
    form.append('file', blob, 'speech.webm')
    const res = await fetch('/api/asr', { method: 'POST', body: form })
    if (!res.ok) {
      let message = '语音识别失败。'
      try {
        const body = (await res.json()) as { message?: string }
        if (body.message) message = body.message
      } catch {}
      throw new ApiError(message, res.status, 'asr_error')
    }
    const data = (await res.json()) as { text: string }
    return data.text
  },
}

export interface ChatHandlers {
  onDelta: (text: string) => void
  onDone: (turnId: number, text: string) => void
  onError: (message: string) => void
}

export async function streamChat(
  body: { sessionId: number; message: string; audioMs?: number },
  handlers: ChatHandlers,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    let message = `对话请求失败（${res.status}）`
    try {
      const data = (await res.json()) as { message?: string }
      if (data.message) message = data.message
    } catch {}
    handlers.onError(message)
    return
  }

  if (!res.body) {
    handlers.onError('模型没有返回内容。')
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payload = trimmed.slice(5).trim()
    if (!payload) return
    let event: ChatStreamEvent
    try {
      event = JSON.parse(payload)
    } catch {
      return
    }
    if (event.type === 'delta') handlers.onDelta(event.text)
    else if (event.type === 'done') {
      finished = true
      handlers.onDone(event.turnId, event.text)
    } else if (event.type === 'error') {
      finished = true
      handlers.onError(event.message)
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
      if (finished) break
    }
  }
}
