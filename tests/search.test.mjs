// Covers the title-merging in api/search.js.
//
// The point of this logic: SubDL knows a title by its own sd_id, OpenSubtitles and SubSource
// know it by IMDb/TMDb. A SubDL-only result carries just an sd_id, and that is exactly what
// used to starve OpenSubtitles at the listing step. Merging providers into one result with
// every ID is what makes all three usable.
import { mergeTitles } from '../api/search.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) } }

const subdl = { title: 'Inception', year: '2010', type: 'movie', imdb_id: null, tmdb_id: null, sd_id: 2922, provider: 'subdl' }
const os = { title: 'Inception', year: '2010', type: 'movie', imdb_id: 'tt1375666', tmdb_id: 27205, sd_id: null, provider: 'opensubtitles' }
const ss = { title: 'Inception', year: '2010', type: 'movie', imdb_id: 'tt1375666', tmdb_id: null, sd_id: null, provider: 'subsource' }

console.log('\n-- ID merging across providers --')
let r = mergeTitles([[subdl], [os], [ss]], 'Inception')
check('the same film collapses to one result', r.length === 1, `got ${r.length}`)
check('keeps the sd_id from SubDL', r[0].sd_id === 2922, String(r[0].sd_id))
check('gains the imdb_id from OpenSubtitles', r[0].imdb_id === 'tt1375666', String(r[0].imdb_id))
check('gains the tmdb_id from OpenSubtitles', r[0].tmdb_id === 27205, String(r[0].tmdb_id))
check('records all three providers', r[0].providers.length === 3, JSON.stringify(r[0].providers))

console.log('\n-- matching by IMDb even when titles are written differently --')
r = mergeTitles([
  [{ ...subdl, title: 'Inception.2010.BluRay', imdb_id: 'tt1375666' }],
  [{ ...os, title: 'Inception' }],
], 'Inception')
check('same imdb_id merges despite different title text', r.length === 1, `got ${r.length}`)

console.log('\n-- different films stay separate --')
r = mergeTitles([[subdl], [{ ...os, title: 'Interstellar', imdb_id: 'tt0816692', tmdb_id: 157336 }]], 'Inception')
check('two distinct films stay two results', r.length === 2, `got ${r.length}`)
check('the searched title is ranked first', r[0].title === 'Inception', r[0].title)

console.log('\n-- same title, different years, no shared ids --')
r = mergeTitles([
  [{ title: 'The Office', year: '2005', type: 'tv', imdb_id: null, tmdb_id: null, sd_id: 1, provider: 'subdl' }],
  [{ title: 'The Office', year: '2001', type: 'tv', imdb_id: null, tmdb_id: null, sd_id: null, provider: 'subsource' }],
], 'The Office')
check('different years are not merged', r.length === 2, `got ${r.length}`)

console.log('\n-- ranking --')
r = mergeTitles([[
  { title: 'Inception Reloaded', year: null, type: 'movie', imdb_id: 'tt9', tmdb_id: null, sd_id: null, provider: 'subdl' },
  { title: 'Inception', year: '2010', type: 'movie', imdb_id: 'tt1375666', tmdb_id: null, sd_id: null, provider: 'subdl' },
]], 'inception')
check('an exact title match outranks a partial one', r[0].title === 'Inception', r[0].title)
r = mergeTitles([[{ ...subdl, imdb_id: 'tt2', title: 'Alpha' }], [{ ...os, title: 'Alpha', imdb_id: 'tt2' }], [{ title: 'Beta', year: null, type: 'movie', imdb_id: 'tt3', tmdb_id: null, sd_id: null, provider: 'subdl' }]], 'zzz')
check('a title known to more providers ranks higher', r[0].title === 'Alpha', r[0].title)

console.log('\n-- output shape and limits --')
r = mergeTitles([[subdl], [os]], 'Inception')
check('every result has an id for React keys', r.every(x => x.id !== undefined && x.id !== null && x.id !== ''))
check('the internal provider field is gone', r.every(x => !('provider' in x)))
check('providers list is exposed', Array.isArray(r[0].providers))
const many = Array.from({ length: 40 }, (_, i) => ({ title: `Film ${i}`, year: '2000', type: 'movie', imdb_id: `tt${i}`, tmdb_id: null, sd_id: null, provider: 'subdl' }))
check('caps the list at 10', mergeTitles([many], 'Film').length === 10, String(mergeTitles([many], 'Film').length))
check('ids are unique across results', new Set(mergeTitles([many], 'Film').map(x => x.id)).size === 10)

console.log('\n-- bad provider data does not throw --')
check('empty input returns nothing', mergeTitles([], 'x').length === 0)
check('all providers empty returns nothing', mergeTitles([[], [], []], 'x').length === 0)
check('entries without a title are dropped', mergeTitles([[{ title: null, provider: 'subdl' }, subdl]], 'Inception').length === 1)
check('a missing year is tolerated', mergeTitles([[{ ...subdl, year: null }]], 'Inception').length === 1)
check('numeric imdb ids are tolerated', mergeTitles([[{ ...subdl, imdb_id: 1375666 }], [os]], 'Inception').length === 1)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
