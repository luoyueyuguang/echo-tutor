import { describe, expect, test } from 'bun:test'
import { bundle } from '../server/content'

describe('content packs', () => {
  test('expected volume is present', () => {
    expect(bundle.ieltsSpeaking.part1).toHaveLength(12)
    expect(bundle.ieltsSpeaking.part2).toHaveLength(24)
    expect(bundle.ieltsSpeaking.part3).toHaveLength(12)
    expect(bundle.toeflSpeaking).toHaveLength(12)
    expect(bundle.writing).toHaveLength(80)
    expect(bundle.scenarios).toHaveLength(12)
    expect(bundle.drills).toHaveLength(10)
    expect(bundle.phrases).toHaveLength(8)
    expect(bundle.rubrics.length).toBeGreaterThanOrEqual(8)
  })

  test('writing ids are unique and every task is complete', () => {
    const ids = new Set<string>()
    for (const task of bundle.writing) {
      expect(ids.has(task.id)).toBe(false)
      ids.add(task.id)
      expect(task.prompt.length).toBeGreaterThan(20)
      expect(task.topicZh.length).toBeGreaterThan(0)
      if (task.kind !== 'build-sentence') expect(task.minWords).toBeGreaterThan(0)
      expect(task.minutes).toBeGreaterThan(0)
      expect(task.guidance?.length ?? 0).toBeGreaterThan(0)
    }
  })

  test('IELTS part 2 cards have the promised structure', () => {
    for (const card of bundle.ieltsSpeaking.part2) {
      expect(card.cue.startsWith('Describe')).toBe(true)
      expect(card.bullets).toHaveLength(4)
      expect(card.followUps).toHaveLength(3)
    }
  })

  test('TOEFL speaking follows the 2026 section structure', () => {
    const repeat = bundle.toeflSpeaking.filter((set) => set.kind === 'listen-repeat')
    const interview = bundle.toeflSpeaking.filter((set) => set.kind === 'interview')
    expect(repeat).toHaveLength(6)
    expect(interview).toHaveLength(6)
    for (const set of repeat) expect(set.items).toHaveLength(7)
    for (const set of interview) expect(set.items).toHaveLength(4)
  })

  test('TOEFL writing has Build a Sentence, Email and Academic Discussion', () => {
    const build = bundle.writing.filter((task) => task.kind === 'build-sentence')
    const email = bundle.writing.filter((task) => task.kind === 'email')
    const discussion = bundle.writing.filter((task) => task.kind === 'academic-discussion')
    expect(build).toHaveLength(12)
    expect(email).toHaveLength(6)
    expect(discussion).toHaveLength(6)
    for (const task of build) {
      expect(task.chunks?.length ?? 0).toBeGreaterThan(1)
      expect(task.answer?.length ?? 0).toBeGreaterThan(10)
    }
  })

  test('every rubric has criteria and band descriptors', () => {
    for (const rubric of bundle.rubrics) {
      expect(rubric.criteria.length).toBeGreaterThan(0)
      for (const criterion of rubric.criteria) {
        expect(Object.keys(criterion.bands).length).toBeGreaterThanOrEqual(3)
      }
    }
  })

  test('drills and phrase groups are complete', () => {
    for (const drill of bundle.drills) {
      expect(drill.items).toHaveLength(5)
      for (const item of drill.items) expect(item.zh?.length ?? 0).toBeGreaterThan(0)
    }
    for (const group of bundle.phrases) expect(group.phrases).toHaveLength(8)
  })
})
