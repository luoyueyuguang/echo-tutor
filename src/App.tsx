import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings, ContentBundle, View } from './shared/types'
import { api } from './api'
import { DashboardView } from './components/DashboardView'
import { PracticeView } from './components/PracticeView'
import { ReviewView } from './components/ReviewView'
import { SettingsView } from './components/SettingsView'
import { ToastStack, type ToastItem, type ToastKind, type ToastOptions } from './components/ui'
import { WritingView } from './components/WritingView'
import { EXAM_LABEL } from './lib/format'

const NAV: { view: View; label: string; icon: string }[] = [
  { view: 'chat', label: '对话练习', icon: 'M4 5h16v10H8l-4 4V5Z' },
  { view: 'writing', label: '写作实验室', icon: 'M4 20h4l10-10-4-4L4 16v4Zm11-13 3 3' },
  { view: 'review', label: '间隔复习', icon: 'M5 5h6v6H5V5Zm8 8h6v6h-6v-6ZM5 13h6v6H5v-6Zm8-8h6v6h-6V5Z' },
  { view: 'dashboard', label: '学习报告', icon: 'M4 19V5m0 14h16M8 15v-4m4 4V8m4 7v-6' },
  { view: 'settings', label: '设置', icon: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm8 3-2.1-.6-.6-1.5 1.1-1.9-1.4-1.4-1.9 1.1-1.5-.6L13.9 5h-3.8l-.7 2.1-1.5.6-1.9-1.1-1.4 1.4 1.1 1.9-.6 1.5L3 12l.6 2.1 1.5.6 1.1 1.9 1.4 1.4 1.9-1.1 1.5.6.7 2.2h3.8l.7-2.2 1.5-.6 1.9 1.1 1.4-1.4-1.1-1.9.6-1.5L21 12Z' },
]

export default function App() {
  const [view, setView] = useState<View>('chat')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [content, setContent] = useState<ContentBundle | null>(null)
  const [bootError, setBootError] = useState('')
  const [dataVersion, setDataVersion] = useState(0)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastId = useRef(0)

  const notify = useCallback((message: string, kind: ToastKind = 'info', options: ToastOptions = {}) => {
    const id = ++toastId.current
    setToasts((prev) => [...prev.slice(-3), { id, kind, message, action: options.action }])
    const duration = options.duration ?? 5000
    if (duration > 0) {
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id))
      }, duration)
    }
    return id
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const boot = useCallback(async () => {
    setBootError('')
    try {
      const [nextSettings, nextContent] = await Promise.all([api.getSettings(), api.getContent()])
      setSettings(nextSettings)
      setContent(nextContent)
    } catch (err) {
      setBootError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    void boot()
  }, [boot])

  const onDataChanged = useCallback(() => setDataVersion((value) => value + 1), [])

  if (bootError) {
    return (
      <div className="boot-screen">
        <div className="boot-card">
          <h1>Echo Tutor</h1>
          <p className="muted">无法连接到本地服务。</p>
          <pre>{bootError}</pre>
          <p className="muted small">在项目目录运行 `bun run dev`，然后重试。</p>
          <button className="btn primary" onClick={() => void boot()}>
            重试
          </button>
        </div>
      </div>
    )
  }

  if (!settings || !content) {
    return (
      <div className="boot-screen">
        <div className="boot-card">
          <h1>Echo Tutor</h1>
          <p className="muted">正在准备你的英语老师…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">E</div>
          <div>
            <strong>Echo Tutor</strong>
            <span>英语数字人老师</span>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.view}
              className={`nav-item ${view === item.view ? 'active' : ''}`}
              onClick={() => setView(item.view)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={item.icon} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className={`status-dot ${settings.llmApiKeySet ? 'ok' : 'warn'}`} />
          <div>
            <strong>{settings.llmApiKeySet ? '模型已连接' : '未配置模型'}</strong>
            <span>{settings.llmApiKeySet ? settings.llmModel : '语音可用，对话需配置'}</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <h1>{NAV.find((item) => item.view === view)?.label}</h1>
            <span className="muted small">{EXAM_LABEL[settings.exam]} · {settings.studentLevel}</span>
          </div>
          <div className="topbar-right">
            <span className="muted small">
              {settings.llmApiKeySet ? `${settings.llmModel} · ${settings.ttsProvider === 'openai' ? '服务端语音' : '浏览器语音'}` : '本地模式'}
            </span>
            <button className="btn tiny ghost" onClick={() => setView('settings')}>
              设置
            </button>
          </div>
        </header>

        <div className="content">
          {view === 'chat' ? (
            <PracticeView
              settings={settings}
              content={content}
              notify={notify}
              onOpenSettings={() => setView('settings')}
              onDataChanged={onDataChanged}
              onSettingsChanged={setSettings}
              dismissToast={dismissToast}
            />
          ) : null}
          {view === 'writing' ? (
            <WritingView settings={settings} content={content} notify={notify} onDataChanged={onDataChanged} />
          ) : null}
          {view === 'review' ? <ReviewView notify={notify} onDataChanged={onDataChanged} /> : null}
          {view === 'dashboard' ? (
            <DashboardView version={dataVersion} notify={notify} dailyGoalMin={settings.dailyGoalMin} />
          ) : null}
          {view === 'settings' ? (
            <SettingsView
              settings={settings}
              notify={notify}
              onSaved={(updated) => {
                setSettings(updated)
                onDataChanged()
              }}
            />
          ) : null}
        </div>
      </main>

      <ToastStack items={toasts} onDismiss={dismissToast} />
    </div>
  )
}
