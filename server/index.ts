import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { ChatStreamEvent, Correction, Exam, SessionMode } from '../src/shared/types'
import {
  addReviewItem,
  addTurn,
  bandTrend,
  createSession,
  deleteEssay,
  deleteReviewItem,
  deleteSession,
  dueReviewCount,
  dueReviewItems,
  endSession,
  errorCategoryCounts,
  essayCount,
  getEssay,
  getReviewItem,
  getSession,
  getSessionReport,
  getSettings,
  insertEssay,
  listCorrections,
  listEssays,
  listReviewItems,
  listSessions,
  listTurns,
  publicSettings,
  saveAssessment,
  saveCorrections,
  saveSettings,
  sessionsSince,
  todayMinutes,
  totalMinutes,
  updateReviewItem,
  activityByDay,
  wordsSpokenSince,
  recentSessionSummaries,
} from './db'
import { bundle, writingTask } from './content'
import { gradeWriting, buildSessionReport, writingWordCount } from './grading'
import { resolveLlm, resolveTts, streamChat, transcribeAudio, synthesizeSpeech, LlmError, type LlmConfig } from './llm'
import { buildTutorMessages, openingFor, type SessionMeta } from './prompts'
import { previewIntervals, schedule, type Rating } from './srs'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '127.0.0.1'
const DIST = join(process.cwd(), 'dist')

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })

const fail = (message: string, status = 400, code = 'bad_request') =>
  json({ error: code, message }, status)

class HttpError extends Error {
  status: number
  code: string
  constructor(message: string, status = 400, code = 'bad_request') {
    super(message)
    this.status = status
    this.code = code
  }
}

const MODES: SessionMode[] = ['free', 'ielts.p1', 'ielts.p2', 'ielts.p3', 'toefl.speech', 'scenario', 'dictation', 'shadow']
const EXAMS: Exam[] = ['ielts', 'toefl', 'kaoyan']

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function needLlm(): LlmConfig {
  const cfg = resolveLlm()
  if (!cfg) {
    throw new HttpError('尚未配置模型。请在设置中填写 API Base URL、模型名和 API Key。', 409, 'llm_not_configured')
  }
  return cfg
}

function normalizeCorrectionItems(corrections: Correction[], source: string) {
  for (const c of corrections) {
    if (c.category === 'task' || c.category === 'pronunciation') continue
    const front = c.original.trim()
    if (front.length < 2 || /^[（(]/.test(front)) continue
    addReviewItem({
      kind: 'error',
      front,
      back: `${c.suggestion}${c.explanation ? ` — ${c.explanation}` : ''}`,
      source,
    })
  }
}

function parseMeta(value: unknown): SessionMeta {
  const raw = asRecord(value)
  const meta: SessionMeta = {}
  if (typeof raw.topic === 'string') meta.topic = raw.topic
  if (typeof raw.part2Id === 'string') meta.part2Id = raw.part2Id
  if (typeof raw.scenarioId === 'string') meta.scenarioId = raw.scenarioId
  if (typeof raw.toeflId === 'string') meta.toeflId = raw.toeflId
  return meta
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return asRecord(await req.json())
  } catch {
    throw new HttpError('请求体必须是合法 JSON。', 400, 'invalid_json')
  }
}

/* ------------------------------- routes ------------------------------- */

