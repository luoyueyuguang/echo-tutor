import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { AppSettings, ContentBundle, Exam, GradeResult, WritingTask } from '../shared/types'
import { api, type EssayListRow } from '../api'
import { countWords, EXAM_LABEL, formatClock, formatDate } from '../lib/format'
import { GradeReport } from './GradeReport'
import { EmptyState, Pill, Spinner, type ToastKind } from './ui'

interface WritingProps {
  settings: AppSettings
  content: ContentBundle
  notify: (message: string, kind?: ToastKind) => void
  onDataChanged: () => void
}

interface ResultView {
  essayId: number | null
  grade: GradeResult
  text: string
  prompt: string
}

const GROUP_LABEL: Record<string, string> = {
  task1: 'Task 1 · 图表/流程',
  task2: 'Task 2 · 议论文',
  'build-sentence': 'Build a Sentence',
  email: 'Write an Email',
  'academic-discussion': 'Academic Discussion',
  letter: '小作文 · 书信',
  notice: '小作文 · 通知',
  picture: '大作文 · 图画',
  chart: '大作文 · 图表',
}

function groupFor(exam: Exam, kind: string): string {
  if (exam === 'kaoyan') return kind === 'letter' || kind === 'notice' ? '小作文' : '大作文'
  if (exam === 'toefl') {
    if (kind === 'build-sentence') return 'Build a Sentence'
    if (kind === 'email') return 'Write an Email'
    return 'Academic Discussion'
  }
  return kind === 'task1' ? 'Task 1' : 'Task 2'
}

