// Aligning one subtitle track to another.
//
// Two subtitle files for the same film are usually timed against different video releases.
// Before this existed, the app assumed they shared a clock, which produced dual files where
// nearly every line had a partner and almost none of them were the right partner.
//
// Alignment happens on cue START times rather than on text, so it works for any pair of
// languages. Dialogue onsets are sharp events: at the correct shift, a large share of one
// track's starts land within a few hundred milliseconds of the other's. At a wrong shift they
// scatter. Three kinds of mismatch are handled, in increasing order of nastiness:
//
//   shifted    one constant offset (different intro length). The common case.
//   stretched  a frame-rate mismatch, e.g. 23.976 vs 25 fps, about 4%.
//   drifting   the gap changes through the film (different cuts). Needs per-segment offsets.
//
// When even the best transform leaves most cues unmatched the two files are simply different
// cuts, and the honest answer is to say so rather than hand over a broken merge.

import { tsToMs } from './srt.js'

export const MATCH_TOLERANCE_MS = 300

// Frame-rate pairs that actually occur in subtitle files, as scale factors.
const SCALE_CANDIDATES = [
  { scale: 1, label: null },
  { scale: 25 / 23.976, label: '23.976 to 25 fps' },
  { scale: 23.976 / 25, label: '25 to 23.976 fps' },
  { scale: 25 / 24, label: '24 to 25 fps' },
  { scale: 24 / 25, label: '25 to 24 fps' },
  { scale: 24 / 23.976, label: '23.976 to 24 fps' },
  { scale: 23.976 / 24, label: '24 to 23.976 fps' },
]

// Wide enough for a frame-rate mismatch, which is ~4% and so drifts about four minutes across
// a feature-length film. A window that only covered a plausible start offset missed those.
const SEARCH_RANGE_MS = 400000
const CUES_PER_CHUNK = 30      // enough cues for a chunk's own shift to be unambiguous
const MIN_CHUNKS = 4
const MAX_CHUNKS = 16
const CHUNK_AGREEMENT_MS = 1200 // a chunk this close to the fitted line is counted as agreeing

// Cues arrive with string timestamps ("00:01:22,133") from parseSrt, or already in
// milliseconds when a caller has converted them.
function startMsOf(cue) {
  if (typeof cue.startMs === 'number') return cue.startMs
  return typeof cue.start === 'number' ? cue.start : tsToMs(cue.start)
}

function sortedStarts(cues) {
  return (cues || []).map(startMsOf).filter(n => Number.isFinite(n)).sort((a, b) => a - b)
}

// Distance from `value` to the nearest entry of a sorted array.
function nearestDistance(sorted, value) {
  if (!sorted.length) return Infinity
  let lo = 0, hi = sorted.length - 1
  if (value <= sorted[0]) return sorted[0] - value
  if (value >= sorted[hi]) return value - sorted[hi]
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] === value) return 0
    if (sorted[mid] < value) lo = mid + 1
    else hi = mid - 1
  }
  const above = sorted[lo] !== undefined ? sorted[lo] - value : Infinity
  const below = sorted[hi] !== undefined ? value - sorted[hi] : Infinity
  return Math.min(above, below)
}

// How many of `starts` land near a reference start once shifted, and how tight those hits are.
function scoreShift(refSorted, starts, shift, tolerance = MATCH_TOLERANCE_MS) {
  let hits = 0, residual = 0
  for (const s of starts) {
    const d = nearestDistance(refSorted, s - shift)
    if (d <= tolerance) { hits++; residual += d }
  }
  return { hits, meanResidual: hits ? residual / hits : Infinity }
}

