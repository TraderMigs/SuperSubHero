// Covers the echo check that catches translated blocks attached to the wrong source block.
//
// The real failure: in a 1,322-line film the model hit "Who else would try to attack you" and
// "in our line of work?", two cues carrying one sentence. It translated the sentence once,
// returned one block where two were asked for, and every later block in that batch carried the
// line before it. The numbering looked perfect throughout, so nothing noticed.
import { echoMatches, parseBlocksFromCompletion, dropDuplicatedTails } from '../api/translate-srt.js'

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

console.log('\n-- trimming a tail that belongs to the next cue --')
// Taken from a real run: the sentence spans cues 275 and 276. The model translated it whole
// into 275 and also correctly into 276, so the Thai half showed on screen twice.
let src = [
  { text: 'Who else would try to attack you' },
  { text: 'in our line of work?' },
]
let map = { 1: 'แล้วใครอีกจะพยายามโจมตีคุณ\nในงานของเรา?', 2: 'ในงานของเรา?' }
check('one duplicated line is removed', dropDuplicatedTails(src, map) === 1)
check('the first cue keeps only its own half', map[1] === 'แล้วใครอีกจะพยายามโจมตีคุณ', JSON.stringify(map[1]))
check('the second cue is untouched', map[2] === 'ในงานของเรา?')

console.log('\n-- dialogue that genuinely repeats is left alone --')
// Also real: "- Make way!" is answered by "- Make way!", and both source blocks have two lines.
src = [
  { text: '- One moment, please!\n- Make way!' },
  { text: '- Let us through.\n- Make way!' },
]
map = { 1: '- รอสักครู่!\n- ทางหน่อย!', 2: '- ให้พวกเราผ่านหน่อย\n- ทางหน่อย!' }
check('nothing is removed', dropDuplicatedTails(src, map) === 0)
check('both cues keep both lines', map[1].split('\n').length === 2 && map[2].split('\n').length === 2)

src = [{ text: 'HUR WAS KILLED WITH MY KNIFE\nBY SOMEONE ELSE' }, { text: 'HUR WAS KILLED WITH MY KNIFE' }]
map = { 1: 'ฮอถูกฆ่าด้วยมีดของผม\nโดยคนอื่น', 2: 'ฮอถูกฆ่าด้วยมีดของผม' }
check('a repeated sign card is left alone', dropDuplicatedTails(src, map) === 0)

console.log('\n-- guards --')
src = [{ text: 'one' }, { text: 'two' }]
map = { 1: 'ONE', 2: 'TWO' }
check('a clean pair is untouched', dropDuplicatedTails(src, map) === 0 && map[1] === 'ONE')
map = { 1: 'SAME', 2: 'SAME' }
check('a single line is never removed, even when identical', dropDuplicatedTails(src, map) === 0 && map[1] === 'SAME')
map = { 1: 'A\nB\nB', 2: 'B' }
check('several duplicated lines are all removed', dropDuplicatedTails([{ text: 'a' }, { text: 'b' }], map) === 2 && map[1] === 'A')
check('a missing next block is skipped', dropDuplicatedTails(src, { 1: 'X\nY' }) === 0)
check('an empty map does not throw', dropDuplicatedTails(src, {}) === 0)
check('a source block with no text does not throw', dropDuplicatedTails([{ text: '' }, { text: 'b' }], { 1: 'A\nB', 2: 'B' }) >= 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