export function WritingView({ settings, content, notify, onDataChanged }: WritingProps) {
  const [exam, setExam] = useState<Exam>(settings.exam)
  const [taskId, setTaskId] = useState<string>('')
  const [text, setText] = useState('')
  const [result, setResult] = useState<ResultView | null>(null)
  const [grading, setGrading] = useState(false)
  const [essays, setEssays] = useState<EssayListRow[]>([])
  const [endsAt, setEndsAt] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const [startedAt, setStartedAt] = useState(0)
  const noticeRef = useRef(notify)
  noticeRef.current = notify

  const examTasks = useMemo(() => content.writing.filter((task) => task.exam === exam), [content, exam])
  const groups = useMemo(() => {
    const map = new Map<string, WritingTask[]>()
    for (const task of examTasks) {
      const key = groupFor(exam, task.kind)
      const list = map.get(key) ?? []
      list.push(task)
      map.set(key, list)
    }
    return [...map.entries()]
  }, [examTasks, exam])

  const task = useMemo(() => examTasks.find((item) => item.id === taskId) ?? examTasks[0], [examTasks, taskId])

  useEffect(() => {
    if (examTasks.length && !examTasks.some((item) => item.id === taskId)) {
      setTaskId(examTasks[0].id)
    }
  }, [examTasks, taskId])

  useEffect(() => {
    if (!task) return
    setResult(null)
    setText(localStorage.getItem(`echo.draft.${task.id}`) ?? '')
    setEndsAt(0)
    setRemaining(0)
    setStartedAt(0)
  }, [task?.id])

  useEffect(() => {
    if (!endsAt) return
    const tick = () => {
      const left = Math.ceil((endsAt - Date.now()) / 1000)
      if (left <= 0) {
        setEndsAt(0)
        setRemaining(0)
        noticeRef.current('考试时间到。可以停笔并提交，或继续写完。', 'info')
      } else {
        setRemaining(left)
      }
    }
    tick()
    const id = window.setInterval(tick, 500)
    return () => window.clearInterval(id)
  }, [endsAt])

  useEffect(() => {
    void refreshEssays()
  }, [])

  async function refreshEssays() {
    try {
      setEssays(await api.listEssays())
    } catch {
      /* history is optional */
    }
  }

  function startTimer(minutes: number) {
    const now = Date.now()
    setStartedAt(now)
    setEndsAt(now + minutes * 60_000)
    setRemaining(minutes * 60)
  }

  function onChange(value: string) {
    setText(value)
    if (task) localStorage.setItem(`echo.draft.${task.id}`, value)
    if (!startedAt) startTimer(task?.minutes ?? 30)
  }

  async function submit() {
    if (!task) return
    if (countWords(text) < 10) {
      notify('至少写一个完整段落再提交。', 'info')
      return
    }
    setGrading(true)
    try {
      const durationSec = startedAt ? Math.round((Date.now() - startedAt) / 1000) : null
      const response = await api.gradeWriting(task.id, text, durationSec)
      setResult({ essayId: response.essayId, grade: response.grade, text, prompt: task.prompt })
      setEndsAt(0)
      setRemaining(0)
      await refreshEssays()
      onDataChanged()
      notify('批改完成。', 'success')
    } catch (err) {
      notify((err as Error).message, 'error')
    } finally {
      setGrading(false)
    }
  }

  function nextBuildSentence() {
    if (!task) return
    const index = examTasks.findIndex((item) => item.id === task.id)
    const next = examTasks.slice(index + 1).find((item) => item.kind === 'build-sentence')
    if (next) {
      setTaskId(next.id)
      setResult(null)
    } else {
      notify('这是本组最后一题。', 'info')
    }
  }

  async function openEssay(id: number) {
    try {
      const essay = await api.getEssay(id)
      setResult({ essayId: essay.id, grade: essay.grade, text: essay.text, prompt: essay.prompt })
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  async function removeEssay(id: number, event: MouseEvent) {
    event.stopPropagation()
    if (!window.confirm('删除这篇作文及其评分记录？')) return
    try {
      await api.deleteEssay(id)
      await refreshEssays()
      if (result?.essayId === id) setResult(null)
      notify('已删除。', 'info')
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  return (
    <div className="writing-view">
      <aside className="writing-side">
        <div className="exam-tabs">
          {(Object.keys(EXAM_LABEL) as Exam[]).map((item) => (
            <button key={item} className={`exam-tab ${exam === item ? 'active' : ''}`} onClick={() => setExam(item)}>
              {EXAM_LABEL[item]}
            </button>
          ))}
        </div>

        <div className="task-scroll">
          {groups.map(([group, tasks]) => (
            <div key={group} className="task-group">
              <h4>{group}</h4>
              {tasks.map((item) => (
                <button
                  key={item.id}
                  className={`task-item ${task?.id === item.id && !result ? 'active' : ''}`}
                  onClick={() => {
                    setTaskId(item.id)
                    setResult(null)
                  }}
                >
                  <span>{item.topicZh || item.topic}</span>
                  <small>
                    {item.kind === 'build-sentence' ? '句子构建 · 1 分钟' : `${item.minWords} 词 · ${item.minutes} 分钟`}
                  </small>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="history">
          <h4>历史作文（{essays.length}）</h4>
          {essays.length ? (
            essays.map((essay) => (
              <button key={essay.id} className="history-item" onClick={() => void openEssay(essay.id)}>
                <div>
                  <span>{essay.grade.bandLabel || '未评分'}</span>
                  <small>{formatDate(essay.createdAt)} · {essay.wordCount} 词</small>
                </div>
                <span className="history-delete" onClick={(event) => void removeEssay(essay.id, event)} role="button" tabIndex={0}>
                  ×
                </span>
              </button>
            ))
          ) : (
            <p className="muted tiny">提交第一篇作文后会出现在这里。</p>
          )}
        </div>
      </aside>

      <main className="writing-main">
        {result ? (
          <div className="result-wrap">
            <div className="result-topline">
              <button className="btn ghost small" onClick={() => setResult(null)}>
                ← 返回题目
              </button>
              <Pill tone="neutral">作文 #{result.essayId ?? '—'}</Pill>
            </div>
            <details className="essay-original">
              <summary>题目</summary>
              <p>{result.prompt}</p>
            </details>
            <GradeReport result={result.grade} />
            <details className="essay-original">
              <summary>查看原文</summary>
              <p className="essay-text">{result.text}</p>
            </details>
            <div className="result-actions">
              <button className="btn ghost" onClick={() => setResult(null)}>
                返回题目
              </button>
            </div>
          </div>
        ) : task && task.kind === 'build-sentence' ? (
          <BuildSentence key={task.id} task={task} notify={notify} onNext={nextBuildSentence} />
        ) : task ? (
          <>
            <div className="prompt-head">
              <div>
                <div className="chip-row">
                  <Pill tone="accent">{EXAM_LABEL[task.exam]}</Pill>
                  <Pill tone="neutral">{GROUP_LABEL[task.kind] ?? task.kind}</Pill>
                  <Pill tone="neutral">{task.minWords}+ 词</Pill>
                  <Pill tone="neutral">{task.minutes} 分钟</Pill>
                </div>
                <h2>{task.topicZh || task.topic}</h2>
              </div>
              <div className="writer-timer">
                <span className={remaining > 0 && remaining <= 300 ? 'urgent' : ''}>
                  {endsAt ? formatClock(remaining) : `${task.minutes}:00`}
                </span>
                <button className="btn tiny ghost" onClick={() => startTimer(task.minutes)}>
                  重新计时
                </button>
              </div>
            </div>

            <div className="prompt-body">
              <p>{task.prompt}</p>
              {task.data ? (
                <details open>
                  <summary>数据 / 图表信息</summary>
                  <pre className="data-block">{task.data}</pre>
                </details>
              ) : null}
              {task.reading ? (
                <details>
                  <summary>Reading passage</summary>
                  <p>{task.reading}</p>
                </details>
              ) : null}
              {task.listening ? (
                <details>
                  <summary>Listening transcript</summary>
                  <p>{task.listening}</p>
                </details>
              ) : null}
              {task.guidance?.length ? (
                <ul className="guidance">
                  {task.guidance.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>

            <textarea
              className="essay-editor"
              value={text}
              onChange={(event) => onChange(event.target.value)}
              placeholder="在这里用英文写作… 计时会从第一次输入开始。"
            />

            <div className="editor-bar">
              <span className="muted small">
                {countWords(text)} words
                {task.minWords ? ` / 建议 ${task.minWords}+` : ''}
              </span>
              <button className="btn ghost small" onClick={() => setText('')}>
                清空
              </button>
              <button className="btn primary" onClick={() => void submit()} disabled={grading || countWords(text) < 10}>
                {grading ? <Spinner label="批改中…" /> : '提交批改'}
              </button>
            </div>
            <p className="muted tiny">未配置模型时提供本地粗估；配置模型后可获得 rubric 评分、证据与逐句纠错。</p>
          </>
        ) : (
          <EmptyState title="这个考试还没有题目" body="切换考试分类，或在 content/ 下补充题库。" />
        )}
      </main>
    </div>
  )
}

function BuildSentence({
  task,
  notify,
  onNext,
}: {
  task: WritingTask
  notify: (message: string, kind?: ToastKind) => void
  onNext: () => void
}) {
  const [selected, setSelected] = useState<number[]>([])
  const [checked, setChecked] = useState<null | boolean>(null)

  const chunks = task.chunks ?? []
  const assembled = selected.map((index) => chunks[index]).join(' ')

  function normalize(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9' ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function check() {
    if (!task.answer) return
    if (!assembled.trim()) {
      notify('先从词块里选择单词。', 'info')
      return
    }
    setChecked(normalize(assembled) === normalize(task.answer))
  }

  return (
    <div className="build-sentence">
      <div className="prompt-head">
        <div>
          <div className="chip-row">
            <Pill tone="accent">TOEFL 2026</Pill>
            <Pill tone="neutral">Build a Sentence</Pill>
          </div>
          <h2>{task.topicZh || task.topic}</h2>
        </div>
      </div>
      <p className="build-instruction">{task.prompt}</p>
      <div className="chunk-bank">
        {chunks.map((chunk, index) => (
          <button
            key={`${chunk}-${index}`}
            className="chunk-btn"
            disabled={selected.includes(index) || checked === true}
            onClick={() => {
              setSelected((prev) => [...prev, index])
              setChecked(null)
            }}
          >
            {chunk}
          </button>
        ))}
      </div>
      <div className={`built-sentence ${checked === true ? 'correct' : checked === false ? 'wrong' : ''}`}>
        {assembled || <span className="muted">按顺序点击词块，组成一个完整句子</span>}
      </div>
      {checked === false ? (
        <div className="build-answer">
          <span>参考答案：</span>
          {task.answer}
        </div>
      ) : null}
      {checked === true ? <div className="build-answer correct">正确。</div> : null}
      <div className="build-actions">
        <button className="btn ghost small" onClick={() => { setSelected((prev) => prev.slice(0, -1)); setChecked(null) }} disabled={!selected.length}>
          撤销
        </button>
        <button className="btn ghost small" onClick={() => { setSelected([]); setChecked(null) }} disabled={!selected.length}>
          清空
        </button>
        <button className="btn primary" onClick={check} disabled={checked === true}>
          检查
        </button>
        <button className="btn ghost" onClick={() => { setSelected([]); setChecked(null); onNext() }}>
          下一题
        </button>
      </div>
      {task.guidance?.length ? (
        <ul className="guidance">
          {task.guidance.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      <p className="muted tiny">Build a Sentence 每题 1 分；这里只做单题练习，不计入写作 rubric。</p>
    </div>
  )
}
