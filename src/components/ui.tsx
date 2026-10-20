import { useEffect, type ReactNode } from 'react'

export type ToastKind = 'info' | 'success' | 'error'
export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  duration?: number
  action?: ToastAction
}

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  action?: ToastAction
}

export function ToastStack({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast toast-${item.kind}`} role="status">
          <span className="toast-message">{item.message}</span>
          {item.action ? (
            <button
              className="toast-action"
              onClick={() => {
                item.action?.onClick()
                onDismiss(item.id)
              }}
            >
              {item.action.label}
            </button>
          ) : null}
          <button className="toast-close" onClick={() => onDismiss(item.id)} aria-label="关闭">
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean
  title?: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    document.body.classList.add('modal-open')
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.classList.remove('modal-open')
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap">
      <span className="spinner" />
      {label ? <span>{label}</span> : null}
    </span>
  )
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'danger' | 'success' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

export function ScoreBar({
  label,
  score,
  band,
  comment,
  evidence,
}: {
  label: string
  score: number
  band?: number
  comment?: string
  evidence?: string[]
}) {
  const tier = score >= 75 ? 'good' : score >= 55 ? 'mid' : 'low'
  return (
    <div className="score-row">
      <div className="score-head">
        <span>{label}</span>
        <span className="score-value">
          {band !== undefined ? <b>{band}</b> : null}
          <span>{Math.round(score)}%</span>
        </span>
      </div>
      <div className="score-track">
        <div className={`score-fill score-${tier}`} style={{ width: `${Math.max(3, Math.min(100, score))}%` }} />
      </div>
      {comment ? <p className="score-comment">{comment}</p> : null}
      {evidence && evidence.length ? (
        <div className="evidence">
          {evidence.map((quote, index) => (
            <q key={index}>{quote}</q>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  )
}
