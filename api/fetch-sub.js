// fetch-sub.js — now just a URL resolver, no download proxy
// The actual download happens client-side in the browser to bypass CDN IP blocking
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { url } = req.body
  if (!url) return res.status(400).json({ error: 'url required' })

  // Return the direct download URL for the browser to fetch directly
  const downloadUrl = url.startsWith('http') ? url : `https://dl.subdl.com${url}`
  return res.status(200).json({ directUrl: downloadUrl })
}
