// Covers the alignment engine.
//
// The important case is 'drifting': two files for different cuts of the same film, where the
// gap between them changes as it runs. That is what Migs' Gangster/Cop/Devil pair does (about
// 19.6s apart at 7 minutes, about 8.3s apart at 103 minutes), and it is the case a single
// offset slider cannot fix.
import { analyzeAlignment, describeAlignment, makeTransform, isIdentityTransform, MATCH_TOLERANCE_MS } from '../src/lib/align.js'
import { msToTs, retimeBlocks, tsToMs } from '../src/lib/srt.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) } }

// A pseudo-random but repeatable dialogue track: cues at uneven gaps, like real speech.
function makeTrack(count, { seed = 7, startAt = 60000 } = {}) {
  let s = seed, t = startAt
  const rand = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
  const cues = []
  for (let i = 0; i < count; i++) {
    const dur = 1200 + Math.floor(rand() * 2200)
    cues.push({ index: i + 1, start: msToTs(t), end: msToTs(t + dur), text: `line ${i + 1}` })
    t += dur + 300 + Math.floor(rand() * 3500)
  }
  return cues
}

const shiftTrack = (cues, ms) => cues.map(c => ({ ...c, start: msToTs(tsToMs(c.start) + ms), end: msToTs(tsToMs(c.end) + ms) }))
const scaleTrack = (cues, k) => cues.map(c => ({ ...c, start: msToTs(tsToMs(c.start) * k), end: msToTs(tsToMs(c.end) * k) }))
// Gap shrinks linearly from `fromMs` to `toMs` across the track: models different cuts.
function driftTrack(cues, fromMs, toMs) {
  const first = tsToMs(cues[0].start), last = tsToMs(cues[cues.length - 1].start)
  const span = last - first || 1
  return cues.map(c => {
    const s = tsToMs(c.start)
    const gap = fromMs + (toMs - fromMs) * ((s - first) / span)
    return { ...c, start: msToTs(s + gap), end: msToTs(tsToMs(c.end) + gap) }
  })
}
// Drop some cues, as a real second-language file has a different line count.
const thin = (cues, keepEvery) => cues.filter((_, i) => i % keepEvery !== 0)

const primary = makeTrack(1322)

console.log('\n-- identical tracks --')
let a = analyzeAlignment(primary, primary)
check('verdict is aligned', a.verdict === 'aligned', a.verdict)
check('no shift needed', Math.abs(a.shift) < 50, String(a.shift))
check('transform is the identity', isIdentityTransform(a.transform))
check('match rate is high', a.matchRate > 0.95, a.matchRate.toFixed(2))
check('describe says nothing to correct', /same timing/i.test(describeAlignment(a).headline))

console.log('\n-- constant offset (the common case) --')
a = analyzeAlignment(primary, thin(shiftTrack(primary, 19500), 9))
check('verdict is shifted', a.verdict === 'shifted', a.verdict)
check('detects about 19.5s', Math.abs(a.gap.startMs - 19500) < 120, `${a.gap.startMs}ms`)
check('gap is steady across the film', a.gap.spreadMs < 200, `${a.gap.spreadMs}ms`)
check('match rate after alignment is high', a.matchRate > 0.9, a.matchRate.toFixed(2))
check('was bad before alignment', a.matchRateBefore < 0.25, a.matchRateBefore.toFixed(2))
check('describe mentions late', /late/i.test(describeAlignment(a).headline), describeAlignment(a).headline)

console.log('\n-- negative offset (second track runs early) --')
a = analyzeAlignment(primary, thin(shiftTrack(primary, -7250), 11))
check('verdict is shifted', a.verdict === 'shifted', a.verdict)
check('detects about -7.25s', Math.abs(a.gap.startMs + 7250) < 120, `${a.gap.startMs}ms`)
check('describe mentions early', /early/i.test(describeAlignment(a).headline), describeAlignment(a).headline)

