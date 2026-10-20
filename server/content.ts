import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ContentBundle,
  IeltsPart2,
  IeltsSpeakingPack,
  Rubric,
  Scenario,
  ShadowDrill,
  ToeflSpeakingSet,
  WritingTask,
} from '../src/shared/types'

const dir = process.env.CONTENT_DIR ?? join(process.cwd(), 'content')

function loadJson<T>(file: string): T {
  const path = join(dir, file)
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (err) {
    throw new Error(`Cannot load content/${file}: ${(err as Error).message}`)
  }
}

const ieltsSpeaking = loadJson<{ part1: IeltsSpeakingPack['part1']; part2: IeltsSpeakingPack['part2']; part3: IeltsSpeakingPack['part3'] }>(
  'ielts-speaking.json',
)
const toefl = loadJson<{ sets: ToeflSpeakingSet[] }>('toefl-speaking.json')
const writingIelts = loadJson<{ tasks: WritingTask[] }>('ielts-writing.json')
const writingToefl = loadJson<{ tasks: WritingTask[] }>('toefl-writing.json')
const writingKaoyan = loadJson<{ tasks: WritingTask[] }>('kaoyan-writing.json')
const scenarios = loadJson<{ scenarios: Scenario[] }>('scenarios.json')
const drills = loadJson<{ drills: ShadowDrill[] }>('drills.json')
const phrases = loadJson<{ groups: ContentBundle['phrases'] }>('phrases.json')
const rubrics = loadJson<{ rubrics: Rubric[] }>('rubrics.json')

export const bundle: ContentBundle = {
  ieltsSpeaking: {
    part1: ieltsSpeaking.part1,
    part2: ieltsSpeaking.part2,
    part3: ieltsSpeaking.part3,
  },
  toeflSpeaking: toefl.sets,
  writing: [...writingIelts.tasks, ...writingToefl.tasks, ...writingKaoyan.tasks],
  scenarios: scenarios.scenarios,
  drills: drills.drills,
  phrases: phrases.groups,
  rubrics: rubrics.rubrics,
}

const byId = <T extends { id: string }>(items: T[]) => {
  const map = new Map<string, T>()
  for (const item of items) map.set(item.id, item)
  return map
}

export const writingTasks = byId(bundle.writing)
export const scenariosById = byId(bundle.scenarios)
export const toeflById = byId(bundle.toeflSpeaking)
export const part2ById = byId(bundle.ieltsSpeaking.part2)
export const drillsById = byId(bundle.drills)

export function writingTask(id: string): WritingTask | undefined {
  return writingTasks.get(id)
}

export function part2Card(id: string | undefined): IeltsPart2 | undefined {
  if (!id) return undefined
  return part2ById.get(id)
}

export function scenarioById(id: string | undefined): Scenario | undefined {
  if (!id) return undefined
  return scenariosById.get(id)
}

export function toeflSet(id: string | undefined): ToeflSpeakingSet | undefined {
  if (!id) return undefined
  return toeflById.get(id)
}

export function rubricFor(exam: string, skill: 'speaking' | 'writing', taskKind?: string): Rubric | undefined {
  const list = bundle.rubrics.filter((r) => r.exam === exam && r.skill === skill)
  if (taskKind) {
    const exact = list.find((r) => r.task === taskKind)
    if (exact) return exact
  }
  return list.find((r) => !r.task)
}
