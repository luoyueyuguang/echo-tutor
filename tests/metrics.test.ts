import { describe, expect, test } from 'bun:test'
import { analyzeText, deterministicCorrections, keywordCoverage, wordCount } from '../server/metrics'

describe('text metrics', () => {
  test('counts words and sentences', () => {
    const metrics = analyzeText('I work as an engineer. I enjoy solving problems!')
    expect(metrics.words).toBe(9)
    expect(metrics.sentences).toBe(2)
    expect(metrics.avgSentenceLen).toBe(4.5)
    expect(metrics.paragraphs).toBe(1)
  })

  test('computes speaking rate only with a duration', () => {
    const metrics = analyzeText('one two three four five', { spoken: true, durationSec: 5 })
    expect(metrics.wpm).toBe(60)
    expect(metrics.durationSec).toBe(5)
  })

  test('counts fillers in spoken text only', () => {
    const spoken = analyzeText('Um, I think, you know, it is fine.', { spoken: true })
    const written = analyzeText('Um, I think, you know, it is fine.')
    expect(spoken.fillerCount).toBeGreaterThan(0)
    expect(written.fillerCount).toBe(0)
  })

  test('keyword coverage reflects essay content', () => {
    const prompt = 'Some people think university education should be free for everyone.'
    expect(keywordCoverage(prompt, prompt)).toBeGreaterThan(0.9)
    expect(keywordCoverage(prompt, 'I like coffee.')).toBeLessThan(0.3)
  })

  test('word count ignores numbers and punctuation', () => {
    expect(wordCount("I'm 25 years old, and I can't wait!")).toBe(7)
  })
})

describe('deterministic corrections', () => {
  test('flags a before a vowel, with exceptions', () => {
    const corrections = deterministicCorrections('This is a apple. He is a university student.')
    const originals = corrections.map((c) => c.original)
    expect(originals).toContain('a apple')
    expect(originals).not.toContain('a university')
    expect(corrections.find((c) => c.original === 'a apple')?.suggestion).toBe('an apple')
  })

  test('flags non-idiomatic verb patterns', () => {
    const corrections = deterministicCorrections('We discuss about the plan. It can be able to work.')
    const originals = corrections.map((c) => c.original)
    expect(originals).toContain('discuss about')
    expect(originals).toContain('can be able to')
  })

  test('flags be + agree and very + verb', () => {
    const corrections = deterministicCorrections('I am agree with you. I very like this idea.')
    expect(corrections.find((c) => c.original === 'am agree')?.suggestion).toBe('agree')
    expect(corrections.find((c) => c.original === 'very like')?.suggestion).toBe('really like')
  })

  test('spoken mode ignores ASR punctuation and casing artefacts', () => {
    const corrections = deterministicCorrections('i am agree  with you', { spoken: true })
    expect(corrections.some((c) => c.original === 'i')).toBe(false)
    expect(corrections.some((c) => c.original.includes('连续空格'))).toBe(false)
    expect(corrections.some((c) => c.original === 'am agree')).toBe(true)
  })

  test('does not treat paragraph breaks as double spaces', () => {
    const corrections = deterministicCorrections('First paragraph.\n\nSecond paragraph.')
    expect(corrections.some((c) => c.original.includes('连续空格'))).toBe(false)
  })

  test('reports under-length writing as a task issue', () => {
    const corrections = deterministicCorrections('This is a short essay.', { writing: true, minWords: 250 })
    const task = corrections.find((c) => c.category === 'task')
    expect(task).toBeDefined()
    expect(task?.severity).toBe(3)
  })
})
