/**
 * Test-only OpenAI-compatible stub. It is never imported by the app.
 * Run with: bun tests/stub-llm.ts
 */
const PORT = Number(process.env.STUB_PORT ?? 9999)

interface ChatBody {
  messages: { role: string; content: string }[]
  stream?: boolean
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function rubricKeys(text: string): string[] {
  const keys = new Set<string>()
  for (const match of text.matchAll(/^- ([a-z_]+) \(/gm)) keys.add(match[1])
  const inline = text.match(/Rubric criteria: ([^\n]+)/)
  if (inline) {
    for (const part of inline[1].split(',')) {
      const key = part.split('=')[0]?.trim()
      if (key && /^[a-z_]+$/.test(key)) keys.add(key)
    }
  }
  return [...keys]
}

function gradeResponse(user: string): Record<string, unknown> {
  const isKaoyan = /KAOYAN/.test(user)
  const isToefl = /TOEFL/.test(user)
  const keys = rubricKeys(user)
  const dimensions = (keys.length ? keys : ['tr', 'cc', 'lr', 'gra']).map((key) => ({
    key,
    band: isKaoyan ? 13 : isToefl ? 3 : 6,
    comment: `测试模型对 ${key} 的点评：论点清楚，但例子还可以更具体。`,
    evidence: [],
  }))
  const hasAgree = /I am agree/i.test(user)
  return {
    dimensions,
    corrections: hasAgree
      ? [
          {
            original: 'I am agree',
            suggestion: 'I agree',
            category: 'grammar',
            explanation: 'agree 是动词，前面不需要 be 动词。',
            severity: 2,
          },
        ]
      : [],
    summary: '这是一条测试评分。结构完整，观点明确；下一步可以补充更具体的例子。',
    strengths: ['能够完整表达观点。'],
    improvements: ['每个观点后补一个具体例子。'],
    confidence: 'medium',
  }
}

function silentWav(seconds = 0.25, rate = 16000): ArrayBuffer {
  const samples = Math.floor(seconds * rate)
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.2
    view.setInt16(44 + i * 2, sample * 32767, true)
  }
  return buffer
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname.endsWith('/audio/speech') && req.method === 'POST') {
      const body = (await req.json()) as { model?: string; voice?: string; speed?: number; instructions?: string }
      console.log(
        'stub tts:',
        JSON.stringify({ model: body.model, voice: body.voice, speed: body.speed, instructions: Boolean(body.instructions) }),
      )
      return new Response(silentWav(), { headers: { 'Content-Type': 'audio/wav' } })
    }
    if (!url.pathname.endsWith('/chat/completions') || req.method !== 'POST') {
      return new Response('not found', { status: 404 })
    }
    const body = (await req.json()) as ChatBody
    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    const isGrading = /Return this exact JSON shape/.test(lastUser)

    if (isGrading) {
      await sleep(1200)
      return Response.json({
        id: 'stub',
        choices: [{ message: { role: 'assistant', content: JSON.stringify(gradeResponse(lastUser)) } }],
      })
    }

    const reply =
      'That is a solid start. You used a clear reason, and your meaning came through. Try adding one concrete example next time. What do you enjoy most about your work?'
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder()
        for (const word of reply.split(' ')) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: `${word} ` } }] })}\n\n`,
            ),
          )
          await sleep(18)
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  },
})

console.log(`stub LLM listening on http://127.0.0.1:${server.port}`)
