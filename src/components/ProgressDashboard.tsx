'use client'

// ─── ProgressDashboard ─────────────────────────────────────────────────────────
//
// Shows streak, today's phrase count, a 30-day activity heatmap, and
// (when score data is available) a pronunciation score trend chart.

import { useEffect, useState } from 'react'
import { getProgress, getLast30Days } from '@/lib/progress'
import { useAppStore } from '@/store/useAppStore'
import type { ScoreRecord } from '@/store/useAppStore'
import { getWeakWords } from '@/lib/phonemeAnalysis'

interface DayCell {
  date: string
  count: number
}

function heatColor(count: number): string {
  if (count === 0) return 'bg-surface'
  if (count < 5)  return 'bg-success-light'
  if (count < 15) return 'bg-success/60'
  return 'bg-success'
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Score trend helpers ───────────────────────────────────────────────────────

const CHART_W = 240
const CHART_H = 48

function yVal(score: number): number {
  return CHART_H - (score / 100) * CHART_H
}

type WeekPoint = {
  label: string
  pronunciation: number | null
  accuracy: number | null
  fluency: number | null
  completeness: number | null
}

function getWeeklyData(history: ScoreRecord[]): WeekPoint[] {
  const now = new Date()
  return Array.from({ length: 8 }, (_, i) => {
    const weeksAgo = 7 - i  // i=0 → oldest, i=7 → current week
    const end = new Date(now)
    end.setDate(now.getDate() - weeksAgo * 7)
    end.setHours(23, 59, 59, 999)
    const start = new Date(end)
    start.setDate(end.getDate() - 6)
    start.setHours(0, 0, 0, 0)

    const records = history.filter((r) => {
      const d = new Date(r.timestamp)
      return d >= start && d <= end
    })

    const avg = (fn: (r: ScoreRecord) => number): number | null =>
      records.length ? Math.round(records.reduce((s, r) => s + fn(r), 0) / records.length) : null

    return {
      label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      pronunciation: avg((r) => r.pronunciation),
      accuracy: avg((r) => r.accuracy),
      fluency: avg((r) => r.fluency),
      completeness: avg((r) => r.completeness),
    }
  })
}

// Returns polyline point-strings for each contiguous non-null segment
function chartSegments(data: (number | null)[]): string[] {
  const xStep = CHART_W / (data.length - 1)
  const segments: string[] = []
  let current: string[] = []
  data.forEach((v, i) => {
    if (v !== null) {
      current.push(`${(i * xStep).toFixed(1)},${yVal(v).toFixed(1)}`)
    } else {
      if (current.length >= 2) segments.push(current.join(' '))
      current = []
    }
  })
  if (current.length >= 2) segments.push(current.join(' '))
  return segments
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProgressDashboard() {
  const [streak, setStreak] = useState(0)
  const [todayCount, setTodayCount] = useState(0)
  const [days, setDays] = useState<DayCell[]>([])

  useEffect(() => {
    const progress = getProgress()
    const _d = new Date()
    const todayStr = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`
    const todaySession = progress.sessions.find((s) => s.date === todayStr)

    setStreak(progress.streak)
    setTodayCount(todaySession?.phrasesCount ?? 0)
    setDays(getLast30Days())
  }, [])

  const totalPhrases = days.reduce((sum, d) => sum + d.count, 0)
  const activeDays = days.filter((d) => d.count > 0).length

  // ── Score trends from store ──
  const scoreHistory = useAppStore((s) => s.scoreHistory)

  const weeklyData = getWeeklyData(scoreHistory)
  const pronData = weeklyData.map((w) => w.pronunciation)
  const pronSegments = chartSegments(pronData)
  const xStep = CHART_W / (weeklyData.length - 1)

  // 30-day averages
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  const last30 = scoreHistory.filter((r) => new Date(r.timestamp) >= cutoff)
  const avg30 = {
    accuracy:     last30.length ? Math.round(last30.reduce((s, r) => s + r.accuracy, 0) / last30.length) : null,
    fluency:      last30.length ? Math.round(last30.reduce((s, r) => s + r.fluency, 0) / last30.length) : null,
    completeness: last30.length ? Math.round(last30.reduce((s, r) => s + r.completeness, 0) / last30.length) : null,
  }

  // ── Weak words (Task 7) ──
  const weakWords = getWeakWords(scoreHistory)

  return (
    <div className="bg-bg border border-border rounded-[12px] p-5 space-y-4">
      {/* ── Stats row ── */}
      <div className="flex items-center gap-6">
        <div className="text-center">
          <p className="text-2xl font-bold font-display text-text">
            {streak > 0 ? `${streak}` : '—'}
          </p>
          <p className="text-xs text-text-muted mt-0.5">day streak</p>
        </div>
        <div className="w-px h-8 bg-surface" />
        <div className="text-center">
          <p className="text-2xl font-bold font-display text-text">{todayCount}</p>
          <p className="text-xs text-text-muted mt-0.5">today</p>
        </div>
        <div className="w-px h-8 bg-surface" />
        <div className="text-center">
          <p className="text-2xl font-bold font-display text-text">{totalPhrases}</p>
          <p className="text-xs text-text-muted mt-0.5">last 30 days</p>
        </div>
        <div className="w-px h-8 bg-surface" />
        <div className="text-center">
          <p className="text-2xl font-bold font-display text-text">{activeDays}</p>
          <p className="text-xs text-text-muted mt-0.5">active days</p>
        </div>
      </div>

      {/* ── 30-day heatmap ── */}
      <div>
        <p className="text-xs text-text-muted mb-2">Last 30 days</p>
        <div className="flex gap-1 flex-wrap">
          {days.map((day) => (
            <div
              key={day.date}
              title={`${shortDate(day.date)}: ${day.count} phrase${day.count !== 1 ? 's' : ''}`}
              className={`w-6 h-6 rounded-sm ${heatColor(day.count)} cursor-default`}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          <span className="text-xs text-text-muted">Less</span>
          {['bg-surface', 'bg-success-light', 'bg-success/60', 'bg-success'].map((c) => (
            <div key={c} className={`w-3 h-3 rounded-sm ${c}`} />
          ))}
          <span className="text-xs text-text-muted">More</span>
        </div>
      </div>

      {/* ── Score trend (only when there's enough data) ── */}
      {scoreHistory.length >= 3 && (
        <div className="border-t border-border pt-4 space-y-3">
          <p className="text-xs text-text-muted">Score trend (8 weeks)</p>

          {/* SVG line chart — pronunciation score per week */}
          <div style={{ height: `${CHART_H}px` }} className="w-full">
            <svg
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              className="w-full h-full"
              preserveAspectRatio="none"
            >
              {/* Grid lines */}
              {[25, 50, 75].map((y) => (
                <line
                  key={y}
                  x1={0} y1={yVal(y)} x2={CHART_W} y2={yVal(y)}
                  stroke="#E5E7EB" strokeWidth="1"
                />
              ))}
              {/* Line segments */}
              {pronSegments.map((pts, i) => (
                <polyline
                  key={i}
                  points={pts}
                  fill="none"
                  stroke="#0EA5E9"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {/* Dots at each week that has data */}
              {pronData.map((v, i) =>
                v !== null ? (
                  <circle
                    key={i}
                    cx={(i * xStep).toFixed(1)}
                    cy={yVal(v).toFixed(1)}
                    r="2.5"
                    fill="#0EA5E9"
                  />
                ) : null
              )}
            </svg>
          </div>

          {/* X axis labels */}
          <div className="flex justify-between px-0.5">
            <span className="text-xs text-text-muted">{weeklyData[0].label}</span>
            <span className="text-xs text-text-muted font-medium">Pronunciation</span>
            <span className="text-xs text-text-muted">{weeklyData[7].label}</span>
          </div>

          {/* 30-day dimension averages */}
          <div className="grid grid-cols-3 gap-2 text-center">
            {([
              { label: 'Accuracy',   value: avg30.accuracy,     color: 'text-success' },
              { label: 'Fluency',    value: avg30.fluency,      color: 'text-warning' },
              { label: 'Complete',   value: avg30.completeness, color: 'text-primary' },
            ] as const).map(({ label, value, color }) => (
              <div key={label} className="bg-surface rounded-[8px] py-2">
                <p className={`text-base font-bold ${value !== null ? color : 'text-text-muted'}`}>
                  {value !== null ? value : '—'}
                </p>
                <p className="text-xs text-text-muted">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Weak spots (Task 7) ── */}
      {weakWords.length > 0 && (
        <div className="border-t border-border pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-muted">Weak spots</p>
            <p className="text-xs text-text-muted">{weakWords.length} word{weakWords.length !== 1 ? 's' : ''}</p>
          </div>

          <div className="space-y-2">
            {weakWords.map((w) => (
              <div key={w.word} className="flex items-center gap-3">
                {/* Word */}
                <span className="font-mono text-sm font-medium text-text w-24 shrink-0 truncate">
                  {w.word}
                </span>

                {/* Accuracy bar */}
                <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      w.avgAccuracy < 50 ? 'bg-error' : 'bg-warning'
                    }`}
                    style={{ width: `${w.avgAccuracy}%` }}
                  />
                </div>

                {/* Score */}
                <span className={`text-xs font-semibold w-7 text-right tabular-nums ${
                  w.avgAccuracy < 50 ? 'text-error' : 'text-warning'
                }`}>
                  {w.avgAccuracy}
                </span>

                {/* Trend */}
                <span
                  className={`text-xs w-4 text-center ${
                    w.trend === 'improving' ? 'text-success' :
                    w.trend === 'declining' ? 'text-error' :
                    'text-text-muted'
                  }`}
                  title={w.trend}
                >
                  {w.trend === 'improving' ? '↑' : w.trend === 'declining' ? '↓' : '→'}
                </span>

                {/* Attempts */}
                <span className="text-xs text-text-muted w-6 text-right tabular-nums">
                  {w.attempts}×
                </span>
              </div>
            ))}
          </div>

          <p className="text-xs text-text-muted">
            Words with accuracy below 75 · min 3 attempts · ↑ improving ↓ declining
          </p>
        </div>
      )}
    </div>
  )
}
