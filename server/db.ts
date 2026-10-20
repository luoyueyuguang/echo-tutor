import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import type {
  AppSettings,
  Correction,
  EssayRow,
  Exam,
  GradeResult,
  ReviewItemRow,
  SessionMode,
  SessionReport,
  SessionRow,
  TurnRow,
} from '../src/shared/types'
import { defaultFsrsState } from './srs'

const dbPath = process.env.DB_PATH ?? 'data/echo.db'
mkdirSync(dbPath.replace(/\/[^/]+$/, ''), { recursive: true })

export const db = new Database(dbPath, { create: true })
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  exam TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  audio_ms INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, id);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  essay_id INTEGER,
  category TEXT NOT NULL,
  original TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  explanation TEXT NOT NULL,
  severity INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS essays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_id TEXT NOT NULL,
  exam TEXT NOT NULL,
  kind TEXT NOT NULL,
  prompt TEXT NOT NULL,
  text TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  duration_sec INTEGER,
  grade TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS review_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  note TEXT,
  due_at INTEGER NOT NULL,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_due ON review_items(due_at);
CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  session_id INTEGER,
  essay_id INTEGER,
  exam TEXT,
  band REAL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assessments_created ON assessments(created_at);
`)

// Close sessions abandoned by a crash or a closed tab so they do not accrue
// minutes forever.
db.query('UPDATE sessions SET ended_at = started_at + 60000 WHERE ended_at IS NULL AND started_at < ?').run(
  Date.now() - 4 * 3600_000,
)

type AssessmentKind = 'session' | 'writing'

/* ------------------------------ settings ------------------------------ */

const DEFAULT_SETTINGS: AppSettings = {
  llmBaseUrl: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
  llmModel: process.env.LLM_MODEL ?? 'gpt-4o-mini',
  llmApiKeySet: false,
  asrProvider: 'browser',
  ttsProvider: 'browser',
  accent: 'en-GB',
  rate: 1,
  pitch: 1,
  browserVoiceURI: '',
  ttsVoice: 'fable',
  ttsBaseUrl: '',
  ttsModel: 'gpt-4o-mini-tts',
  ttsApiKeySet: false,
  ttsConfigured: false,
  exam: 'ielts',
  dailyGoalMin: 30,
  studentLevel: 'B1',
}

interface StoredSettings extends Omit<AppSettings, 'llmApiKeySet' | 'ttsApiKeySet' | 'ttsConfigured'> {
  llmApiKey: string
  ttsApiKey: string
}

function readStored(): StoredSettings {
  const row = db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'app'").get()
  let saved: Partial<StoredSettings> = {}
  if (row) {
    try {
      saved = JSON.parse(row.value)
    } catch {
      saved = {}
    }
  }
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    llmApiKey: saved.llmApiKey ?? process.env.LLM_API_KEY ?? '',
    ttsApiKey: saved.ttsApiKey ?? process.env.TTS_API_KEY ?? '',
  } as StoredSettings
}

export function getSettings(): StoredSettings {
  return readStored()
}

export function publicSettings(): AppSettings {
  const { llmApiKey, ttsApiKey, ...rest } = readStored()
  return {
    ...rest,
    llmApiKeySet: llmApiKey.trim().length > 0,
    ttsApiKeySet: ttsApiKey.trim().length > 0,
    ttsConfigured: Boolean((ttsApiKey || llmApiKey).trim()),
  }
}

export function saveSettings(patch: Record<string, unknown>): AppSettings {
  const cur = readStored()
  const next: StoredSettings = { ...cur }
  const allowed: (keyof StoredSettings)[] = [
    'llmBaseUrl',
    'llmModel',
    'llmApiKey',
    'asrProvider',
    'ttsProvider',
    'accent',
    'rate',
    'pitch',
    'browserVoiceURI',
    'ttsVoice',
    'ttsBaseUrl',
    'ttsModel',
    'ttsApiKey',
    'exam',
    'dailyGoalMin',
    'studentLevel',
  ]
  for (const k of allowed) {
    if (k in patch && patch[k] !== undefined) {
      ;(next as unknown as Record<string, unknown>)[k] = patch[k]
    }
  }
  next.rate = Math.min(1.5, Math.max(0.6, Number(next.rate) || 1))
  next.pitch = Math.min(1.3, Math.max(0.7, Number(next.pitch) || 1))
  next.browserVoiceURI = String(next.browserVoiceURI ?? '')
  next.ttsVoice = String(next.ttsVoice || 'fable')
  next.ttsBaseUrl = String(next.ttsBaseUrl ?? '')
  next.ttsModel = String(next.ttsModel || 'gpt-4o-mini-tts')
  next.dailyGoalMin = Math.min(240, Math.max(5, Number(next.dailyGoalMin) || 30))
  if (!['A2', 'B1', 'B2', 'C1'].includes(next.studentLevel)) next.studentLevel = 'B1'
  if (!['browser', 'whisper'].includes(next.asrProvider)) next.asrProvider = 'browser'
  if (!['browser', 'openai'].includes(next.ttsProvider)) next.ttsProvider = 'browser'
  if (!['ielts', 'toefl', 'kaoyan'].includes(next.exam)) next.exam = 'ielts'
  if (!['en-GB', 'en-US'].includes(next.accent)) next.accent = 'en-GB'

  db.query("INSERT INTO settings(key, value) VALUES('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify(next),
  )
  return publicSettings()
}

/* ------------------------------ sessions ------------------------------ */

export function createSession(mode: SessionMode, exam: Exam | null, meta: Record<string, unknown> = {}): SessionRow {
  const startedAt = Date.now()
  const info = db
    .query('INSERT INTO sessions(mode, exam, meta, started_at) VALUES(?, ?, ?, ?)')
    .run(mode, exam, JSON.stringify(meta), startedAt)
  return {
    id: Number(info.lastInsertRowid),
    mode,
    exam,
    meta,
    startedAt,
    endedAt: null,
  }
}

interface RawSession {
  id: number
  mode: string
  exam: string | null
  meta: string
  started_at: number
  ended_at: number | null
}

function mapSession(r: RawSession): SessionRow {
  let meta: Record<string, unknown> = {}
  try {
    meta = JSON.parse(r.meta)
  } catch {}
  return {
    id: r.id,
    mode: r.mode as SessionMode,
    exam: (r.exam as Exam | null) ?? null,
    meta,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  }
}

export function getSession(id: number): SessionRow | null {
  const r = db.query<RawSession, [number]>('SELECT * FROM sessions WHERE id = ?').get(id)
  return r ? mapSession(r) : null
}

export function endSession(id: number): void {
  db.query('UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL').run(Date.now(), id)
}

export function deleteSession(id: number): void {
  db.query('DELETE FROM sessions WHERE id = ?').run(id)
}

export function listSessions(limit = 30): SessionRow[] {
  return db.query<RawSession, [number]>('SELECT * FROM sessions ORDER BY id DESC LIMIT ?').all(limit).map(mapSession)
}

/* ------------------------------- turns -------------------------------- */

export function addTurn(sessionId: number, role: 'user' | 'assistant', text: string, audioMs?: number | null): TurnRow {
  const createdAt = Date.now()
  const info = db
    .query('INSERT INTO turns(session_id, role, text, audio_ms, created_at) VALUES(?, ?, ?, ?, ?)')
    .run(sessionId, role, text, audioMs ?? null, createdAt)
  return { id: Number(info.lastInsertRowid), sessionId, role, text, audioMs: audioMs ?? null, createdAt }
}

interface RawTurn {
  id: number
  session_id: number
  role: string
  text: string
  audio_ms: number | null
  created_at: number
}

export function listTurns(sessionId: number, limit = 200): TurnRow[] {
  return db
    .query<RawTurn, [number, number]>('SELECT * FROM turns WHERE session_id = ? ORDER BY id ASC LIMIT ?')
    .all(sessionId, limit)
    .map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      role: r.role as 'user' | 'assistant',
      text: r.text,
      audioMs: r.audio_ms,
      createdAt: r.created_at,
    }))
}

/* ------------------------------ feedback ------------------------------ */

export function saveCorrections(corrections: Correction[], sessionId?: number, essayId?: number): void {
  if (!corrections.length) return
  const stmt = db.query(
    'INSERT INTO feedback(session_id, essay_id, category, original, suggestion, explanation, severity, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const now = Date.now()
  db.transaction(() => {
    for (const c of corrections) {
      stmt.run(sessionId ?? null, essayId ?? null, c.category, c.original, c.suggestion, c.explanation, c.severity, now)
    }
  })()
}

interface RawFeedback {
  category: string
  original: string
  suggestion: string
  explanation: string
  severity: number
}

export function listCorrections(limit = 500): Correction[] {
  return db
    .query<RawFeedback, [number]>('SELECT category, original, suggestion, explanation, severity FROM feedback ORDER BY id DESC LIMIT ?')
    .all(limit)
    .map((r) => ({
      category: r.category as Correction['category'],
      original: r.original,
      suggestion: r.suggestion,
      explanation: r.explanation,
      severity: (r.severity as 1 | 2 | 3) ?? 1,
    }))
}

/* ------------------------------- essays ------------------------------- */

export function insertEssay(input: {
  promptId: string
  exam: Exam
  kind: string
  prompt: string
  text: string
  wordCount: number
  durationSec: number | null
  grade: GradeResult
}): number {
  const info = db
    .query(
      'INSERT INTO essays(prompt_id, exam, kind, prompt, text, word_count, duration_sec, grade, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      input.promptId,
      input.exam,
      input.kind,
      input.prompt,
      input.text,
      input.wordCount,
      input.durationSec,
      JSON.stringify(input.grade),
      Date.now(),
    )
  return Number(info.lastInsertRowid)
}

interface RawEssay {
  id: number
  prompt_id: string
  exam: string
  kind: string
  prompt: string
  text: string
  word_count: number
  duration_sec: number | null
  grade: string
  created_at: number
}

function mapEssay(r: RawEssay): EssayRow {
  return {
    id: r.id,
    promptId: r.prompt_id,
    exam: r.exam as Exam,
    kind: r.kind,
    prompt: r.prompt,
    text: r.text,
    wordCount: r.word_count,
    durationSec: r.duration_sec,
    grade: JSON.parse(r.grade) as GradeResult,
    createdAt: r.created_at,
  }
}

export function listEssays(limit = 30): Omit<EssayRow, 'text'>[] {
  return db
    .query<RawEssay, [number]>('SELECT * FROM essays ORDER BY id DESC LIMIT ?')
    .all(limit)
    .map(mapEssay)
    .map(({ text, ...rest }) => rest)
}

export function getEssay(id: number): EssayRow | null {
  const r = db.query<RawEssay, [number]>('SELECT * FROM essays WHERE id = ?').get(id)
  return r ? mapEssay(r) : null
}

export function deleteEssay(id: number): void {
  db.query('DELETE FROM essays WHERE id = ?').run(id)
}

/* ---------------------------- assessments ----------------------------- */

export function saveAssessment(input: {
  kind: AssessmentKind
  sessionId?: number
  essayId?: number
  exam?: Exam | null
  band?: number | null
  data: SessionReport | GradeResult
}): number {
  const info = db
    .query('INSERT INTO assessments(kind, session_id, essay_id, exam, band, data, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
    .run(
      input.kind,
      input.sessionId ?? null,
      input.essayId ?? null,
      input.exam ?? null,
      input.band ?? null,
      JSON.stringify(input.data),
      Date.now(),
    )
  return Number(info.lastInsertRowid)
}

const localDay = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function bandTrend(limit = 20): { date: string; band: number; label: string }[] {
  const rows = db
    .query<{ created_at: number; band: number; data: string }, [number]>(
      "SELECT created_at, band, data FROM assessments WHERE band IS NOT NULL AND kind = 'session' ORDER BY id DESC LIMIT ?",
    )
    .all(limit)
  return rows
    .map((r) => {
      let label = ''
      try {
        label = (JSON.parse(r.data) as SessionReport).bandLabel ?? ''
      } catch {}
      return { date: localDay(r.created_at), band: r.band, label }
    })
    .reverse()
}

/* ---------------------------- review items ---------------------------- */

interface RawReview {
  id: number
  kind: string
  front: string
  back: string
  note: string | null
  due_at: number
  reps: number
  lapses: number
  state: string
  created_at: number
}

function mapReview(r: RawReview): ReviewItemRow {
  return {
    id: r.id,
    kind: r.kind as ReviewItemRow['kind'],
    front: r.front,
    back: r.back,
    note: r.note,
    dueAt: r.due_at,
    reps: r.reps,
    lapses: r.lapses,
    state: JSON.parse(r.state),
    createdAt: r.created_at,
  }
}

export function addReviewItem(input: {
  kind: ReviewItemRow['kind']
  front: string
  back: string
  note?: string | null
  source?: string
}): number | null {
  const exists = db
    .query<{ id: number }, [string]>('SELECT id FROM review_items WHERE front = ? LIMIT 1')
    .get(input.front)
  if (exists) return null
  const now = Date.now()
  const info = db
    .query(
      'INSERT INTO review_items(kind, front, back, note, due_at, reps, lapses, state, created_at) VALUES(?, ?, ?, ?, ?, 0, 0, ?, ?)',
    )
    .run(input.kind, input.front, input.back, input.note ?? null, now, JSON.stringify(defaultFsrsState()), now)
  return Number(info.lastInsertRowid)
}

export function dueReviewItems(limit = 50): ReviewItemRow[] {
  return db
    .query<RawReview, [number, number]>('SELECT * FROM review_items WHERE due_at <= ? ORDER BY due_at ASC LIMIT ?')
    .all(Date.now(), limit)
    .map(mapReview)
}

export function listReviewItems(limit = 200): ReviewItemRow[] {
  return db
    .query<RawReview, [number]>('SELECT * FROM review_items ORDER BY due_at ASC LIMIT ?')
    .all(limit)
    .map(mapReview)
}

export function getReviewItem(id: number): ReviewItemRow | null {
  const r = db.query<RawReview, [number]>('SELECT * FROM review_items WHERE id = ?').get(id)
  return r ? mapReview(r) : null
}

export function updateReviewItem(id: number, patch: { dueAt: number; reps: number; lapses: number; state: unknown }): void {
  db.query('UPDATE review_items SET due_at = ?, reps = ?, lapses = ?, state = ? WHERE id = ?').run(
    patch.dueAt,
    patch.reps,
    patch.lapses,
    JSON.stringify(patch.state),
    id,
  )
}

export function deleteReviewItem(id: number): void {
  db.query('DELETE FROM review_items WHERE id = ?').run(id)
}

export function dueReviewCount(): number {
  const r = db.query<{ n: number }, [number]>('SELECT COUNT(*) AS n FROM review_items WHERE due_at <= ?').get(Date.now())
  return r?.n ?? 0
}

/* ------------------------------- stats -------------------------------- */

export function activityByDay(days = 14): { date: string; minutes: number }[] {
  const start = Date.now() - days * 86400_000
  const rows = db
    .query<{ started_at: number; ended_at: number | null }, [number]>(
      'SELECT started_at, ended_at FROM sessions WHERE started_at >= ?',
    )
    .all(start)
  const map = new Map<string, number>()
  const now = Date.now()
  for (const row of rows) {
    const key = localDay(row.started_at)
    const minutes = Math.max(0, (Math.min(row.ended_at ?? now, row.started_at + 7200_000) - row.started_at) / 60000)
    map.set(key, (map.get(key) ?? 0) + minutes)
  }
  const out: { date: string; minutes: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const key = localDay(Date.now() - i * 86400_000)
    out.push({ date: key, minutes: Math.round(map.get(key) ?? 0) })
  }
  return out
}

export function errorCategoryCounts(): { category: string; count: number }[] {
  return db
    .query<{ category: string; count: number }, []>(
      'SELECT category, COUNT(*) AS count FROM feedback GROUP BY category ORDER BY count DESC',
    )
    .all()
}

export function wordsSpokenSince(since: number): number {
  const rows = db
    .query<{ text: string }, [string, number]>('SELECT text FROM turns WHERE role = ? AND created_at >= ?')
    .all('user', since)
  let words = 0
  for (const r of rows) words += (r.text.match(/[A-Za-z']+/g) ?? []).length
  return words
}

export function sessionsSince(since: number): number {
  const r = db.query<{ n: number }, [number]>('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ?').get(since)
  return r?.n ?? 0
}

export function todayMinutes(): number {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const r = db
    .query<{ seconds: number }, [number, number]>(
      'SELECT SUM(MIN(COALESCE(ended_at, ?), started_at + 7200000) - started_at) / 1000 AS seconds FROM sessions WHERE started_at >= ?',
    )
    .get(Date.now(), start.getTime())
  return Math.round((r?.seconds ?? 0) / 60)
}

export function totalMinutes(): number {
  const r = db
    .query<{ seconds: number }, [number]>(
      'SELECT SUM(MIN(COALESCE(ended_at, ?), started_at + 7200000) - started_at) / 1000 AS seconds FROM sessions',
    )
    .get(Date.now())
  return Math.round((r?.seconds ?? 0) / 60)
}

export function essayCount(): number {
  const r = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM essays').get()
  return r?.n ?? 0
}

export function sessionTurns(sessionId: number): TurnRow[] {
  return listTurns(sessionId, 500)
}


export interface SessionSummary {
  id: number
  mode: string
  startedAt: number
  durationSec: number
  band: number | null
  label: string
  summary: string
}

export function getSessionReport(sessionId: number): SessionReport | null {
  const row = db
    .query<{ data: string }, [number]>(
      "SELECT data FROM assessments WHERE kind = 'session' AND session_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(sessionId)
  if (!row) return null
  try {
    return JSON.parse(row.data) as SessionReport
  } catch {
    return null
  }
}

export function recentSessionSummaries(limit = 10): SessionSummary[] {
  const rows = db
    .query<{ id: number; mode: string; started_at: number; ended_at: number | null; band: number | null; data: string | null }, [number]>(
      `SELECT s.id, s.mode, s.started_at, s.ended_at, a.band, a.data
       FROM sessions s LEFT JOIN assessments a ON a.session_id = s.id AND a.kind = 'session'
       WHERE s.ended_at IS NOT NULL
       ORDER BY s.id DESC LIMIT ?`,
    )
    .all(limit)
  return rows.map((r) => {
    let label = ''
    let summary = ''
    if (r.data) {
      try {
        const parsed = JSON.parse(r.data) as SessionReport
        label = parsed.bandLabel ?? ''
        summary = parsed.summary ?? ''
      } catch {}
    }
    return {
      id: r.id,
      mode: r.mode,
      startedAt: r.started_at,
      durationSec: Math.max(0, Math.round(((r.ended_at ?? Date.now()) - r.started_at) / 1000)),
      band: r.band,
      label,
      summary,
    }
  })
}

export { DEFAULT_SETTINGS }
export type { StoredSettings }
