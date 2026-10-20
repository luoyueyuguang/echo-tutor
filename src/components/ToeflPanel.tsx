import { useEffect, useRef, useState } from 'react'
import type { ToeflSpeakingSet } from '../shared/types'
import { compareTranscript, type TranscriptComparison } from '../lib/compare'
import { countWords, formatClock } from '../lib/format'
import { speechRecognitionSupported, useSpeechRecognition } from '../lib/speech'
import { Pill, type ToastKind } from './ui'

interface ToeflPanelProps {
  sets: ToeflSpeakingSet[]
  setId: (id: string) => void
  set?: ToeflSpeakingSet
  speak: (text: string) => void
  notify: (message: string, kind?: ToastKind) => void
  lang: string
}

export function ToeflPanel({ sets, setId, set, speak, notify, lang }: ToeflPanelProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [interim, setInterim] = useState('')
  const [comparisons, setComparisons] = useState<Record<string, TranscriptComparison>>({})
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [endsAt, setEndsAt] = useState(0)
  const [remaining, setRemaining] = useState(0)

  const activeRef = useRef<string | null>(null)
  activeRef.current = activeId
  const setRef = useRef(set)
  setRef.current = set

  const recognition = useSpeechRecognition({
    lang,
    onFinal: (text) => {
      const current = setRef.current
      const id = activeRef.current
      if (!current || !id) return
      const item = current.items.find((entry) => entry.id === id)
      if (!item) return
      if (current.kind === 'listen-repeat') {
        setComparisons((prev) => ({ ...prev, [id]: compareTranscript(item.text, text) }))
        setRevealed((prev) => ({ ...prev, [id]: true }))
        recognition.stop()
      } else {
        setAnswers((prev) => ({ ...prev, [id]: `${prev[id] ?? ''} ${text}`.trim() }))
      }
      setInterim('')
    },
    onInterim: setInterim,
    onSpeechStart: () => {},
    onError: (message) => notify(message, 'error'),
  })

  useEffect(() => {
    if (!endsAt) return
    const tick = () => {
      const left = Math.ceil((endsAt - Date.now()) / 1000)
      if (left <= 0) {
        setEndsAt(0)
        setRemaining(0)
        recognition.stop()
        notify('作答时间到。', 'info')
      } else {
        setRemaining(left)
      }
    }
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [endsAt, recognition.stop, notify])

  useEffect(() => {
    recognition.stop()
    setActiveId(null)
    setInterim('')
    setComparisons({})
    setAnswers({})
    setRevealed({})
    setEndsAt(0)
    setRemaining(0)
  }, [set?.id])

  function startRepeat(itemId: string) {
    if (!speechRecognitionSupported()) {
      notify('语音识别不可用，请使用 Edge / Chrome。', 'error')
      return
    }
    setActiveId(itemId)
    setInterim('')
    recognition.stop()
    recognition.start()
  }

  function startAnswer(itemId: string, seconds: number) {
    if (!speechRecognitionSupported()) {
      notify('语音识别不可用，请使用 Edge / Chrome。', 'error')
      return
    }
    setActiveId(itemId)
    setInterim('')
    setRevealed((prev) => ({ ...prev, [itemId]: true }))
    setRemaining(seconds)
    setEndsAt(Date.now() + seconds * 1000)
    recognition.stop()
    recognition.start()
  }

  function stopAnswer() {
    recognition.stop()
    setEndsAt(0)
    setRemaining(0)
  }

  const attempted = set ? set.items.filter((item) => comparisons[item.id]) : []
  const average = attempted.length
    ? Math.round((attempted.reduce((sum, item) => sum + (comparisons[item.id]?.score ?? 0), 0) / attempted.length) * 100)
    : 0

  if (!set) return null

  return (
    <section className="shadow-panel toefl-panel">
      <div className="panel-head">
        <h3>托福口语 · 2026</h3>
        <Pill tone="accent">{set.kind === 'listen-repeat' ? 'Listen and Repeat' : 'Take an Interview'}</Pill>
      </div>

      <select value={set.id} onChange={(event) => setId(event.target.value)}>
        {sets.map((item) => (
          <option key={item.id} value={item.id}>
            {item.kind === 'listen-repeat' ? '跟读' : '面试'} · {item.topicZh}
          </option>
        ))}
      </select>

      <div className="chip-row">
        <Pill tone="neutral">{set.items.length} 题</Pill>
        <Pill tone="neutral">作答 {set.responseSec}s / 题</Pill>
        {set.kind === 'listen-repeat' && attempted.length ? <Pill tone="success">平均词级匹配 {average}%</Pill> : null}
      </div>
      <p className="muted small">
        {set.kind === 'listen-repeat'
          ? '先听，再复述。原文在复述前隐藏；系统按词级匹配标出漏读和替换，不评发音。'
          : '听问题后直接作答，没有准备时间。每题 45 秒；本轮不打断、不提示。'}
      </p>

      <ul className="drill-list">
        {set.items.map((item, index) => {
          const comparison = comparisons[item.id]
          const answer = answers[item.id] ?? ''
          const isInterview = set.kind === 'interview'
          return (
            <li key={item.id} className={`drill-item toefl-item ${activeId === item.id ? 'active' : ''}`}>
              <div>
                <p className="toefl-item-title">
                  <span className="muted tiny">{String(index + 1).padStart(2, '0')}</span>{' '}
                  {revealed[item.id] || comparison ? item.text : '••• ••• ••• •••'}
                </p>
                {item.tip ? <p className="muted tiny">{item.tip}</p> : null}
              </div>
              <div className="drill-actions">
                {!isInterview ? (
                  <>
                    <button className="btn tiny ghost" onClick={() => speak(item.text)}>
                      播放
                    </button>
                    <button className="btn tiny" onClick={() => startRepeat(item.id)}>
                      跟读
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn tiny ghost" onClick={() => { setRevealed((prev) => ({ ...prev, [item.id]: true })); speak(item.text) }}>
                      播放问题
                    </button>
                    {activeId === item.id && endsAt ? (
                      <button className="btn tiny danger" onClick={stopAnswer}>
                        结束作答
                      </button>
                    ) : (
                      <button className="btn tiny" onClick={() => startAnswer(item.id, set.responseSec)}>
                        开始作答
                      </button>
                    )}
                  </>
                )}
              </div>

              {!isInterview && comparison ? (
                <div className="drill-result">
                  <div className="drill-score">词级匹配 {Math.round(comparison.score * 100)}%</div>
                  <p className="token-line">
                    {comparison.tokens.map((token, tokenIndex) => (
                      <span key={`${token.text}-${tokenIndex}`} className={token.matched ? 'token-ok' : 'token-miss'}>
                        {token.text}{' '}
                      </span>
                    ))}
                  </p>
                  {comparison.missing.length ? <p className="muted tiny">漏读/替换：{comparison.missing.join(', ')}</p> : null}
                </div>
              ) : null}

              {isInterview && (answer || (activeId === item.id && interim)) ? (
                <div className="drill-result">
                  <p className="muted tiny">
                    你的回答 · {countWords(answer + ' ' + (activeId === item.id ? interim : ''))} 词
                  </p>
                  <p className="toefl-answer">{answer} {activeId === item.id ? interim : ''}</p>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      {set.kind === 'interview' && activeId && endsAt ? (
        <div className="timer-strip">
          <span>第 {set.items.findIndex((item) => item.id === activeId) + 1} 题作答中</span>
          <b className={remaining <= 10 ? 'urgent' : ''}>{formatClock(remaining)}</b>
        </div>
      ) : null}

      {set.guidance?.length ? (
        <details>
          <summary>本题型说明</summary>
          <ul className="question-list">
            {set.guidance.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="muted tiny">2026 版：Speaking 共 11 题（7 跟读 + 4 面试），约 8 分钟；这里按题型拆分练习。</p>
    </section>
  )
}
