// Parse SRT string into array of {index, start, end, text}
export function parseSrt(srtString) {
  const blocks = srtString.trim().replace(/\r\n/g, '\n').split(/\n\n+/)
  return blocks.map(block => {
    const lines = block.split('\n')
    const indexLine = lines[0]?.trim()
    const timeLine = lines[1]?.trim() || ''
    const text = lines.slice(2).join('\n').trim()
    const [start, end] = timeLine.includes('-->') ? timeLine.split(' --> ') : ['', '']
    return { index: parseInt(indexLine) || 0, start: start?.trim(), end: end?.trim(), text }
  }).filter(b => b.start && b.end && b.text)
}

// Rebuild SRT string from parsed blocks
export function buildSrt(blocks) {
  return blocks.map((b, i) => `${i + 1}\n${b.start} --> ${b.end}\n${b.text}`).join('\n\n') + '\n'
}

// Merge two parsed SRT arrays into dual-language SRT
export function mergeSrts(blocks1, blocks2) {
  // Map lang2 by start time for fast lookup
  const lang2Map = {}
  blocks2.forEach(b => { lang2Map[b.start] = b.text })

  const merged = blocks1.map(b => {
    const lang2Text = lang2Map[b.start]
    return {
      ...b,
      text: lang2Text ? `${b.text}\n${lang2Text}` : b.text
    }
  })
  return merged
}

// Download a string as a file
export function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Apply timing offset (ms) to all blocks — positive = delay, negative = advance
export function applyOffset(blocks, offsetMs) {
  if (!offsetMs) return blocks
  return blocks.map(b => ({
    ...b,
    start: shiftTimestamp(b.start, offsetMs),
    end: shiftTimestamp(b.end, offsetMs),
  }))
}

function shiftTimestamp(ts, offsetMs) {
  if (!ts) return ts
  // Parse HH:MM:SS,mmm
  const match = ts.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/)
  if (!match) return ts
  const [, h, m, s, ms] = match
  let totalMs = (parseInt(h) * 3600000) + (parseInt(m) * 60000) + (parseInt(s) * 1000) + parseInt(ms)
  totalMs = Math.max(0, totalMs + offsetMs)
  const newH = String(Math.floor(totalMs / 3600000)).padStart(2, '0')
  const newM = String(Math.floor((totalMs % 3600000) / 60000)).padStart(2, '0')
  const newS = String(Math.floor((totalMs % 60000) / 1000)).padStart(2, '0')
  const newMs = String(totalMs % 1000).padStart(3, '0')
  return `${newH}:${newM}:${newS},${newMs}`
}
