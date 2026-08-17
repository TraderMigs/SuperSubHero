import JSZip from 'jszip'
import { requireAuth } from './_auth.js'

function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder('windows-1252').decode(bytes)
    } catch {
      return new TextDecoder().decode(bytes)
    }
  }
}

async function extractSrtFromZip(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const entries = Object.values(zip.files)
    .filter(file => !file.dir)
    .sort((a, b) => a.name.localeCompare(b.name))

  const preferred = entries.find(file => file.name.toLowerCase().endsWith('.srt'))
    || entries.find(file => file.name.toLowerCase().endsWith('.ass'))
    || entries.find(file => file.name.toLowerCase().endsWith('.vtt'))

  if (!preferred) {
    throw new Error('No supported subtitle file found inside archive')
  }

  const bytes = await preferred.async('uint8array')
  return {
    content: decodeText(bytes),
    format: preferred.name.split('.').pop().toLowerCase(),
  }
}

async function fetchSubDL(url) {
  const downloadUrl = url.startsWith('http') ? url : `https://dl.subdl.com${url}`
  const resp = await fetch(downloadUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Referer': 'https://subdl.com/',
      'Origin': 'https://subdl.com',
    },
  })

  if (!resp.ok) throw new Error(`SubDL CDN returned ${resp.status}`)

  const buffer = await resp.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const contentType = (resp.headers.get('content-type') || '').toLowerCase()
  const isZip = contentType.includes('zip') || (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B)

  if (isZip) {
    const extracted = await extractSrtFromZip(buffer)
    return { ...extracted, source: 'subdl' }
  }

  return {
    content: decodeText(bytes),
    format: contentType.includes('vtt') ? 'vtt' : contentType.includes('ass') ? 'ass' : 'srt',
    source: 'subdl',
  }
}

async function fetchOpenSubtitles(file_id, OS_KEY) {
  const dlResp = await fetch('https://api.opensubtitles.com/api/v1/download', {
    method: 'POST',
    headers: {
      'Api-Key': OS_KEY,
      'Content-Type': 'application/json',
      'User-Agent': 'SuperSubHero v2.0',
    },
    body: JSON.stringify({ file_id }),
  })

  if (!dlResp.ok) throw new Error(`OpenSubtitles download link failed: ${dlResp.status}`)

  const dlData = await dlResp.json()
  if (!dlData.link) throw new Error('OpenSubtitles did not return a download link')

  const srtResp = await fetch(dlData.link, {
    headers: { 'User-Agent': 'SuperSubHero v2.0', Accept: '*/*' },
  })

  if (!srtResp.ok) throw new Error(`OpenSubtitles CDN returned ${srtResp.status}`)

  const content = await srtResp.text()
  if (!content || !content.trim()) throw new Error('OpenSubtitles returned empty subtitle content')

  return { content, source: 'opensubtitles', format: 'srt' }
}

async function fetchSubSource(ss_id, SS_KEY) {
  // SubSource official API: GET /api/v1/subtitles/{subtitleId}/download returns the file (usually a zip).
  let dlResp = await fetch(
    `https://api.subsource.net/api/v1/subtitles/${encodeURIComponent(ss_id)}/download`,
    { headers: { 'X-API-Key': SS_KEY, Accept: '*/*' } }
  )

  if (!dlResp.ok) throw new Error(`SubSource download failed: ${dlResp.status}`)

  let buffer = await dlResp.arrayBuffer()
  let bytes = new Uint8Array(buffer)
  let contentType = (dlResp.headers.get('content-type') || '').toLowerCase()

  // If the endpoint answers with JSON, look for a link inside it and follow that.
  if (contentType.includes('json')) {
    let link = null
    try {
      const j = JSON.parse(new TextDecoder().decode(bytes))
      link = j?.data?.link || j?.data?.url || j?.data?.downloadUrl || j?.link || j?.url || j?.downloadUrl || null
    } catch { /* not JSON after all */ }
    if (!link) throw new Error('SubSource returned no downloadable file')
    dlResp = await fetch(link, { headers: { Accept: '*/*' } })
    if (!dlResp.ok) throw new Error(`SubSource file link returned ${dlResp.status}`)
    buffer = await dlResp.arrayBuffer()
    bytes = new Uint8Array(buffer)
    contentType = (dlResp.headers.get('content-type') || '').toLowerCase()
  }

  const isZip = contentType.includes('zip') || (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B)

  if (isZip) {
    const extracted = await extractSrtFromZip(buffer)
    return { ...extracted, source: 'subsource' }
  }

  return {
    content: decodeText(bytes),
    format: contentType.includes('vtt') ? 'vtt' : contentType.includes('ass') ? 'ass' : 'srt',
    source: 'subsource',
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { url, file_id, ss_id } = req.body || {}
  if (!url && !file_id && !ss_id) {
    return res.status(400).json({ success: false, error: 'url, file_id, or ss_id required' })
  }

  const OS_KEY = process.env.OPENSUBTITLES_API_KEY
  const SS_KEY = process.env.SUBSOURCE_API_KEY
  const errors = []

  // OpenSubtitles via file_id
  if (file_id && OS_KEY) {
    try {
      const data = await fetchOpenSubtitles(file_id, OS_KEY)
      return res.status(200).json({ success: true, ...data })
    } catch (err) {
      errors.push(`OpenSubtitles: ${err.message}`)
      console.error('OpenSubtitles fetch error:', err.message)
    }
  }

  // SubSource via ss_id
  if (ss_id && SS_KEY) {
    try {
      const data = await fetchSubSource(ss_id, SS_KEY)
      return res.status(200).json({ success: true, ...data })
    } catch (err) {
      errors.push(`SubSource: ${err.message}`)
      console.error('SubSource fetch error:', err.message)
    }
  }

  // SubDL via url
  if (url) {
    try {
      const data = await fetchSubDL(url)
      return res.status(200).json({ success: true, ...data })
    } catch (err) {
      errors.push(`SubDL: ${err.message}`)
      console.error('SubDL fetch error:', err.message)
    }
  }

  return res.status(500).json({
    success: false,
    error: errors.length
      ? `All subtitle download methods failed. ${errors.join(' | ')}`
      : 'All subtitle download methods failed.',
  })
}

export default requireAuth(handler)
