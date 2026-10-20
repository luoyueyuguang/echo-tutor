import type { AppSettings, Exam, LanguageMetrics, Rubric, SessionMode, TurnRow, WritingTask } from '../src/shared/types'
import { bundle, part2Card, scenarioById } from './content'

export interface SessionMeta {
  topic?: string
  part2Id?: string
  scenarioId?: string
  toeflId?: string
}

const LEVEL_HINT: Record<string, string> = {
  A2: 'short, simple sentences; high-frequency vocabulary; speak slowly',
  B1: 'clear everyday English; occasional B2 words with context',
  B2: 'natural conversational English; encourage complex sentences',
  C1: 'natural, idiomatic English; push precision and nuance',
}

function part1Set(meta: SessionMeta) {
  const sets = bundle.ieltsSpeaking.part1
  return sets.find((s) => s.topic === meta.topic) ?? sets[0]
}

function part3Set(meta: SessionMeta) {
  const sets = bundle.ieltsSpeaking.part3
  return sets.find((s) => s.topic === meta.topic) ?? sets[0]
}

export function openingFor(mode: SessionMode, meta: SessionMeta): string {
  switch (mode) {
    case 'ielts.p1': {
      const set = part1Set(meta)
      return `We'll start with IELTS Speaking Part 1. Let's talk about ${set.topic.toLowerCase()}. ${set.questions[0]}`
    }
    case 'ielts.p2': {
      const card = part2Card(meta.part2Id) ?? bundle.ieltsSpeaking.part2[0]
      return `Here is your cue card: “${card.cue}”. You have one minute to prepare. Make a few notes if you like, then speak for up to two minutes — I won't interrupt.`
    }
    case 'ielts.p3': {
      const set = part3Set(meta)
      return `Now let's move to IELTS Speaking Part 3. ${set.questions[0]}`
    }
    case 'toefl.speech':
      return `TOEFL Speaking 2026 practice: seven Listen and Repeat items and four Take an Interview questions. The app will play each prompt and time your response.`
    case 'scenario': {
      const sc = scenarioById(meta.scenarioId) ?? bundle.scenarios[0]
      return sc.opening
    }
    case 'dictation':
      return `Listen to the sentence, then type exactly what you hear. Replay it as often as you need.`
    case 'shadow':
      return `Listen to each sentence, then repeat it. Focus on the rhythm, not on speed.`
    default:
      return `Hi, I'm Aria — your English tutor. Let's have a relaxed conversation. Tell me one thing you did this morning, in English. If you get stuck, say it in Chinese and I'll help you say it in English.`
  }
}

const BASE_STYLE = `You are Aria, a warm, patient English tutor for a Chinese adult learner.
How you speak:
- English only. If the learner writes in Chinese or is clearly stuck, add ONE short Chinese gloss in parentheses, then continue in English.
- 2-4 short sentences per reply. End with exactly ONE question.
- Match vocabulary and grammar to the learner's level (CEFR {{LEVEL}}: {{LEVEL_HINT}}).
- Introduce at most one useful phrase per turn and use it naturally.
- Recast errors: use the correct form in your reply instead of explaining it. Do NOT list corrections during practice; a separate report handles that.
- Never mention being an AI. Never give band scores or fake statistics during practice.
- Learner text comes from speech recognition: ignore casing, punctuation and obvious homophone slips.
- Do not lecture. Prefer questions that make the learner talk.`

