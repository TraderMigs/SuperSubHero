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

// milliseconds -> "HH:MM:SS,mmm". Negative times clamp to zero, as SRT has no before-zero.
export function msToTs(totalMs) {
  const ms = Math.max(0, Math.round(totalMs))
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0')
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`
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

// For two files with different cue grids, pair by time.
//
// Each secondary cue is assigned to the ONE primary cue it overlaps most, rather than to every
// primary cue it touches. The earlier version attached a cue to all of them, which repeated the
// same line onto consecutive cues (83 times in a real 1,322-line pair) and stacked four lines
// on screen at once. Secondary cues that match nothing are kept as their own cues, so no line
// is ever dropped.
function mergeByTime(blocks1, blocks2) {
  const primary = []
  let carried = 0
  blocks1.forEach((b, i) => {
    const s = tsToMs(b.start), e = tsToMs(b.end)
    const valid = !isNaN(s) && !isNaN(e)
    if (valid) carried = s
    primary.push({ b, i, s, e, valid, at: valid ? s : carried })
  })

  const second = blocks2
    .map(b => ({ b, s: tsToMs(b.start), e: tsToMs(b.end) }))
    .filter(x => !isNaN(x.s) && !isNaN(x.e))
    .sort((x, y) => x.s - y.s)

  // Primary cues sorted by start, so the search window can move forward monotonically.
  const byStart = primary.filter(p => p.valid).slice().sort((x, y) => x.s - y.s)
  const attached = new Map() // primary index -> secondary cues, in time order
  const orphans = []
  let lo = 0

  for (const c of second) {
    while (lo < byStart.length && byStart[lo].e < c.s) lo++
    let bestAt = -1, bestOverlap = 0
    for (let k = lo; k < byStart.length && byStart[k].s <= c.e; k++) {
      const p = byStart[k]
      const overlap = Math.min(p.e, c.e) - Math.max(p.s, c.s)
      if (overlap <= 0) continue
      const shorter = Math.max(1, Math.min(p.e - p.s, c.e - c.s))
      // Ignore grazing contact: require 300ms or 40% of the shorter cue.
      if (overlap < 300 && overlap / shorter < 0.4) continue
      if (overlap > bestOverlap) { bestOverlap = overlap; bestAt = p.i }
    }
    if (bestAt >= 0) {
      if (!attached.has(bestAt)) attached.set(bestAt, [])
      attached.get(bestAt).push(c)
    } else {
      orphans.push(c)
    }
  }

  const out = []
  let matched = 0
  for (const p of primary) {
    const mine = attached.get(p.i)
    if (mine && mine.length) {
      matched++
      const texts = []
      for (const c of mine) if (texts[texts.length - 1] !== c.b.text) texts.push(c.b.text)
      out.push({ ...p.b, text: `${p.b.text}\n${texts.join('\n')}`, _ms: p.at })
    } else {
      out.push({ ...p.b, _ms: p.at })
    }
  }
  for (const c of orphans) {
    out.push({ index: 0, start: c.b.start, end: c.b.end, text: c.b.text, _ms: c.s })
  }

  out.sort((x, y) => x._ms - y._ms)
  const blocks = out.map(({ _ms, ...rest }) => rest)
  return { blocks, matched, unmatchedSecond: orphans.length }
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
  const base = tsToMs(ts)
  if (Number.isNaN(base)) return ts
  return msToTs(base + offsetMs)
}

// Retime cues with an arbitrary function of milliseconds, keeping each cue's duration.
// Used to apply an alignment transform, which can stretch as well as shift.
export function retimeBlocks(blocks, transform) {
  if (typeof transform !== 'function') return blocks
  return blocks.map(b => {
    const start = tsToMs(b.start), end = tsToMs(b.end)
    if (Number.isNaN(start) || Number.isNaN(end)) return b
    const newStart = transform(start)
    const scale = transform.scale || 1
    return { ...b, start: msToTs(newStart), end: msToTs(newStart + Math.max(0, end - start) * scale) }
  })
}
