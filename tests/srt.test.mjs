// Covers SRT parsing, the dual-language merge, and timing offsets.
// The merge is the part that used to be wrong: it paired line 1 with line 1 no matter what
// the timestamps said, which only holds when one track is a translation of the other.
import { parseSrt, buildSrt, mergeSrts, mergeSrtsDetailed, sameTimeline, applyOffset, tsToMs }
  from '../src/lib/srt.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) } }

const cue = (n, start, end, text) => `${n}\n${start} --> ${end}\n${text}`
const srtOf = (...cues) => cues.join('\n\n') + '\n'

console.log('\n-- parseSrt --')
const parsed = parseSrt(srtOf(
  cue(1, '00:00:01,000', '00:00:03,000', 'first'),
  cue(2, '00:00:04,000', '00:00:06,000', 'second line one\nsecond line two'),
  cue(3, '00:00:07,000', '00:00:09,000', '<i>italic</i>'),
))
check('parses every cue', parsed.length === 3, `got ${parsed.length}`)
check('keeps multi-line text', parsed[1].text === 'second line one\nsecond line two', JSON.stringify(parsed[1].text))
check('strips well-formed tags', parsed[2].text === 'italic', parsed[2].text)
check('handles CRLF line endings', parseSrt(srtOf(cue(1, '00:00:01,000', '00:00:02,000', 'x')).replace(/\n/g, '\r\n')).length === 1)
check('drops cues with no text', parseSrt(srtOf(cue(1, '00:00:01,000', '00:00:02,000', ''))).length === 0)
check('round-trips through buildSrt', parseSrt(buildSrt(parsed)).length === 3)
check('buildSrt renumbers from 1', buildSrt(parsed).startsWith('1\n'))

console.log('\n-- timestamps --')
check('tsToMs comma form', tsToMs('01:02:03,004') === 3723004, String(tsToMs('01:02:03,004')))
check('tsToMs dot form', tsToMs('01:02:03.004') === 3723004, String(tsToMs('01:02:03.004')))
check('tsToMs rejects junk', Number.isNaN(tsToMs('not a time')))

console.log('\n-- applyOffset --')
const shifted = applyOffset(parsed, 1500)
check('positive offset delays', shifted[0].start === '00:00:02,500', shifted[0].start)
check('negative offset advances', applyOffset(parsed, -500)[0].start === '00:00:00,500', applyOffset(parsed, -500)[0].start)
check('never goes below zero', applyOffset(parsed, -99999999)[0].start === '00:00:00,000', applyOffset(parsed, -99999999)[0].start)
check('zero offset returns the same array', applyOffset(parsed, 0) === parsed)

console.log('\n-- merge: same timeline (a translation of the same track) --')
const english = parseSrt(srtOf(
  cue(1, '00:00:01,000', '00:00:03,000', 'Hello'),
  cue(2, '00:00:05,000', '00:00:07,000', 'Goodbye'),
))
const translated = english.map(b => ({ ...b, text: 'TH ' + b.text }))
check('sameTimeline is true', sameTimeline(english, translated))
let r = mergeSrtsDetailed(english, translated)
check('uses index mode', r.mode === 'index', r.mode)
check('pairs line for line', r.blocks[0].text === 'Hello\nTH Hello', JSON.stringify(r.blocks[0].text))
check('cue count unchanged', r.blocks.length === 2, String(r.blocks.length))

console.log('\n-- merge: different timelines (two separate downloads) --')
// Second track is offset and has an extra cue that matches nothing in the first.
const other = parseSrt(srtOf(
  cue(1, '00:00:00,500', '00:00:02,500', 'ES Hello'),
  cue(2, '00:00:03,200', '00:00:03,900', 'ES extra line'),
  cue(3, '00:00:05,200', '00:00:07,100', 'ES Goodbye'),
))
check('sameTimeline is false', !sameTimeline(english, other))
r = mergeSrtsDetailed(english, other)
check('uses time mode', r.mode === 'time', r.mode)
check('Hello paired with ES Hello', r.blocks.find(b => b.text.startsWith('Hello'))?.text === 'Hello\nES Hello', JSON.stringify(r.blocks.find(b => b.text.startsWith('Hello'))?.text))
check('Goodbye paired with ES Goodbye', r.blocks.find(b => b.text.startsWith('Goodbye'))?.text === 'Goodbye\nES Goodbye')
check('the unmatched second-track cue is kept', r.blocks.some(b => b.text === 'ES extra line'))
check('reports how many matched', r.matched === 2, String(r.matched))
check('reports the unmatched count', r.unmatchedSecond === 1, String(r.unmatchedSecond))
check('output is ordered by start time', r.blocks.every((b, i) => i === 0 || tsToMs(b.start) >= tsToMs(r.blocks[i - 1].start)))

console.log('\n-- merge: barely-touching cues must not pair --')
// Track 2 ends 100ms after track 1 starts: contact, but not the same line of dialogue.
const grazing = parseSrt(srtOf(cue(1, '00:00:00,000', '00:00:01,100', 'ES unrelated')))
r = mergeSrtsDetailed(parseSrt(srtOf(cue(1, '00:00:01,000', '00:00:04,000', 'Hello'))), grazing)
check('grazing overlap is ignored', r.matched === 0, `matched ${r.matched}`)
check('the ignored cue is still kept', r.blocks.length === 2, `${r.blocks.length} cues`)

console.log('\n-- merge: same length but different times must not use index mode --')
const sameLenDifferentTimes = english.map(b => ({ ...b, start: '00:09:' + b.start.slice(6), end: '00:09:' + b.end.slice(6) }))
check('sameTimeline is false', !sameTimeline(english, sameLenDifferentTimes))
check('falls back to time mode', mergeSrtsDetailed(english, sameLenDifferentTimes).mode === 'time')

console.log('\n-- merge: edge cases --')
check('empty second track leaves the first intact', mergeSrts(english, []).every((b, i) => b.text === english[i].text))
// Nothing is thrown away: with no primary track the secondary lines survive on their own.
// (Unreachable from the UI, which requires both tracks, but silently losing lines would be worse.)
check('empty first track keeps the second track lines', mergeSrts([], english).length === english.length, String(mergeSrts([], english).length))
check('mergeSrts still returns plain blocks', Array.isArray(mergeSrts(english, translated)))
check('merged output has no leftover internal fields', !Object.keys(mergeSrtsDetailed(english, other).blocks[0]).includes('_ms'))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
