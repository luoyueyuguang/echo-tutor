import { useEffect, useState } from 'react'
import type { SessionMode, SessionReport, StatsPayload } from '../shared/types'
import { api } from '../api'
import { formatDate, formatDuration, MODE_LABEL } from '../lib/format'
import { sessionReportToGrade } from '../lib/report'
import { GradeReport } from './GradeReport'
import { EmptyState, Modal, Pill, Spinner, type ToastKind } from './ui'

const CATEGORY_LABEL: Record<string, string> = {
  grammar: '语法',
  vocabulary: '词汇',
  pronunciation: '发音',
  coherence: '连贯',
  register: '语域',
  task: '任务',
}

export function DashboardView({
  version,
  notify,
  dailyGoalMin,
}: {
  version: number
  notify: (message: string, kind?: ToastKind) => void
  dailyGoalMin: number
}) {
  const [stats, setStats] = useState<StatsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [report, setReport] = useState<SessionReport | null>(null)
  const [reportBusy, setReportBusy] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .stats()
      .then((data) => {
        if (alive) setStats(data)
      })
      .catch((err) => notify((err as Error).message, 'error'))
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [version, notify])

  async function openReport(id: number) {
    setReportBusy(id)
    try {
      setReport(await api.getSessionReport(id))
    } catch (err) {
      notify((err as Error).message, 'error')
    } finally {
      setReportBusy(0)
    }
  }

  if (loading && !stats) return <div className="view-pad"><Spinner label="正在汇总学习数据…" /></div>
  if (!stats) return <div className="view-pad"><EmptyState title="暂无数据" body="完成一次练习后这里会出现报告。" /></div>

  const goalProgress = Math.min(100, Math.round((stats.todayMinutes / Math.max(1, dailyGoalMin)) * 100))
  const maxActivity = Math.max(10, ...stats.activity.map((day) => day.minutes))
  const maxError = Math.max(1, ...stats.errorCategories.map((item) => item.count))
  const trend = stats.bandTrend
  const trendMax = Math.max(9, ...trend.map((point) => point.band))

  return (
    <div className="dashboard">
      <div className="dash-head">
        <div>
          <h2>学习报告</h2>
          <p className="muted">所有数据保存在本机。分数是练习估算，不等同于正式考试成绩。</p>
        </div>
        <Pill tone="neutral">{formatDate(Date.now())}</Pill>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span>连续练习</span>
          <b>{stats.streakDays}</b>
          <small>天</small>
        </div>
        <div className="stat-card">
          <span>今日练习</span>
          <b>{stats.todayMinutes}</b>
          <small>/ {dailyGoalMin} 分钟</small>
          <div className="mini-track">
            <div className="mini-fill" style={{ width: `${goalProgress}%` }} />
          </div>
        </div>
        <div className="stat-card">
          <span>近 7 天开口</span>
          <b>{stats.wordsSpoken7d}</b>
          <small>词</small>
        </div>
        <div className="stat-card">
          <span>待复习</span>
          <b>{stats.dueReviews}</b>
          <small>张卡片</small>
        </div>
        <div className="stat-card">
          <span>累计练习</span>
          <b>{stats.totalMinutes}</b>
          <small>分钟</small>
        </div>
        <div className="stat-card">
          <span>作文</span>
          <b>{stats.essays}</b>
          <small>篇</small>
        </div>
      </div>

      <div className="dash-grid">
        <section className="dash-panel">
          <div className="panel-head">
            <h3>分数趋势</h3>
            <span className="muted tiny">每次会话结束后的文本估算</span>
          </div>
          {trend.length ? (
            <svg className="trend-chart" viewBox="0 0 560 200" role="img" aria-label="Band trend">
              {[0.25, 0.5, 0.75, 1].map((ratio) => (
                <line
                  key={ratio}
                  x1="30"
                  x2="540"
                  y1={170 - ratio * 140}
                  y2={170 - ratio * 140}
                  stroke="var(--border)"
                  strokeDasharray="4 6"
                />
              ))}
              {trend.length > 1 ? (
                <polyline
                  points={trend
                    .map((point, index) => {
                      const x = 30 + (index * 510) / (trend.length - 1)
                      const y = 170 - (point.band / trendMax) * 140
                      return `${x},${y}`
                    })
                    .join(' ')}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
              ) : null}
              {trend.map((point, index) => {
                const x = trend.length > 1 ? 30 + (index * 510) / (trend.length - 1) : 285
                const y = 170 - (point.band / trendMax) * 140
                return (
                  <g key={`${point.date}-${index}`}>
                    <circle cx={x} cy={y} r="4.5" fill="var(--accent)" />
                    <title>{`${point.date} · ${point.label || point.band}`}</title>
                  </g>
                )
              })}
              <text x="30" y="192" fill="var(--muted)" fontSize="11">
                {trend[0]?.date}
              </text>
              {trend.length > 1 ? (
                <text x="470" y="192" fill="var(--muted)" fontSize="11">
                  {trend[trend.length - 1]?.date}
                </text>
              ) : null}
            </svg>
          ) : (
            <EmptyState title="还没有会话分数" body="完成一轮口语练习后开始记录。" />
          )}
        </section>

        <section className="dash-panel">
          <div className="panel-head">
            <h3>近 14 天练习</h3>
            <span className="muted tiny">分钟</span>
          </div>
          <div className="activity-chart">
            {stats.activity.map((day) => (
              <div key={day.date} className="activity-col">
                <div className="activity-bar-track">
                  <div className="activity-bar" style={{ height: `${Math.max(2, (day.minutes / maxActivity) * 100)}%` }} title={`${day.date}: ${day.minutes} 分钟`} />
                </div>
                <span>{day.date.slice(8)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="dash-panel">
          <div className="panel-head">
            <h3>错误类型</h3>
            <span className="muted tiny">来自纠错卡片</span>
          </div>
          {stats.errorCategories.length ? (
            <div className="error-bars">
              {stats.errorCategories.map((item) => (
                <div key={item.category} className="error-bar-row">
                  <span>{CATEGORY_LABEL[item.category] ?? item.category}</span>
                  <div className="error-track">
                    <div style={{ width: `${(item.count / maxError) * 100}%` }} />
                  </div>
                  <b>{item.count}</b>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">完成对话或作文批改后，这里会统计语法、词汇、连贯等错误分布。</p>
          )}
        </section>

        <section className="dash-panel">
          <div className="panel-head">
            <h3>近期纠错</h3>
          </div>
          {stats.recentCorrections.length ? (
            <ul className="recent-corrections">
              {stats.recentCorrections.map((item, index) => (
                <li key={`${item.original}-${index}`}>
                  <del>{item.original}</del>
                  <span>→</span>
                  <ins>{item.suggestion}</ins>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">暂无纠错记录。</p>
          )}
        </section>
      </div>

      <section className="dash-panel">
        <div className="panel-head">
          <h3>最近练习</h3>
        </div>
        {stats.recentSessions.length ? (
          <ul className="session-list">
            {stats.recentSessions.map((session) => (
              <li key={session.id}>
                <button className="session-row" onClick={() => void openReport(session.id)} disabled={reportBusy === session.id}>
                  <div>
                    <b>{MODE_LABEL[session.mode as SessionMode] ?? session.mode}</b>
                    <small>
                      {formatDate(session.startedAt)} · {formatDuration(session.durationSec)}
                    </small>
                  </div>
                  <div className="session-score">
                    {reportBusy === session.id ? <Spinner /> : session.label || (session.band ? session.band.toFixed(1) : '查看报告')}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">还没有完成的会话。</p>
        )}
      </section>

      <Modal open={Boolean(report)} title="练习报告" onClose={() => setReport(null)} wide>
        {report ? <GradeReport result={sessionReportToGrade(report)} /> : null}
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => setReport(null)}>
            关闭
          </button>
        </div>
      </Modal>
    </div>
  )
}
