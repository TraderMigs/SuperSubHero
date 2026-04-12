import React, { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home.jsx'

const SESSION_KEY = 'ssh_unlocked'

export default function App() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(SESSION_KEY) === 'yes')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
          <input
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            autoFocus
            style={{
              background: '#14141e',
              border: `1px solid ${error ? '#f1354a' : '#22222f'}`,
              borderRadius: 10,
              padding: '14px 18px',
              color: '#eeeef5',
              fontFamily: "'Instrument Sans', sans-serif",
              fontSize: 15,
              outline: 'none',
              width: '100%',
            }}
          />
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
