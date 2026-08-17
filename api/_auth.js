// Shared gate for the API routes.
//
// Before this existed the password prompt was a curtain in front of the page only: every
// /api route answered anyone who called it directly, and the repo is public. Now
// /api/check-password hands out a signed cookie and the data routes require it.
//
// The cookie holds an expiry plus an HMAC of that expiry keyed by SITE_PASSWORD, so no
// server-side session store is needed and changing SITE_PASSWORD invalidates every
// outstanding cookie. Files in api/ that start with an underscore are not routed by Vercel.

import crypto from 'node:crypto'

const COOKIE_NAME = 'ssh_auth'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('base64url')
}

// Constant-time string compare that does not leak length through an early return.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8')
  const bb = Buffer.from(String(b), 'utf8')
  const len = Math.max(ba.length, bb.length, 1)
  const pa = Buffer.alloc(len)
  const pb = Buffer.alloc(len)
  ba.copy(pa)
  bb.copy(pb)
  return crypto.timingSafeEqual(pa, pb) && ba.length === bb.length
}

export function passwordMatches(candidate) {
  const secret = process.env.SITE_PASSWORD
  if (!secret || typeof candidate !== 'string' || !candidate) return false
  return safeEqual(candidate, secret)
}

function parseCookies(header = '') {
  const out = {}
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    if (!k) continue
    out[k] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

export function makeToken(now = Date.now()) {
  const secret = process.env.SITE_PASSWORD
  if (!secret) return null
  const exp = Math.floor(now / 1000) + MAX_AGE_SECONDS
  return `${exp}.${sign(exp, secret)}`
}

export function tokenIsValid(token, now = Date.now()) {
  const secret = process.env.SITE_PASSWORD
  if (!secret || typeof token !== 'string') return false
  const dot = token.indexOf('.')
  if (dot < 1) return false
  const exp = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!/^\d{1,15}$/.test(exp)) return false
  if (Number(exp) * 1000 <= now) return false
  return safeEqual(sig, sign(exp, secret))
}

// No SITE_PASSWORD means no valid token can exist, so the routes stay closed rather than
// falling open if the env var goes missing.
export function isAuthorized(req) {
  const cookies = parseCookies(req.headers?.cookie)
  return tokenIsValid(cookies[COOKIE_NAME])
}

export function setAuthCookie(res) {
  const token = makeToken()
  if (!token) return false
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_SECONDS}`,
  ].join('; '))
  return true
}

export function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`)
}

// Wrap a route handler so it only runs for unlocked visitors.
export function requireAuth(handler) {
  return async function guarded(req, res) {
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: 'Locked. Enter the site password first.' })
    }
    return handler(req, res)
  }
}
