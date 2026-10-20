import type { FsrsState } from '../src/shared/types'

export type Rating = 1 | 2 | 3 | 4

// FSRS-4.5 default weights.
const W = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246,
  1.587, 0.2272, 2.8755,
]

const DECAY = -0.5
const FACTOR = 19 / 81
const DESIRED_RETENTION = 0.9
const DAY_MS = 86_400_000

export function defaultFsrsState(): FsrsState {
  return { stability: 0, difficulty: 0, lastReview: null, scheduledDays: 0 }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function initialDifficulty(rating: Rating): number {
  return clamp(W[4] - (rating - 3) * W[5], 1, 10)
}

function initialStability(rating: Rating): number {
  return Math.max(0.1, W[rating - 1])
}

function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0
  return Math.pow(1 + FACTOR * Math.max(0, elapsedDays) / stability, DECAY)
}

function nextDifficulty(d: number, rating: Rating): number {
  const delta = d - W[6] * (rating - 3)
  return clamp(W[7] * initialDifficulty(4) + (1 - W[7]) * delta, 1, 10)
}

function nextStability(s: number, d: number, r: number, rating: Rating): number {
  if (rating === 1) {
    return Math.max(
      0.1,
      W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)),
    )
  }
  const hardPenalty = rating === 2 ? W[15] : 1
  const easyBonus = rating === 4 ? W[16] : 1
  const grown =
    s *
    (1 +
      Math.exp(W[8]) *
        (11 - d) *
        Math.pow(s, -W[9]) *
        (Math.exp(W[10] * (1 - r)) - 1) *
        hardPenalty *
        easyBonus)
  return Math.max(0.1, grown)
}

function intervalDays(stability: number): number {
  const raw = (stability / FACTOR) * (Math.pow(DESIRED_RETENTION, 1 / DECAY) - 1)
  return Math.max(0.007, raw)
}

export interface ScheduleResult {
  state: FsrsState
  dueAt: number
  intervalDays: number
}

export function schedule(state: FsrsState, rating: Rating, now = Date.now()): ScheduleResult {
  const isNew = state.stability <= 0
  let stability: number
  let difficulty: number

  if (isNew) {
    stability = initialStability(rating)
    difficulty = initialDifficulty(rating)
  } else {
    const elapsedDays = state.lastReview ? (now - state.lastReview) / DAY_MS : state.scheduledDays
    const r = retrievability(elapsedDays, state.stability)
    difficulty = nextDifficulty(state.difficulty, rating)
    stability = nextStability(state.stability, state.difficulty, r, rating)
  }

  // Lapses still get a short same-day relearn step; this keeps daily practice useful.
  const days = rating === 1 ? 10 / (60 * 24) : Math.max(1, Math.round(intervalDays(stability)))
  const next: FsrsState = {
    stability,
    difficulty,
    lastReview: now,
    scheduledDays: days,
  }
  return { state: next, dueAt: now + Math.round(days * DAY_MS), intervalDays: days }
}

export function previewIntervals(state: FsrsState, now = Date.now()): Record<Rating, string> {
  const out = {} as Record<Rating, string>
  for (const rating of [1, 2, 3, 4] as Rating[]) {
    const { intervalDays } = schedule(state, rating, now)
    if (intervalDays < 1 / 24) out[rating] = `${Math.round(intervalDays * 24 * 60)} 分钟`
    else if (intervalDays < 1) out[rating] = `${Math.round(intervalDays * 24)} 小时`
    else if (intervalDays < 30) out[rating] = `${Math.round(intervalDays)} 天`
    else if (intervalDays < 365) out[rating] = `${(intervalDays / 30).toFixed(1)} 个月`
    else out[rating] = `${(intervalDays / 365).toFixed(1)} 年`
  }
  return out
}

export function retentionOf(state: FsrsState, now = Date.now()): number {
  if (!state.lastReview || state.stability <= 0) return 0
  return retrievability((now - state.lastReview) / DAY_MS, state.stability)
}
