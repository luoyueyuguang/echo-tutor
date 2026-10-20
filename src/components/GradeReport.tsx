import type { GradeResult } from '../shared/types'
import { confidenceLabel } from '../lib/format'
import { Pill, ScoreBar } from './ui'

const CATEGORY_LABEL: Record<string, string> = {
  grammar: '语法',
  vocabulary: '词汇',
  pronunciation: '发音',
  coherence: '连贯',
  register: '语域',
  task: '任务',
}

export function GradeReport({ result }: { result: GradeResult }) {
  return (
    <div className="grade-report">
      <div className="grade-hero">
        <div>
          <div className="grade-band">{result.bandLabel}</div>
          <div className="grade-sub">
            <Pill tone={result.source === 'llm' ? 'accent' : 'warn'}>
              {result.source === 'llm' ? '模型评分' : '本地粗估'}
            </Pill>
            <Pill tone={result.confidence === 'low' ? 'warn' : 'neutral'}>{confidenceLabel(result.confidence)}</Pill>
          </div>
        </div>
        <div className="grade-metrics">
          <span>
            <b>{result.metrics.words}</b> 词
          </span>
          <span>
            <b>{result.metrics.sentences}</b> 句
          </span>
          <span>
            <b>{result.metrics.avgSentenceLen}</b> 平均句长
          </span>
          {result.metrics.wpm ? (
            <span>
              <b>{result.metrics.wpm}</b> 词/分
            </span>
          ) : null}
          <span>
            <b>{result.metrics.fillerCount}</b> 填充词
          </span>
        </div>
      </div>

      {result.summary ? <p className="grade-summary">{result.summary}</p> : null}

      <div className="score-list">
        {result.dimensions.map((dimension) => (
          <ScoreBar
            key={dimension.key}
            label={`${dimension.labelZh} · ${dimension.label}`}
            score={dimension.score}
            band={dimension.band}
            comment={dimension.comment}
            evidence={dimension.evidence}
          />
        ))}
      </div>

      <div className="two-col">
        <div className="note-block">
          <h4>做得好的</h4>
          <ul>
            {result.strengths.length ? result.strengths.map((item, index) => <li key={index}>{item}</li>) : <li>继续保持输出。</li>}
          </ul>
        </div>
        <div className="note-block">
          <h4>下一步改进</h4>
          <ul>
            {result.improvements.length ? (
              result.improvements.map((item, index) => <li key={index}>{item}</li>)
            ) : (
              <li>再练一轮，尝试更长的回答。</li>
            )}
          </ul>
        </div>
      </div>

      <div className="corrections">
        <h4>逐句纠错（{result.corrections.length}）</h4>
        {result.corrections.length ? (
          <ul>
            {result.corrections.map((correction, index) => (
              <li key={index} className={`correction severity-${correction.severity}`}>
                <div className="correction-top">
                  <Pill tone="neutral">{CATEGORY_LABEL[correction.category] ?? correction.category}</Pill>
                  <span className={`severity severity-${correction.severity}`}>
                    {correction.severity === 3 ? '重点' : correction.severity === 2 ? '中等' : '轻微'}
                  </span>
                </div>
                <p className="correction-line">
                  <del>{correction.original}</del>
                  <span aria-hidden="true">→</span>
                  <ins>{correction.suggestion}</ins>
                </p>
                {correction.explanation ? <p className="correction-note">{correction.explanation}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">没有检测到需要纠正的句子。</p>
        )}
      </div>
    </div>
  )
}
