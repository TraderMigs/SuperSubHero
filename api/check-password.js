import { passwordMatches, setAuthCookie, isAuthorized, clearAuthCookie } from './_auth.js'

// POST { password } -> checks the site password and, on success, sets the signed cookie
//                      that the other API routes require.
// GET                -> reports whether the caller's cookie is still valid, so the page can
//                      re-lock itself instead of showing an app whose API calls all fail.
export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (isAuthorized(req)) return res.status(200).json({ success: true })
    return res.status(401).json({ success: false })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.SITE_PASSWORD) {
    console.error('SITE_PASSWORD is not set; refusing all logins.')
    return res.status(500).json({ success: false, error: 'Site password is not configured on the server.' })
  }

  const { password } = req.body || {}
  if (passwordMatches(password)) {
    setAuthCookie(res)
    return res.status(200).json({ success: true })
  }

  clearAuthCookie(res)
  return res.status(401).json({ success: false })
}
