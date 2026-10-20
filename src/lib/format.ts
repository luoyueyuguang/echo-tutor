import type { Exam, SessionMode } from '../shared/types'

export const EXAM_LABEL: Record<Exam, string> = {
  ielts: '雅思',
  toefl: '托福',
  kaoyan: '考研',
}

export const MODE_LABEL: Record<SessionMode, string> = {
  free: '自由对话',
  'ielts.p1': '雅思 Part 1',
  'ielts.p2': '雅思 Part 2',
  'ielts.p3': '雅思 Part 3',
  'toefl.speech': '托福口语',
  scenario: '情景角色',
  dictation: '听力听写',
  shadow: '跟读训练',
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

export function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds < 0) return '0 分钟'
  const minutes = Math.round(totalSeconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const h = Math.floor(minutes / 60)
  return `${h} 小时 ${minutes % 60} 分`
}

export function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function countWords(text: string): number {
  return (text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? []).length
}

export function confidenceLabel(value: 'low' | 'medium' | 'high'): string {
  return value === 'high' ? '置信度较高' : value === 'medium' ? '中等置信度' : '置信度低'
}
