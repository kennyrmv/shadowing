'use client'

// ─── PushNotificationToggle ───────────────────────────────────────────────────
//
// Requests push notification permission and registers the service worker
// subscription with /api/push/subscribe.
//
// Shows a simple toggle: Off → enable → permission prompt → subscribed.
// On click when subscribed: unsubscribes and removes from server.

import { useState, useEffect } from 'react'

type Status = 'unsupported' | 'denied' | 'idle' | 'subscribed' | 'loading' | 'error'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

export default function PushNotificationToggle() {
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported')
      return
    }
    if (Notification.permission === 'denied') {
      setStatus('denied')
      return
    }
    // Check if already subscribed
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setStatus(sub ? 'subscribed' : 'idle')
      })
    })
  }, [])

  async function handleToggle() {
    if (status === 'subscribed') {
      // Unsubscribe
      setStatus('loading')
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await fetch('/api/push/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          })
          await sub.unsubscribe()
        }
        setStatus('idle')
      } catch {
        setStatus('subscribed') // revert on error
      }
      return
    }

    // Subscribe
    setStatus('loading')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'idle')
        return
      }

      // Fetch VAPID public key from server at runtime (avoids build-time env var issues)
      const configRes = await fetch('/api/push/config')
      if (!configRes.ok) throw new Error('Failed to fetch VAPID config')
      const { vapidPublicKey } = await configRes.json()
      if (!vapidPublicKey) throw new Error('VAPID public key not configured on server')

      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as ArrayBuffer,
      })

      const subJSON = sub.toJSON() as {
        endpoint: string
        keys: { auth: string; p256dh: string }
      }

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subJSON),
      })

      setStatus('subscribed')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[push] Subscribe failed:', err)
      setErrorMsg(msg)
      setStatus('error')
    }
  }

  if (status === 'unsupported') return null

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleToggle}
        disabled={status === 'loading' || status === 'denied'}
        className={`
          flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors
          ${status === 'subscribed'
            ? 'bg-primary text-white'
            : status === 'denied' || status === 'error'
              ? 'bg-surface text-text-muted cursor-not-allowed'
              : 'bg-surface text-text-secondary hover:bg-gray-200'
          }
        `}
        title={status === 'denied' ? 'Notifications blocked in browser settings' : undefined}
      >
        <span>{status === 'subscribed' ? '🔔' : '🔕'}</span>
        <span>
          {status === 'subscribed' ? 'Notificaciones activas' :
           status === 'denied' ? 'Bloqueadas' :
           status === 'loading' ? '...' :
           status === 'error' ? 'Error' :
           'Activar recordatorio'}
        </span>
      </button>
      {status === 'error' && errorMsg && (
        <span className="text-[10px] text-error max-w-[200px] text-right leading-tight">{errorMsg}</span>
      )}
    </div>
  )
}
