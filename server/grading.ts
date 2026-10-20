import type {
  AppSettings,
  Correction,
  DimensionScore,
  Exam,
  GradeResult,
  LanguageMetrics,
  Rubric,
  SessionMode,
  SessionReport,
  TurnRow,
  WritingTask,
} from '../src/shared/types'
import { bundle, rubricFor } from './content'
import { completeJson, type LlmConfig } from './llm'
import { analyzeText, deterministicCorrections, keywordCoverage, wordCount } from './metrics'
import { buildSessionFeedbackMessages, buildWritingGradeMessages, heuristicStudyAdvice, type SessionMeta } from './prompts'

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v))
const roundHalf = (v: number) => Math.round(v * 2) / 2

const CORRECTION_CATEGORIES = new Set<Correction['category']>([
  'grammar',
  'vocabulary',
  'pronunciation',
  'coherence',
  'register',
  'task',
])

interface LlmDimension {
  key?: string
  band?: number | string
  comment?: string
  evidence?: string[]
}

interface LlmGradeJson {
  dimensions?: LlmDimension[]
  corrections?: Partial<Correction>[]
  summary?: string
  strengths?: string[]
  improvements?: string[]
  confidence?: string
}

function criterionMax(rubric: Rubric): number {
  if (rubric.exam === 'ielts') return 9
  if (rubric.exam === 'toefl') return 5
  return rubric.scale.max
}

function bandLabel(exam: Exam, band: number, scaleMax: number, suffix = ''): string {
  if (exam === 'ielts') return `Band ${roundHalf(band).toFixed(1)}${suffix}`
  if (exam === 'toefl') return `TOEFL ${band.toFixed(1)}/${scaleMax}${suffix}`
  return `${band.toFixed(1)}/${scaleMax}${suffix}`
}

function bandFromOverall(exam: Exam, overall: number, scaleMax: number): number {
  if (exam === 'ielts') return roundHalf((overall / 100) * 9)
  if (exam === 'toefl') return Math.round((1 + (overall / 100) * 5) * 10) / 10
  return (overall / 100) * scaleMax
}

