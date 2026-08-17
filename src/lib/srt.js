// Parse SRT string into array of {index, start, end, text}
export function parseSrt(srtString) {
  const blocks = srtString.trim().replace(/\r\n/g, '\n').split(/\n\n+/)
  return blocks.map(block => {
    const lines = block.split('\n')
    const indexLine = lines[0]?.trim()
    const timeLine = lines[1]?.trim() || ''
    const rawText = lines.slice(2).join('\n').trim()
    const text = rawText.replace(/<[^>]+>/g, '')
    const [start, end] = timeLine.includes('-->') ? timeLine.split(' --> ') : ['', '']
    return { index: parseInt(indexLine) || 0, start: start?.trim(), end: end?.trim(), text }
  }).filter(b => b.start && b.end && b.text)
}

// Rebuild SRT string from parsed blocks
export function buildSrt(blocks) {
  return blocks.map((b, i) => `${i + 1}\n${b.start} --> ${b.end}\n${b.text}`).join('\n\n') + '\n'
}

// "HH:MM:SS,mmm" (or with a dot) -> milliseconds. NaN when unparseable.
export function tsToMs(ts) {
  const m = (ts || '').match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/)
  if (!m) return NaN
  return (+m[1]) * 3600000 + (+m[2]) * 60000 + (+m[3]) * 1000 + parseInt(m[4].padEnd(3, '0'), 10)
}

// True when both tracks sit on the same cue grid, which is the case when one is a
// translation of the other (translated cues keep the original start/end).
export function sameTimeline(blocks1, blocks2) {
  if (!blocks1.length || blocks1.length !== blocks2.length) return false
  for (let i = 0; i < blocks1.length; i++) {
    if (blocks1[i].start !== blocks2[i].start || blocks1[i].end !== blocks2[i].end) return false
  }
  return true
}

function mergeByIndex(blocks1, blocks2) {
  return blocks1.map((b, i) => {
    const lang2Text = blocks2[i]?.text
    return { ...b, text: lang2Text ? `${b.text}\n${lang2Text}` : b.text }
  })
}

// For two files with different cue grids (two different uploads), pair by time instead:
// each track-1 cue takes the text of every track-2 cue that genuinely overlaps it.
// Track-2 cues that overlap nothing are kept as their own cues so no line is lost.
function mergeByTime(blocks1, blocks2) {
  const second = blocks2
    .map(b => ({ b, s: tsToMs(b.start), e: tsToMs(b.end) }))
    .filter(x => !isNaN(x.s) && !isNaN(x.e))
    .sort((x, y) => x.s - y.s)
  const used = new Array(second.length).fill(false)
  const out = []
  let lo = 0
  let matched = 0

  for (const b of blocks1) {
    const s = tsToMs(b.start), e = tsToMs(b.end)
    if (isNaN(s) || isNaN(e)) { out.push({ ...b, _ms: NaN }); continue }
    // No subtitle cue runs longer than a minute, so anything starting >60s earlier cannot overlap.
    while (lo < second.length && second[lo].s < s - 60000) lo++
    const texts = []
    for (let k = lo; k < second.length && second[k].s <= e; k++) {
      const c = second[k]
      const overlap = Math.min(e, c.e) - Math.max(s, c.s)
      if (overlap <= 0) continue
      const shorter = Math.max(1, Math.min(e - s, c.e - c.s))
      // Ignore grazing contact: require 300ms or 40% of the shorter cue.
      if (overlap < 300 && overlap / shorter < 0.4) continue
      if (texts[texts.length - 1] !== c.b.text) texts.push(c.b.text)
      used[k] = true
    }
    if (texts.length) matched++
    out.push({ ...b, text: texts.length ? `${b.text}\n${texts.join('\n')}` : b.text, _ms: s })
  }

  let unmatchedSecond = 0
  second.forEach((c, k) => {
    if (used[k]) return
    unmatchedSecond++
    out.push({ index: 0, start: c.b.start, end: c.b.end, text: c.b.text, _ms: c.s })
  })

  out.sort((x, y) => (isNaN(x._ms) ? 0 : x._ms) - (isNaN(y._ms) ? 0 : y._ms))
  const blocks = out.map(({ _ms, ...rest }) => rest)
  return { blocks, matched, unmatchedSecond }
}

// Merge two parsed SRT arrays into one dual-language track, plus a description of what happened.
export function mergeSrtsDetailed(blocks1, blocks2) {
  if (sameTimeline(blocks1, blocks2)) {
    return { blocks: mergeByIndex(blocks1, blocks2), mode: 'index', matched: blocks1.length, unmatchedSecond: 0 }
  }
  return { mode: 'time', ...mergeByTime(blocks1, blocks2) }
}

export function mergeSrts(blocks1, blocks2) {
  return mergeSrtsDetailed(blocks1, blocks2).blocks
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