function modeInstructions(mode: SessionMode, meta: SessionMeta): string {
  switch (mode) {
    case 'ielts.p1': {
      const set = part1Set(meta)
      return `MODE: IELTS Speaking Part 1 (4-5 minutes).
Topic: ${set.topic}. Questions, in order:
${set.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}
Ask one question at a time. Use the transcript to see which ones are done. You may add at most one natural follow-up before moving on. Do not ask abstract Part 3 questions or give scores.`
    }
    case 'ielts.p2': {
      const card = part2Card(meta.part2Id) ?? bundle.ieltsSpeaking.part2[0]
      return `MODE: IELTS Speaking Part 2 (long turn).
Cue card: ${card.cue}
Bullets: ${card.bullets.join('; ')}
Follow-up questions: ${card.followUps.join(' | ')}
The learner has one minute of preparation. When they start speaking, do NOT interrupt, even if they pause. If they stop before 90 seconds, encourage them to continue with one short prompt. Afterwards ask the follow-ups one at a time.`
    }
    case 'ielts.p3': {
      const set = part3Set(meta)
      return `MODE: IELTS Speaking Part 3 (4-5 minutes).
Discussion questions, in order:
${set.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}
Ask one at a time. Probe for reasons, examples, comparisons and consequences. Politely challenge vague answers ("Why do you think that is?"). Do not accept one-word answers. Do not give scores.`
    }
    case 'toefl.speech':
      return `MODE: TOEFL Speaking 2026.
The app runs Listen and Repeat (seven items) and Take an Interview (four questions) with its own audio and timers. Do not use the old independent/integrated tasks, do not give feedback during the section, and keep any chat turns minimal.`
    case 'scenario': {
      const sc = scenarioById(meta.scenarioId) ?? bundle.scenarios[0]
      return `MODE: role-play.
You are ${sc.role}. Setting: ${sc.setting}
The learner's goal: ${sc.goal}
Stay in character. Use simple, realistic language. Do not explain grammar mid-scene. If the learner is stuck, offer one short in-character hint in parentheses. Useful language they may try: ${sc.usefulLanguage.join(' | ')}.`
    }
    case 'dictation':
      return `MODE: dictation. The app handles playback and checking; keep turns extremely short.`
    case 'shadow':
      return `MODE: shadowing. Keep spoken turns extremely short; the app handles the drill.`
    default:
      return `MODE: free conversation. Be curious about the learner's life, goals and opinions. Ask follow-ups that require more than one sentence. Gently push them to elaborate.`
  }
}

export function buildTutorMessages(input: {
  mode: SessionMode
  meta: SessionMeta
  settings: AppSettings
  turns: TurnRow[]
}) {
  const { mode, meta, settings, turns } = input
  const system = `${BASE_STYLE.replace('{{LEVEL}}', settings.studentLevel).replace('{{LEVEL_HINT}}', LEVEL_HINT[settings.studentLevel] ?? '')}

Target exam: ${settings.exam.toUpperCase()}.
${modeInstructions(mode, meta)}`

  const history = turns.slice(-24).map((t) => ({
    role: t.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: t.text,
  }))
  return [{ role: 'system' as const, content: system }, ...history]
}

function rubricBlock(rubric: Rubric): string {
  return rubric.criteria
    .map(
      (c) =>
        `- ${c.key} (${c.label} / ${c.labelZh}):\n${Object.entries(c.bands)
          .map(([band, text]) => `  Band ${band}: ${text}`)
          .join('\n')}`,
    )
    .join('\n')
}

export interface FeedbackPromptInput {
  mode: SessionMode
  exam: Exam
  settings: AppSettings
  turns: TurnRow[]
  metrics: LanguageMetrics
  durationSec: number
  rubric?: Rubric
}

export function buildSessionFeedbackMessages(input: FeedbackPromptInput) {
  const { mode, exam, settings, turns, metrics, durationSec, rubric } = input
  const transcript = turns.map((t) => `${t.role === 'user' ? 'LEARNER' : 'TUTOR'}: ${t.text}`).join('\n')
  const assessable = rubric
    ? rubric.criteria.filter((c) => c.key !== 'p' && c.key !== 'delivery')
    : []
  const dims = assessable.length
    ? assessable.map((c) => `${c.key} = ${c.label}`).join(', ')
    : 'fluency, vocabulary, grammar, coherence'

  const system = `You are a senior ${exam.toUpperCase()} speaking examiner and diagnostic coach. You analyse a practice transcript and return STRICT JSON only.
Rules:
- Be conservative and evidence-based. Never inflate.
- Pronunciation CANNOT be judged from a transcript. Never claim pronunciation errors from spelling, and never score pronunciation.
- Ignore speech-recognition artefacts (missing punctuation, casing, homophones) unless the same error is unmistakable.
- Quote the learner's exact words in "original" fields. Keep original/suggestion in English; write comments, summary, strengths and improvements in Chinese.
- Corrections: at most 8, highest impact first. category is one of grammar, vocabulary, pronunciation, coherence, register, task. severity 1 (minor) to 3 (blocks meaning).
- dimension bands must use the rubric scale. Only include dimensions listed below.
- confidence: low, medium or high.`

  const rubricText = assessable.length
    ? `Rubric criteria: ${dims}\n${assessable
        .map(
          (c) =>
            `- ${c.key} (${c.label} / ${c.labelZh}):\n${Object.entries(c.bands)
              .map(([band, text]) => `  Band ${band}: ${text}`)
              .join('\n')}`,
        )
        .join('\n')}`
    : `Assess fluency, vocabulary, grammar and coherence on a 0-9 band scale.`

  const user = `Target: ${exam.toUpperCase()} speaking, mode ${mode}. Learner level ${settings.studentLevel}.
Session duration: ${durationSec}s. Turns: ${turns.length}.

Measured metrics (from text; may be inaccurate):
${JSON.stringify(metrics, null, 2)}

${rubricText}

Transcript:
${transcript}

Return this exact JSON shape:
{
  "dimensions": [{"key": "fc", "band": 6, "comment": "中文点评", "evidence": ["exact learner quote"]}],
  "corrections": [{"original": "exact quote", "suggestion": "corrected English", "category": "grammar", "explanation": "中文说明", "severity": 1}],
  "summary": "2-3 句中文总结",
  "strengths": ["中文", "..."],
  "improvements": ["中文，可执行", "..."],
  "confidence": "medium"
}
Do not wrap the JSON in markdown.`

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]
}

