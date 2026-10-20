import type { GradeResult, SessionReport } from '../shared/types'

export function sessionReportToGrade(report: SessionReport): GradeResult {
  const overall = report.dimensions.length
    ? Math.round(report.dimensions.reduce((sum, dimension) => sum + dimension.score, 0) / report.dimensions.length)
    : 0
  return {
    dimensions: report.dimensions,
    overall,
    band: report.band ?? 0,
    bandLabel: report.bandLabel ?? '',
    confidence: report.confidence,
    summary: report.summary,
    strengths: report.strengths,
    improvements: report.improvements,
    corrections: report.corrections,
    metrics: report.metrics,
    source: report.source,
  }
}
