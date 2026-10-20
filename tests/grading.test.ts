import { describe, expect, test } from 'bun:test'
import type { AppSettings, TurnRow } from '../src/shared/types'

process.env.DB_PATH = `/tmp/echo-test-${process.pid}.db`
process.env.CONTENT_DIR = `${process.cwd()}/content`

const { gradeWriting, buildSessionReport } = await import('../server/grading')
const { bundle, rubricFor } = await import('../server/content')

const settings: AppSettings = {
  llmBaseUrl: 'http://127.0.0.1:9/v1',
  llmModel: 'none',
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

describe('heuristic grading', () => {
  test('writing without a model still returns a complete rubric report', async () => {
    const task = bundle.writing.find((item) => item.exam === 'ielts' && item.kind === 'task2')!
    const rubric = rubricFor('ielts', 'writing', 'task2')!
    const result = await gradeWriting({
      task,
      text: 'I am agree with this view. Education is important because it helps people.',
      durationSec: 120,
      llm: null,
    })
    expect(result.source).toBe('heuristic')
    expect(result.confidence).toBe('low')
    expect(result.dimensions.map((dimension) => dimension.key)).toEqual(rubric.criteria.map((criterion) => criterion.key))
    expect(result.bandLabel).toContain('粗估')
    expect(result.corrections.some((correction) => correction.category === 'task')).toBe(true)
    expect(result.metrics.words).toBeGreaterThan(0)
  })

  test('speaking report excludes pronunciation when only text is available', async () => {
    const turns: TurnRow[] = [
      { id: 1, sessionId: 1, role: 'assistant', text: 'Do you work or are you a student?', audioMs: null, createdAt: 1 },
      {
        id: 2,
        sessionId: 1,
        role: 'user',
        text: 'I am agree with you. I work as a software engineer and I enjoy solving problems.',
        audioMs: 9000,
        createdAt: 2,
      },
    ]
    const report = await buildSessionReport({
      sessionId: 1,
      mode: 'ielts.p1',
      exam: 'ielts',
      turns,
      durationSec: 30,
      settings,
      llm: null,
      meta: {},
    })
    expect(report.source).toBe('heuristic')
    expect(report.dimensions.length).toBeGreaterThan(0)
    expect(report.dimensions.map((dimension) => dimension.key)).not.toContain('p')
    expect(report.bandLabel).toContain('不含发音')
    expect(report.userTurns).toBe(1)
    expect(report.metrics.words).toBeGreaterThan(10)
  })

  test('TOEFL 2026 writing uses the 1-6 scale', async () => {
    const task = bundle.writing.find((item) => item.exam === 'toefl' && item.kind === 'email')!
    const rubric = rubricFor('toefl', 'writing')!
    const result = await gradeWriting({
      task,
      text: 'Dear Manager, I am writing to request a change to my schedule. I have a laboratory class on Tuesday afternoons, so I would prefer to work in the morning. I have experience in customer service and can start immediately. Thank you for considering my request. Best regards, Li Ming.',
      durationSec: 300,
      llm: null,
    })
    expect(result.source).toBe('heuristic')
    expect(result.dimensions.map((dimension) => dimension.key)).toEqual(rubric.criteria.map((criterion) => criterion.key))
    expect(result.bandLabel).toContain('/6')
  })

  test('TOEFL 2026 speaking report uses 1-6 and 2026 dimensions', async () => {
    const turns: TurnRow[] = [
      {
        id: 1,
        sessionId: 3,
        role: 'user',
        text: 'I usually prepare by reviewing my notes and doing practice questions. I prefer studying alone because I can focus better.',
        audioMs: 20000,
        createdAt: 1,
      },
    ]
    const report = await buildSessionReport({
      sessionId: 3,
      mode: 'toefl.speech',
      exam: 'toefl',
      turns,
      durationSec: 30,
      settings: { ...settings, exam: 'toefl' },
      llm: null,
      meta: {},
    })
    expect(report.bandLabel).toContain('/6')
    expect(report.dimensions.map((dimension) => dimension.key)).toEqual(['language', 'development'])
  })

  test('kaoyan speaking is reported on a 100-point scale', async () => {
    const turns: TurnRow[] = [
      { id: 1, sessionId: 2, role: 'user', text: 'I think this is a good idea because it helps many people.', audioMs: 7000, createdAt: 1 },
    ]
    const report = await buildSessionReport({
      sessionId: 2,
      mode: 'free',
      exam: 'kaoyan',
      turns,
      durationSec: 20,
      settings: { ...settings, exam: 'kaoyan' },
      llm: null,
      meta: {},
    })
    expect(report.bandLabel).toContain('/100')
  })
})
