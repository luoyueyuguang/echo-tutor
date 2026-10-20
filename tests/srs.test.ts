import { describe, expect, test } from 'bun:test'
import { defaultFsrsState, previewIntervals, schedule } from '../server/srs'

describe('FSRS scheduling', () => {
  test('new card gets a positive stability and future due date', () => {
    const now = 1_700_000_000_000
    const result = schedule(defaultFsrsState(), 3, now)
    expect(result.state.stability).toBeGreaterThan(0)
    expect(result.state.difficulty).toBeGreaterThanOrEqual(1)
    expect(result.state.difficulty).toBeLessThanOrEqual(10)
    expect(result.dueAt).toBeGreaterThan(now)
  })

  test('easy produces a longer interval than hard on a new card', () => {
    const now = 1_700_000_000_000
    const hard = schedule(defaultFsrsState(), 2, now)
    const good = schedule(defaultFsrsState(), 3, now)
    const easy = schedule(defaultFsrsState(), 4, now)
    expect(hard.intervalDays).toBeLessThan(good.intervalDays)
    expect(good.intervalDays).toBeLessThan(easy.intervalDays)
  })

  test('lapse schedules a short same-day relearn step', () => {
    const now = 1_700_000_000_000
    const first = schedule(defaultFsrsState(), 3, now)
    const lapse = schedule(first.state, 1, now + 3 * 86400_000)
    expect(lapse.dueAt - (now + 3 * 86400_000)).toBeLessThan(3600_000)
    expect(lapse.state.stability).toBeGreaterThan(0)
  })

  test('repeated successful reviews grow stability', () => {
    const now = 1_700_000_000_000
    let state = defaultFsrsState()
    let previous = 0
    for (let i = 0; i < 4; i++) {
      const result = schedule(state, 3, now + i * 10 * 86400_000)
      expect(result.state.stability).toBeGreaterThan(previous)
      previous = result.state.stability
      state = result.state
    }
    expect(state.stability).toBeGreaterThan(1)
  })

  test('previews all four ratings', () => {
    const preview = previewIntervals(defaultFsrsState())
    expect(Object.keys(preview).sort()).toEqual(['1', '2', '3', '4'])
    for (const value of Object.values(preview)) expect(value.length).toBeGreaterThan(0)
  })
})
