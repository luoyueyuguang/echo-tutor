import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type {
  AppSettings,
  ContentBundle,
  Exam,
  GradeResult,
  Scenario,
  SessionMode,
  SessionReport,
  SessionRow,
  ShadowDrill,
  ToeflSpeakingSet,
  TurnRow,
} from '../shared/types'
import { api, streamChat } from '../api'
import { compareTranscript, type TranscriptComparison } from '../lib/compare'
import { sessionReportToGrade } from '../lib/report'
import { voiceSummary } from '../lib/voice'
import { countWords, formatClock, MODE_LABEL } from '../lib/format'
import { AudioRecorder, SpeechPlayer, speechRecognitionSupported, useSpeechRecognition, useVoices } from '../lib/speech'
import { Avatar } from './Avatar'
import { GradeReport } from './GradeReport'
import { Modal, Pill, Spinner, type ToastKind, type ToastOptions } from './ui'
import { ToeflPanel } from './ToeflPanel'

const MODE_ORDER: SessionMode[] = ['free', 'ielts.p1', 'ielts.p2', 'ielts.p3', 'toefl.speech', 'scenario', 'dictation', 'shadow']

const MODE_DESCRIPTION: Record<SessionMode, string> = {
  free: '像和真人老师聊天一样自由对话。Aria 会把你的错误自然地复述成正确说法，并在课后给出逐句纠错。',
  'ielts.p1': '雅思口语 Part 1：4–5 分钟，围绕熟悉话题的一问一答。先求自然，再求长度。',
  'ielts.p2': '雅思口语 Part 2：1 分钟准备 + 最多 2 分钟独白。计时器在左侧，Aria 不会打断你。',
  'ielts.p3': '雅思口语 Part 3：4–5 分钟抽象讨论，要求解释原因、举例和比较。',
  'toefl.speech': '托福口语 2026：7 题 Listen and Repeat + 4 题 Take an Interview，约 8 分钟。',
  scenario: '真实情景角色扮演：点单、面试、投诉、租房……先完成任务，再追求语法。',
  dictation: '听力听写：先听句子，再逐词输入。系统会逐词对齐，标出漏听和拼错的词。',
  shadow: '影子跟读：先听，再复述。系统会把识别结果与原文逐词对齐，标出漏读和替换。',
}

const MODE_HINT: Record<SessionMode, string> = {
  free: 'Tell me about your day, your goals, or something you found interesting recently.',
  'ielts.p1': 'Answer in 2–3 sentences. Add one reason or example.',
  'ielts.p2': 'Use the bullets as a structure, not a script. Keep talking until the timer ends.',
  'ielts.p3': 'Give an opinion, then justify it with a reason and an example.',
  'toefl.speech': 'Listen once, repeat accurately, or answer the interview question without preparation.',
  scenario: 'Use the useful language if you get stuck — the goal is to finish the task.',
  dictation: 'Listen once for meaning, then again for details. Type what you hear.',
  shadow: 'Match the rhythm and linking, not just the words.',
}

interface ActiveSession {
  row: SessionRow
  turns: TurnRow[]
}

interface PracticeProps {
  settings: AppSettings
  content: ContentBundle
  notify: (message: string, kind?: ToastKind, options?: ToastOptions) => number
  onOpenSettings: () => void
  onDataChanged: () => void
  onSettingsChanged: (settings: AppSettings) => void
  dismissToast: (id: number) => void
}

function initialMode(exam: Exam): SessionMode {
  return exam === 'toefl' ? 'toefl.speech' : exam === 'kaoyan' ? 'free' : 'ielts.p1'
}

/** Split streamed text into speakable chunks without cutting words. */
function drainSentences(buffer: string, force: boolean): { chunks: string[]; rest: string } {
  const chunks: string[] = []
  let rest = buffer
  while (rest.length) {
    const sentence = rest.match(/^[\s\S]*?[.!?](?=\s|$)/)
    if (sentence) {
      const chunk = sentence[0].trim()
      if (chunk) chunks.push(chunk)
      rest = rest.slice(sentence[0].length)
      continue
    }
    if (force) {
      const chunk = rest.trim()
      if (chunk) chunks.push(chunk)
      rest = ''
      continue
    }
    if (rest.length > 170) {
      const cut = rest.lastIndexOf(' ', 170)
      if (cut > 40) {
        chunks.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut)
        continue
      }
    }
    break
  }
  return { chunks, rest }
}

