// Covers release-name parsing and the match badge.
// The names below are real ones taken from the app's own results for Inception and
// The Gangster, the Cop, the Devil, so the parser is checked against what it actually meets.
import { parseRelease, compareReleases, MATCH_COLORS } from '../src/lib/release.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) } }

console.log('\n-- real release names from the app --')
const cases = [
  ['Blu-ray.Remux.1080p.VC-1.DTS-HD.MA.5.1-HDRemuX_eng', { sourceFamily: 'BluRay', resolution: '1080p' }],
  ['Inception (2010) 720p BluRay x265 HEVC 366MB', { sourceFamily: 'BluRay', resolution: '720p', codec: 'x265' }],
  ['Inception.2010.1080p.10bit.BluRay.6CH.x265.HEVC-PSA', { sourceFamily: 'BluRay', resolution: '1080p', codec: 'x265', group: 'PSA' }],
  ['Inception.2010.720p.BluRay.x264-NeZu - OCR', { sourceFamily: 'BluRay', resolution: '720p', codec: 'x264' }],
  ['The Gangster The Cop The Devil (2019) 720p WEB-DL Ganool', { sourceFamily: 'WEB', sourceLabel: 'WEB-DL', resolution: '720p' }],
  ['The Gangster the Cop the Devil (2019) BluRay 720p x264 900MB Ganool.ws', { sourceFamily: 'BluRay', resolution: '720p', codec: 'x264' }],
  ['The Gangster, The Cop, The Devil (2019) 1080p WEB-DL H264 AAC-NonDRM', { sourceFamily: 'WEB', resolution: '1080p', codec: 'x264', group: 'NonDRM' }],
  ['The Gangster, The.Cop, The.Devil 2019 720p.HDRip.x264.MkvCage', { sourceFamily: 'HDRip', resolution: '720p', codec: 'x264' }],
  ['Inception (2010) DVDRip XviD-MAXSPEED [En]', { sourceFamily: 'DVD', sourceLabel: 'DVDRip', codec: 'XviD', group: 'MAXSPEED' }],
  ['Inception.2010.1080p.BluRay.x264.anoXmous', { sourceFamily: 'BluRay', resolution: '1080p', codec: 'x264' }],
]
for (const [name, want] of cases) {
  const got = parseRelease(name)
  for (const [key, value] of Object.entries(want)) {
    check(`${name.slice(0, 34)}... ${key}=${value}`, got[key] === value, `got ${got[key]}`)
  }
}

console.log('\n-- names with nothing useful in them --')
for (const bare of ['inception', 'The Gangster, the Cop, the Devil 2019', 'SubSource #2598327']) {
  const got = parseRelease(bare)
  check(`"${bare}" has no source`, got.sourceFamily === null, String(got.sourceFamily))
  check(`"${bare}" produces no false chips`, got.chips.every(c => !/blu|web|hdtv/i.test(c)), JSON.stringify(got.chips))
}
check('an empty name does not throw', parseRelease('').chips.length === 0)
check('a missing name does not throw', parseRelease().sourceFamily === null)

console.log('\n-- chips read in a sensible order --')
const chips = parseRelease('Inception.2010.1080p.BluRay.x265.HEVC-PSA').chips
check('source first', chips[0] === 'BluRay', JSON.stringify(chips))
check('then resolution', chips[1] === '1080p', JSON.stringify(chips))
check('then codec', chips[2] === 'x265', JSON.stringify(chips))
check('group shown with a dash', chips.includes('-PSA'), JSON.stringify(chips))
check('OCR is flagged', parseRelease('X.720p.BluRay-NeZu - OCR').flags.includes('OCR'))
check('hearing impaired is flagged', parseRelease('Movie 1080p WEB-DL SDH').flags.includes('Hearing impaired'))

console.log('\n-- the badge --')
const bluray1080 = 'Inception.2010.1080p.BluRay.x264-PSA'
check('same group is a match', compareReleases(bluray1080, 'Inception.2010.720p.BluRay.x265-PSA').level === 'match')
check('same source and resolution is a match', compareReleases(bluray1080, 'Other.2010.1080p.BluRay.x265-XYZ').level === 'match')
check('same source, different resolution is close', compareReleases(bluray1080, 'Other.2010.720p.BluRay.x264-XYZ').level === 'likely',
  compareReleases(bluray1080, 'Other.2010.720p.BluRay.x264-XYZ').level)
check('BluRay against WEB is close', compareReleases(bluray1080, 'Other.2010.1080p.WEB-DL.x264-XYZ').level === 'likely')
check('BluRay against HDTV differs', compareReleases(bluray1080, 'Other.2010.720p.HDTV.x264-XYZ').level === 'unlikely')
check('BluRay against DVDRip differs', compareReleases(bluray1080, 'Other.2010.DVDRip.XviD-XYZ').level === 'unlikely')
check('a CAM against BluRay is flagged bad', compareReleases(bluray1080, 'Other.2010.HDCAM.x264-XYZ').level === 'bad')
check('two CAMs are not flagged bad', compareReleases('A.HDCAM.x264-Q', 'B.CAM.x264-Z').level !== 'bad')
check('an unreadable name gives no opinion', compareReleases(bluray1080, 'inception').level === 'unsure')
check('nothing selected gives no opinion', compareReleases(null, bluray1080).level === 'unsure')
check('every badge has a reason', ['match', 'likely', 'unsure', 'unlikely', 'bad'].every(l => {
  const r = compareReleases(bluray1080, l === 'bad' ? 'X.CAM-Q' : l === 'unlikely' ? 'X.HDTV-Q' : l === 'unsure' ? 'x' : l === 'likely' ? 'X.720p.BluRay-Q' : bluray1080)
  return typeof r.reason === 'string' && r.reason.length > 8
}))
check('the real pair from the test file reads as likely or same cut', (() => {
  const r = compareReleases('The Gangster The Cop The Devil (2019) 720p WEB-DL Ganool', 'The Gangster the Cop the Devil (2019) BluRay 720p x264 900MB Ganool.ws')
  return r.level === 'likely' || r.level === 'match'
})(), JSON.stringify(compareReleases('The Gangster The Cop The Devil (2019) 720p WEB-DL Ganool', 'The Gangster the Cop the Devil (2019) BluRay 720p x264 900MB Ganool.ws')))

console.log('\n-- colours exist for every level --')
check('all five levels have colours', ['match', 'likely', 'unsure', 'unlikely', 'bad'].every(l => MATCH_COLORS[l] && MATCH_COLORS[l].bg))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
