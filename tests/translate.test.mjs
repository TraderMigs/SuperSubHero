// Covers the echo check that catches translated blocks attached to the wrong source block.
//
// The real failure: in a 1,322-line film the model hit "Who else would try to attack you" and
// "in our line of work?", two cues carrying one sentence. It translated the sentence once,
// returned one block where two were asked for, and every later block in that batch carried the
// line before it. The numbering looked perfect throughout, so nothing noticed.
import { echoMatches, parseBlocksFromCompletion } from '../api/translate-srt.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) } }

console.log('\n-- echo matching --')
check('exact opening matches', echoMatches('Who else would', 'Who else would try to attack you'))
check('different case and punctuation still match', echoMatches('who else, would', 'Who else would try to attack you'))
check('a longer echo is fine', echoMatches('Who else would try to attack', 'Who else would try to attack you'))
check('the wrong block is caught', !echoMatches('in our line', 'Who else would try to attack you'))
check('an empty echo is caught', !echoMatches('', 'Who else would try to attack you'))
check('a translated echo is caught', !echoMatches('แล้วใครอีกล่ะ', 'Who else would try to attack you'))
check('one-word sources are not judged', echoMatches('anything', 'Seriously?'))
check('symbol-only sources are not judged', echoMatches('', '♪ ♪'))
check('a number-only source is not judged', echoMatches('x', '3849'))
check('multi-line sources match on their first words', echoMatches('Isn\'t it common', "Isn't it common sense\nto drive slowly at night?"))

console.log('\n-- parsing a good reply --')
const blocks = [
  { text: 'Who else would try to attack you' },
  { text: 'in our line of work?' },
  { text: 'Give me that.' },
]
const reply = out => ({ choices: [{ message: { content: JSON.stringify({ blocks: out }) } }] })

let r = parseBlocksFromCompletion(reply([
  { n: 1, echo: 'Who else would', text: 'TH one' },
  { n: 2, echo: 'in our line', text: 'TH two' },
  { n: 3, echo: 'Give me that', text: 'TH three' },
]), blocks)
check('all three kept', Object.keys(r.map).length === 3, JSON.stringify(r.map))
check('nothing rejected', r.rejected.length === 0)
check('text lands on the right numbers', r.map[2] === 'TH two')

console.log('\n-- parsing the reply that caused the real damage --')
// The model merges blocks 1 and 2, so what it labels 2 is really the translation of block 3,
// and what it labels 3 is the translation of a block further on.
r = parseBlocksFromCompletion(reply([
  { n: 1, echo: 'Who else would', text: 'TH one and two together' },
  { n: 2, echo: 'Give me that', text: 'TH three' },
  { n: 3, echo: 'It was too', text: 'TH four' },
]), blocks)
check('the slid blocks are rejected', r.rejected.length === 2, JSON.stringify(r.rejected))
check('the correct block is still kept', r.map[1] === 'TH one and two together')
check('nothing wrong is written to block 2', r.map[2] === undefined, String(r.map[2]))
check('nothing wrong is written to block 3', r.map[3] === undefined, String(r.map[3]))

console.log('\n-- other malformed replies --')
check('blocks with no text are skipped', Object.keys(parseBlocksFromCompletion(reply([{ n: 1, echo: 'Who else would', text: '' }]), blocks).map).length === 0)
check('a non-numeric n is skipped', Object.keys(parseBlocksFromCompletion(reply([{ n: 'x', echo: 'Who else would', text: 'hi' }]), blocks).map).length === 0)
check('an unknown block number is kept without an echo check', parseBlocksFromCompletion(reply([{ n: 99, echo: 'anything', text: 'hi' }]), blocks).map[99] === 'hi')
check('an empty reply throws', (() => { try { parseBlocksFromCompletion({ choices: [{ message: { content: '' } }] }, blocks); return false } catch { return true } })())
check('invalid JSON throws', (() => { try { parseBlocksFromCompletion({ choices: [{ message: { content: 'not json' } }] }, blocks); return false } catch { return true } })())
check('a cut-off reply says so', (() => {
  try { parseBlocksFromCompletion({ choices: [{ finish_reason: 'length', message: { content: '{"blocks":[' } }] }, blocks); return false }
  catch (e) { return /cut off/i.test(e.message) }
})())
check('parsing without the source list still works', Object.keys(parseBlocksFromCompletion(reply([{ n: 1, echo: 'whatever', text: 'hi' }]), null).map).length === 1)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