export function PracticeView({ settings, content, notify, onOpenSettings, onDataChanged, onSettingsChanged, dismissToast }: PracticeProps) {
  const [mode, setMode] = useState<SessionMode>(() => initialMode(settings.exam))
  const [p1Topic, setP1Topic] = useState(content.ieltsSpeaking.part1[0]?.topic ?? '')
  const [p2Id, setP2Id] = useState(content.ieltsSpeaking.part2[0]?.id ?? '')
  const [p3Topic, setP3Topic] = useState(content.ieltsSpeaking.part3[0]?.topic ?? '')
  const [toeflId, setToeflId] = useState(content.toeflSpeaking[0]?.id ?? '')
  const [scenarioId, setScenarioId] = useState(content.scenarios[0]?.id ?? '')
  const [drillId, setDrillId] = useState(content.drills[0]?.id ?? '')

  const [session, setSession] = useState<ActiveSession | null>(null)
  const [draft, setDraft] = useState('')
  const [interim, setInterim] = useState('')
  const [streaming, setStreaming] = useState('')
  const [sending, setSending] = useState(false)
  const [starting, setStarting] = useState(false)
  const [report, setReport] = useState<SessionReport | null>(null)
  const [assistantSpeaking, setAssistantSpeaking] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(() => localStorage.getItem('echo.tts') !== 'off')
  const [bargeIn, setBargeIn] = useState(() => localStorage.getItem('echo.bargein') === 'on')
  const [hideChat, setHideChat] = useState(() => localStorage.getItem('echo.hidechat') === 'on')
  const [recording, setRecording] = useState(false)
  const [notes, setNotes] = useState('')
  const [now, setNow] = useState(Date.now())

  const sessionRef = useRef<ActiveSession | null>(null)
  sessionRef.current = session
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const ttsEnabledRef = useRef(ttsEnabled)
  ttsEnabledRef.current = ttsEnabled
  const bargeInRef = useRef(bargeIn)
  bargeInRef.current = bargeIn
  const sendingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const streamSpeakRef = useRef('')
  const mutedRef = useRef(false)
  const wasListeningRef = useRef(false)
  const recorderRef = useRef<AudioRecorder | null>(null)
  const bargeTimerRef = useRef<number | null>(null)
  const chatLogRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<SpeechPlayer | null>(null)
  if (!playerRef.current) playerRef.current = new SpeechPlayer(settings.ttsProvider === 'openai' ? 'openai' : 'browser')

  const sendRef = useRef<(text: string, audioMs?: number) => void>(() => {})
  const modeRef = useRef(mode)
  modeRef.current = mode
  const { voices, loaded: voicesLoaded } = useVoices()
  const voiceInfo = voiceSummary(voices, settings.accent, settings.browserVoiceURI, settings.ttsProvider, settings.ttsVoice)

  function interruptSpeech() {
    if (!playerRef.current?.isSpeaking) return
    playerRef.current.cancel()
    mutedRef.current = true
    streamSpeakRef.current = ''
  }

  const recognition = useSpeechRecognition({
    lang: settings.accent,
    onFinal: (text, audioMs) => {
      if (bargeTimerRef.current) {
        window.clearTimeout(bargeTimerRef.current)
        bargeTimerRef.current = null
      }
      if (playerRef.current?.isSpeaking) interruptSpeech()
      sendRef.current(text, audioMs)
    },
    onInterim: (text) => {
      setInterim(text)
      if (!bargeInRef.current || !playerRef.current?.isSpeaking) return
      // Require a couple of words and a short sustained burst before cutting
      // the tutor off, so a cough or speaker bleed does not cancel speech.
      const words = text.split(/\s+/).filter(Boolean).length
      if (words < 2 || bargeTimerRef.current) return
      bargeTimerRef.current = window.setTimeout(() => {
        bargeTimerRef.current = null
        interruptSpeech()
      }, 280)
    },
    onSpeechStart: () => {},
    onError: (message) => notify(message, 'error'),
  })

  const part1 = useMemo(() => content.ieltsSpeaking.part1.find((s) => s.topic === p1Topic), [content, p1Topic])
  const part2 = useMemo(() => content.ieltsSpeaking.part2.find((c) => c.id === p2Id), [content, p2Id])
  const part3 = useMemo(() => content.ieltsSpeaking.part3.find((s) => s.topic === p3Topic), [content, p3Topic])
  const toefl = useMemo(() => content.toeflSpeaking.find((t) => t.id === toeflId), [content, toeflId])
  const scenario = useMemo(() => content.scenarios.find((s) => s.id === scenarioId), [content, scenarioId])
  const drill = useMemo(() => content.drills.find((d) => d.id === drillId), [content, drillId])

  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    player.onSpeakingChange = setAssistantSpeaking
    player.onError = (message) => notify(message, 'error')
    return () => {
      player.onSpeakingChange = undefined
      player.onError = undefined
      player.cancel()
    }
  }, [notify])

  useEffect(() => {
    playerRef.current?.setMode(settings.ttsProvider === 'openai' ? 'openai' : 'browser')
  }, [settings.ttsProvider])

  useEffect(() => {
    if (!session) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [session])

  useEffect(() => {
    const log = chatLogRef.current
    if (!log) return
    log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' })
  }, [session?.turns.length, streaming, interim, sending])

  useEffect(() => {
    if (bargeIn || !assistantSpeaking) return
    if (recognition.listening) {
      wasListeningRef.current = true
      recognition.stop()
    }
    return
  }, [assistantSpeaking, bargeIn, recognition.listening, recognition.stop])

  useEffect(() => {
    if (assistantSpeaking || bargeIn) return
    if (wasListeningRef.current) {
      wasListeningRef.current = false
      recognition.start()
    }
  }, [assistantSpeaking, bargeIn, recognition.start])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      recognition.stop()
      playerRef.current?.cancel()
      if (bargeTimerRef.current) window.clearTimeout(bargeTimerRef.current)
      if (recorderRef.current) {
        recorderRef.current.stop().catch(() => {})
      }
    }
  }, [recognition.stop])

  useEffect(() => {
    localStorage.setItem('echo.tts', ttsEnabled ? 'on' : 'off')
  }, [ttsEnabled])

  useEffect(() => {
    localStorage.setItem('echo.bargein', bargeIn ? 'on' : 'off')
  }, [bargeIn])

  useEffect(() => {
    localStorage.setItem('echo.hidechat', hideChat ? 'on' : 'off')
  }, [hideChat])


  function speakText(text: string) {
    if (!ttsEnabledRef.current) return
    const clean = text
      .replace(/[\u4e00-\u9fff]+/g, ' ')
      .replace(/[*#_`>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!/[A-Za-z]/.test(clean)) return
    void playerRef.current?.speak(clean, {
      lang: settingsRef.current.accent,
      rate: settingsRef.current.rate,
      pitch: settingsRef.current.pitch,
      voiceURI: settingsRef.current.browserVoiceURI,
      voice: settingsRef.current.ttsVoice,
      instructions: modeRef.current.startsWith('ielts.')
        ? 'Speak like a neutral British IELTS examiner: clear, measured and neutral. Do not sound cheerful or exaggerated.'
        : 'Speak like a warm, natural English conversation partner: clear and friendly.',
    })
  }

  function enqueueSpeech(delta: string) {
    if (!ttsEnabledRef.current || mutedRef.current) return
    streamSpeakRef.current += delta
    const { chunks, rest } = drainSentences(streamSpeakRef.current, false)
    streamSpeakRef.current = rest
    for (const chunk of chunks) speakText(chunk)
  }

  function flushSpeech() {
    if (!ttsEnabledRef.current || mutedRef.current) {
      streamSpeakRef.current = ''
      return
    }
    const { chunks } = drainSentences(streamSpeakRef.current, true)
    streamSpeakRef.current = ''
    for (const chunk of chunks) speakText(chunk)
  }

  function metaFor(target: SessionMode): Record<string, unknown> {
    if (target === 'ielts.p1') return { topic: p1Topic }
    if (target === 'ielts.p2') return { part2Id: p2Id }
    if (target === 'ielts.p3') return { topic: p3Topic }
    if (target === 'scenario') return { scenarioId }
    return {}
  }

  async function endCurrent(showReport = true) {
    const current = sessionRef.current
    if (!current) return
    abortRef.current?.abort()
    abortRef.current = null
    playerRef.current?.cancel()
    recognition.stop()
    setSession(null)
    setStreaming('')
    setSending(false)
    sendingRef.current = false
    setInterim('')
    setRecording(false)
    const hasUser = current.turns.some((t) => t.role === 'user')
    if (!hasUser) {
      try {
        await api.deleteSession(current.row.id)
      } catch (err) {
        notify((err as Error).message, 'error')
      }
      return
    }
    if (!showReport) {
      try {
        await api.endSession(current.row.id)
        onDataChanged()
      } catch (err) {
        notify((err as Error).message, 'error')
      }
      return
    }
    const pending = notify('正在生成本轮报告…', 'info', { duration: 0 })
    try {
      const result = await api.endSession(current.row.id)
      dismissToast(pending)
      onDataChanged()
      notify(`报告已生成 · ${result.bandLabel}`, 'success', {
        duration: 30_000,
        action: { label: '查看报告', onClick: () => setReport(result) },
      })
    } catch (err) {
      dismissToast(pending)
      notify((err as Error).message, 'error')
    }
  }

  async function begin(target: SessionMode = mode) {
    if (target === 'shadow' || target === 'dictation' || target === 'toefl.speech') {
      setMode(target)
      return
    }
    if (sessionRef.current) await endCurrent(false)
    setStarting(true)
    try {
      const res = await api.createSession(target, settings.exam, metaFor(target))
      const openingTurn: TurnRow = {
        id: -1,
        sessionId: res.session.id,
        role: 'assistant',
        text: res.opening,
        audioMs: null,
        createdAt: Date.now(),
      }
      setSession({ row: res.session, turns: [openingTurn] })
      setMode(target)
      setReport(null)
      setStreaming('')
      setInterim('')
      setDraft('')
      setNotes('')
      mutedRef.current = false
      streamSpeakRef.current = ''
      if (ttsEnabledRef.current) window.setTimeout(() => speakText(res.opening), 180)
    } catch (err) {
      notify((err as Error).message, 'error')
    } finally {
      setStarting(false)
    }
  }

  async function useIeltsVoice() {
    const candidate =
      voices.find((voice) => voice.lang.toLowerCase() === 'en-gb' && /sonia|ryan|libby|maisie|thomas/i.test(voice.name)) ??
      voices.find((voice) => voice.lang.toLowerCase() === 'en-gb')
    if (!candidate) {
      notify('当前浏览器没有英音语音。请用 Edge，或配置服务端 TTS。', 'error')
      return
    }
    try {
      const updated = await api.saveSettings({
        ttsProvider: 'browser',
        accent: 'en-GB',
        browserVoiceURI: candidate.voiceURI,
        rate: 1.1,
        pitch: 1,
      })
      onSettingsChanged(updated)
      notify(`已使用 ${candidate.name}，语速 1.1x。`, 'success')
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  async function useServerVoice() {
    try {
      const updated = await api.saveSettings({ ttsProvider: 'openai', ttsVoice: 'fable', pitch: 0.95 })
      onSettingsChanged(updated)
      notify('已切换到服务端英音（fable）。', 'success')
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  async function switchMode(next: SessionMode) {
    if (next === mode) return
    stopMic()
    if (sessionRef.current) await endCurrent(true)
    setMode(next)
    setInterim('')
  }

  async function sendMessage(text: string, audioMs?: number) {
    const current = sessionRef.current
    if (!current) {
      notify('先点击“开始这轮练习”。', 'info')
      return
    }
    if (sendingRef.current) {
      notify('Aria 还在回复，等这一句说完。', 'info')
      return
    }
    const clean = text.trim()
    if (!clean) return
    sendingRef.current = true
    setSending(true)
    setStreaming('')
    setDraft('')
    setInterim('')
    mutedRef.current = false
    streamSpeakRef.current = ''

    const optimistic: TurnRow = {
      id: -Date.now(),
      sessionId: current.row.id,
      role: 'user',
      text: clean,
      audioMs: audioMs ?? null,
      createdAt: Date.now(),
    }
    setSession((prev) => (prev ? { ...prev, turns: [...prev.turns, optimistic] } : prev))

    const controller = new AbortController()
    abortRef.current = controller
    try {
      await streamChat(
        { sessionId: current.row.id, message: clean, audioMs },
        {
          onDelta: (delta) => {
            setStreaming((prev) => prev + delta)
            enqueueSpeech(delta)
          },
          onDone: (turnId, full) => {
            setSession((prev) =>
              prev
                ? {
                    ...prev,
                    turns: [
                      ...prev.turns,
                      {
                        id: turnId,
                        sessionId: prev.row.id,
                        role: 'assistant',
                        text: full,
                        audioMs: null,
                        createdAt: Date.now(),
                      },
                    ],
                  }
                : prev,
            )
            setStreaming('')
            setSending(false)
            sendingRef.current = false
            flushSpeech()
          },
          onError: (message) => {
            setStreaming('')
            setSending(false)
            sendingRef.current = false
            notify(message, 'error')
          },
        },
        controller.signal,
      )
    } catch (err) {
      if ((err as Error).name !== 'AbortError') notify((err as Error).message, 'error')
      setSending(false)
      sendingRef.current = false
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }
  sendRef.current = sendMessage

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!draft.trim() || sending) return
    void sendMessage(draft)
  }

  function stopMic() {
    if (settings.asrProvider === 'whisper') {
      setRecording(false)
      if (recorderRef.current) {
        recorderRef.current.stop().catch(() => {})
        recorderRef.current = null
      }
    } else {
      recognition.stop()
    }
  }

  async function toggleMic() {
    if (!sessionRef.current) {
      notify('先点击“开始这轮练习”。', 'info')
      return
    }
    if (settings.asrProvider === 'whisper') {
      if (!recording) {
        try {
          interruptSpeech()
          const recorder = new AudioRecorder()
          await recorder.start()
          recorderRef.current = recorder
          setRecording(true)
        } catch {
          notify('无法访问麦克风。请检查浏览器权限。', 'error')
        }
      } else {
        setRecording(false)
        const recorder = recorderRef.current
        recorderRef.current = null
        if (!recorder) return
        try {
          const { blob, durationMs } = await recorder.stop()
          const text = await api.asr(blob)
          if (text.trim()) void sendMessage(text.trim(), durationMs)
          else notify('没有识别到语音，再试一次。', 'info')
        } catch (err) {
          notify((err as Error).message, 'error')
        }
      }
      return
    }
    if (!speechRecognitionSupported()) {
      notify('当前浏览器不支持语音识别。请改用 Chrome / Edge，或在设置中切换到 Whisper 模式。', 'error')
      return
    }
    if (recognition.listening) {
      recognition.stop()
      return
    }
    interruptSpeech()
    recognition.start()
  }

  const micActive = settings.asrProvider === 'whisper' ? recording : recognition.listening
  const elapsed = session ? Math.max(0, Math.round((now - session.row.startedAt) / 1000)) : 0
  const reportResult: GradeResult | null = report ? sessionReportToGrade(report) : null

  return (
    <div className="practice">
      <div className="practice-main">
        <div className="mode-tabs" role="tablist">
          {MODE_ORDER.map((item) => (
            <button
              key={item}
              role="tab"
              aria-selected={mode === item}
              className={`mode-tab ${mode === item ? 'active' : ''}`}
              onClick={() => void switchMode(item)}
            >
              {MODE_LABEL[item]}
            </button>
          ))}
        </div>

        {!settings.llmApiKeySet ? (
          <div className="banner banner-warn">
            <span>尚未配置对话模型。语音识别与朗读可用，但对话和评分需要模型 API Key。</span>
            <button className="btn tiny" onClick={onOpenSettings}>
              去配置
            </button>
          </div>
        ) : null}

        <div className="practice-body">
          {mode === 'toefl.speech' ? (
            <ToeflPanel
              sets={content.toeflSpeaking}
              setId={setToeflId}
              set={toefl}
              speak={speakText}
              notify={notify}
              lang={settings.accent}
            />
          ) : mode === 'shadow' ? (
            <ShadowPanel
              drills={content.drills}
              drillId={drillId}
              setDrillId={setDrillId}
              drill={drill}
              lang={settings.accent}
              notify={notify}
              speak={speakText}
            />
          ) : mode === 'dictation' ? (
            <DictationPanel drills={content.drills} drillId={drillId} setDrillId={setDrillId} drill={drill} notify={notify} speak={speakText} />
          ) : (
            <>
              <section className="material-panel">
                <div className="panel-head">
                  <h3>{MODE_LABEL[mode]}</h3>
                  <Pill tone="neutral">{settings.exam.toUpperCase()}</Pill>
                </div>
                <p className="muted small">{MODE_DESCRIPTION[mode]}</p>
                {renderMaterial({
                  mode,
                  content,
                  sessionActive: Boolean(session),
                  p1Topic,
                  setP1Topic,
                  p2Id,
                  setP2Id,
                  p3Topic,
                  setP3Topic,
                  scenarioId,
                  setScenarioId,
                  part1,
                  part2,
                  part3,
                  scenario,
                  notes,
                  setNotes,
                  notify,
                  onPickPhrase: (phrase) => setDraft((prev) => (prev ? `${prev} ${phrase}` : phrase)),
                  timerKey: `${mode}-${session?.row.id ?? 'idle'}`,
                })}
              </section>

              <section className="chat-panel">
                <div className="chat-toolbar">
                  <span className="muted small">{MODE_LABEL[mode]}</span>
                  {session ? (
                    <button className={`subtitle-toggle ${hideChat ? 'off' : ''}`} onClick={() => setHideChat((value) => !value)}>
                      {hideChat ? '字幕已隐藏 · 点击显示' : '隐藏字幕'}
                    </button>
                  ) : null}
                </div>
                <div className={`chat-log ${hideChat ? 'chat-masked' : ''}`} ref={chatLogRef}>
                  {!session ? (
                    <div className="start-card">
                      <h3>准备好了吗？</h3>
                      <p>{MODE_HINT[mode]}</p>
                      <button className="btn primary" onClick={() => void begin()} disabled={starting}>
                        {starting ? <Spinner label="正在创建…" /> : '开始这轮练习'}
                      </button>
                    </div>
                  ) : (
                    <>
                      {session.turns.map((turn) => (
                        <div key={turn.id} className={`bubble bubble-${turn.role}`}>
                          <span className="bubble-who">{turn.role === 'user' ? '你' : 'Aria'}</span>
                          <p>{turn.text}</p>
                        </div>
                      ))}
                      {streaming ? (
                        <div className="bubble bubble-assistant bubble-streaming">
                          <span className="bubble-who">Aria</span>
                          <p>
                            {streaming}
                            <span className="caret" />
                          </p>
                        </div>
                      ) : null}
                      {sending && !streaming ? (
                        <div className="bubble bubble-assistant">
                          <span className="bubble-who">Aria</span>
                          <Spinner label="正在组织语言…" />
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                {interim ? (
                  <div className="interim">
                    <span className="pulse-dot" />
                    {interim}
                  </div>
                ) : null}

                {session ? (
                  <form className="composer" onSubmit={handleSubmit}>
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault()
                          if (draft.trim() && !sending) void sendMessage(draft)
                        }
                      }}
                      placeholder="用英文回答，或点麦克风说话…（Enter 发送，Shift+Enter 换行）"
                      rows={2}
                    />
                    <div className="composer-actions">
                      <button
                        type="button"
                        className={`mic-btn ${micActive ? 'active' : ''}`}
                        onClick={() => void toggleMic()}
                        title={micActive ? '停止' : '开始说话'}
                      >
                        <span className="mic-icon" />
                        {micActive ? (recording ? '停止录音' : '正在听') : '说话'}
                      </button>
                      <span className="muted small">{countWords(draft)} words</span>
                      <button type="submit" className="btn primary" disabled={!draft.trim() || sending}>
                        发送
                      </button>
                    </div>
                  </form>
                ) : null}
              </section>
            </>
          )}
        </div>
      </div>

      <aside className="avatar-panel">
        <Avatar
          speaking={assistantSpeaking}
          listening={micActive || Boolean(interim)}
          thinking={sending && !streaming}
          emotion={report ? 'encourage' : 'neutral'}
          getAmplitude={() => playerRef.current?.getAmplitude() ?? 0}
          compact
        />
        <div className="voice-card">
          <div className="voice-row">
            <label className="switch">
              <input type="checkbox" checked={ttsEnabled} onChange={(event) => setTtsEnabled(event.target.checked)} />
              <span /> 老师朗读
            </label>
            <label className="switch">
              <input type="checkbox" checked={bargeIn} onChange={(event) => setBargeIn(event.target.checked)} />
              <span /> 允许打断
            </label>
            <label className="switch">
              <input type="checkbox" checked={hideChat} onChange={(event) => setHideChat(event.target.checked)} />
              <span /> 隐藏字幕
            </label>
          </div>
          <div className="voice-meta">
            <span>{settings.accent === 'en-GB' ? '英音' : '美音'}</span>
            <span>{settings.rate.toFixed(1)}x</span>
            <span>{settings.asrProvider === 'whisper' ? 'Whisper 识别' : '浏览器识别'}</span>
          </div>
          <div className="voice-line">
            <span className="voice-name" title={voiceInfo.lang || voiceInfo.name}>
              {settings.ttsProvider === 'openai' ? `服务端 · ${voiceInfo.name}` : voicesLoaded ? voiceInfo.name : '正在检测系统语音…'}
            </span>
            <button className="btn tiny ghost" onClick={onOpenSettings}>
              换声音
            </button>
            <button
              className="btn tiny ghost"
              onClick={() => speakText("Good morning. Let's talk about work and study. Do you work or are you a student?")}
            >
              试听
            </button>
          </div>
          {voicesLoaded && voiceInfo.warning ? <p className="voice-warning">{voiceInfo.warning}</p> : null}
          <button className="btn tiny ghost voice-preset" onClick={() => void useIeltsVoice()}>
            雅思听力音色 · Sonia/Ryan · 1.1x
          </button>
          {settings.ttsProvider === 'browser' && settings.ttsConfigured && Boolean(voiceInfo.warning) ? (
            <button className="btn tiny primary voice-switch" onClick={() => void useServerVoice()}>
              改用服务端英音
            </button>
          ) : null}
          {bargeIn ? <p className="muted tiny">建议戴耳机，避免老师的声音被麦克风当成你的发言。</p> : null}
          {session ? (
            <div className="session-bar">
              <span>本轮 {formatClock(elapsed)}</span>
              <button className="btn tiny danger" onClick={() => void endCurrent(true)}>
                结束本轮
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      <Modal open={Boolean(report)} title="本轮练习报告" onClose={() => setReport(null)} wide>
        {reportResult ? <GradeReport result={reportResult} /> : null}
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => setReport(null)}>
            关闭
          </button>
          <button
            className="btn primary"
            onClick={() => {
              setReport(null)
              void begin(mode === 'shadow' ? 'free' : mode)
            }}
          >
            再来一轮
          </button>
        </div>
      </Modal>
    </div>
  )
}

interface MaterialProps {
  mode: SessionMode
  content: ContentBundle
  sessionActive: boolean
  p1Topic: string
  setP1Topic: (value: string) => void
  p2Id: string
  setP2Id: (value: string) => void
  p3Topic: string
  setP3Topic: (value: string) => void
  scenarioId: string
  setScenarioId: (value: string) => void
  part1?: { topic: string; topicZh: string; questions: string[] }
  part2?: { cue: string; bullets: string[]; followUps: string[] }
  part3?: { topic: string; topicZh: string; questions: string[] }
  scenario?: Scenario
  notes: string
  setNotes: (value: string) => void
  notify: (message: string, kind?: ToastKind) => void
  onPickPhrase: (phrase: string) => void
  timerKey: string
}

function renderMaterial(props: MaterialProps) {
  const {
    mode,
    content,
    sessionActive,
    p1Topic,
    setP1Topic,
    p2Id,
    setP2Id,
    p3Topic,
    setP3Topic,
    scenarioId,
    setScenarioId,
    part1,
    part2,
    part3,
    scenario,
    notes,
    setNotes,
    notify,
    onPickPhrase,
    timerKey,
  } = props

  if (mode === 'ielts.p1') {
    return (
      <>
        <select value={p1Topic} onChange={(event) => setP1Topic(event.target.value)} disabled={sessionActive}>
          {content.ieltsSpeaking.part1.map((set) => (
            <option key={set.topic} value={set.topic}>
              {set.topic} · {set.topicZh}
            </option>
          ))}
        </select>
        <ol className="question-list">
          {part1?.questions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ol>
        <p className="muted tiny">Aria 会按顺序提问，也可能追问一次。结束本轮后可以换话题。</p>
      </>
    )
  }

  if (mode === 'ielts.p2') {
    return (
      <>
        <select value={p2Id} onChange={(event) => setP2Id(event.target.value)} disabled={sessionActive}>
          {content.ieltsSpeaking.part2.map((card) => (
            <option key={card.id} value={card.id}>
              {card.topic} · {card.topicZh}
            </option>
          ))}
        </select>
        <div className="cue-card">
          <h4>{part2?.cue}</h4>
          <p className="muted small">You should say:</p>
          <ul>
            {part2?.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </div>
        <TimerCard key={timerKey} prepSec={60} responseSec={120} onNotice={notify} />
        <textarea
          className="notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="准备笔记（1 分钟，不计分）"
          rows={3}
        />
        {part2?.followUps.length ? (
          <details>
            <summary>追问</summary>
            <ul className="question-list">
              {part2.followUps.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </>
    )
  }

  if (mode === 'ielts.p3') {
    return (
      <>
        <select value={p3Topic} onChange={(event) => setP3Topic(event.target.value)} disabled={sessionActive}>
          {content.ieltsSpeaking.part3.map((set) => (
            <option key={set.topic} value={set.topic}>
              {set.topic} · {set.topicZh}
            </option>
          ))}
        </select>
        <ol className="question-list">
          {part3?.questions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ol>
      </>
    )
  }

  if (mode === 'scenario') {
    return (
      <>
        <select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)} disabled={sessionActive}>
          {content.scenarios.map((item) => (
            <option key={item.id} value={item.id}>
              {item.titleZh} · {item.level}
            </option>
          ))}
        </select>
        <div className="cue-card">
          <h4>{scenario?.title}</h4>
          <p className="muted small">
            Aria 扮演：{scenario?.role}
          </p>
          <p>{scenario?.setting}</p>
          <p>
            <b>你的目标：</b>
            {scenario?.goal}
          </p>
        </div>
        <div className="chip-row">
          {scenario?.usefulLanguage.map((phrase) => (
            <button key={phrase} type="button" className="phrase-chip" onClick={() => onPickPhrase(phrase)}>
              {phrase}
            </button>
          ))}
        </div>
        <p className="muted tiny">点短语可插入输入框。</p>
      </>
    )
  }

  return (
    <>
      <div className="cue-card">
        <h4>自由对话建议</h4>
        <p>{MODE_HINT.free}</p>
        <ul className="question-list">
          <li>先说一句结论，再补一个原因。</li>
          <li>不会的词用简单词绕过去，不要停下来查词典。</li>
          <li>每轮至少说 2–3 句。</li>
        </ul>
      </div>
      {content.phrases.slice(0, 2).map((group) => (
        <div key={group.topic}>
          <p className="muted small">
            {group.topic} · {group.topicZh}
          </p>
          <div className="chip-row">
            {group.phrases.map((phrase) => (
              <button key={phrase.en} type="button" className="phrase-chip" onClick={() => onPickPhrase(phrase.en)}>
                {phrase.en}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

function TimerCard({ prepSec, responseSec, onNotice }: { prepSec: number; responseSec: number; onNotice: (message: string, kind?: ToastKind) => void }) {
  const [phase, setPhase] = useState<'idle' | 'prep' | 'ready' | 'speak' | 'done'>('idle')
  const [endsAt, setEndsAt] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const noticeRef = useRef(onNotice)
  noticeRef.current = onNotice

  useEffect(() => {
    if (!endsAt) return
    const tick = () => {
      const left = Math.ceil((endsAt - Date.now()) / 1000)
      if (left <= 0) {
        const wasPrep = phaseRef.current === 'prep'
        setEndsAt(0)
        setRemaining(0)
        setPhase(wasPrep ? 'ready' : 'done')
        noticeRef.current(wasPrep ? '准备时间到，可以开始作答。' : '时间到，说完最后一句就好。', wasPrep ? 'info' : 'success')
      } else {
        setRemaining(left)
      }
    }
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [endsAt])

  function startTimer(seconds: number, next: 'prep' | 'speak') {
    setPhase(next)
    setRemaining(seconds)
    setEndsAt(Date.now() + seconds * 1000)
  }

  return (
    <div className="timer-card">
      <div className={`timer-value ${phase === 'speak' && remaining <= 10 ? 'urgent' : ''}`}>
        {phase === 'idle' ? '--:--' : phase === 'ready' ? '准备完成' : phase === 'done' ? '时间到' : formatClock(remaining)}
      </div>
      <div className="timer-actions">
        {phase === 'idle' ? (
          <button className="btn small primary" onClick={() => startTimer(prepSec, 'prep')}>
            开始准备 {prepSec}s
          </button>
        ) : null}
        {phase === 'prep' ? (
          <>
            <span className="muted small">准备中</span>
            <button className="btn small ghost" onClick={() => startTimer(responseSec, 'speak')}>
              跳过，开始作答
            </button>
          </>
        ) : null}
        {phase === 'ready' ? (
          <button className="btn small primary" onClick={() => startTimer(responseSec, 'speak')}>
            开始作答 {responseSec}s
          </button>
        ) : null}
        {phase === 'speak' ? (
          <button className="btn small ghost" onClick={() => setPhase('done')}>
            提前结束
          </button>
        ) : null}
        {phase === 'done' ? (
          <button className="btn small ghost" onClick={() => setPhase('idle')}>
            重新计时
          </button>
        ) : null}
      </div>
    </div>
  )
}

function DictationPanel({
  drills,
  drillId,
  setDrillId,
  drill,
  notify,
  speak,
}: {
  drills: ShadowDrill[]
  drillId: string
  setDrillId: (value: string) => void
  drill?: ShadowDrill
  notify: (message: string, kind?: ToastKind) => void
  speak: (text: string) => void
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  function check(item: string) {
    const answer = (answers[item] ?? '').trim()
    if (!answer) {
      notify('先写下你听到的内容。', 'info')
      return
    }
    setChecked((prev) => ({ ...prev, [item]: true }))
  }

  return (
    <section className="shadow-panel dictation-panel">
      <div className="panel-head">
        <h3>听力听写</h3>
        <Pill tone="neutral">听 → 写 → 对照</Pill>
      </div>
      <select value={drillId} onChange={(event) => setDrillId(event.target.value)}>
        {drills.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title}
          </option>
        ))}
      </select>
      <p className="muted small">先整句听一遍，再逐词写下。检查后会显示逐词匹配和漏听的词。</p>
      <ul className="drill-list">
        {drill?.items.map((item) => {
          const answer = answers[item.text] ?? ''
          const result = checked[item.text] ? compareTranscript(item.text, answer) : null
          return (
            <li key={item.text} className="drill-item dictation-item">
              <div>
                <p className="dictation-target">{checked[item.text] ? item.text : '• • • • •'}</p>
                {item.tip ? <p className="muted tiny">{item.tip}</p> : null}
              </div>
              <div className="drill-actions">
                <button className="btn tiny ghost" onClick={() => speak(item.text)}>
                  播放
                </button>
              </div>
              <div className="dictation-input">
                <input
                  value={answer}
                  onChange={(event) => setAnswers((prev) => ({ ...prev, [item.text]: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') check(item.text)
                  }}
                  placeholder="输入你听到的句子…"
                />
                <button className="btn tiny primary" onClick={() => check(item.text)}>
                  检查
                </button>
              </div>
              {result ? (
                <div className="drill-result">
                  <div className="drill-score">词级匹配 {Math.round(result.score * 100)}%</div>
                  <p className="token-line">
                    {result.tokens.map((token, index) => (
                      <span key={`${token.text}-${index}`} className={token.matched ? 'token-ok' : 'token-miss'}>
                        {token.text}{' '}
                      </span>
                    ))}
                  </p>
                  {result.missing.length ? <p className="muted tiny">漏听/拼错：{result.missing.join(', ')}</p> : null}
                  {item.zh ? <p className="dictation-zh">中文：{item.zh}</p> : null}
                  <p className="muted tiny">这是词级匹配，不评价拼写之外的发音细节。</p>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      <p className="muted tiny">听写不计入会话报告。</p>
    </section>
  )
}

function ShadowPanel({
  drills,
  drillId,
  setDrillId,
  drill,
  lang,
  notify,
  speak,
}: {
  drills: ShadowDrill[]
  drillId: string
  setDrillId: (value: string) => void
  drill?: ShadowDrill
  lang: string
  notify: (message: string, kind?: ToastKind) => void
  speak: (text: string) => void
}) {
  const [activeText, setActiveText] = useState('')
  const [transcript, setTranscript] = useState('')
  const [result, setResult] = useState<TranscriptComparison | null>(null)

  const recognition = useSpeechRecognition({
    lang,
    onFinal: (text) => {
      setTranscript(text)
      if (activeText) setResult(compareTranscript(activeText, text))
      recognition.stop()
    },
    onInterim: () => {},
    onSpeechStart: () => {},
    onError: (message) => notify(message, 'error'),
  })

  useEffect(() => {
    setTranscript('')
    setResult(null)
    setActiveText('')
  }, [drillId])

  function record(item: string) {
    setActiveText(item)
    setTranscript('')
    setResult(null)
    if (!speechRecognitionSupported()) {
      notify('当前浏览器不支持语音识别，请用 Chrome / Edge。', 'error')
      return
    }
    recognition.start()
  }

  return (
    <section className="shadow-panel">
      <div className="panel-head">
        <h3>影子跟读</h3>
        <Pill tone="neutral">{drill?.focus ?? 'drill'}</Pill>
      </div>
      <select value={drillId} onChange={(event) => setDrillId(event.target.value)}>
        {drills.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title}
          </option>
        ))}
      </select>
      <p className="muted small">先听一遍，再点“跟读”复述。识别结果会与原文逐词对齐。</p>
      <ul className="drill-list">
        {drill?.items.map((item) => (
          <li key={item.text} className={`drill-item ${activeText === item.text ? 'active' : ''}`}>
            <div>
              <p>{item.text}</p>
              {item.zh ? <p className="dictation-zh">{item.zh}</p> : null}
              {item.tip ? <p className="muted tiny">{item.tip}</p> : null}
            </div>
            <div className="drill-actions">
              <button className="btn tiny ghost" onClick={() => speak(item.text)}>
                播放
              </button>
              <button className="btn tiny" onClick={() => record(item.text)}>
                跟读
              </button>
            </div>
            {activeText === item.text && result ? (
              <div className="drill-result">
                <div className="drill-score">匹配度 {Math.round(result.score * 100)}%</div>
                <p className="token-line">
                  {result.tokens.map((token, tokenIndex) => (
                    <span key={`${token.text}-${tokenIndex}`} className={token.matched ? 'token-ok' : 'token-miss'}>
                      {token.text}{' '}
                    </span>
                  ))}
                </p>
                {transcript ? <p className="muted small">识别到：{transcript}</p> : null}
                {result.missing.length ? <p className="muted tiny">漏读/替换：{result.missing.join(', ')}</p> : null}
                <p className="muted tiny">这是词级覆盖率，不是音素级发音分。</p>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="muted tiny">跟读不计入会话报告。</p>
    </section>
  )
}
