import { describe, expect, test } from 'bun:test'
import { compareTranscript, tokenizeEnglish } from '../src/lib/compare'

describe('transcript comparison', () => {
  test('exact repetition scores one', () => {
    const result = compareTranscript('I would like a cup of coffee', 'I would like a cup of coffee')
    expect(result.score).toBe(1)
    expect(result.missing).toEqual([])
    expect(result.tokens.every((token) => token.matched)).toBe(true)
  })

  test('missing words are marked', () => {
    const result = compareTranscript('I would like a cup of coffee', 'I would like coffee')
    expect(result.score).toBeLessThan(1)
    expect(result.missing).toContain('a')
    expect(result.tokens.find((token) => token.text === 'coffee')?.matched).toBe(true)
  })

  test('extra words do not reduce coverage', () => {
    const result = compareTranscript('I like coffee', 'Well I really like coffee actually')
    expect(result.score).toBe(1)
  })

  test('tokenization is case-insensitive and keeps contractions', () => {
    expect(tokenizeEnglish("I can't do it")).toEqual(['i', "can't", 'do', 'it'])
  })
})
