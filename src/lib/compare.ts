export interface ComparisonToken {
  text: string
  matched: boolean
}

export interface TranscriptComparison {
  score: number
  tokens: ComparisonToken[]
  missing: string[]
  extra: string[]
}

export function tokenizeEnglish(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? []).filter((w) => w.length > 0)
}

/**
 * Word-level alignment (longest common subsequence). This is a pronunciation
 * *coverage* check, not a phoneme score: it catches dropped or substituted
 * words that the recogniser heard, and is honest about its limits.
 */
export function compareTranscript(target: string, said: string): TranscriptComparison {
  const wanted = tokenizeEnglish(target)
  const heard = tokenizeEnglish(said)
  const rows = wanted.length + 1
  const cols = heard.length + 1
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] = wanted[i - 1] === heard[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  const matched = new Array<boolean>(wanted.length).fill(false)
  let i = wanted.length
  let j = heard.length
  while (i > 0 && j > 0) {
    if (wanted[i - 1] === heard[j - 1]) {
      matched[i - 1] = true
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  const matchedHeard = new Array<boolean>(heard.length).fill(false)
  i = wanted.length
  j = heard.length
  while (i > 0 && j > 0) {
    if (wanted[i - 1] === heard[j - 1]) {
      matchedHeard[j - 1] = true
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  return {
    score: wanted.length ? matched.filter(Boolean).length / wanted.length : 0,
    tokens: wanted.map((text, index) => ({ text, matched: matched[index] })),
    missing: wanted.filter((_, index) => !matched[index]),
    extra: heard.filter((_, index) => !matchedHeard[index]),
  }
}