function cleanCorrections(input: unknown, max = 10): Correction[] {
  if (!Array.isArray(input)) return []
  const out: Correction[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const c = raw as Record<string, unknown>
    const original = typeof c.original === 'string' ? c.original.trim() : ''
    const suggestion = typeof c.suggestion === 'string' ? c.suggestion.trim() : ''
    const explanation = typeof c.explanation === 'string' ? c.explanation.trim() : ''
    if (!original || !suggestion) continue
    const category = CORRECTION_CATEGORIES.has(c.category as Correction['category'])
      ? (c.category as Correction['category'])
      : 'grammar'
    const severity = Math.min(3, Math.max(1, Math.round(Number(c.severity) || 1))) as 1 | 2 | 3
    const key = `${original}->${suggestion}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ original, suggestion, category, explanation, severity })
    if (out.length >= max) break
  }
  return out
}

function llmDimensions(input: unknown, rubric: Rubric | undefined, fallback: DimensionScore[]): DimensionScore[] {
  if (!Array.isArray(input) || !input.length) return fallback
  const byKey = new Map(rubric?.criteria.map((c) => [c.key, c]) ?? [])
  const max = rubric ? criterionMax(rubric) : 9
  const out: DimensionScore[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const d = raw as LlmDimension
    const key = typeof d.key === 'string' ? d.key : ''
    if (!key) continue
    const band = clamp(Number(d.band), 0, max)
    if (!Number.isFinite(band)) continue
    const criterion = byKey.get(key)
    out.push({
      key,
      label: criterion?.label ?? key,
      labelZh: criterion?.labelZh ?? key,
      score: Math.round((band / max) * 100),
      band: Math.round(band * 10) / 10,
      comment: typeof d.comment === 'string' ? d.comment : '',
      evidence: Array.isArray(d.evidence)
        ? d.evidence.filter((e): e is string => typeof e === 'string' && e.trim().length > 0).slice(0, 3)
        : [],
    })
  }
  if (!out.length) return fallback
  // Fill any criterion the model skipped with the heuristic estimate.
  for (const c of rubric?.criteria ?? []) {
    if (!out.some((d) => d.key === c.key)) {
      const f = fallback.find((d) => d.key === c.key)
      if (f) out.push(f)
    }
  }
  return out
}

function mergeCorrections(a: Correction[], b: Correction[]): Correction[] {
  const out: Correction[] = []
  const seen = new Set<string>()
  for (const c of [...a, ...b]) {
    const key = `${c.original}->${c.suggestion}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out.slice(0, 12)
}

/* ----------------------------- heuristic ------------------------------ */

function writingHeuristicDimensions(task: WritingTask, metrics: LanguageMetrics, corrections: Correction[], rubric: Rubric): DimensionScore[] {
  const errors = corrections.filter((c) => c.category === 'grammar').length
  const errorDensity = (errors / Math.max(20, metrics.words)) * 100
  const coverage = keywordCoverage(task.prompt, task.prompt) // prompt-only baseline; replaced below by caller
  const wcRatio = metrics.words / Math.max(1, task.minWords)
  const content = clamp(20 + Math.min(1.15, wcRatio) * 45 + Math.min(1, coverage) * 25)
  const organization = clamp(38 + Math.min(5, metrics.paragraphs) * 6 + Math.min(12, metrics.connectives) * 2.2)
  const lexis = clamp(25 + metrics.typeTokenRatio * 60 + metrics.longWordRatio * 80 - errorDensity * 1.2)
  const grammar = clamp(62 + Math.min(12, metrics.avgSentenceLen * 0.4) - errorDensity * 4 - metrics.repeatedWordPairs * 3)
  const language = (lexis + grammar) / 2

  const scoreFor = (key: string): number => {
    if (key === 'tr' || key === 'ta' || key === 'task') return content
    if (key === 'cc' || key === 'organization') return organization
    if (key === 'lr') return lexis
    if (key === 'gra') return grammar
    if (key === 'language') return language
    if (key === 'development') return content
    return (content + organization + language) / 3
  }

  const max = criterionMax(rubric)
  return rubric.criteria.map((c) => {
    const score = Math.round(scoreFor(c.key))
    return {
      key: c.key,
      label: c.label,
      labelZh: c.labelZh,
      score,
      band: Math.round((score / 100) * max * 10) / 10,
      comment: '本地粗估（未使用模型），置信度低。',
      evidence: [],
    }
  })
}

function overallFrom(dimensions: DimensionScore[], rubric: Rubric): { overall: number; band: number; label: string } {
  const overall = Math.round(dimensions.reduce((s, d) => s + d.score, 0) / Math.max(1, dimensions.length))
  const band = bandFromOverall(rubric.exam, overall, rubric.scale.max)
  return { overall, band, label: bandLabel(rubric.exam, band, rubric.scale.max) }
}

function summaryForHeuristic(metrics: LanguageMetrics): string {
  return `本轮共输出 ${metrics.words} 个英文词、${metrics.sentences} 个句子，平均句长 ${metrics.avgSentenceLen} 词。以下分数为本地规则粗估，未调用模型，仅供参考；配置模型后可获得逐句纠错与可靠的 rubric 评分。`
}

export async function gradeWriting(input: {
  task: WritingTask
  text: string
  durationSec: number | null
  llm: LlmConfig | null
}): Promise<GradeResult> {
  const { task, text, durationSec, llm } = input
  const rubric = rubricFor(task.exam, 'writing', task.kind) ?? bundle.rubrics.find((r) => r.skill === 'writing' && r.exam === task.exam)!
  const metrics = analyzeText(text, { writing: true, durationSec: durationSec ?? undefined })
  const deterministic = deterministicCorrections(text, { writing: true, minWords: task.minWords })

  let heuristic = writingHeuristicDimensions(task, metrics, deterministic, rubric)
  // Feed real topic coverage into the content dimension.
  const coverage = keywordCoverage(task.prompt, text)
  heuristic = heuristic.map((d) =>
    ['tr', 'ta', 'task', 'development'].includes(d.key)
      ? { ...d, score: Math.round(clamp(d.score * (0.75 + coverage * 0.35))) }
      : d,
  )
  heuristic = heuristic.map((d) => ({ ...d, band: Math.round((d.score / 100) * criterionMax(rubric) * 10) / 10 }))

  const fallbackOverall = overallFrom(heuristic, rubric)

  if (!llm) {
    return {
      dimensions: heuristic,
      overall: fallbackOverall.overall,
      band: fallbackOverall.band,
      bandLabel: `${fallbackOverall.label}（粗估）`,
      confidence: 'low',
      summary: summaryForHeuristic(metrics),
      strengths: [
        metrics.words >= task.minWords ? `字数达标（${metrics.words} 词）。` : `已完成 ${metrics.words} 词。`,
        metrics.connectives > 0 ? `使用了 ${metrics.connectives} 处连接词。` : '句子结构基本可读。',
      ],
      improvements: heuristicStudyAdvice(metrics),
      corrections: deterministic,
      metrics,
      source: 'heuristic',
    }
  }

  let parsed: LlmGradeJson | null = null
  let llmError = ''
  try {
    parsed = await completeJson<LlmGradeJson>(
      llm,
      buildWritingGradeMessages({
        task,
        rubric,
        text,
        metrics,
        deterministic: deterministic.map((c) => `${c.original} -> ${c.suggestion} (${c.category})`),
        durationSec,
      }),
      { timeoutMs: 150_000 },
    )
  } catch (err) {
    llmError = (err as Error).message
  }

  if (!parsed) {
    return {
      dimensions: heuristic,
      overall: fallbackOverall.overall,
      band: fallbackOverall.band,
      bandLabel: `${fallbackOverall.label}（模型失败，粗估）`,
      confidence: 'low',
      summary: `模型评分失败：${llmError}。以下为本地粗估。`,
      strengths: [],
      improvements: heuristicStudyAdvice(metrics),
      corrections: deterministic,
      metrics,
      source: 'heuristic',
    }
  }

  const dimensions = llmDimensions(parsed.dimensions, rubric, heuristic)
  const overall = overallFrom(dimensions, rubric)
  const corrections = mergeCorrections(deterministic, cleanCorrections(parsed.corrections))
  return {
    dimensions,
    overall: overall.overall,
    band: overall.band,
    bandLabel: overall.label,
    confidence: parsed.confidence === 'high' ? 'high' : parsed.confidence === 'low' ? 'low' : 'medium',
    summary: parsed.summary ?? '',
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.filter((s) => typeof s === 'string').slice(0, 5) : [],
    improvements: Array.isArray(parsed.improvements)
      ? parsed.improvements.filter((s) => typeof s === 'string').slice(0, 6)
      : [],
    corrections,
    metrics,
    source: 'llm',
  }
}

/* ------------------------------ speaking ------------------------------ */

function speakingHeuristicDimensions(metrics: LanguageMetrics, rubric?: Rubric): DimensionScore[] {
  const wpm = metrics.wpm ?? 0
  const pacePenalty = wpm < 90 ? (90 - wpm) * 0.8 : wpm > 175 ? (wpm - 175) * 0.8 : 0
  const fluency = wpm ? clamp(78 - pacePenalty - metrics.fillerRate * 500, 20, 95) : 55
  const vocabulary = clamp(30 + Math.min(25, metrics.uniqueWords * 1.2) + metrics.longWordRatio * 80)
  const grammar = clamp(50 + Math.min(20, metrics.avgSentenceLen * 0.8) - metrics.repeatedWordPairs * 8)
  const coherence = clamp(35 + Math.min(14, metrics.connectives) * 4 + Math.min(8, metrics.sentences))
  const make = (key: string, label: string, labelZh: string, score: number, max: number): DimensionScore => ({
    key,
    label,
    labelZh,
    score: Math.round(score),
    band: Math.round((score / 100) * max * 10) / 10,
    comment: '基于文本指标的本地粗估。',
    evidence: [],
  })
  if (rubric?.exam === 'toefl') {
    return [
      make('language', 'Language Use', '语言运用', (vocabulary + grammar) / 2, 5),
      make('development', 'Topic Development', '内容展开', coherence, 5),
    ]
  }
  if (rubric?.exam === 'ielts') {
    return [
      make('fc', 'Fluency and Coherence', '流利与连贯', (fluency + coherence) / 2, 9),
      make('lr', 'Lexical Resource', '词汇资源', vocabulary, 9),
      make('gra', 'Grammatical Range and Accuracy', '语法多样性与准确性', grammar, 9),
    ]
  }
  return [
    make('fluency', 'Fluency', '流利度', fluency, 9),
    make('vocabulary', 'Vocabulary', '词汇', vocabulary, 9),
    make('grammar', 'Grammar', '语法', grammar, 9),
    make('coherence', 'Coherence', '连贯', coherence, 9),
  ]
}

function fillerCorrections(text: string): Correction[] {
  const patterns: { re: RegExp; suggestion: string; note: string }[] = [
    { re: /\b(um+|uh+|erm?|hmm+)\b/gi, suggestion: '（短暂停顿）', note: '用停顿代替语气填充词，听感更自信。' },
    { re: /\byou know\b/gi, suggestion: '（直接进入下一句）', note: '减少口头禅，信息密度会更高。' },
    { re: /\bsort of\b/gi, suggestion: '（更精确的表达）', note: '避免用 sort of 模糊化观点。' },
    { re: /\bkind of\b/gi, suggestion: '（更精确的表达）', note: '避免用 kind of 模糊化观点。' },
  ]
  const out: Correction[] = []
  for (const p of patterns) {
    const matches = text.match(p.re) ?? []
    const first = matches[0]
    if (!first) continue
    out.push({
      original: first,
      suggestion: p.suggestion,
      category: 'coherence',
      explanation: p.note,
      severity: 1,
    })
  }
  return out
}

export async function buildSessionReport(input: {
  sessionId: number
  mode: SessionMode
  exam: Exam
  turns: TurnRow[]
  durationSec: number
  settings: AppSettings
  llm: LlmConfig | null
  meta: SessionMeta
}): Promise<SessionReport> {
  const { sessionId, mode, exam, turns, durationSec, settings, llm } = input
  const userTurns = turns.filter((t) => t.role === 'user')
  const userText = userTurns.map((t) => t.text).join('\n')
  const speechMs = userTurns.reduce((sum, t) => sum + (t.audioMs ?? 0), 0)
  const metrics = analyzeText(userText, { spoken: true, durationSec: speechMs > 3000 ? speechMs / 1000 : undefined })
  const rubric = exam === 'ielts' || exam === 'toefl' ? rubricFor(exam, 'speaking') : undefined
  const deterministic = mergeCorrections(deterministicCorrections(userText, { spoken: true }), fillerCorrections(userText))
  const heuristic = speakingHeuristicDimensions(metrics, rubric)
  const scaleMax = rubric?.scale.max ?? (exam === 'toefl' ? 6 : exam === 'kaoyan' ? 100 : 9)
  const fallbackOverall = Math.round(heuristic.reduce((s, d) => s + d.score, 0) / heuristic.length)
  const fallbackBand = bandFromOverall(exam, fallbackOverall, scaleMax)
  const suffix = rubric ? '（文本估算，不含发音）' : '（文本粗估）'

  const base: SessionReport = {
    sessionId,
    mode,
    durationSec,
    turns: turns.length,
    userTurns: userTurns.length,
    metrics,
    dimensions: heuristic,
    band: Math.round(fallbackBand * 10) / 10,
    bandLabel: bandLabel(exam, fallbackBand, scaleMax, suffix),
    confidence: 'low',
    summary: userTurns.length
      ? `本轮你说 ${metrics.words} 词，平均语速 ${metrics.wpm ?? '—'} 词/分钟，填充词占比 ${(metrics.fillerRate * 100).toFixed(1)}%。未调用模型，分数为本地粗估。`
      : '本轮没有检测到你的英文发言。',
    strengths: [
      metrics.words > 0 ? `完成 ${userTurns.length} 轮发言。` : '开始了练习。',
      metrics.connectives > 0 ? `使用了 ${metrics.connectives} 处连接词。` : '发音/转写已记录。',
    ],
    improvements: heuristicStudyAdvice(metrics),
    corrections: deterministic,
    source: 'heuristic',
  }

  if (!llm || !userTurns.length) return base

  try {
    const parsed = await completeJson<LlmGradeJson>(
      llm,
      buildSessionFeedbackMessages({ mode, exam, settings, turns, metrics, durationSec, rubric }),
      { timeoutMs: 45_000 },
    )
    const dimensions = llmDimensions(parsed.dimensions, rubric, heuristic).filter(
      (d) => d.key !== 'p' && d.key !== 'delivery',
    )
    const overall = Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length)
    const band = bandFromOverall(exam, overall, scaleMax)
    return {
      ...base,
      dimensions,
      band: Math.round(band * 10) / 10,
      bandLabel: bandLabel(exam, band, scaleMax, suffix),
      confidence:
        parsed.confidence === 'high' ? 'high' : parsed.confidence === 'medium' ? 'medium' : 'low',
      summary: parsed.summary ?? base.summary,
      strengths: Array.isArray(parsed.strengths)
        ? parsed.strengths.filter((s) => typeof s === 'string').slice(0, 5)
        : base.strengths,
      improvements: Array.isArray(parsed.improvements)
        ? parsed.improvements.filter((s) => typeof s === 'string').slice(0, 6)
        : base.improvements,
      corrections: mergeCorrections(deterministic, cleanCorrections(parsed.corrections, 8)),
      source: 'llm',
    }
  } catch (err) {
    return {
      ...base,
      summary: `${base.summary}（模型分析失败：${(err as Error).message}）`,
    }
  }
}

export function writingWordCount(text: string): number {
  return wordCount(text)
}
