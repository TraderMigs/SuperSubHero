// Keeping the workspace across a page refresh.
//
// Reloading used to throw everything away: the search, the chosen title, both subtitle tracks
// and any AI translation, which costs real money and a couple of minutes to produce again.
//
// Subtitle tracks are the bulk of it, roughly 100KB per language for a feature, which sits
// comfortably inside the 5MB localStorage allowance. Writing is wrapped because a full or
// disabled store must never break the page, and reading is defensive because the shape can
// change between deploys.

const KEY = 'ssh_session_v1'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // a week later, it is not what you were working on

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.state) return {}
    if (typeof parsed.savedAt === 'number' && Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(KEY)
      return {}
    }
    return parsed.state
  } catch {
    return {}
  }
}

export function saveSession(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), state }))
    return true
  } catch (err) {
    // Almost always the quota: a very long film in two languages. Drop the heavy parts and keep
    // the rest, so a reload at least lands on the right title with the right settings.
    try {
      const { blocksL1, blocksL2, subResultsL1, subResultsL2, ...light } = state
      localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), state: light, trimmed: true }))
    } catch {
      try { localStorage.removeItem(KEY) } catch { /* nothing else to try */ }
    }
    return false
  }
}

export function clearSession() {
  try { localStorage.removeItem(KEY) } catch { /* nothing else to try */ }
}

// Read a value from a restored session, falling back when it is missing or the wrong shape.
export function restored(session, key, fallback) {
  const value = session?.[key]
  if (value === undefined || value === null) return fallback
  if (Array.isArray(fallback) && !Array.isArray(value)) return fallback
  if (typeof fallback === 'number' && typeof value !== 'number') return fallback
  if (typeof fallback === 'boolean' && typeof value !== 'boolean') return fallback
  if (typeof fallback === 'string' && typeof value !== 'string') return fallback
  return value
}
