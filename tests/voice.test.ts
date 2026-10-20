import { describe, expect, test } from 'bun:test'
import { pickVoice, voiceSummary, type VoiceLike } from '../src/lib/voice'

const voice = (name: string, lang: string, uri: string, local = true): VoiceLike => ({
  name,
  lang,
  voiceURI: uri,
  localService: local,
})

const voices: VoiceLike[] = [
  voice('Google US English', 'en-US', 'us-google', false),
  voice('English (America)', 'en-US', 'us-system'),
  voice('Google UK English Female', 'en-GB', 'gb-google', false),
  voice('Daniel', 'en-GB', 'gb-daniel'),
]

describe('voice selection', () => {
  test('an explicitly chosen voice wins even if the accent differs', () => {
    expect(pickVoice(voices, 'en-GB', 'us-system')?.name).toBe('English (America)')
  })

  test('prefers a natural voice in the requested accent', () => {
    expect(pickVoice(voices, 'en-GB', '')?.name).toBe('Google UK English Female')
    expect(pickVoice(voices, 'en-US', '')?.name).toBe('Google US English')
  })

  test('falls back to another English voice and reports the mismatch', () => {
    const onlyUs = voices.filter((item) => item.lang === 'en-US')
    const chosen = pickVoice(onlyUs, 'en-GB', '')
    expect(chosen?.lang).toBe('en-US')
    const summary = voiceSummary(onlyUs, 'en-GB', '', 'browser', '')
    expect(summary.warning).toContain('en-US')
    expect(summary.lang).toBe('en-US')
  })

  test('reports when the browser has no voices', () => {
    const summary = voiceSummary([], 'en-GB', '', 'browser', '')
    expect(summary.name).toContain('未检测到')
    expect(summary.warning).toContain('没有可用')
  })

  test('server TTS reports the configured server voice', () => {
    const summary = voiceSummary([], 'en-GB', '', 'openai', 'fable')
    expect(summary.name).toBe('fable')
    expect(summary.warning).toBe('')
  })
})