console.log('\n-- frame-rate mismatch (23.976 vs 25) --')
a = analyzeAlignment(primary, thin(scaleTrack(primary, 23.976 / 25), 13))
check('verdict is stretched', a.verdict === 'stretched', `${a.verdict} scale=${a.scale}`)
check('scale is not 1', Math.abs(a.scale - 1) > 0.001, String(a.scale))
check('names the frame rates', /fps/.test(a.fpsLabel || ''), String(a.fpsLabel))
check('match rate after stretch is high', a.matchRate > 0.85, a.matchRate.toFixed(2))

console.log('\n-- drifting gap: models the Gangster/Cop/Devil pair --')
const drifted = thin(driftTrack(primary, 19600, 8300), 10)
a = analyzeAlignment(primary, drifted)
check('verdict is drifting', a.verdict === 'drifting', `${a.verdict} shift=${a.shift}`)
check('reports a drift range', !!a.drift, JSON.stringify(a.drift))
if (a.drift) {
  check('drift spread is several seconds', a.drift.spreadMs > 4000, `${a.drift.spreadMs}ms`)
  // These assert the gap a viewer feels, not the engine's internal shift: a correction may be
  // split between a rate change and a curve, and only the total is meaningful.
  check('gap at the start is near 19.6s', Math.abs(a.gap.startMs - 19600) < 1500, `${a.gap.startMs}ms`)
  check('gap at the end is near 8.3s', Math.abs(a.gap.endMs - 8300) < 1500, `${a.gap.endMs}ms`)
  check('reported drift matches the measured gap', a.drift.fromMs === a.gap.startMs && a.drift.toMs === a.gap.endMs)
}
check('alignment beats a single offset', a.matchRate > 0.8, a.matchRate.toFixed(2))
const singleOffsetOnly = analyzeAlignment(primary, drifted).matchRateBefore
check('was unusable before alignment', singleOffsetOnly < 0.2, singleOffsetOnly.toFixed(2))
check('describe warns about wandering', describeAlignment(a).tone === 'warn', describeAlignment(a).tone)

console.log('\n-- retiming actually fixes the drifted track --')
const fixed = retimeBlocks(drifted, a.transform)
const after = analyzeAlignment(primary, fixed)
check('retimed track now reads as aligned or near it', ['aligned', 'shifted'].includes(after.verdict), after.verdict)
check('residual shift is small', Math.abs(after.shift) < 400, `${after.shift}ms`)
check('retimed cues keep their duration', (() => {
  const before = tsToMs(drifted[5].end) - tsToMs(drifted[5].start)
  const now = tsToMs(fixed[5].end) - tsToMs(fixed[5].start)
  return Math.abs(before - now) < 40
})())
check('retimed cues stay in order', fixed.every((c, i) => i === 0 || tsToMs(c.start) >= tsToMs(fixed[i - 1].start)))

console.log('\n-- unrelated tracks must be refused, not merged --')
a = analyzeAlignment(primary, makeTrack(1100, { seed: 99991, startAt: 45000 }))
check('verdict is incompatible', a.verdict === 'incompatible', `${a.verdict} rate=${a.matchRate.toFixed(2)}`)
check('describe tone is bad', describeAlignment(a).tone === 'bad')
check('describe tells the user what to do instead', /translate/i.test(describeAlignment(a).detail))

console.log('\n-- guards --')
check('too few cues returns unknown', analyzeAlignment(primary.slice(0, 4), primary.slice(0, 4)).verdict === 'unknown')
check('empty input returns unknown', analyzeAlignment([], []).verdict === 'unknown')
check('missing input does not throw', analyzeAlignment(primary, null).verdict === 'unknown')
check('identity transform detected', isIdentityTransform(makeTransform()))
check('shift transform is not identity', !isIdentityTransform(makeTransform({ shift: 500 })))
check('transform never returns a negative time', makeTransform({ shift: 999999 })(1000) === 0)
check('tolerance is exported', MATCH_TOLERANCE_MS > 0)

console.log('\n-- performance on a feature-length pair --')
const t0 = Date.now()
analyzeAlignment(primary, thin(driftTrack(primary, 19600, 8300), 10))
const ms = Date.now() - t0
check(`completes quickly (${ms}ms, budget 2500ms)`, ms < 2500, `${ms}ms`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
