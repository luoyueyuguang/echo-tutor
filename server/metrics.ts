import type { Correction, LanguageMetrics } from '../src/shared/types'

const CONNECTIVES = [
  'however',
  'therefore',
  'moreover',
  'furthermore',
  'in addition',
  'on the other hand',
  'whereas',
  'although',
  'because',
  'consequently',
  'for instance',
  'for example',
  'in contrast',
  'as a result',
  'nevertheless',
  'while',
  'since',
  'despite',
  'in conclusion',
  'firstly',
  'secondly',
  'finally',
  'in other words',
  'that is why',
]

// Conservative on purpose: "like" and "actually" produce too many false positives
// in ordinary speech to be counted as fillers automatically.
const FILLERS = ['um+', 'uh+', 'er+m?', 'hmm+', 'you know', 'sort of', 'kind of', 'i mean', 'basically']

const countMatches = (text: string, source: string) => {
  const re = new RegExp(source, 'gi')
  return (text.match(re) ?? []).length
}

const CONTENT_STOPWORDS = new Set([
  'the','a','an','and','or','but','of','to','in','on','at','for','with','by','from','as','is','are','was','were',
  'be','been','being','it','its','this','that','these','those','you','your','we','our','they','their','he','she',
  'his','her','i','my','me','not','no','do','does','did','have','has','had','will','would','can','could','should',
  'may','might','must','about','which','who','whom','what','when','where','why','how','than','then','so','if',
  'there','here','also','more','most','some','any','all','both','each','other','such','only','very','just',
])

function tokenize(text: string): string[] {
  return (text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? []).map((w) => w.toLowerCase())
}

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?]+|\n+/)
    .map((s) => s.trim())
    .filter((s) => tokenize(s).length > 0)
}

function contentWords(text: string): Set<string> {
  return new Set(tokenize(text).filter((w) => w.length > 2 && !CONTENT_STOPWORDS.has(w)))
}

export interface AnalyzeOptions {
  spoken?: boolean
  writing?: boolean
  durationSec?: number
}

export function analyzeText(text: string, opts: AnalyzeOptions = {}): LanguageMetrics {
  const words = tokenize(text)
  const sentences = splitSentences(text)
  const paragraphs = text.split(/\n\s*\n/).filter((p) => tokenize(p).length > 0).length
  const unique = new Set(words)
  const longWords = words.filter((w) => w.length >= 7).length
  const connectives = CONNECTIVES.reduce((sum, c) => sum + countMatches(text, `\\b${c.replace(/ /g, '\\s+')}\\b`), 0)
  const fillerCount = opts.spoken ? FILLERS.reduce((sum, f) => sum + countMatches(text, `\\b${f}\\b`), 0) : 0
  const repeatedWordPairs = (text.match(/\b(\w+)\s+\1\b/gi) ?? []).length
  const wordCount = words.length
  const durationSec = opts.durationSec && opts.durationSec > 0 ? opts.durationSec : undefined

  return {
    words: wordCount,
    uniqueWords: unique.size,
    sentences: sentences.length,
    paragraphs,
    avgSentenceLen: sentences.length ? Math.round((wordCount / sentences.length) * 10) / 10 : 0,
    typeTokenRatio: wordCount ? Math.round((unique.size / wordCount) * 1000) / 1000 : 0,
    longWordRatio: wordCount ? Math.round((longWords / wordCount) * 1000) / 1000 : 0,
    connectives,
    fillerCount,
    fillerRate: wordCount ? Math.round((fillerCount / wordCount) * 1000) / 1000 : 0,
    repeatedWordPairs,
    durationSec,
    wpm: durationSec && durationSec >= 5 ? Math.round((wordCount / durationSec) * 60) : undefined,
  }
}

export function keywordCoverage(prompt: string, essay: string): number {
  const wanted = contentWords(prompt)
  if (!wanted.size) return 1
  const got = contentWords(essay)
  let hit = 0
  for (const w of wanted) if (got.has(w)) hit++
  return hit / wanted.size
}

