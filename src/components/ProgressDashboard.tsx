'use client'

// ─── ProgressDashboard ─────────────────────────────────────────────────────────
//
// Shows streak, today's phrase count, and a 30-day activity heatmap.
// Reads from localStorage via progress.ts — all client-side.

import { useEffect, useState } from 'react'
import { getProgress, getLast30Days } from '@/lib/progress'

interface DayCell {
  date: string
  count: number
}

function heatColor(count: number): string {
  if (count === 0) return 'bg-gray-100'
  if (count < 5)  return 'bg-green-200'
  if (count < 15) return 'bg-green-400'
  return 'bg-green-600'
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

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

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
      {/* ── Stats row ── */}
      <div className="flex items-center gap-6">
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900">
            {streak > 0 ? `${streak}` : '—'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">day streak</p>
        </div>
        <div className="w-px h-8 bg-gray-100" />
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900">{todayCount}</p>
          <p className="text-xs text-gray-400 mt-0.5">today</p>
        </div>
        <div className="w-px h-8 bg-gray-100" />
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900">{totalPhrases}</p>
          <p className="text-xs text-gray-400 mt-0.5">last 30 days</p>
        </div>
        <div className="w-px h-8 bg-gray-100" />
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900">{activeDays}</p>
          <p className="text-xs text-gray-400 mt-0.5">active days</p>
        </div>
      </div>

      {/* ── 30-day heatmap ── */}
      <div>
        <p className="text-xs text-gray-400 mb-2">Last 30 days</p>
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
          <span className="text-xs text-gray-300">Less</span>
          {['bg-gray-100', 'bg-green-200', 'bg-green-400', 'bg-green-600'].map((c) => (
            <div key={c} className={`w-3 h-3 rounded-sm ${c}`} />
          ))}
          <span className="text-xs text-gray-300">More</span>
        </div>
      </div>
    </div>
  )
}
