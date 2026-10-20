import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { pickVoice } from './voice'

interface RecognitionAlternativeLike {
  transcript: string
}

interface RecognitionResultLike {
  readonly isFinal: boolean
  readonly 0: RecognitionAlternativeLike
}

interface RecognitionResultsLike {
  readonly length: number
  [index: number]: RecognitionResultLike
}

interface RecognitionEventLike {
  resultIndex: number
  results: RecognitionResultsLike
}

interface RecognitionErrorLike {
  error: string
}

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: RecognitionEventLike) => void) | null
  onerror: ((event: RecognitionErrorLike) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

type RecognitionCtor = new () => SpeechRecognitionLike

// Vendor-prefixed SpeechRecognition is absent from lib.dom.
type SpeechWindow = Window & {
  SpeechRecognition?: RecognitionCtor
  webkitSpeechRecognition?: RecognitionCtor
}

const speechWindow = (): SpeechWindow => window as unknown as SpeechWindow

export function speechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(speechWindow().SpeechRecognition ?? speechWindow().webkitSpeechRecognition)
}

export function speechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function useVoices() {
  const [state, setState] = useState<{ voices: SpeechSynthesisVoice[]; loaded: boolean }>({ voices: [], loaded: false })
  useEffect(() => {
    if (!speechSynthesisSupported()) {
      setState({ voices: [], loaded: true })
      return
    }
    const load = () =>
      setState({
        voices: window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en')),
        loaded: true,
      })
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])
  return state
}

export interface RecognitionOptions {
  lang: string
  onFinal: (text: string, audioMs: number) => void
  onInterim: (text: string) => void
  onSpeechStart: () => void
  onError: (message: string) => void
}

export function useSpeechRecognition(options: RecognitionOptions) {
  const optsRef = useRef(options)
  optsRef.current = options
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const wantRef = useRef(false)
  const chunkStartRef = useRef(0)
  const [listening, setListening] = useState(false)
  const supported = speechRecognitionSupported()

  const ensure = useCallback((): SpeechRecognitionLike | null => {
    if (recognitionRef.current) return recognitionRef.current
    const Ctor = speechWindow().SpeechRecognition ?? speechWindow().webkitSpeechRecognition
    if (!Ctor) return null
    const rec = new Ctor()
    rec.lang = optsRef.current.lang
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onstart = () => setListening(true)

    rec.onresult = (event: RecognitionEventLike) => {
      let interim = ''
      let final = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = String(result[0]?.transcript ?? '')
        if (result.isFinal) final += text
        else interim += text
      }
      if (!chunkStartRef.current && (interim || final)) {
        chunkStartRef.current = Date.now()
        optsRef.current.onSpeechStart()
      }
      if (interim) optsRef.current.onInterim(interim.trim())
      if (final.trim()) {
        const audioMs = chunkStartRef.current ? Date.now() - chunkStartRef.current : 0
        chunkStartRef.current = 0
        optsRef.current.onInterim('')
        optsRef.current.onFinal(final.trim(), audioMs)
      }
    }

    rec.onerror = (event: RecognitionErrorLike) => {
      const code = event.error
      if (code === 'no-speech' || code === 'aborted') return
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        wantRef.current = false
        setListening(false)
        optsRef.current.onError('麦克风权限被拒绝。请在浏览器地址栏允许麦克风访问。')
        return
      }
      if (code === 'network') {
        optsRef.current.onError('语音识别服务连接失败。请检查网络，或改用文字输入。')
        return
      }
      optsRef.current.onError(`语音识别出错：${code || 'unknown'}`)
    }

    rec.onend = () => {
      if (wantRef.current) {
        window.setTimeout(() => {
          try {
            rec.start()
          } catch {}
        }, 180)
      } else {
        setListening(false)
      }
    }

    recognitionRef.current = rec
    return rec
  }, [])

  const start = useCallback(() => {
    const rec = ensure()
    if (!rec) {
      optsRef.current.onError('当前浏览器不支持语音识别。请使用 Chrome / Edge，或改用文字输入。')
      return
    }
    wantRef.current = true
    try {
      rec.start()
    } catch {}
  }, [ensure])

  const stop = useCallback(() => {
    wantRef.current = false
    chunkStartRef.current = 0
    try {
      recognitionRef.current?.stop()
    } catch {}
    setListening(false)
  }, [])

  const toggle = useCallback(() => {
    if (wantRef.current) stop()
    else start()
  }, [start, stop])

  useEffect(() => {
    return () => {
      wantRef.current = false
      try {
        recognitionRef.current?.abort()
      } catch {}
    }
  }, [])

  return { supported, listening, start, stop, toggle }
}

/* ------------------------------- TTS -------------------------------- */

export interface SpeakOptions {
  lang?: string
  rate?: number
  pitch?: number
  voice?: string
  voiceURI?: string
  instructions?: string
}

type QueuedItem = { text: string; opts: SpeakOptions; resolve: () => void }

export class SpeechPlayer {
  mode: 'browser' | 'openai'
  onSpeakingChange?: (speaking: boolean) => void
  onError?: (message: string) => void

  private queue: QueuedItem[] = []
  private pumping = false
  private speaking = false
  private cancelToken = 0
  private ctx: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private data: Uint8Array<ArrayBuffer> | null = null
  private utterance: SpeechSynthesisUtterance | null = null
  private cancelCurrent: (() => void) | null = null
  private warnedNoVoice = false

  constructor(mode: 'browser' | 'openai') {
    this.mode = mode
  }

  get isSpeaking(): boolean {
    return this.speaking
  }

  setMode(mode: 'browser' | 'openai') {
    this.cancel()
    this.mode = mode
  }