export function deterministicCorrections(
  text: string,
  opts: { minWords?: number; writing?: boolean; spoken?: boolean } = {},
): Correction[] {
  const out: Correction[] = []
  const seen = new Set<string>()
  const push = (c: Correction) => {
    const key = `${c.original}->${c.suggestion}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(c)
  }

  const repeated = text.match(/\b(\w+)\s+\1\b/gi) ?? []
  for (const m of repeated) {
    const word = m.split(/\s+/)[0]
    push({
      original: m,
      suggestion: word,
      category: 'grammar',
      explanation: 'Avoid repeating the same word twice in a row.',
      severity: 1,
    })
  }

  if (!opts.spoken) {
    if (/[^\S\n]{2,}/.test(text)) {
      push({
        original: '（连续空格）',
        suggestion: '（单个空格）',
        category: 'grammar',
        explanation: 'Use a single space between words.',
        severity: 1,
      })
    }

    const punctuation = text.match(/[,;:!?][A-Za-z]/g) ?? []
    for (const m of punctuation.slice(0, 5)) {
      push({
        original: m,
        suggestion: `${m[0]} ${m.slice(1)}`,
        category: 'grammar',
        explanation: 'Put a space after punctuation.',
        severity: 1,
      })
    }

    if (/\bi\b/.test(text)) {
      push({
        original: 'i',
        suggestion: 'I',
        category: 'grammar',
        explanation: 'The pronoun I is always capitalised.',
        severity: 1,
      })
    }
  }

  const aVowel = text.match(/\ba\s+([aeiou][a-z]*)\b/gi) ?? []
  for (const m of aVowel) {
    const noun = m.split(/\s+/)[1] ?? ''
    if (/^(university|unique|user|useful|european|one|once|uniform)/i.test(noun)) continue
    push({
      original: m,
      suggestion: m.replace(/\ba\b/i, 'an'),
      category: 'grammar',
      explanation: 'Use "an" before a vowel sound.',
      severity: 1,
    })
  }

  const anConsonant = text.match(/\ban\s+([b-df-hj-np-tv-z][a-z]*)\b/gi) ?? []
  for (const m of anConsonant) {
    const noun = m.split(/\s+/)[1] ?? ''
    if (/^(hour|honest|heir|honour)/i.test(noun)) continue
    push({
      original: m,
      suggestion: m.replace(/\ban\b/i, 'a'),
      category: 'grammar',
      explanation: 'Use "a" before a consonant sound.',
      severity: 1,
    })
  }

  const patterns: { re: RegExp; to: string; note: string; category: Correction['category'] }[] = [
    { re: /\baccording to my opinion\b/gi, to: 'in my opinion', note: 'This phrase is not idiomatic in English.', category: 'vocabulary' },
    { re: /\bin nowadays\b/gi, to: 'nowadays', note: 'Use "nowadays" without a preposition.', category: 'grammar' },
    { re: /\bdiscuss about\b/gi, to: 'discuss', note: '"Discuss" is transitive; no "about" is needed.', category: 'grammar' },
    { re: /\bemphasi[sz]e on\b/gi, to: 'emphasise', note: '"Emphasise" is transitive; no "on" is needed.', category: 'grammar' },
    { re: /\bcan be able to\b/gi, to: 'can', note: '"Can" and "be able to" express the same idea; use one.', category: 'grammar' },
    { re: /\bmore better\b/gi, to: 'better', note: 'Do not use "more" with a comparative form.', category: 'grammar' },
    { re: /\bmost easiest\b/gi, to: 'easiest', note: 'Do not use "most" with a superlative form.', category: 'grammar' },
    { re: /\bvery much like\b/gi, to: 'like … very much', note: 'Place "very much" after the object.', category: 'grammar' },
    { re: /\b(am|is|are|was|were)\s+agree\b/gi, to: 'agree', note: '"Agree" is a verb; do not put a form of "be" before it.', category: 'grammar' },
    { re: /\bvery\s+(like|love|enjoy|want)\b/gi, to: 'really $1', note: 'Use "really" before a verb, not "very".', category: 'grammar' },
  ]
  for (const p of patterns) {
    for (const m of text.match(p.re) ?? []) {
      push({ original: m, suggestion: m.replace(p.re, p.to), category: p.category, explanation: p.note, severity: 2 })
    }
  }

  if (opts.writing) {
    const lowerStart = text.match(/(^|[.!?]\s+)([a-z])/g) ?? []
    for (const m of lowerStart.slice(0, 3)) {
      const ch = m.slice(-1)
      if (ch === 'i') continue
      push({
        original: m.trim(),
        suggestion: `${m.slice(0, -1)}${ch.toUpperCase()}`,
        category: 'grammar',
        explanation: 'Start a sentence with a capital letter.',
        severity: 1,
      })
    }
    const trimmed = text.trim()
    if (trimmed.length > 20 && !/[.!?]$/.test(trimmed)) {
      push({
        original: `${trimmed.slice(-12)}…`,
        suggestion: '…（句末加标点）',
        category: 'grammar',
        explanation: 'End the final sentence with punctuation.',
        severity: 1,
      })
    }
    if (opts.minWords && opts.minWords > 0) {
      const n = tokenize(text).length
      if (n < opts.minWords) {
        push({
          original: `${n} words`,
          suggestion: `${opts.minWords}+ words`,
          category: 'task',
          explanation: `This task requires at least ${opts.minWords} words. Under-length answers lose marks.`,
          severity: 3,
        })
      }
    }
  }

  return out
}

export function wordCount(text: string): number {
  return tokenize(text).length
}
