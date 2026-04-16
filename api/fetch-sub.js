export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { url, file_id } = req.body
  if (!url && !file_id) return res.status(400).json({ error: 'url or file_id required' })

  // OpenSubtitles download — needs server-side API call to get temp download URL
  if (file_id) {
    const OS_KEY = process.env.OPENSUBTITLES_API_KEY
    if (!OS_KEY) return res.status(500).json({ error: 'OpenSubtitles API key not configured' })

    try {
      const dlResp = await fetch('https://api.opensubtitles.com/api/v1/download', {
        method: 'POST',
        headers: {
          'Api-Key': OS_KEY,
          'Content-Type': 'application/json',
          'User-Agent': 'SuperSubHero v2.0',
        },
        body: JSON.stringify({ file_id }),
      })

      if (!dlResp.ok) throw new Error(`OS download link failed: ${dlResp.status}`)
      const dlData = await dlResp.json()
      if (!dlData.link) throw new Error('No download link returned')

      // Fetch the actual SRT from the temp link
      const srtResp = await fetch(dlData.link)
      if (!srtResp.ok) throw new Error(`SRT fetch failed: ${srtResp.status}`)

      const content = await srtResp.text()
      return res.status(200).json({ content })
    } catch (err) {
      console.error('OS fetch error:', err)
      return res.status(500).json({ error: err.message })
    }
  }

  // SubDL direct URL — browser handles this client-side, just return the URL
  const downloadUrl = url.startsWith('http') ? url : `https://dl.subdl.com${url}`
  return res.status(200).json({ directUrl: downloadUrl })
}