// Coarse sweep then a fine sweep around the winner. Returns an ABSOLUTE shift: the window is
// `center` +/- `range`, never a delta to add on.
//
// The coarse pass counts a hit generously, because at the real tolerance the score is a spike
// only a few hundred milliseconds wide and a cheap sweep would step straight over it. The
// loose pass finds the neighbourhood; the fine pass finds the value.
function bestShift(refSorted, starts, {
  center = 0, range = SEARCH_RANGE_MS, coarseStep = 500, coarseTolerance = 1500,
  fineStep = 20, tolerance = MATCH_TOLERANCE_MS,
} = {}) {
  let coarseBest = { shift: center, hits: -1 }
  for (let shift = center - range; shift <= center + range; shift += coarseStep) {
    const s = scoreShift(refSorted, starts, shift, coarseTolerance)
    if (s.hits > coarseBest.hits) coarseBest = { shift, hits: s.hits }
  }

  let best = { shift: coarseBest.shift, hits: -1, meanResidual: Infinity }
  const window = coarseStep + coarseTolerance
  for (let shift = coarseBest.shift - window; shift <= coarseBest.shift + window; shift += fineStep) {
    const s = scoreShift(refSorted, starts, shift, tolerance)
    if (s.hits > best.hits || (s.hits === best.hits && s.meanResidual < best.meanResidual)) {
      best = { shift, hits: s.hits, meanResidual: s.meanResidual }
    }
  }
  return best
}

// Split the secondary track into contiguous chunks of cues and find each chunk's own best
// shift, searching the whole plausible range every time.
//
// Deliberately independent: an earlier version found one global shift first and then let each
// segment wander a little either side of it, which failed badly whenever the global estimate
// was itself junk. It is junk exactly when the tracks drift, since then no single shift fits
// the whole film. Per-chunk searches have no such dependency, and a chunk of 30 cues has an
// unmistakable peak: at the right shift almost every cue lands, at a wrong one almost none do.
function chunkShifts(refSorted, secStarts) {
  const count = Math.max(MIN_CHUNKS, Math.min(MAX_CHUNKS, Math.round(secStarts.length / CUES_PER_CHUNK)))
  if (secStarts.length < MIN_CHUNKS * 8) return []
  const size = Math.ceil(secStarts.length / count)
  const chunks = []
  for (let i = 0; i < secStarts.length; i += size) {
    const group = secStarts.slice(i, i + size)
    if (group.length < 6) break
    const r = bestShift(refSorted, group, { range: SEARCH_RANGE_MS })
    chunks.push({
      at: group[Math.floor(group.length / 2)],
      shift: r.shift,
      hits: r.hits,
      size: group.length,
      rate: r.hits / group.length,
    })
  }
  return chunks
}

// Median-of-pairwise-slopes line fit (Theil-Sen). Resists chunks that locked onto a wrong
// peak, which a least-squares fit would let drag the whole line off.
function robustFit(points) {
  if (points.length < 2) return null
  const slopes = []
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dt = points[j].at - points[i].at
      if (Math.abs(dt) < 1000) continue
      slopes.push((points[j].shift - points[i].shift) / dt)
    }
  }
  if (!slopes.length) return null
  slopes.sort((a, b) => a - b)
  const slope = slopes[Math.floor(slopes.length / 2)]
  const intercepts = points.map(p => p.shift - slope * p.at).sort((a, b) => a - b)
  return { slope, intercept: intercepts[Math.floor(intercepts.length / 2)] }
}

const median = arr => {
  if (!arr.length) return 0
  const s = arr.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function shiftAt(points, t) {
  if (!points || !points.length) return 0
  if (t <= points[0].at) return points[0].shift
  const last = points[points.length - 1]
  if (t >= last.at) return last.shift
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    if (t <= b.at) {
      const span = b.at - a.at
      const w = span > 0 ? (t - a.at) / span : 0
      return a.shift + (b.shift - a.shift) * w
    }
  }
  return last.shift
}

// The transform a caller applies to secondary cue times: stretch by `scale`, then subtract the
// shift that applies at that moment. A curve makes the shift vary through the film; without one
// it is constant. Curve points live in stretched time, which is the space they were fitted in.
//
// Both parts are needed. A rate mismatch of 4% changes the required shift by ten seconds inside
// a single chunk of cues, so no constant-per-chunk shift can absorb it; the stretch removes
// that, and the curve then handles whatever irregular drift is left.
export function makeTransform({ scale = 1, shift = 0, curve = null } = {}) {
  const fn = t => {
    const stretched = scale === 1 ? t : t * scale
    return Math.max(0, Math.round(stretched - (curve ? shiftAt(curve.points, stretched) : shift)))
  }
  fn.scale = scale
  fn.shift = shift
  fn.curve = curve
  return fn
}

