// Covers keeping the film across a refresh.
//
// Two routes, and the whole point is that the better one is taken when it is available: a file
// handle costs nothing on disk, while copying the bytes of a two-hour film costs a second copy
// of it. Neither may ever break playing the film that is already open, so every failure here
// has to end in a shrug rather than a throw.

// A stand-in for IndexedDB. Small enough to reason about, faithful about the parts that matter:
// values come back by identity, deletes really delete, and a store can be made to fail.
function fakeIndexedDb() {
  const dbs = new Map()
  const api = {
    failOn: null, // key name whose put should throw, standing in for a full disk
    open(name) {
      const req = {}
      setTimeout(() => {
        if (!dbs.has(name)) {
          dbs.set(name, new Map())
          req.result = makeDb(name)
          if (req.onupgradeneeded) req.onupgradeneeded()
        } else {
          req.result = makeDb(name)
        }
        if (req.onsuccess) req.onsuccess()
      }, 0)
      return req
    },
    deleteDatabase(name) { dbs.delete(name) },
    _dbs: dbs,
  }
  function makeDb(name) {
    return {
      objectStoreNames: { contains: () => true },
      createObjectStore() {},
      close() {},
      transaction() {
        const tx = {}
        const ops = []
        setTimeout(() => {
          try {
            for (const op of ops) op()
            if (tx.oncomplete) tx.oncomplete()
          } catch (err) {
            tx.error = err
            if (tx.onerror) tx.onerror()
          }
        }, 0)
        return Object.assign(tx, {
          objectStore: () => ({
            put(value, key) {
              ops.push(() => {
                if (api.failOn === key) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' })
                dbs.get(name).set(key, value)
              })
            },
            get(key) {
              const req = {}
              ops.push(() => { req.result = dbs.get(name).get(key); if (req.onsuccess) req.onsuccess() })
              return req
            },
            delete(key) { ops.push(() => dbs.get(name).delete(key)) },
          }),
        })
      },
    }
  }
  return api
}

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) } }

globalThis.indexedDB = fakeIndexedDb()
globalThis.window = globalThis
const store = await import('../src/lib/videoStore.js')
const { rememberVideo, restoreVideo, grantVideo, forgetVideo, handlesSupported, MAX_INLINE_BYTES } = store

const fakeFile = (name = 'film.mkv', size = 1024) => ({ name, size, type: 'video/x-matroska' })
const fakeHandle = (perm = 'granted', file = fakeFile()) => ({
  name: file.name,
  asked: 0,
  async queryPermission() { return perm },
  async requestPermission() { this.asked++; return perm === 'prompt' ? 'granted' : perm },
  async getFile() { if (perm === 'gone') throw new Error('NotFoundError'); return file },
})

console.log('\n-- a handle is preferred over copying the film --')
globalThis.indexedDB = fakeIndexedDb()
let res = await rememberVideo(fakeFile('gangster.mkv', 2e9), fakeHandle())
check('a handle is what gets stored', res.stored === 'handle', JSON.stringify(res))
check('the name is kept alongside it', res.meta.name === 'gangster.mkv')
let back = await restoreVideo()
check('an already-granted handle comes back ready', back.status === 'ready', back.status)
check('with the film in hand', back.file && back.file.name === 'film.mkv')

console.log('\n-- a handle whose permission lapsed --')
globalThis.indexedDB = fakeIndexedDb()
await rememberVideo(fakeFile(), fakeHandle('prompt'))
back = await restoreVideo()
check('it asks rather than failing', back.status === 'needs-permission', back.status)
check('and hands back the handle to ask with', !!back.handle)
const granted = await grantVideo(back.handle)
check('one click gets the film', granted.status === 'ready', JSON.stringify(granted))
check('and the browser was actually asked', back.handle.asked === 1)

console.log('\n-- a handle the user says no to --')
let denied = await grantVideo(fakeHandle('denied'))
check('a refusal is reported, not thrown', denied.status === 'denied', JSON.stringify(denied))

console.log('\n-- a file that moved or was deleted --')
denied = await grantVideo(fakeHandle('gone'))
check('a missing file is reported, not thrown', denied.status === 'denied')
check('nothing to grant is not an error', (await grantVideo(null)).status === 'none')

console.log('\n-- no handle, so the bytes are copied instead --')
globalThis.indexedDB = fakeIndexedDb()
res = await rememberVideo(fakeFile('dropped.mp4', 50e6), null)
check('the file itself is stored', res.stored === 'file', JSON.stringify(res))
back = await restoreVideo()
check('and it comes straight back, no click', back.status === 'ready', back.status)
check('as the same file', back.file.name === 'dropped.mp4')

console.log('\n-- a film too big to be worth copying --')
globalThis.indexedDB = fakeIndexedDb()
res = await rememberVideo(fakeFile('epic.mkv', MAX_INLINE_BYTES + 1), null)
check('the copy is skipped', res.stored === 'none', JSON.stringify(res))
check('and it says why', /too large/.test(res.reason || ''))
check('so nothing is offered on the way back', (await restoreVideo()).status === 'none')

console.log('\n-- a full disk --')
globalThis.indexedDB = fakeIndexedDb()
globalThis.indexedDB.failOn = 'file'
res = await rememberVideo(fakeFile('big.mkv', 1e9), null)
check('a quota failure does not throw', res.stored === 'none', JSON.stringify(res))
check('and it says what went wrong', res.reason === 'QuotaExceededError', String(res.reason))
check('and nothing half-written is offered back', (await restoreVideo()).status === 'none')

console.log('\n-- switching from a copied file to a handle, and back --')
globalThis.indexedDB = fakeIndexedDb()
await rememberVideo(fakeFile('first.mp4', 1000), null)
await rememberVideo(fakeFile('second.mkv', 1000), fakeHandle('granted', fakeFile('second.mkv')))
back = await restoreVideo()
check('the handle wins and the old copy is gone', back.status === 'ready' && back.file.name === 'second.mkv', JSON.stringify(back.file))
await rememberVideo(fakeFile('third.mp4', 1000), null)
back = await restoreVideo()
check('and the stale handle does not come back later', back.status === 'ready' && back.file.name === 'third.mp4', JSON.stringify(back.file))

console.log('\n-- nothing stored --')
globalThis.indexedDB = fakeIndexedDb()
check('an empty store offers nothing', (await restoreVideo()).status === 'none')

console.log('\n-- removing the video --')
globalThis.indexedDB = fakeIndexedDb()
await rememberVideo(fakeFile('bye.mp4', 100), null)
await forgetVideo()
check('nothing survives Remove Video', (await restoreVideo()).status === 'none')

console.log('\n-- a browser with no IndexedDB at all --')
delete globalThis.indexedDB
check('remembering shrugs', (await rememberVideo(fakeFile(), null)).stored === 'none')
check('restoring shrugs', (await restoreVideo()).status === 'none')
check('forgetting shrugs', (await forgetVideo(), true))

console.log('\n-- which route is available --')
delete globalThis.showOpenFilePicker
check('no picker means no handles', handlesSupported() === false)
globalThis.showOpenFilePicker = () => {}
check('a picker means handles', handlesSupported() === true)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
