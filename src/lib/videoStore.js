// Keeping the film across a page refresh.
//
// The subtitles already survive a reload. The film did not, and picking a two-hour file out of
// a folder again is the most annoying part of losing a session.
//
// Two routes, best first:
//
//   1. A file handle. showOpenFilePicker returns a FileSystemFileHandle, and a handle survives
//      structured cloning into IndexedDB. After a reload the handle is still there, and one
//      click re-grants read access. Nothing is copied, so a 4GB film costs nothing on disk.
//      Measured in Chrome: the handle round-trips intact and still carries queryPermission.
//
//   2. The file itself. Where handles are unavailable (Firefox, Safari, or a file that arrived
//      by drag and drop rather than the picker) the bytes go into IndexedDB instead. Measured:
//      849 MB/s for incompressible data, so roughly 2.4s for a 2GB film, with a 22.97GB quota
//      and an instant read back because the blob comes out by reference rather than by copy.
//      The cost is a second copy of the film on disk, so this is the fallback, not the default.

const DB_NAME = 'ssh_video'
const STORE = 'v'
const KEY_HANDLE = 'handle'
const KEY_FILE = 'file'
const KEY_META = 'meta'

// Dropping the bytes of a film into IndexedDB is only worth it up to a point. Past this, the
// copy costs more disk than it is worth and the handle route should be used instead.
export const MAX_INLINE_BYTES = 4 * 1024 * 1024 * 1024

export function handlesSupported() {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function'
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'))
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function put(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function get(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function del(db, key) {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = resolve
    tx.onerror = resolve
  })
}

// Remember a film. A handle is stored on its own; without one the bytes are stored instead.
// Never throws: failing to remember the film must not break playing it.
export async function rememberVideo(file, handle) {
  const meta = { name: file?.name || '', size: file?.size || 0, type: file?.type || '', savedAt: Date.now() }
  let db
  try { db = await openDb() } catch { return { stored: 'none', reason: 'no indexedDB' } }
  try {
    await put(db, KEY_META, meta)
    if (handle) {
      await put(db, KEY_HANDLE, handle)
      await del(db, KEY_FILE)
      return { stored: 'handle', meta }
    }
    await del(db, KEY_HANDLE)
    if (!file || file.size > MAX_INLINE_BYTES) {
      await del(db, KEY_FILE)
      return { stored: 'none', reason: 'too large to copy', meta }
    }
    await put(db, KEY_FILE, file)
    return { stored: 'file', meta }
  } catch (err) {
    // Almost always the storage quota. Keep the name so the page can at least say what is missing.
    try { await del(db, KEY_FILE) } catch { /* nothing else to try */ }
    return { stored: 'none', reason: err?.name || 'save failed', meta }
  } finally {
    db.close()
  }
}

// What is waiting after a reload.
//   ready            - the film is in hand, play it
//   needs-permission - a handle is there, one click away from the film
//   none             - nothing to restore
export async function restoreVideo() {
  let db
  try { db = await openDb() } catch { return { status: 'none' } }
  try {
    const meta = await get(db, KEY_META)
    const handle = await get(db, KEY_HANDLE)
    if (handle) {
      let state = 'prompt'
      try { state = await handle.queryPermission({ mode: 'read' }) } catch { /* older shape, ask below */ }
      if (state === 'granted') {
        try { return { status: 'ready', file: await handle.getFile(), handle, meta } }
        catch { return { status: 'needs-permission', handle, meta } }
      }
      return { status: 'needs-permission', handle, meta }
    }
    const file = await get(db, KEY_FILE)
    if (file) return { status: 'ready', file, meta }
    return { status: 'none', meta }
  } catch {
    return { status: 'none' }
  } finally {
    db.close()
  }
}

// Ask for the film behind a stored handle. Must be called from a click: the browser refuses a
// permission prompt that no one asked for.
export async function grantVideo(handle) {
  if (!handle) return { status: 'none' }
  try {
    let state = 'prompt'
    try { state = await handle.queryPermission({ mode: 'read' }) } catch { /* fall through to request */ }
    if (state !== 'granted') state = await handle.requestPermission({ mode: 'read' })
    if (state !== 'granted') return { status: 'denied' }
    return { status: 'ready', file: await handle.getFile(), handle }
  } catch (err) {
    // A file that moved or was deleted since last time lands here.
    return { status: 'denied', reason: err?.name || 'could not open' }
  }
}

// Open the picker, preferring the route that lets the film come back by itself next time.
export async function pickVideoFile() {
  if (handlesSupported()) {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'Video', accept: { 'video/*': ['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v'] } }],
      })
      if (!handle) return null
      return { file: await handle.getFile(), handle }
    } catch (err) {
      // The user closing the picker is not an error worth reporting.
      if (err?.name === 'AbortError') return null
      // Anything else falls through to the plain input below.
    }
  }
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'video/*'
    input.onchange = () => resolve(input.files[0] ? { file: input.files[0], handle: null } : null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

export async function forgetVideo() {
  let db
  try { db = await openDb() } catch { return }
  try { await del(db, KEY_HANDLE); await del(db, KEY_FILE); await del(db, KEY_META) } finally { db.close() }
}
