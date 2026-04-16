export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { url } = req.body
  if (!url) return res.status(400).json({ error: 'url required' })

  try {
    const downloadUrl = url.startsWith('http') ? url : `https://dl.subdl.com${url}`

    const SUBDL_KEY = process.env.SUBDL_API_KEY

    // Try with API key auth first, then fallback without
    let resp = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://subdl.com/',
        'Api-Key': SUBDL_KEY || '',
      }
    })

    // If still failing, try the download_link format with api_key param
    if (!resp.ok && SUBDL_KEY) {
      const urlWithKey = downloadUrl.includes('?')
        ? `${downloadUrl}&api_key=${SUBDL_KEY}`
        : `${downloadUrl}?api_key=${SUBDL_KEY}`
      resp = await fetch(urlWithKey, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://subdl.com/',
        }
      })
    }

    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`)

    const contentType = resp.headers.get('content-type') || ''
    const buffer = await resp.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    // Check if ZIP (PK header)
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4B

    if (isZip) {
      // Extract SRT from zip server-side using basic zip parsing
      const srtContent = await extractSrtFromZip(bytes)
      if (!srtContent) throw new Error('No SRT file found in ZIP')
      return res.status(200).json({ content: srtContent })
    }

    // Plain SRT
    const text = new TextDecoder('utf-8').decode(bytes)
    return res.status(200).json({ content: text })

  } catch (err) {
    console.error('Fetch sub error:', err)
    return res.status(500).json({ error: err.message })
  }
}

// Minimal ZIP extractor — finds first .srt file
async function extractSrtFromZip(bytes) {
  // Find all local file headers (PK\x03\x04)
  const files = []
  let i = 0
  while (i < bytes.length - 4) {
    if (bytes[i] === 0x50 && bytes[i+1] === 0x4B && bytes[i+2] === 0x03 && bytes[i+3] === 0x04) {
      const compression = bytes[i+8] | (bytes[i+9] << 8)
      const compressedSize = bytes[i+18] | (bytes[i+19] << 8) | (bytes[i+20] << 16) | (bytes[i+21] << 24)
      const filenameLen = bytes[i+26] | (bytes[i+27] << 8)
      const extraLen = bytes[i+28] | (bytes[i+29] << 8)
      const filenameBytes = bytes.slice(i+30, i+30+filenameLen)
      const filename = new TextDecoder().decode(filenameBytes)
      const dataStart = i + 30 + filenameLen + extraLen
      const dataEnd = dataStart + compressedSize
      files.push({ filename, compression, dataStart, dataEnd })
      i = dataEnd
    } else {
      i++
    }
  }

  // Find first .srt file
  const srtFile = files.find(f => f.filename.toLowerCase().endsWith('.srt'))
  if (!srtFile) return null

  const fileData = bytes.slice(srtFile.dataStart, srtFile.dataEnd)

  if (srtFile.compression === 0) {
    // Stored (no compression)
    return new TextDecoder('utf-8').decode(fileData)
  } else if (srtFile.compression === 8) {
    // Deflate
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

  return null
}
