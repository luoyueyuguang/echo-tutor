export type Exam = 'ielts' | 'toefl' | 'kaoyan'
export type Skill = 'speaking' | 'writing'
export type Cefr = 'A2' | 'B1' | 'B2' | 'C1'
export type View = 'chat' | 'exam' | 'writing' | 'review' | 'dashboard' | 'settings'

export type SessionMode =
  | 'free'
  | 'ielts.p1'
  | 'ielts.p2'
  | 'ielts.p3'
  | 'toefl.speech'
  | 'scenario'
  | 'dictation'
  | 'shadow'

/* ---------------- speaking content ---------------- */

export interface IeltsPart1 {
  topic: string
  topicZh: string
  questions: string[]
}

export interface IeltsPart2 {
  id: string
  topic: string
  topicZh: string
  cue: string
  bullets: string[]
  followUps: string[]
}

export interface IeltsPart3 {
  topic: string
  topicZh: string
  questions: string[]
}

export interface IeltsSpeakingPack {
  part1: IeltsPart1[]
  part2: IeltsPart2[]
  part3: IeltsPart3[]
}

export interface ToeflSpeakingItem {
  id: string
  text: string
  tip?: string
}

export interface ToeflSpeakingSet {
  id: string
  kind: 'listen-repeat' | 'interview'
  topic: string
  topicZh: string
  prepSec: number
  responseSec: number
  items: ToeflSpeakingItem[]
  guidance?: string[]
}

export interface ToeflPack {
  sets: ToeflSpeakingSet[]
}

export interface Scenario {
  id: string
  title: string
  titleZh: string
  level: Cefr
  role: string
  setting: string
  goal: string
  usefulLanguage: string[]
  opening: string
}

export interface ShadowDrill {
  id: string
  focus: 'linking' | 'stress' | 'minimal-pair' | 'intonation' | 'chunking'
  title: string
  items: { text: string; zh?: string; tip?: string }[]
}

/* ---------------- writing content ---------------- */

export type WritingTaskKind =
  | 'task1'
  | 'task2'
  | 'build-sentence'
  | 'email'
  | 'academic-discussion'
  | 'letter'
  | 'notice'
  | 'chart'
  | 'picture'

export interface WritingTask {
  id: string
  exam: Exam
  kind: WritingTaskKind
  topic: string
  topicZh: string
  prompt: string
  data?: string
  reading?: string
  listening?: string
  chunks?: string[]
  answer?: string
  minWords: number
  minutes: number
  guidance?: string[]
}

/* ---------------- rubrics ---------------- */

export interface RubricCriterion {
  key: string
  label: string
  labelZh: string
  bands: Record<string, string>
}

export interface Rubric {
  exam: Exam
  skill: Skill
  task?: string
  scale: { min: number; max: number; unit: 'band' | 'score' }
  criteria: RubricCriterion[]
  notes?: string
}

export interface PhraseGroup {
  topic: string
  topicZh: string
  phrases: { en: string; zh: string; note?: string }[]
}

export interface ContentBundle {
  ieltsSpeaking: IeltsSpeakingPack
  toeflSpeaking: ToeflSpeakingSet[]
  writing: WritingTask[]
  scenarios: Scenario[]
  drills: ShadowDrill[]
  phrases: PhraseGroup[]
  rubrics: Rubric[]
}

/* ---------------- settings ---------------- */

export interface AppSettings {
  llmBaseUrl: string
  llmModel: string
  llmApiKeySet: boolean
  asrProvider: 'browser' | 'whisper'
  ttsProvider: 'browser' | 'openai'
  accent: 'en-GB' | 'en-US'
  rate: number
  pitch: number
  browserVoiceURI: string
  ttsVoice: string
  ttsBaseUrl: string
  ttsModel: string
  ttsApiKeySet: boolean
  ttsConfigured: boolean
  exam: Exam
  dailyGoalMin: number
  studentLevel: Cefr
}

export interface SettingsInput extends Partial<Omit<AppSettings, 'llmApiKeySet' | 'ttsApiKeySet' | 'ttsConfigured'>> {
  llmApiKey?: string
  ttsApiKey?: string
}

/* ---------------- records ---------------- */

export interface SessionRow {
  id: number
  mode: SessionMode
  exam: Exam | null
  meta: Record<string, unknown>
  startedAt: number
  endedAt: number | null
}

export interface TurnRow {
  id: number
  sessionId: number
  role: 'user' | 'assistant'
  text: string
  audioMs: number | null
  createdAt: number
}

export interface Correction {
  original: string
  suggestion: string
  category: 'grammar' | 'vocabulary' | 'pronunciation' | 'coherence' | 'register' | 'task'
  explanation: string
  severity: 1 | 2 | 3
}

export interface DimensionScore {
  key: string
  label: string
  labelZh: string
  score: number // normalized 0-100
  band: number // raw scale value
  comment: string
  evidence: string[]
}

export interface LanguageMetrics {
  words: number
  uniqueWords: number
  sentences: number
  paragraphs: number
  avgSentenceLen: number
  typeTokenRatio: number
  longWordRatio: number
  connectives: number
  fillerCount: number
  fillerRate: number
  repeatedWordPairs: number
  durationSec?: number
  wpm?: number
}

export interface GradeResult {
  dimensions: DimensionScore[]
  overall: number // normalized 0-100
  band: number
  bandLabel: string
  confidence: 'low' | 'medium' | 'high'
  summary: string
  strengths: string[]
  improvements: string[]
  corrections: Correction[]
  metrics: LanguageMetrics
  source: 'llm' | 'heuristic'
}

export interface EssayRow {
  id: number
  promptId: string
  exam: Exam
  kind: string
  prompt: string
  text: string
  wordCount: number
  durationSec: number | null
  grade: GradeResult
  createdAt: number
}

export interface SessionReport {
  sessionId: number
  mode: SessionMode
  durationSec: number
  turns: number
  userTurns: number
  metrics: LanguageMetrics
  dimensions: DimensionScore[]
  band: number | null
  bandLabel: string | null
  confidence: 'low' | 'medium' | 'high'
  summary: string
  strengths: string[]
  improvements: string[]
  corrections: Correction[]
  source: 'llm' | 'heuristic'
}

export interface ReviewItemRow {
  id: number
  kind: 'error' | 'vocab' | 'phrase'
  front: string
  back: string
  note: string | null
  dueAt: number
  reps: number
  lapses: number
  state: FsrsState
  createdAt: number
}

export interface FsrsState {
  stability: number
  difficulty: number
  lastReview: number | null
  scheduledDays: number
}

export interface OverviewStats {
  streakDays: number
  todayMinutes: number
  totalMinutes: number
  sessions7d: number
  wordsSpoken7d: number
  dueReviews: number
  essays: number
  bandTrend: { date: string; band: number; label: string }[]
  errorCategories: { category: string; count: number }[]
  activity: { date: string; minutes: number }[]
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

export interface StatsPayload extends OverviewStats {
  recentCorrections: Correction[]
  recentSessions: SessionSummary[]
  recentEssays: Omit<EssayRow, 'text'>[]
}

export interface ReviewItemWithPreview extends ReviewItemRow {
  preview: Record<string, string>
}

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; turnId: number; text: string }
  | { type: 'error'; message: string }

export interface ChatRequest {
  sessionId: number
  message: string
  part2Id?: string
  scenarioId?: string
  toeflId?: string
}

export interface SessionStartInput {
  mode: SessionMode
  exam: Exam | null
  meta?: Record<string, unknown>
}