/**
 * Work out how to align `secondary` onto `primary`.
 * Both are arrays of parsed cues with numeric start/end in ms (startMs/endMs or start/end).
 * Returns { verdict, transform, ...measurements }. The caller decides whether to apply it.
 */
export function analyzeAlignment(primary, secondary, { tolerance = MATCH_TOLERANCE_MS } = {}) {
  const refSorted = sortedStarts(primary)
  const secStarts = sortedStarts(secondary)

  const empty = {
    verdict: 'unknown', reason: 'not enough cues to compare',
    transform: makeTransform(), scale: 1, shift: 0, fpsLabel: null,
    matchRate: 0, matchRateBefore: 0, medianResidual: null, drift: null, applied: false,
  }
  if (refSorted.length < 10 || secStarts.length < 10) return empty

  const before = scoreShift(refSorted, secStarts, 0, tolerance)
  const rateBefore = before.hits / secStarts.length

  // Fit at one candidate rate: every chunk finds its own shift, then a robust line through
  // those shifts says whether they tell a consistent story. Chunks that disagree with the line
  // are outliers and get pulled onto it, so one confused chunk cannot bend the correction.
  const fitAtScale = scale => {
    const stretched = scale === 1 ? secStarts : secStarts.map(s => s * scale)
    const chunks = chunkShifts(refSorted, stretched)
    const trusted = chunks.filter(c => c.rate >= 0.35)
    const fit = robustFit(trusted.length >= 2 ? trusted : chunks)

    let points = []
    let agreeing = 0
    if (fit && chunks.length) {
      points = chunks.map(c => {
        const predicted = fit.intercept + fit.slope * c.at
        const agrees = c.rate >= 0.35 && Math.abs(c.shift - predicted) <= CHUNK_AGREEMENT_MS
        if (agrees) agreeing++
        return { at: c.at, shift: agrees ? c.shift : predicted, cues: c.size, agrees }
      })
    }

    // A single shift is the simplest answer, so it is tried too and preferred when it does as
    // well: fewer moving parts, and a plainer message for the reader.
    const flatShift = points.length ? median(points.map(p => p.shift)) : bestShift(refSorted, stretched).shift
    const rateOf = t => scoreShift(refSorted, secStarts.map(t), 0, tolerance).hits / secStarts.length
    const flat = makeTransform({ scale, shift: flatShift })
    const flatRate = rateOf(flat)

    const curve = points.length >= MIN_CHUNKS ? { points, chunks: chunks.length, agreeing } : null
    const curved = curve ? makeTransform({ scale, curve }) : null
    const curveRate = curved ? rateOf(curved) : 0

    const useCurve = !!curve && curveRate > flatRate + 0.03
    return {
      scale, chunks, agreeing,
      curve: useCurve ? curve : null,
      transform: useCurve ? curved : flat,
      shift: Math.round(flatShift),
      rate: useCurve ? curveRate : flatRate,
    }
  }

  // Same rate first. When that already explains the track the other six fits are skipped,
  // which is the common case and keeps this fast.
  let best = fitAtScale(1)
  if (best.rate < 0.8) {
    for (const cand of SCALE_CANDIDATES.slice(1)) {
      const r = fitAtScale(cand.scale)
      if (r.rate > best.rate + 0.02) best = r
    }
  }

  const transform = best.transform
  const usedCurve = best.curve
  const finalRate = best.rate
  const chunks = best.chunks
  const agreeing = best.agreeing
  const fpsMatch = SCALE_CANDIDATES.find(c => c.label && c.scale === best.scale)

  // Residual spread after alignment, measured from the primary side so it reflects what a
  // viewer sees: how far the nearest secondary cue sits from each primary cue.
  const movedSorted = secStarts.map(transform).sort((a, b) => a - b)
  const residuals = []
  let primaryMatched = 0
  for (const p of refSorted) {
    const d = nearestDistance(movedSorted, p)
    if (d <= tolerance) { primaryMatched++; residuals.push(d) }
  }
  residuals.sort((a, b) => a - b)
  const medianResidual = residuals.length ? residuals[Math.floor(residuals.length / 2)] : null
  const primaryMatchRate = refSorted.length ? primaryMatched / refSorted.length : 0

  // The gap a viewer actually experiences: how far each secondary cue had to move. This is
  // not the same as the internal shift, because a rate correction moves cues too, and it is
  // the only version of the number that means anything to the person reading the message.
  const gaps = secStarts.map(t => t - transform(t))
  const gap = {
    startMs: Math.round(gaps[0]),
    endMs: Math.round(gaps[gaps.length - 1]),
    spreadMs: Math.round(Math.max(...gaps) - Math.min(...gaps)),
  }

  let drift = null
  if (usedCurve) {
    drift = {
      fromMs: gap.startMs,
      toMs: gap.endMs,
      spreadMs: gap.spreadMs,
      segments: usedCurve.chunks,
      movedSegments: usedCurve.agreeing,
    }
  }

  // Verdicts, most benign first.
  let verdict, reason
  const nearIdentity = Math.abs(gap.startMs) <= 250 && gap.spreadMs <= 250
  if (finalRate < 0.45 || primaryMatchRate < 0.4) {
    verdict = 'incompatible'
    reason = 'these two files do not follow the same cut of the film'
  } else if (nearIdentity && rateBefore >= 0.75) {
    verdict = 'aligned'
    reason = 'both tracks already share the same timing'
  } else if (usedCurve && gap.spreadMs > 1500) {
    // Checked before the frame-rate case on purpose. Whenever an uneven correction was needed,
    // "the gap changes through the film" is something we measured, whereas a frame-rate label
    // would be a guess at the cause: a fitted rate can land on a known ratio by coincidence.
    verdict = 'drifting'
    reason = 'the gap between the tracks changes through the film'
  } else if (fpsMatch) {
    verdict = 'stretched'
    reason = `frame rate mismatch (${fpsMatch.label})`
  } else {
    verdict = 'shifted'
    reason = 'one track starts earlier than the other'
  }

  return {
    verdict,
    reason,
    transform,
    scale: best.scale,
    shift: best.shift,
    fpsLabel: fpsMatch ? fpsMatch.label : null,
    matchRate: finalRate,
    matchRateBefore: rateBefore,
    primaryMatchRate,
    medianResidual,
    gap,
    drift,
    chunkCount: chunks.length,
    agreeingChunks: agreeing,
    applied: false,
    secondaryCues: secStarts.length,
    primaryCues: refSorted.length,
  }
}

