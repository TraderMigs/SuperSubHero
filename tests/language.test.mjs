// Covers language verification.
//
// The case that prompted it: a file offered as Thai for The Gangster, the Cop, the Devil was
// actually Sinhala. It aligned and merged perfectly, so nothing else in the app could catch it.
// The Sinhala and Thai lines below are real text taken from that file and from a genuine Thai one.
import { detectScript, verifyLanguage, scriptsForLanguage } from '../src/lib/language.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) } }

// Real lines from the mislabelled file Migs opened.
const SINHALA = [
  'අනේ අම්මපා',
  'මේ මිනී මැරුම් අතර සතියක පරතරයක් තියෙනවා වගේම..',
  'මේ වගේ එකෙක්ව විශ්වාස කරපු මමයි මෝඩ.',
  'ඔයාට කරදරයක් වුණාද?',
  'මම හිතුවේ ඔයා එනවා කියලා. ඒක හරි.',
].join('\n')

// Real lines from a genuine Thai file.
const THAI = [
  'คุณไม่ควรกลัวที่จะฝัน',
  'คอบบ์ เราต้องไปเดี๋ยวนี้',
  'เขาจะไม่กลับมาใช่ไหม?',
  'ตอนกลางคืนแบบนี้ ทำไมขับรถเร็วนักล่ะ',
  'จะเคลมประกันต้องใช้รูปถ่าย',
].join('\n')

const ENGLISH = [
  "You mustn't be afraid to dream a little bigger, darling.",
  'Cobb, we need to go. Now.',
  "He's not coming back, is he?",
  'Another murder took place in a land development site',
].join('\n')

console.log('\n-- writing system detection --')
check('Sinhala is detected', detectScript(SINHALA).script === 'Sinhala', detectScript(SINHALA).script)
check('Thai is detected', detectScript(THAI).script === 'Thai', detectScript(THAI).script)
check('Latin is detected', detectScript(ENGLISH).script === 'Latin', detectScript(ENGLISH).script)
check('Sinhala is not mistaken for Thai', detectScript(SINHALA).script !== 'Thai')
check('Thai is not mistaken for Sinhala', detectScript(THAI).script !== 'Sinhala')
check('dominant share is high for a clean file', detectScript(THAI).share > 0.9, detectScript(THAI).share.toFixed(2))
for (const [name, sample] of [
  ['Hangul', '경찰이 아직 사건을 종결하지 못했습니다'],
  ['Arabic', 'لا يجب أن تخاف من أن تحلم بشكل أكبر'],
  ['Cyrillic', 'Ты не должен бояться мечтать о большем'],
  ['Greek', 'Δεν πρέπει να φοβάσαι να ονειρεύεσαι'],
  ['Hebrew', 'אתה לא צריך לפחד לחלום בגדול'],
  ['Devanagari', 'तुम्हें बड़ा सपना देखने से डरना नहीं चाहिए'],
  ['Tamil', 'நீங்கள் பெரிதாக கனவு காண பயப்பட வேண்டாம்'],
]) {
  check(`${name} is detected`, detectScript(sample).script === name, detectScript(sample).script)
}
check('empty text detects nothing', detectScript('').script === null)
check('digits and punctuation alone detect nothing', detectScript('12:34,567 --> 00:00 ... ♪ ♪').script === null)
check('music symbols do not count as a language', detectScript('♪ ♫ ♩ ♬').script === null)

console.log('\n-- the real failure: Sinhala filed as Thai --')
let v = verifyLanguage(SINHALA, 'TH', 'Thai')
check('flagged as a mismatch', v.status === 'mismatch', v.status)
check('names Sinhala in the message', /Sinhala/.test(v.message), v.message)
check('says it is not Thai', /not Thai/.test(v.message), v.message)
check('blames the supplying site, not the user', /wrong language/.test(v.message), v.message)

console.log('\n-- correct files pass --')
check('Thai text under Thai is fine', verifyLanguage(THAI, 'TH', 'Thai').status === 'ok')
check('English text under English is fine', verifyLanguage(ENGLISH, 'EN', 'English').status === 'ok')
check('Sinhala under Sinhala is fine', verifyLanguage(SINHALA, 'SI', 'Sinhala').status === 'ok')
check('no message when it is fine', verifyLanguage(THAI, 'TH', 'Thai').message === '')

console.log('\n-- other mismatches --')
check('Thai filed as Korean is flagged', verifyLanguage(THAI, 'KO', 'Korean').status === 'mismatch')
check('English filed as Thai is flagged', verifyLanguage(ENGLISH, 'TH', 'Thai').status === 'mismatch')
check('a Latin message reads naturally', /Latin-alphabet/.test(verifyLanguage(ENGLISH, 'TH', 'Thai').message), verifyLanguage(ENGLISH, 'TH', 'Thai').message)
check('Han text filed as Korean is flagged', verifyLanguage('警察還沒有結案這些案件都是同一個人做的'.repeat(4), 'KO', 'Korean').status === 'mismatch')

console.log('\n-- deliberately silent cases --')
check('Latin languages are not separated from each other', verifyLanguage(ENGLISH, 'ES', 'Spanish').status === 'ok')
check('Serbian accepts both of its scripts', verifyLanguage('Ne treba da se plasis da sanjas vece snove'.repeat(2), 'SR', 'Serbian').status === 'ok')
check('Japanese accepts Han-only text', verifyLanguage('警察還沒有結案這些案件都是同一個人做的'.repeat(4), 'JA', 'Japanese').status === 'ok')
check('a short file is not judged', verifyLanguage('สวัสดี', 'TH', 'Thai').status === 'unknown', verifyLanguage('สวัสดี', 'TH', 'Thai').status)
check('an unlisted language is not judged', verifyLanguage(THAI, 'ZZ', 'Klingon').status === 'unknown')
check('no expected scripts for an unknown code', scriptsForLanguage('ZZ') === null)
check('Thai maps to the Thai script', (scriptsForLanguage('th') || []).includes('Thai'))

console.log('\n-- a Thai file with English signs in it stays Thai --')
const mixed = THAI + '\n' + 'CHEONAN POLICE STATION\nGAMELAND\nAUGUST 2005'
check('dominant script still Thai', detectScript(mixed).script === 'Thai', detectScript(mixed).script)
check('still passes as Thai', verifyLanguage(mixed, 'TH', 'Thai').status === 'ok')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