  getAmplitude(): number {
    if (!this.analyser || !this.data) return 0
    this.analyser.getByteTimeDomainData(this.data)
    let sum = 0
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] - 128) / 128
      sum += v * v
    }
    return Math.min(1, Math.sqrt(sum / this.data.length) * 3)
  }

  speak(text: string, opts: SpeakOptions = {}): Promise<void> {
    const clean = text.trim()
    if (!clean) return Promise.resolve()
    const { promise, resolve } = Promise.withResolvers<void>()
    this.queue.push({ text: clean, opts, resolve })
    void this.pump()
    return promise
  }

  cancel() {
    this.cancelToken++
    const stopCurrent = this.cancelCurrent
    this.cancelCurrent = null
    if (stopCurrent) stopCurrent()
    for (const item of this.queue) item.resolve()
    this.queue = []
    if (this.utterance) {
      this.utterance.onend = null
      this.utterance.onerror = null
      this.utterance = null
    }
    if (speechSynthesisSupported()) window.speechSynthesis.cancel()
    if (this.source) {
      try {
        this.source.stop()
      } catch {}
      this.source = null
    }
    this.setSpeaking(false)
  }

  private setSpeaking(value: boolean) {
    if (this.speaking === value) return
    this.speaking = value
    this.onSpeakingChange?.(value)
  }

  private async pump() {
    if (this.pumping) return
    this.pumping = true
    while (this.queue.length) {
      const item = this.queue[0]
      const token = this.cancelToken
      this.setSpeaking(true)
      try {
        if (this.mode === 'openai') await this.playServer(item.text, item.opts)
        else await this.playBrowser(item.text, item.opts, token)
      } catch (err) {
        if (token === this.cancelToken) {
          this.onError?.((err as Error).message || '语音播放失败。')
        }
      }
      this.queue.shift()
      item.resolve()
    }
    this.pumping = false
    this.setSpeaking(false)
  }

  private async loadVoices(): Promise<SpeechSynthesisVoice[]> {
    if (!speechSynthesisSupported()) return []
    const current = window.speechSynthesis.getVoices()
    if (current.length) return current
    const { promise, resolve } = Promise.withResolvers<void>()
    const timer = window.setTimeout(resolve, 300)
    window.speechSynthesis.addEventListener(
      'voiceschanged',
      () => {
        window.clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
    await promise
    return window.speechSynthesis.getVoices()
  }

  private async playBrowser(text: string, opts: SpeakOptions, token: number): Promise<void> {
    if (!speechSynthesisSupported()) return
    const voices = await this.loadVoices()
    if (!voices.length) {
      if (!this.warnedNoVoice) {
        this.warnedNoVoice = true
        this.onError?.('当前浏览器没有可用的英文语音。请在设置中切换服务端 TTS，或安装英音语音。')
      }
      return
    }
    this.warnedNoVoice = false
    const { promise, resolve } = Promise.withResolvers<void>()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = opts.lang ?? 'en-GB'
    utter.rate = opts.rate ?? 1
    utter.pitch = Math.min(1.3, Math.max(0.7, opts.pitch ?? 1))
    const chosen = pickVoice(voices, utter.lang, opts.voiceURI ?? '')
    if (chosen) utter.voice = chosen
    let timer = 0
    const done = () => {
      window.clearTimeout(timer)
      if (this.utterance === utter) this.utterance = null
      if (this.cancelCurrent === done) this.cancelCurrent = null
      resolve()
    }
    utter.onend = done
    utter.onerror = done
    this.utterance = utter
    this.cancelCurrent = done
    // Safety net for engines that never fire onend (seen in headless Edge).
    timer = window.setTimeout(done, Math.min(90_000, 4_000 + text.length * 120))
    if (token !== this.cancelToken) {
      done()
      return promise
    }
    try {
      window.speechSynthesis.speak(utter)
    } catch {
      done()
    }
    return promise
  }

  private async playServer(text: string, opts: SpeakOptions): Promise<void> {
    const buffer = await api.tts(text, opts.voice ?? 'alloy', opts.rate ?? 1, opts.instructions)
    if (!this.ctx) this.ctx = new AudioContext()
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    const decoded = await this.ctx.decodeAudioData(buffer.slice(0))
    const source = this.ctx.createBufferSource()
    source.buffer = decoded
    const analyser = this.ctx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    analyser.connect(this.ctx.destination)
    this.analyser = analyser
    this.data = new Uint8Array(new ArrayBuffer(analyser.fftSize))
    this.source = source
    const { promise, resolve } = Promise.withResolvers<void>()
    const finish = () => {
      this.cancelCurrent = null
      resolve()
    }
    this.cancelCurrent = () => {
      try {
        source.stop()
      } catch {}
      finish()
    }
    source.onended = finish
    try {
      source.start()
    } catch {
      resolve()
    }
    await promise
    if (this.source === source) this.source = null
    if (this.cancelCurrent) this.cancelCurrent = null
  }
}

/* ---------------------------- push to talk ---------------------------- */

export class AudioRecorder {
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private startedAt = 0

  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
    this.chunks = []
    this.recorder = new MediaRecorder(stream, { mimeType: mime })
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    this.startedAt = Date.now()
    this.recorder.start(200)
  }

  async stop(): Promise<{ blob: Blob; durationMs: number }> {
    const recorder = this.recorder
    if (!recorder) throw new Error('录音尚未开始。')
    const durationMs = Date.now() - this.startedAt
    const { promise, resolve } = Promise.withResolvers<void>()
    recorder.onstop = () => resolve()
    recorder.stop()
    for (const track of recorder.stream.getTracks()) track.stop()
    await promise
    this.recorder = null
    const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' })
    this.chunks = []
    return { blob, durationMs }
  }
}
