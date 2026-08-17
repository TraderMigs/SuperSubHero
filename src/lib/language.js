// Checking that a subtitle file is actually in the language it was filed under.
//
// Providers take the uploader's word for it, and uploaders get it wrong. A file offered as Thai
// for The Gangster, the Cop, the Devil turned out to be Sinhala, and nothing in the app noticed:
// it aligned correctly, merged correctly, and produced a dual-language file in the wrong
// language. Alignment works on timings and cannot see this; the release name cannot either.
//
// Writing systems are the reliable signal. Thai and Sinhala occupy different Unicode blocks, so
// counting characters answers the question outright, in any language, with no word lists.
// Languages that share the Latin alphabet cannot be told apart this way, and this deliberately
// says nothing rather than guessing at them.

const SCRIPTS = [
  { name: 'Thai', re: /[฀-๿]/ },
  { name: 'Lao', re: /[຀-໿]/ },
  { name: 'Sinhala', re: /[඀-෿]/ },
  { name: 'Tamil', re: /[஀-௿]/ },
  { name: 'Malayalam', re: /[ഀ-ൿ]/ },
  { name: 'Telugu', re: /[ఀ-౿]/ },
  { name: 'Kannada', re: /[ಀ-೿]/ },
  { name: 'Bengali', re: /[ঀ-৿]/ },
  { name: 'Gujarati', re: /[઀-૿]/ },
  { name: 'Gurmukhi', re: /[਀-੿]/ },
  { name: 'Odia', re: /[଀-୿]/ },
  { name: 'Devanagari', re: /[ऀ-ॿ]/ },
  { name: 'Khmer', re: /[ក-៿]/ },
  { name: 'Myanmar', re: /[က-႟]/ },
  { name: 'Ethiopic', re: /[ሀ-፿]/ },
  { name: 'Georgian', re: /[Ⴀ-ჿ]/ },
  { name: 'Armenian', re: /[԰-֏]/ },
  { name: 'Hebrew', re: /[֐-׿]/ },
  { name: 'Arabic', re: /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/ },
  { name: 'Greek', re: /[Ͱ-Ͽἀ-῿]/ },
  { name: 'Cyrillic', re: /[Ѐ-ӿԀ-ԯ]/ },
  { name: 'Hangul', re: /[가-힯ᄀ-ᇿ㄰-㆏]/ },
  { name: 'Kana', re: /[぀-ヿ]/ },
  { name: 'Han', re: /[一-鿿㐀-䶿]/ },
  { name: 'Latin', re: /[A-Za-zÀ-ɏ]/ },
]

