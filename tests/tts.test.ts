import { describe, expect, test } from 'bun:test'

process.env.DB_PATH = `/tmp/echo-tts-test-${process.pid}.db`
const { synthesizeSpeech, resolveTts } = await import('../server/llm')
const { saveSettings } = await import('../server/db')

describe('server TTS payload', () => {
  test('sends the selected voice, speed and examiner instructions', async () => {
    let captured: Record<string, unknown> = {}
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        captured = (await req.json()) as Record<string, unknown>
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } })
      },
    })
    const result = await synthesizeSpeech(
      { root: `http://127.0.0.1:${server.port}`, apiKey: 'test', model: 'tts-1-hd' },
      'Good morning.',
      'fable',
      0.95,
      'Speak like a neutral British IELTS examiner.',
    )
    server.stop(true)
    expect(result.contentType).toBe('audio/mpeg')
    expect(captured.model).toBe('tts-1-hd')
    expect(captured.voice).toBe('fable')
    expect(captured.speed).toBe(0.95)
    expect(String(captured.instructions)).toContain('IELTS examiner')
  })

  test('retries without instructions when the provider rejects them', async () => {
    const bodies: Record<string, unknown>[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as Record<string, unknown>
        bodies.push(body)
        if (body.instructions) return Response.json({ error: 'unsupported field' }, { status: 400 })
        return new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'audio/mpeg' } })
      },
    })
    await synthesizeSpeech(
      { root: `http://127.0.0.1:${server.port}`, apiKey: 'test', model: 'tts-1-hd' },
      'Hello.',
      'alloy',
      1,
      'neutral',
    )
    server.stop(true)
    expect(bodies).toHaveLength(2)
    expect(bodies[0].instructions).toBe('neutral')
    expect(bodies[1].instructions).toBeUndefined()
  })
})

describe('TTS configuration resolution', () => {
  test('uses a dedicated TTS endpoint and key', () => {
    saveSettings({
      llmBaseUrl: 'https://api.openai.com/v1',
      llmApiKey: 'llm-key',
      ttsBaseUrl: 'https://tts.example/v1/audio/speech',
      ttsModel: 'tts-1-hd',
      ttsApiKey: 'tts-key',
    })
    const config = resolveTts()
    expect(config?.root).toBe('https://tts.example/v1')
    expect(config?.apiKey).toBe('tts-key')
    expect(config?.model).toBe('tts-1-hd')
  })

  test('falls back to the model endpoint and key', () => {
    saveSettings({
      llmBaseUrl: 'https://api.openai.com/v1',
      llmApiKey: 'llm-key',
      ttsBaseUrl: '',
      ttsModel: 'tts-1',
      ttsApiKey: '',
    })
    const config = resolveTts()
    expect(config?.root).toBe('https://api.openai.com/v1')
    expect(config?.apiKey).toBe('llm-key')
    expect(config?.model).toBe('tts-1')
  })

  test('returns null when no key is available', () => {
    saveSettings({ llmApiKey: '', ttsApiKey: '' })
    expect(resolveTts()).toBeNull()
  })
})
