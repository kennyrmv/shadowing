'use client'

import { useState, useEffect } from 'react'

type Theme = 'light' | 'dark' | 'system'

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system')

  useEffect(() => {
    const saved = localStorage.getItem('shadowing-theme') as Theme | null
    if (saved) {
      setTheme(saved)
      applyTheme(saved)
    }
  }, [])

  function applyTheme(t: Theme) {
    if (t === 'system') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', t)
    }
  }

  function toggle() {
    const next: Theme = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system'
    setTheme(next)
    applyTheme(next)
    localStorage.setItem('shadowing-theme', next)
  }

  const icon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🌓'

  return (
    <button
      onClick={toggle}
      className="w-8 h-8 flex items-center justify-center rounded-full bg-surface hover:bg-border transition-colors text-sm"
      title={`Theme: ${theme}`}
    >
      {icon}
    </button>
  )
}