// True when a transform would leave every cue exactly where it is.
export function isIdentityTransform(t) {
  return !t || (t.scale === 1 && t.shift === 0 && !t.curve)
}

// Plain-language summary for the interface.
export function describeAlignment(a, { primaryLabel = 'first', secondaryLabel = 'second' } = {}) {
  if (!a || a.verdict === 'unknown') return { tone: 'neutral', headline: 'Not enough lines to check the timing.', detail: '' }
  const pct = Math.round(a.matchRate * 100)
  const secs = ms => `${(Math.abs(ms) / 1000).toFixed(1)}s`

  switch (a.verdict) {
    case 'aligned':
      return { tone: 'good', headline: 'Both tracks share the same timing.', detail: `${pct}% of lines line up. Nothing to correct.` }
    case 'shifted':
      return {
        tone: 'good',
        headline: `The ${secondaryLabel} track ran ${a.gap.startMs > 0 ? 'late' : 'early'} by ${secs(a.gap.startMs)}.`,
        detail: `Corrected automatically. ${pct}% of lines line up afterwards.`,
      }
    case 'stretched':
      return {
        tone: 'good',
        headline: `The tracks came from different frame rates (${a.fpsLabel}).`,
        detail: `Stretched to match, which closed a gap that grew to ${secs(a.gap.spreadMs)} by the end. ${pct}% of lines line up afterwards.`,
      }
    case 'drifting':
      return {
        tone: 'warn',
        headline: `The gap between the tracks changed through the film, from ${secs(a.gap.startMs)} to ${secs(a.gap.endMs)}.`,
        detail: `Corrected section by section across ${a.drift.segments} sections. ${pct}% of lines line up afterwards, so a few may still wander.`,
      }
    case 'incompatible':
    default:
      return {
        tone: 'bad',
        headline: 'These two subtitle files do not match the same version of the film.',
        detail: `Even at the best possible alignment only ${pct}% of lines line up. Merging them will pair the wrong lines. Pick a different release, or translate the ${primaryLabel} track instead.`,
      }
  }
}
