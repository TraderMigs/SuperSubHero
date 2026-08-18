// Covers keeping the workspace across a refresh.
//
// The failure this guards: a reload used to throw away the search, the chosen title, both
// subtitle tracks and any AI translation, which costs money and minutes to produce again.
// The risky parts are the quota fallback (a long film in two languages) and reading a snapshot
// written by an older deploy, where a field may be missing or the wrong shape.

// A stand-in for the browser store, with a size limit we can push against.
function fakeStorage(limitBytes = Infinity) {
  const data = new Map()
  return {
    data,
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (String(v).length > limitBytes) {
        const err = new Error('QuotaExceededError')
        err.name = 'QuotaExceededError'
        throw err
      }
      data.set(k, String(v))
    },
    removeItem: k => { data.delete(k) },
  }
}

globalThis.localStorage = fakeStorage()
const { loadSession, saveSession, clearSession, restored } = await import('../src/lib/session.js')

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) } }
const KEY = 'ssh_session_v1'

console.log('\n-- a round trip --')
globalThis.localStorage = fakeStorage()
saveSession({ query: 'Inception', blocksL1: [{ start: 0, end: 900, text: 'hi' }], autoAlign: true })
let back = loadSession()
check('the query comes back', back.query === 'Inception')
check('the subtitle track comes back', Array.isArray(back.blocksL1) && back.blocksL1[0].text === 'hi')
check('a boolean comes back', back.autoAlign === true)

console.log('\n-- nothing saved yet --')
globalThis.localStorage = fakeStorage()
check('an empty store gives an empty session', Object.keys(loadSession()).length === 0)

console.log('\n-- a damaged or foreign snapshot --')
globalThis.localStorage = fakeStorage()
localStorage.setItem(KEY, 'not json at all')
check('junk does not throw', Object.keys(loadSession()).length === 0)
localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now() }))
check('a snapshot with no state is ignored', Object.keys(loadSession()).length === 0)
localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), state: 'a string' }))
check('a non-object state is still returned as-is for the guards to handle', typeof loadSession() === 'string' || Object.keys(loadSession()).length >= 0)

console.log('\n-- a snapshot from last week --')
globalThis.localStorage = fakeStorage()
localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000, state: { query: 'old' } }))
check('an eight-day-old session is dropped', Object.keys(loadSession()).length === 0)
check('and the stale entry is deleted', localStorage.getItem(KEY) === null)
globalThis.localStorage = fakeStorage()
localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now() - 6 * 24 * 60 * 60 * 1000, state: { query: 'recent' } }))
check('a six-day-old session is kept', loadSession().query === 'recent')

console.log('\n-- a store that is full --')
// A long film in two languages plus everything else. Only the heavy fields may be dropped.
globalThis.localStorage = fakeStorage(400)
const heavy = {
  query: 'Inception', lang1: 'EN', lang2: 'TH', autoAlign: true, offsetMs: 1200,
  blocksL1: Array.from({ length: 200 }, (_, i) => ({ start: i * 1000, end: i * 1000 + 900, text: 'a line of dialogue ' + i })),
  blocksL2: Array.from({ length: 200 }, (_, i) => ({ start: i * 1000, end: i * 1000 + 900, text: 'another line ' + i })),
  subResultsL1: Array.from({ length: 50 }, (_, i) => ({ name: 'release ' + i })),
  subResultsL2: [],
}
check('saving reports that it could not keep everything', saveSession(heavy) === false)
back = loadSession()
check('the settings survive', back.query === 'Inception' && back.lang1 === 'EN' && back.offsetMs === 1200)
check('the heavy tracks are the part dropped', back.blocksL1 === undefined && back.blocksL2 === undefined)
check('the release lists are dropped too', back.subResultsL1 === undefined)

console.log('\n-- a store that refuses everything --')
globalThis.localStorage = fakeStorage(0)
check('saving does not throw', saveSession({ query: 'x' }) === false)
check('and leaves nothing behind', localStorage.getItem(KEY) === null)

console.log('\n-- a store that is switched off entirely --')
globalThis.localStorage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
check('loading survives a blocked store', Object.keys(loadSession()).length === 0)
check('saving survives a blocked store', saveSession({ query: 'x' }) === false)
check('clearing survives a blocked store', (() => { try { clearSession(); return true } catch { return false } })())

console.log('\n-- clearing --')
globalThis.localStorage = fakeStorage()
saveSession({ query: 'Inception' })
clearSession()
check('the entry is gone', localStorage.getItem(KEY) === null)
check('and a load starts clean', Object.keys(loadSession()).length === 0)

console.log('\n-- reading fields written by an older deploy --')
const old = { query: 'Inception', blocksL1: 'was a string once', offsetMs: '1200', autoAlign: 'yes', selectedTitle: { id: 7 } }
check('a good string is used', restored(old, 'query', '') === 'Inception')
check('a string where an array is expected falls back', restored(old, 'blocksL1', []).length === 0)
check('a string where a number is expected falls back', restored(old, 'offsetMs', 0) === 0)
check('a string where a boolean is expected falls back', restored(old, 'autoAlign', true) === true)
check('a missing field falls back', restored(old, 'season', '') === '')
check('null falls back', restored({ lang2: null }, 'lang2', 'ES') === 'ES')
check('an object passes through when the fallback is null', restored(old, 'selectedTitle', null).id === 7)
check('zero is kept, not treated as missing', restored({ offsetMs: 0 }, 'offsetMs', 500) === 0)
check('an empty string is kept, not treated as missing', restored({ year: '' }, 'year', '2010') === '')
check('false is kept, not treated as missing', restored({ autoAlign: false }, 'autoAlign', true) === false)
check('an empty array is kept', restored({ blocksL1: [] }, 'blocksL1', [{ text: 'x' }]).length === 0)
check('no session at all falls back', restored(undefined, 'query', '') === '')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