// Which writing systems each language may legitimately appear in. Anything absent from this map
// is not checked, which is the right default: silence beats a wrong accusation.
const EXPECTED = {
  TH: ['Thai'],
  LO: ['Lao'],
  SI: ['Sinhala'],
  KM: ['Khmer'],
  MY: ['Myanmar'],
  KO: ['Hangul'],
  // Japanese mixes kana with Han characters, and a passage can run on Han alone.
  JA: ['Kana', 'Han'],
  ZH: ['Han'],
  ZT: ['Han'],
  AR: ['Arabic'],
  FA: ['Arabic'],
  UR: ['Arabic'],
  HE: ['Hebrew'],
  EL: ['Greek'],
  HY: ['Armenian'],
  KA: ['Georgian'],
  AM: ['Ethiopic'],
  HI: ['Devanagari'],
  MR: ['Devanagari'],
  NE: ['Devanagari'],
  BN: ['Bengali'],
  PA: ['Gurmukhi'],
  GU: ['Gujarati'],
  TA: ['Tamil'],
  TE: ['Telugu'],
  KN: ['Kannada'],
  ML: ['Malayalam'],
  OR: ['Odia'],
  RU: ['Cyrillic'], UK: ['Cyrillic'], BG: ['Cyrillic'], SR: ['Cyrillic', 'Latin'],
  BE: ['Cyrillic'], MK: ['Cyrillic'], KK: ['Cyrillic'], MN: ['Cyrillic'],
  TG: ['Cyrillic'], KY: ['Cyrillic'], TT: ['Cyrillic'],
  // Everything else in the list is written in Latin script.
  EN: ['Latin'], ES: ['Latin'], FR: ['Latin'], DE: ['Latin'], IT: ['Latin'], PT: ['Latin'],
  NL: ['Latin'], PL: ['Latin'], SV: ['Latin'], TR: ['Latin'], CS: ['Latin'], RO: ['Latin'],
  HU: ['Latin'], DA: ['Latin'], FI: ['Latin'], NO: ['Latin'], TL: ['Latin'], HR: ['Latin'],
  SK: ['Latin'], VI: ['Latin'], ID: ['Latin'], MS: ['Latin'], SL: ['Latin'], ET: ['Latin'],
  LV: ['Latin'], LT: ['Latin'], SQ: ['Latin'], EU: ['Latin'], CA: ['Latin'], GL: ['Latin'],
  AF: ['Latin'], SW: ['Latin'], CEB: ['Latin'], JW: ['Latin'], SU: ['Latin'], HT: ['Latin'],
  IS: ['Latin'], MT: ['Latin'], CY: ['Latin'], GD: ['Latin'], LB: ['Latin'], EO: ['Latin'],
  LA: ['Latin'], MI: ['Latin'], SM: ['Latin'], HAW: ['Latin'], CO: ['Latin'], NY: ['Latin'],
  HA: ['Latin'], IG: ['Latin'], YO: ['Latin'], ZU: ['Latin'], XH: ['Latin'], ST: ['Latin'],
  SN: ['Latin'], SO: ['Latin'], MG: ['Latin'], RW: ['Latin'], AZ: ['Latin'], UZ: ['Latin'],
  BS: ['Latin'], TK: ['Latin'],
}

// Languages that share the Latin alphabet cannot be separated by writing system, so a Latin
// result for a Latin language is treated as agreement rather than confirmation.
const LATIN_ONLY = new Set(['Latin'])

/**
 * Count characters by writing system and return the dominant one.
 * Punctuation, digits, spaces and music symbols are ignored: they appear in every language.
 */
export function detectScript(text) {
  const counts = {}
  let total = 0
  for (const ch of String(text || '')) {
    if (/[\s\d\p{P}\p{S}]/u.test(ch)) continue
    const hit = SCRIPTS.find(s => s.re.test(ch))
    if (!hit) continue
    counts[hit.name] = (counts[hit.name] || 0) + 1
    total++
  }
  if (!total) return { script: null, share: 0, counts, sampled: 0 }

  const [script, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return { script, share: count / total, counts, sampled: total }
}

export const scriptsForLanguage = code => EXPECTED[String(code || '').toUpperCase()] || null

/**
 * Does this text look like the language it was filed under?
 * Returns { status, detected, expected, message } where status is:
 *   ok        the writing system is one this language uses
 *   mismatch  it is a different writing system entirely, so the file is not this language
 *   unknown   not enough text, or nothing we can meaningfully check
 */
export function verifyLanguage(text, code, languageLabel = code) {
  const expected = scriptsForLanguage(code)
  const { script, share, sampled } = detectScript(text)

  if (!expected) return { status: 'unknown', detected: script, expected: null, message: '' }
  if (!script || sampled < 40) {
    return { status: 'unknown', detected: script, expected, message: 'Not enough text to check the language.' }
  }

  if (expected.includes(script)) {
    // Japanese written only in Han characters is indistinguishable from Chinese here.
    return { status: 'ok', detected: script, expected, message: '' }
  }

  // A Latin-script file under a Latin-script language is as far as this check can go.
  if (LATIN_ONLY.has(script) && expected.every(e => LATIN_ONLY.has(e))) {
    return { status: 'ok', detected: script, expected, message: '' }
  }

  const pct = Math.round(share * 100)
  const asName = script === 'Han' ? 'Chinese' : script === 'Kana' ? 'Japanese' : script === 'Hangul' ? 'Korean'
    : script === 'Devanagari' ? 'Hindi or another Devanagari language' : script === 'Latin' ? 'a Latin-alphabet language' : script
  return {
    status: 'mismatch',
    detected: script,
    expected,
    message: `This file is not ${languageLabel}. ${pct}% of its characters are ${asName}. The site that supplied it has it filed under the wrong language.`,
  }
}
