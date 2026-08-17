// Proves the API gate with a throwaway SITE_PASSWORD, so the real one is never needed.
// Routes are called directly with mock req/res: no server, and no outbound network calls
// (subtitles.js returns [] for every provider when no provider keys are set, and
// translate-srt.js refuses before calling OpenAI when OPENAI_API_KEY is missing).

process.env.SITE_PASSWORD = 'dummy-test-password-123'
delete process.env.SUBDL_API_KEY
delete process.env.OPENSUBTITLES_API_KEY
delete process.env.SUBSOURCE_API_KEY
delete process.env.OPENAI_API_KEY

const base = new URL('../api/', import.meta.url).href
const checkPassword = (await import(base + 'check-password.js')).default
const subtitles = (await import(base + 'subtitles.js')).default
const translate = (await import(base + 'translate-srt.js')).default
const fetchSub = (await import(base + 'fetch-sub.js')).default
const search = (await import(base + 'search.js')).default
const auth = await import(base + '_auth.js')

function mock(method, { cookie, body, query } = {}) {
  const res = {
    statusCode: null, headers: {}, payload: null,
    status(c) { this.statusCode = c; return this },
    json(o) { this.payload = o; return this },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this },
  }
  const req = { method, headers: cookie ? { cookie } : {}, body, query: query || {} }
  return { req, res }
}
const cookieOf = res => {
  const h = res.headers['set-cookie']
  return Array.isArray(h) ? h[0] : h
}

let pass = 0, fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

console.log('\n-- login --')
let m = mock('POST', { body: { password: 'not-the-password' } })
await checkPassword(m.req, m.res)
check('wrong password -> 401', m.res.statusCode === 401, `got ${m.res.statusCode}`)
check('wrong password sets no auth cookie', !/ssh_auth=[^;]/.test(cookieOf(m.res) || 'ssh_auth=;'), cookieOf(m.res))

m = mock('POST', { body: { password: '' } })
await checkPassword(m.req, m.res)
check('empty password -> 401', m.res.statusCode === 401, `got ${m.res.statusCode}`)

m = mock('POST', { body: { password: process.env.SITE_PASSWORD } })
await checkPassword(m.req, m.res)
const setCookie = cookieOf(m.res)
check('right password -> 200', m.res.statusCode === 200, `got ${m.res.statusCode}`)
check('cookie is HttpOnly', /HttpOnly/i.test(setCookie || ''), setCookie)
check('cookie is Secure', /Secure/i.test(setCookie || ''), setCookie)
check('cookie is SameSite=Lax', /SameSite=Lax/i.test(setCookie || ''), setCookie)
const goodCookie = (setCookie || '').split(';')[0]
check('cookie does not contain the password', !(setCookie || '').includes(process.env.SITE_PASSWORD), 'password leaked into cookie!')

console.log('\n-- session check (GET) --')
m = mock('GET')
await checkPassword(m.req, m.res)
check('GET without cookie -> 401', m.res.statusCode === 401, `got ${m.res.statusCode}`)
m = mock('GET', { cookie: goodCookie })
await checkPassword(m.req, m.res)
check('GET with cookie -> 200', m.res.statusCode === 200, `got ${m.res.statusCode}`)

console.log('\n-- data routes locked without the cookie --')
for (const [name, fn, method, opts] of [
  ['search', search, 'GET', { query: { query: 'Inception' } }],
  ['subtitles', subtitles, 'GET', { query: { language: 'EN' } }],
  ['fetch-sub', fetchSub, 'POST', { body: { url: '/x.zip' } }],
  ['translate-srt', translate, 'POST', { body: { srtContent: '1\n00:00:01,000 --> 00:00:02,000\nhi\n', targetLanguage: 'Thai' } }],
]) {
  const a = mock(method, opts)
  await fn(a.req, a.res)
  check(`${name} without cookie -> 401`, a.res.statusCode === 401, `got ${a.res.statusCode} ${JSON.stringify(a.res.payload)}`)
}

console.log('\n-- data routes reachable with the cookie --')
m = mock('GET', { cookie: goodCookie, query: { language: 'EN', imdb_id: 'tt1375666' } })
await subtitles(m.req, m.res)
check('subtitles with cookie is not 401', m.res.statusCode !== 401, `got ${m.res.statusCode}`)
check('subtitles with cookie -> 200', m.res.statusCode === 200, `got ${m.res.statusCode} ${JSON.stringify(m.res.payload)}`)
m = mock('POST', { cookie: goodCookie, body: { srtContent: '1\n00:00:01,000 --> 00:00:02,000\nhi\n', targetLanguage: 'Thai' } })
await translate(m.req, m.res)
check('translate with cookie passes the gate (500 = missing OPENAI key, not 401)', m.res.statusCode === 500 && /OPENAI_API_KEY/.test(m.res.payload?.error || ''), `got ${m.res.statusCode} ${JSON.stringify(m.res.payload)}`)

console.log('\n-- forged and stale cookies --')
const [expPart, sigPart] = goodCookie.replace('ssh_auth=', '').split('.')
for (const [name, cookie] of [
  ['tampered signature', `ssh_auth=${expPart}.${'A'.repeat(sigPart.length)}`],
  ['extended expiry, old signature', `ssh_auth=${Number(expPart) + 99999}.${sigPart}`],
  ['empty token', 'ssh_auth='],
  ['garbage token', 'ssh_auth=not-a-token'],
  ['no dot', `ssh_auth=${expPart}${sigPart}`],
  ['password as token', `ssh_auth=${process.env.SITE_PASSWORD}`],
]) {
  const a = mock('GET', { cookie, query: { language: 'EN' } })
  await subtitles(a.req, a.res)
  check(`${name} -> 401`, a.res.statusCode === 401, `got ${a.res.statusCode}`)
}
check('expired token rejected', auth.tokenIsValid(goodCookie.replace('ssh_auth=', ''), Date.now() + 31 * 24 * 3600 * 1000) === false)
check('valid token accepted now', auth.tokenIsValid(goodCookie.replace('ssh_auth=', '')) === true)

console.log('\n-- cookie from a different password must not work --')
const otherToken = (() => { process.env.SITE_PASSWORD = 'a-different-password'; const t = auth.makeToken(); process.env.SITE_PASSWORD = 'dummy-test-password-123'; return t })()
m = mock('GET', { cookie: `ssh_auth=${otherToken}`, query: { language: 'EN' } })
await subtitles(m.req, m.res)
check('token signed with another password -> 401', m.res.statusCode === 401, `got ${m.res.statusCode}`)

console.log('\n-- fail closed when SITE_PASSWORD is missing --')
delete process.env.SITE_PASSWORD
m = mock('GET', { cookie: goodCookie, query: { language: 'EN' } })
await subtitles(m.req, m.res)
check('previously valid cookie -> 401 with no SITE_PASSWORD', m.res.statusCode === 401, `got ${m.res.statusCode}`)
m = mock('POST', { body: { password: 'anything' } })
await checkPassword(m.req, m.res)
check('login refused with no SITE_PASSWORD (500, not 200)', m.res.statusCode === 500, `got ${m.res.statusCode}`)
m = mock('POST', { body: { password: undefined } })
await checkPassword(m.req, m.res)
check('undefined password with no SITE_PASSWORD does not unlock', m.res.statusCode !== 200, `got ${m.res.statusCode}`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