export interface WritingPromptInput {
  task: WritingTask
  rubric: Rubric
  text: string
  metrics: LanguageMetrics
  deterministic: string[]
  durationSec: number | null
}

export function buildWritingGradeMessages(input: WritingPromptInput) {
  const { task, rubric, text, metrics, deterministic, durationSec } = input
  const system = `You are a senior ${task.exam.toUpperCase()} writing examiner. Score the response against the supplied rubric and return STRICT JSON only.
Rules:
- Apply the band descriptors literally and conservatively. Do not reward memorised templates or impressive words used inaccurately.
- Every dimension comment needs at least one exact quote from the essay as evidence.
- Corrections: at most 10, highest impact first. "original" must be an exact substring of the essay. Keep original/suggestion in English; explanations in Chinese.
- Do not invent errors. If the essay is clean, return an empty corrections array.
- Under-length responses must be capped on the task criterion.
- Integrated tasks must accurately relate the lecture to the reading.
- Write summary, comments, strengths and improvements in Chinese.`

  const user = `Exam: ${task.exam.toUpperCase()}
Task type: ${task.kind}
Task prompt:
${task.prompt}
${task.reading ? `\nReading passage:\n${task.reading}` : ''}
${task.listening ? `\nListening transcript:\n${task.listening}` : ''}
Minimum words: ${task.minWords}. Recommended time: ${task.minutes} minutes. Actual duration: ${durationSec ?? 'unknown'}s.

Measured metrics:
${JSON.stringify(metrics, null, 2)}

Deterministic issues detected:
${deterministic.length ? deterministic.join('\n') : 'none'}

Rubric (${rubric.scale.min}-${rubric.scale.max} ${rubric.scale.unit}):
${rubric.criteria.map((c) => `${c.key} = ${c.label} / ${c.labelZh}`).join('\n')}
${rubricBlock(rubric)}

Essay:
"""
${text}
"""

Return this exact JSON shape:
{
  "dimensions": [{"key": "${rubric.criteria[0].key}", "band": 6, "comment": "中文点评", "evidence": ["exact quote"]}],
  "corrections": [{"original": "exact quote", "suggestion": "corrected English", "category": "grammar", "explanation": "中文说明", "severity": 2}],
  "summary": "2-3 句中文总结",
  "strengths": ["中文"],
  "improvements": ["中文，可执行"],
  "confidence": "medium"
}
Include every rubric criterion exactly once. Do not wrap the JSON in markdown.`

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]
}

export function heuristicStudyAdvice(metrics: LanguageMetrics) {
  const advice: string[] = []
  if (metrics.words < 60) advice.push('回答偏短。先用“观点 + 原因 + 例子”把每轮扩展到 3 句以上。')
  if (metrics.fillerRate > 0.02) advice.push('填充词偏多。用短暂停顿代替 um / you know，语速会更稳。')
  if (metrics.connectives < 3) advice.push('连接词偏少。练习 however / because / for example / on the other hand。')
  if (metrics.typeTokenRatio < 0.42) advice.push('重复用词较多。每轮准备 2 个同义替换，再开口。')
  if (metrics.avgSentenceLen > 26) advice.push('句子偏长。拆成两个短句，逻辑会更清楚。')
  if (metrics.repeatedWordPairs > 0) advice.push('出现连续重复词，放慢一点，先想好再开口。')
  if (!advice.length) advice.push('保持当前节奏，下一轮尝试加入一个具体例子和一个对比。')
  return advice
}
