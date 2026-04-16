// Unified subtitle content gateway
// Always returns { success, content, source, format } — never directUrl
// Handles SubDL and OpenSubtitles internally with automatic failover

async function extractSrtFromZip(buffer) {
  const bytes = new Uint8Array(buffer)
  const files = []
  let i = 0
  while (i < bytes.length - 4) {
    if (bytes[i] === 0x50 && bytes[i+1] === 0x4B && bytes[i+2] === 0x03 && bytes[i+3] === 0x04) {
      const compression = bytes[i+8] | (bytes[i+9] << 8)
      const compressedSize = bytes[i+18] | (bytes[i+19] << 8) | (bytes[i+20] << 16) | (bytes[i+21] << 24)
      const filenameLen = bytes[i+26] | (bytes[i+27] << 8)
      const extraLen = bytes[i+28] | (bytes[i+29] << 8)
      const filename = new TextDecoder().decode(bytes.slice(i+30, i+30+filenameLen))
      const dataStart = i + 30 + filenameLen + extraLen
      const dataEnd = dataStart + compressedSize
      files.push({ filename, compression, dataStart, dataEnd, bytes })
      i = dataEnd
    } else { i++ }
  }
  const srtFile = files.find(f => f.filename.toLowerCase().endsWith('.srt'))
  if (!srtFile) throw new Error('No SRT file found in ZIP')

  const fileData = bytes.slice(srtFile.dataStart, srtFile.dataEnd)
  if (srtFile.compression === 0) {
    return new TextDecoder('utf-8').decode(fileData)
  } else if (srtFile.compression === 8) {
    const ds = new DecompressionStream('deflate-raw')
    const writer = ds.writable.getWriter()
    const reader = ds.readable.getReader()
    writer.write(fileData)
    writer.close()
    const chunks = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const total = chunks.reduce((acc, c) => acc + c.length, 0)
    const result = new Uint8Array(total)
    let offset = 0
    for (const c of chunks) { result.set(c, offset); offset += c.length }
    return new TextDecoder('utf-8').decode(result)
  }
  throw new Error('Unsupported ZIP compression method')
}

async function fetchSubDL(url) {
  const downloadUrl = url.startsWith('http') ? url : `https://dl.subdl.com${url}`
  const resp = await fetch(downloadUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Referer': 'https://subdl.com/',
    }
  })
  if (!resp.ok) throw new Error(`SubDL CDN returned ${resp.status}`)
  const buffer = await resp.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4B
  if (isZip) return await extractSrtFromZip(buffer)
  return new TextDecoder('utf-8').decode(bytes)
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
  if (!dlData.link) throw new Error('No download link returned from OpenSubtitles')
  const srtResp = await fetch(dlData.link)
  if (!srtResp.ok) throw new Error(`SRT fetch from OpenSubtitles CDN failed: ${srtResp.status}`)
  return await srtResp.text()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { url, file_id } = req.body
  if (!url && !file_id) return res.status(400).json({ error: 'url or file_id required' })

  const OS_KEY = process.env.OPENSUBTITLES_API_KEY
  const errors = []

  // Path 1: OpenSubtitles (file_id provided)
  if (file_id && OS_KEY) {
    try {
      const content = await fetchOpenSubtitles(file_id, OS_KEY)
      return res.status(200).json({ success: true, content, source: 'opensubtitles', format: 'srt' })
    } catch (err) {
      errors.push(`OpenSubtitles: ${err.message}`)
      console.error('OpenSubtitles fetch error:', err.message)
    }
  }

  // Path 2: SubDL (url provided)
  if (url) {
    try {
      const content = await fetchSubDL(url)
      return res.status(200).json({ success: true, content, source: 'subdl', format: 'srt' })
    } catch (err) {
      errors.push(`SubDL: ${err.message}`)
      console.error('SubDL fetch error:', err.message)
    }
  }

  // All paths failed
  return res.status(500).json({
    success: false,
    error: `All subtitle download methods failed. ${errors.join(' | ')}`
  })
}
