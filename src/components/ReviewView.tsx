import { useEffect, useRef, useState } from 'react'
import type { ReviewItemRow, ReviewItemWithPreview } from '../shared/types'
import { api } from '../api'
import { formatDate } from '../lib/format'
import { EmptyState, Pill, Spinner, type ToastKind } from './ui'

const RATING_LABEL: Record<1 | 2 | 3 | 4, string> = {
  1: '忘记了',
  2: '困难',
  3: '记得',
  4: '很简单',
}

export function ReviewView({ notify, onDataChanged }: { notify: (message: string, kind?: ToastKind) => void; onDataChanged: () => void }) {
  const [due, setDue] = useState<ReviewItemWithPreview[]>([])
  const [all, setAll] = useState<ReviewItemRow[]>([])
  const [flipped, setFlipped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<'error' | 'vocab' | 'phrase'>('vocab')
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const current = due[0]
  const busyRef = useRef(false)
  const currentRef = useRef(current)
  currentRef.current = current
  const flippedRef = useRef(flipped)
  flippedRef.current = flipped

  async function load() {
    setLoading(true)
    try {
      const [dueItems, allItems] = await Promise.all([api.dueReviews(), api.allReviews()])
      setDue(dueItems)
      setAll(allItems)
      setFlipped(false)
    } catch (err) {
      notify((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!currentRef.current) return
      if (event.code === 'Space') {
        event.preventDefault()
        setFlipped((value) => !value)
        return
      }
      if (!flippedRef.current) return
      const rating = Number(event.key)
      if (rating >= 1 && rating <= 4) void rate(rating as 1 | 2 | 3 | 4)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  async function rate(rating: 1 | 2 | 3 | 4) {
    const item = currentRef.current
    if (!item || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await api.gradeReview(item.id, rating)
      setDue((prev) => prev.slice(1))
      setFlipped(false)
      onDataChanged()
    } catch (err) {
      notify((err as Error).message, 'error')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function addCard() {
    if (!front.trim() || !back.trim()) {
      notify('正面和背面都需要填写。', 'info')
      return
    }
    try {
      await api.addReview({ kind, front: front.trim(), back: back.trim() })
      setFront('')
      setBack('')
      setAdding(false)
      await load()
      notify('卡片已加入复习队列。', 'success')
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  async function removeCard(id: number) {
    if (!window.confirm('删除这张卡片？')) return
    try {
      await api.deleteReview(id)
      await load()
      notify('已删除。', 'info')
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  if (loading) {
    return (
      <div className="view-pad">
        <Spinner label="正在加载复习队列…" />
      </div>
    )
  }

  return (
    <div className="review-view">
      <div className="review-head">
        <div>
          <h2>间隔复习</h2>
          <p className="muted">错误句型、词汇和短语按 FSRS 调度，到期后自动出现。</p>
        </div>
        <div className="review-counts">
          <Pill tone="accent">待复习 {due.length}</Pill>
          <Pill tone="neutral">全部 {all.length}</Pill>
        </div>
      </div>

      {current ? (
        <div className="review-stage">
          <div className={`review-card ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped((value) => !value)}>
            <div className="review-card-inner">
              <div className="review-face review-front">
                <span className="muted tiny">{current.kind === 'error' ? '纠错' : current.kind === 'vocab' ? '词汇' : '短语'}</span>
                <p>{current.front}</p>
                <span className="muted tiny">点击或按空格查看答案</span>
              </div>
              <div className="review-face review-back">
                <span className="muted tiny">答案</span>
                <p>{current.back}</p>
                {current.note ? <span className="muted tiny">{current.note}</span> : null}
              </div>
            </div>
          </div>
          {flipped ? (
            <div className="rating-row">
              {([1, 2, 3, 4] as const).map((rating) => (
                <button key={rating} className={`rating rating-${rating}`} onClick={() => void rate(rating)} disabled={busy}>
                  <b>{RATING_LABEL[rating]}</b>
                  <span>{current.preview[String(rating)] ?? ''}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="review-hint muted small">先回忆，再翻面；空格翻面，1–4 评分。</div>
          )}
        </div>
      ) : (
        <EmptyState
          title="今天没有到期卡片"
          body={all.length ? '新的错误会在你完成对话或作文批改后自动加入。' : '完成一次对话或作文批改后，系统会自动生成复习卡片。'}
        />
      )}

      <div className="review-tools">
        <button className="btn ghost small" onClick={() => setAdding((value) => !value)}>
          {adding ? '收起' : '手动添加卡片'}
        </button>
        <button className="btn ghost small" onClick={() => void load()}>
          刷新
        </button>
      </div>

      {adding ? (
        <div className="add-card-form">
          <select value={kind} onChange={(event) => setKind(event.target.value as 'error' | 'vocab' | 'phrase')}>
            <option value="vocab">词汇</option>
            <option value="phrase">短语</option>
            <option value="error">纠错</option>
          </select>
          <input value={front} onChange={(event) => setFront(event.target.value)} placeholder="正面：单词 / 错误句 / 提示" />
          <input value={back} onChange={(event) => setBack(event.target.value)} placeholder="背面：释义 / 正确说法" />
          <button className="btn primary small" onClick={() => void addCard()}>
            添加
          </button>
        </div>
      ) : null}

      {all.length ? (
        <details className="all-cards">
          <summary>全部卡片（{all.length}）</summary>
          <ul>
            {all.map((item) => (
              <li key={item.id}>
                <div>
                  <span>{item.front}</span>
                  <small>
                    {item.back} · 下次 {formatDate(item.dueAt)}
                  </small>
                </div>
                <button className="icon-btn" onClick={() => void removeCard(item.id)} aria-label="删除">
                  ×
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
