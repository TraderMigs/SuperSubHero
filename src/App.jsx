import React, { useState, useRef } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home.jsx'

const SESSION_KEY = 'ssh_unlocked'

function EyeIcon({ off }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="4" y1="4" x2="20" y2="20" />}
    </svg>
  )
}

export default function App() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(SESSION_KEY) === 'yes')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  // Swapping the input between password/text makes the browser reset the caret
  // to the start (Chrome does it after the click event finishes). If the field
  // is focused, remember the caret and put it back on the next frame.
  const toggleShowPassword = () => {
    const el = inputRef.current
    const focused = el && document.activeElement === el
    const caret = focused ? [el.selectionStart, el.selectionEnd] : null
    setShowPassword(s => !s)
    if (caret) {
      requestAnimationFrame(() => {
        if (inputRef.current) inputRef.current.setSelectionRange(caret[0], caret[1])
      })
    }
  }

  const handleSubmit = async () => {
    if (!password.trim()) return
    setLoading(true)
    setError('')
    try {
      const resp = await fetch('/api/check-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await resp.json()
      if (data.success) {
        sessionStorage.setItem(SESSION_KEY, 'yes')
        setUnlocked(true)
      } else {
        setError('Wrong password.')
      }
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!unlocked) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#0a0a0f',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Instrument Sans', sans-serif",
        gap: 20,
        padding: 24,
      }}>
        <img src="/logo.png" alt="SuperSubHero" style={{ height: 120, width: 'auto' }} />
        <div style={{ fontSize: 12, color: '#666680', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Private Access</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 320 }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <input
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              autoFocus
              style={{
                background: '#14141e',
                border: `1px solid ${error ? '#f1354a' : '#22222f'}`,
                borderRadius: 10,
                padding: '14px 48px 14px 18px',
                color: '#eeeef5',
                fontFamily: "'Instrument Sans', sans-serif",
                fontSize: 15,
                outline: 'none',
                width: '100%',
              }}
            />
            <button
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={toggleShowPassword}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                height: '100%',
                width: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'none',
                border: 'none',
                borderRadius: 10,
                color: showPassword ? '#eeeef5' : '#666680',
                cursor: 'pointer',
              }}
            >
              <EyeIcon off={showPassword} />
            </button>
          </div>
          {error && <div style={{ fontSize: 12, color: '#f1354a', textAlign: 'center' }}>{error}</div>}
          <button
            onClick={handleSubmit}
            disabled={loading || !password.trim()}
            style={{
              background: '#c8f135',
              color: '#0a0a0f',
              border: 'none',
              borderRadius: 10,
              padding: '14px',
              fontFamily: "'Syne', sans-serif",
              fontWeight: 700,
              fontSize: 15,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'all 0.2s',
            }}
          >
            {loading ? 'Checking...' : 'Enter'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  )
}
