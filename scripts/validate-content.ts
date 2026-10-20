import { bundle } from '../server/content'

const errors: string[] = []
const fail = (message: string) => errors.push(message)
const check = (condition: boolean, message: string) => {
  if (!condition) fail(message)
}

check(bundle.ieltsSpeaking.part1.length === 12, `IELTS part1: expected 12, got ${bundle.ieltsSpeaking.part1.length}`)
check(bundle.ieltsSpeaking.part2.length === 24, `IELTS part2: expected 24, got ${bundle.ieltsSpeaking.part2.length}`)
check(bundle.ieltsSpeaking.part3.length === 12, `IELTS part3: expected 12, got ${bundle.ieltsSpeaking.part3.length}`)
check(bundle.toeflSpeaking.length === 12, `TOEFL speaking sets: expected 12, got ${bundle.toeflSpeaking.length}`)
check(bundle.writing.length === 80, `Writing: expected 80, got ${bundle.writing.length}`)
check(bundle.scenarios.length === 12, `Scenarios: expected 12, got ${bundle.scenarios.length}`)
check(bundle.drills.length === 10, `Drills: expected 10, got ${bundle.drills.length}`)
check(bundle.phrases.length === 8, `Phrases: expected 8, got ${bundle.phrases.length}`)

const writingIds = new Set<string>()
for (const task of bundle.writing) {
  check(Boolean(task.id), 'writing task without id')
  check(!writingIds.has(task.id), `duplicate writing id: ${task.id}`)
  writingIds.add(task.id)
  check(task.prompt.length > 20, `${task.id}: prompt too short`)
  check(task.topicZh.length > 0, `${task.id}: missing topicZh`)
  if (task.kind !== 'build-sentence') check(task.minWords > 0, `${task.id}: invalid word count`)
  check(task.minutes > 0, `${task.id}: invalid timing`)
  check((task.guidance?.length ?? 0) > 0, `${task.id}: missing guidance`)
}

for (const part of bundle.ieltsSpeaking.part1) {
  check(part.questions.length === 4, `part1 ${part.topic}: expected 4 questions`)
  check(part.topicZh.length > 0, `part1 ${part.topic}: missing topicZh`)
}
for (const card of bundle.ieltsSpeaking.part2) {
  check(card.cue.startsWith('Describe'), `${card.id}: cue must start with Describe`)
  check(card.bullets.length === 4, `${card.id}: expected 4 bullets`)
  check(card.followUps.length === 3, `${card.id}: expected 3 follow-ups`)
}
for (const set of bundle.ieltsSpeaking.part3) {
  check(set.questions.length === 4, `part3 ${set.topic}: expected 4 questions`)
}

for (const set of bundle.toeflSpeaking) {
  check(set.items.length === (set.kind === 'listen-repeat' ? 7 : 4), `${set.id}: wrong item count`)
  check(set.responseSec > 0, `${set.id}: invalid timing`)
  for (const item of set.items) check(item.text.length > 10, `${item.id}: item too short`)
}
const buildSentences = bundle.writing.filter((task) => task.kind === 'build-sentence')
const emails = bundle.writing.filter((task) => task.kind === 'email')
const discussions = bundle.writing.filter((task) => task.kind === 'academic-discussion')
check(buildSentences.length === 12, `Build a Sentence: expected 12, got ${buildSentences.length}`)
check(emails.length === 6, `TOEFL email: expected 6, got ${emails.length}`)
check(discussions.length === 6, `Academic Discussion: expected 6, got ${discussions.length}`)
for (const task of buildSentences) {
  check((task.chunks?.length ?? 0) > 1, `${task.id}: missing chunks`)
  check(Boolean(task.answer), `${task.id}: missing answer`)
}
for (const task of [...emails, ...discussions]) {
  check(task.minWords > 0 && task.minutes > 0, `${task.id}: invalid limits`)
}
for (const task of buildSentences) {
  check(task.minutes > 0, `${task.id}: invalid timing`)
}

for (const rubric of bundle.rubrics) {
  check(rubric.criteria.length > 0, `${rubric.exam}/${rubric.skill}: no criteria`)
  for (const criterion of rubric.criteria) {
    check(Object.keys(criterion.bands).length >= 3, `${rubric.exam}/${criterion.key}: too few band descriptors`)
  }
}

for (const drill of bundle.drills) {
  check(drill.items.length === 5, `${drill.id}: expected 5 items`)
  for (const item of drill.items) check((item.zh ?? '').length > 0, `${item.text}: missing Chinese gloss`)
}
for (const group of bundle.phrases) check(group.phrases.length === 8, `${group.topic}: expected 8 phrases`)
for (const scenario of bundle.scenarios) {
  check(scenario.usefulLanguage.length >= 5, `${scenario.id}: too few useful phrases`)
  check(scenario.opening.length > 0, `${scenario.id}: missing opening`)
}

if (errors.length) {
  console.error(`Content validation failed (${errors.length}):`)
  for (const error of errors) console.error(` - ${error}`)
  process.exit(1)
}

console.log(
  `Content OK · IELTS speaking ${bundle.ieltsSpeaking.part1.length}/${bundle.ieltsSpeaking.part2.length}/${bundle.ieltsSpeaking.part3.length}, ` +
    `TOEFL speaking ${bundle.toeflSpeaking.length}, writing ${bundle.writing.length}, scenarios ${bundle.scenarios.length}, ` +
    `drills ${bundle.drills.length}, phrases ${bundle.phrases.length}, rubrics ${bundle.rubrics.length}`,
)