async function handleApi(req: Request, url: URL): Promise<Response> {
  const parts = url.pathname.split('/').filter(Boolean) // api, ...
  const method = req.method
  const seg = (i: number) => parts[i]

  if (parts[1] === 'health' && method === 'GET') {
    return json({ ok: true, llm: Boolean(resolveLlm()), version: '0.1.0' })
  }

  if (parts[1] === 'settings') {
    if (method === 'GET') return json(publicSettings())
    if (method === 'PUT') return json(saveSettings(await readJson(req)))
  }

  if (parts[1] === 'content' && method === 'GET') {
    if (seg(2) === 'writing') {
      const exam = url.searchParams.get('exam')
      return json(exam ? bundle.writing.filter((t) => t.exam === exam) : bundle.writing)
    }
    if (seg(2) === 'ielts-speaking') return json(bundle.ieltsSpeaking)
    if (seg(2) === 'toefl-speaking') return json(bundle.toeflSpeaking)
    if (seg(2) === 'scenarios') return json(bundle.scenarios)
    if (seg(2) === 'drills') return json(bundle.drills)
    if (seg(2) === 'phrases') return json(bundle.phrases)
    if (seg(2) === 'rubrics') return json(bundle.rubrics)
    return json(bundle)
  }

  if (parts[1] === 'sessions') {
    if (method === 'GET' && !seg(2)) return json(listSessions(50))

    if (method === 'POST' && !seg(2)) {
      const body = await readJson(req)
      const mode = String(body.mode ?? 'free') as SessionMode
      if (!MODES.includes(mode)) throw new HttpError('未知练习模式。', 400, 'invalid_mode')
      const examRaw = body.exam === null || body.exam === undefined ? null : String(body.exam)
      if (examRaw && !EXAMS.includes(examRaw as Exam)) throw new HttpError('未知考试类型。', 400, 'invalid_exam')
      const meta = parseMeta(body.meta)
      const session = createSession(mode, examRaw as Exam | null, meta as unknown as Record<string, unknown>)
      const opening = openingFor(mode, meta)
      addTurn(session.id, 'assistant', opening)
      return json({ session, opening })
    }

    const id = Number(seg(2))
    if (!Number.isFinite(id)) throw new HttpError('无效的会话 ID。', 400)

    if (method === 'GET' && seg(3) === undefined) {
      const session = getSession(id)
      if (!session) throw new HttpError('会话不存在。', 404, 'not_found')
      return json({ session, turns: listTurns(id) })
    }

    if (method === 'GET' && seg(3) === 'report') {
      const report = getSessionReport(id)
      if (!report) throw new HttpError('这次练习还没有报告。', 404, 'not_found')
      return json(report)
    }

    if (method === 'POST' && seg(3) === 'turns') {
      const body = await readJson(req)
      const role = body.role === 'assistant' ? 'assistant' : 'user'
      const text = String(body.text ?? '').trim()
      if (!text) throw new HttpError('发言内容为空。', 400, 'empty_text')
      if (text.length > 6000) throw new HttpError('单次发言过长。', 413, 'too_long')
      const turn = addTurn(id, role, text, Number(body.audioMs) || null)
      return json(turn)
    }

    if (method === 'POST' && seg(3) === 'end') {
      const session = getSession(id)
      if (!session) throw new HttpError('会话不存在。', 404, 'not_found')
      if (session.endedAt) {
        throw new HttpError('会话已经结束。', 409, 'already_ended')
      }
      endSession(id)
      const turns = listTurns(id)
      const endedAt = Date.now()
      const report = await buildSessionReport({
        sessionId: id,
        mode: session.mode,
        exam: (session.exam ?? getSettings().exam) as Exam,
        turns,
        durationSec: Math.max(1, Math.round((endedAt - session.startedAt) / 1000)),
        settings: publicSettings(),
        llm: resolveLlm(),
        meta: session.meta as SessionMeta,
      })
      saveAssessment({
        kind: 'session',
        sessionId: id,
        exam: session.exam,
        band: report.band,
        data: report,
      })
      normalizeCorrectionItems(report.corrections, `session:${id}`)
      return json(report)
    }

    if (method === 'DELETE' && seg(3) === undefined) {
      deleteSession(id)
      return json({ ok: true })
    }
  }

  if (parts[1] === 'chat' && method === 'POST') {
    const body = await readJson(req)
    const sessionId = Number(body.sessionId)
    const message = String(body.message ?? '').trim()
    if (!Number.isFinite(sessionId)) throw new HttpError('无效的会话 ID。', 400)
    if (!message) throw new HttpError('发言内容为空。', 400, 'empty_text')
    if (message.length > 6000) throw new HttpError('单次发言过长。', 413, 'too_long')

    const session = getSession(sessionId)
    if (!session) throw new HttpError('会话不存在。', 404, 'not_found')
    if (session.endedAt) throw new HttpError('会话已经结束，请开始新的练习。', 409, 'session_ended')

    const llm = needLlm()
    addTurn(sessionId, 'user', message, Number(body.audioMs) || null)
    const turns = listTurns(sessionId)
    const messages = buildTutorMessages({
      mode: session.mode,
      meta: session.meta as SessionMeta,
      settings: publicSettings(),
      turns,
    })

    const encoder = new TextEncoder()
    const abort = new AbortController()
    req.signal.addEventListener('abort', () => abort.abort(), { once: true })

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false
        const send = (event: ChatStreamEvent) => {
          if (closed) return
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }
        try {
          let full = ''
          const text = await streamChat(
            llm,
            messages,
            (delta) => {
              full += delta
              send({ type: 'delta', text: delta })
            },
            { signal: abort.signal, timeoutMs: 120_000 },
          )
          const assistant = addTurn(sessionId, 'assistant', text)
          send({ type: 'done', turnId: assistant.id, text })
        } catch (err) {
          const aborted = abort.signal.aborted
          if (!aborted) {
            const messageText = err instanceof LlmError ? err.message : (err as Error).message
            send({ type: 'error', message: messageText })
          }
        } finally {
          closed = true
          try {
            controller.close()
          } catch {}
        }
      },
      cancel() {
        abort.abort()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  if (parts[1] === 'writing' && parts[2] === 'grade' && method === 'POST') {
    const body = await readJson(req)
    const promptId = String(body.promptId ?? '')
    const text = String(body.text ?? '').trim()
    if (!promptId) throw new HttpError('缺少作文题目。', 400)
    if (text.length < 20) throw new HttpError('作文太短，至少写一个完整句子。', 400, 'too_short')
    if (text.length > 40_000) throw new HttpError('作文过长。', 413, 'too_long')
    const task = writingTask(promptId)
    if (!task) throw new HttpError('找不到该作文题目。', 404, 'not_found')
    const durationSec = Number(body.durationSec)
    const grade = await gradeWriting({
      task,
      text,
      durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null,
      llm: resolveLlm(),
    })
    const essayId = insertEssay({
      promptId,
      exam: task.exam,
      kind: task.kind,
      prompt: task.prompt,
      text,
      wordCount: writingWordCount(text),
      durationSec: Number.isFinite(durationSec) && durationSec > 0 ? Math.round(durationSec) : null,
      grade,
    })
    saveCorrections(grade.corrections, undefined, essayId)
    saveAssessment({
      kind: 'writing',
      essayId,
      exam: task.exam,
      band: grade.band,
      data: grade,
    })
    normalizeCorrectionItems(grade.corrections, `essay:${essayId}`)
    return json({ essayId, grade })
  }

  if (parts[1] === 'essays') {
    if (method === 'GET' && !seg(2)) return json(listEssays(50))
    const id = Number(seg(2))
    if (!Number.isFinite(id)) throw new HttpError('无效的作文 ID。', 400)
    if (method === 'GET') {
      const essay = getEssay(id)
      if (!essay) throw new HttpError('作文不存在。', 404, 'not_found')
      return json(essay)
    }
    if (method === 'DELETE') {
      deleteEssay(id)
      return json({ ok: true })
    }
  }

  if (parts[1] === 'review') {
    if (method === 'GET' && seg(2) === 'due') {
      const items = dueReviewItems(50).map((item) => ({
        ...item,
        preview: previewIntervals(item.state),
      }))
      return json(items)
    }
    if (method === 'GET' && !seg(2)) return json(listReviewItems(200))
    if (method === 'POST' && !seg(2)) {
      const body = await readJson(req)
      const front = String(body.front ?? '').trim()
      const back = String(body.back ?? '').trim()
      if (!front || !back) throw new HttpError('正面和背面都不能为空。', 400)
      const kind = ['error', 'vocab', 'phrase'].includes(String(body.kind)) ? (body.kind as 'error' | 'vocab' | 'phrase') : 'vocab'
      const id = addReviewItem({ kind, front, back, note: typeof body.note === 'string' ? body.note : null })
      if (id === null) throw new HttpError('这条卡片已经存在。', 409, 'duplicate')
      return json({ id })
    }
    const id = Number(seg(2))
    if (!Number.isFinite(id)) throw new HttpError('无效的卡片 ID。', 400)
    if (method === 'DELETE') {
      deleteReviewItem(id)
      return json({ ok: true })
    }
    if (method === 'POST' && seg(3) === 'grade') {
      const body = await readJson(req)
      const rating = Number(body.rating) as Rating
      if (![1, 2, 3, 4].includes(rating)) throw new HttpError('评分必须是 1-4。', 400)
      const item = getReviewItem(id)
      if (!item) throw new HttpError('卡片不存在。', 404, 'not_found')
      const next = schedule(item.state, rating)
      updateReviewItem(id, {
        dueAt: next.dueAt,
        reps: item.reps + 1,
        lapses: item.lapses + (rating === 1 ? 1 : 0),
        state: next.state,
      })
      return json({ ok: true, dueAt: next.dueAt, state: next.state })
    }
  }

  if (parts[1] === 'stats' && method === 'GET') {
    const activity = activityByDay(14)
    let streak = 0
    let i = activity.length - 1
    if (i >= 0 && activity[i].minutes === 0) i--
    for (; i >= 0 && activity[i].minutes > 0; i--) streak++
    return json({
      streakDays: streak,
      todayMinutes: todayMinutes(),
      totalMinutes: totalMinutes(),
      sessions7d: sessionsSince(Date.now() - 7 * 86400_000),
      wordsSpoken7d: wordsSpokenSince(Date.now() - 7 * 86400_000),
      dueReviews: dueReviewCount(),
      essays: essayCount(),
      bandTrend: bandTrend(20),
      errorCategories: errorCategoryCounts(),
      activity,
      recentCorrections: listCorrections(8),
      recentSessions: recentSessionSummaries(8),
      recentEssays: listEssays(5),
    })
  }

  if (parts[1] === 'pronunciation' && method === 'POST') {
    const form = await req.formData()
    const audio = form.get('audio')
    const text = String(form.get('text') ?? '').trim()
    if (!(audio instanceof File)) throw new HttpError('缺少录音文件。', 400, 'no_audio')
    if (!text) throw new HttpError('缺少参考文本。', 400, 'no_text')
    if (audio.size > 20_000_000) throw new HttpError('录音文件过大。', 413, 'too_large')
    const endpoint = (process.env.PRONUNCIATION_URL ?? 'http://127.0.0.1:9000').replace(/\/+$/, '')
    const upstream = new FormData()
    upstream.append('audio', audio, audio.name || 'speech.webm')
    upstream.append('text', text)
    try {
      const res = await fetch(`${endpoint}/assess`, {
        method: 'POST',
        body: upstream,
        signal: AbortSignal.timeout(60_000),
      })
      if (!res.ok) {
        let detail = ''
        try {
          const body = (await res.json()) as { detail?: string }
          detail = body.detail ?? ''
        } catch {}
        throw new HttpError(`声学评测失败${detail ? `：${detail}` : ''}`, 502, 'pronunciation_error')
      }
      return json(await res.json())
    } catch (err) {
      if (err instanceof HttpError) throw err
      throw new HttpError(
        '声学评测服务未启动。运行 `docker compose up -d pronunciation` 后重试。',
        503,
        'pronunciation_unavailable',
      )
    }
  }

  if (parts[1] === 'asr' && method === 'POST') {
    const llm = needLlm()
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw new HttpError('缺少音频文件。', 400, 'no_file')
    const text = await transcribeAudio(llm, file, file.name || 'audio.webm')
    return json({ text })
  }

  if (parts[1] === 'tts' && method === 'POST') {
    const tts = resolveTts()
    if (!tts) {
      throw new HttpError(
        '尚未配置服务端 TTS。请在设置中填写 TTS Base URL 和 Key，或复用模型配置。',
        409,
        'tts_not_configured',
      )
    }
    const body = await readJson(req)
    const text = String(body.text ?? '').trim()
    if (!text) throw new HttpError('朗读文本为空。', 400)
    if (text.length > 2000) throw new HttpError('朗读文本过长。', 413, 'too_long')
    const voice = String(body.voice ?? 'alloy')
    const instructions = typeof body.instructions === 'string' ? body.instructions.slice(0, 600) : undefined
    const { audio, contentType } = await synthesizeSpeech(tts, text, voice, Number(body.speed) || 1, instructions)
    return new Response(audio, {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' },
    })
  }

  if (parts[1] === 'llm' && parts[2] === 'test' && method === 'POST') {
    const llm = needLlm()
    try {
      const text = await streamChat(
        llm,
        [
          { role: 'system', content: 'Reply with exactly: OK' },
          { role: 'user', content: 'ping' },
        ],
        () => {},
        { timeoutMs: 30_000 },
      )
      return json({ ok: true, reply: text.trim().slice(0, 40) })
    } catch (err) {
      return fail((err as Error).message, 502, 'llm_error')
    }
  }

  if (parts[1] === 'meta' && method === 'GET') {
    const s = publicSettings()
    return json({
      modes: MODES,
      exams: EXAMS,
      counts: {
        part1: bundle.ieltsSpeaking.part1.length,
        part2: bundle.ieltsSpeaking.part2.length,
        part3: bundle.ieltsSpeaking.part3.length,
        toeflSpeaking: bundle.toeflSpeaking.length,
        writing: bundle.writing.length,
        scenarios: bundle.scenarios.length,
        drills: bundle.drills.length,
      },
      settings: s,
    })
  }

  throw new HttpError('接口不存在。', 404, 'not_found')
}

/* ------------------------------- server ------------------------------- */

async function serveStatic(url: URL): Promise<Response> {
  if (!existsSync(DIST)) {
    return new Response('Frontend not built. Run `bun run dev` for development or `bun run build` first.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  const pathname = decodeURIComponent(url.pathname)
  const target = join(DIST, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''))
  if (target.startsWith(DIST)) {
    const file = Bun.file(target)
    if (await file.exists()) {
      const immutable = pathname.startsWith('/assets/')
      return new Response(file, {
        headers: immutable ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : { 'Cache-Control': 'no-cache' },
      })
    }
  }
  return new Response(Bun.file(join(DIST, 'index.html')), { headers: { 'Cache-Control': 'no-cache' } })
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(req, url)
      } catch (err) {
        if (err instanceof HttpError) return fail(err.message, err.status, err.code)
        if (err instanceof LlmError) return fail(err.message, 502, 'llm_error')
        console.error('[api]', err)
        return fail((err as Error).message || '服务器内部错误。', 500, 'internal_error')
      }
    }
    return serveStatic(url)
  },
})

console.log(`Echo Tutor API listening on http://${HOST}:${server.port}`)
