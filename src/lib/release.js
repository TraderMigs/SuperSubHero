// Reading release names, so a subtitle row can say what it came from and whether it is likely
// to match the one picked in the other language.
//
// Subtitle timing follows the video it was made for. Two files from the same release group are
// almost always interchangeable; a broadcast rip and a disc rip rarely are, because the cuts
// and ad breaks differ. That is knowable from the release name before anything is downloaded,
// which is cheaper than finding out after a merge has gone wrong.

const SOURCES = [
  // Most specific first: "BDRip" must not be read as "BluRay", and "WEB-DL" not as "WEB".
  { family: 'BluRay', label: 'BluRay Remux', re: /\b(?:bd|blu-?ray)[\s._-]*remux\b|\bremux\b/i },
  { family: 'BluRay', label: 'BDRip', re: /\b(?:bd|br)rip\b/i },
  { family: 'BluRay', label: 'BluRay', re: /\bblu-?ray\b|\bbdmv\b|\bbd25\b|\bbd50\b/i },
  { family: 'WEB', label: 'WEB-DL', re: /\bweb[\s._-]*dl\b/i },
  { family: 'WEB', label: 'WEBRip', re: /\bweb[\s._-]*rip\b/i },
  { family: 'WEB', label: 'WEB', re: /\bweb\b|\b(?:nf|amzn|dsnp|hulu|hmax|atvp)\b/i },
  { family: 'HDTV', label: 'HDTV', re: /\bhd-?tv\b|\bpdtv\b|\bsdtv\b|\bdvb\b/i },
  { family: 'DVD', label: 'DVDRip', re: /\bdvd-?rip\b/i },
  { family: 'DVD', label: 'DVDScr', re: /\bdvd-?scr\b/i },
  { family: 'DVD', label: 'DVD', re: /\bdvd(?:-?[59r])?\b|\bntsc\b|\bpal\b/i },
  { family: 'HDRip', label: 'HDRip', re: /\bhd-?rip\b/i },
  { family: 'CAM', label: 'HDCAM', re: /\bhd-?cam\b/i },
  { family: 'CAM', label: 'CAM', re: /\bcam(?:rip)?\b/i },
  { family: 'CAM', label: 'TS', re: /\b(?:hd-?)?ts\b|\btelesync\b|\btc\b|\btelecine\b/i },
]

const RESOLUTIONS = [
  { label: '2160p', re: /\b(?:2160p|4k|uhd)\b/i },
  { label: '1080p', re: /\b1080[pi]\b/i },
  { label: '720p', re: /\b720p\b/i },
  { label: '576p', re: /\b576[pi]\b/i },
  { label: '480p', re: /\b480[pi]\b/i },
]

const CODECS = [
  { label: 'x265', re: /\b(?:x265|h\.?265|hevc)\b/i },
  { label: 'x264', re: /\b(?:x264|h\.?264|avc)\b/i },
  { label: 'AV1', re: /\bav1\b/i },
  { label: 'XviD', re: /\bxvid\b/i },
  { label: 'DivX', re: /\bdivx\b/i },
]

const FLAGS = [
  { label: 'OCR', re: /\bocr\b/i },
  { label: 'Hearing impaired', re: /\b(?:hi|sdh|cc)\b/i },
  { label: 'Forced', re: /\bforced\b/i },
  { label: 'Colour-corrected', re: /\bhdr\b|\bdo?vi\b|\bdolby[\s._-]*vision\b/i },
]

// Words that look like a release group at the end of a name but are not one.
const NOT_A_GROUP = /^(?:srt|ass|ssa|vtt|sub|subs|eng|en|english|thai|th|mp4|mkv|avi|x264|x265|hevc|web|dl|rip|hd|full|season|complete|ocr|hi|sdh|forced|\d+(?:ch|bit|p|mb|gb)?)$/i

export function parseRelease(rawName = '') {
  const name = String(rawName).replace(/\.(srt|ass|ssa|vtt|sub|idx|zip)$/i, '').trim()
  // Dots and underscores act as spaces in release names, but keep the original for the group.
  const spaced = ' ' + name.replace(/[._]+/g, ' ').replace(/\s+/g, ' ') + ' '

  const source = SOURCES.find(s => s.re.test(spaced)) || null
  const resolution = RESOLUTIONS.find(r => r.re.test(spaced)) || null
  const codec = CODECS.find(c => c.re.test(spaced)) || null
  const flags = FLAGS.filter(f => f.re.test(spaced)).map(f => f.label)

  // A release group is the token after the last hyphen. Trailing tags in brackets, such as
  // "[En]" or "(2010)", get stripped first or they hide it.
  let tail = name
  for (let i = 0; i < 4; i++) {
    const trimmed = tail.replace(/\s*[[(][^\])]*[\])]\s*$/, '').trim()
    if (trimmed === tail) break
    tail = trimmed
  }
  let group = null
  const hyphen = tail.match(/-\s*([A-Za-z0-9]{2,20})\s*$/)
  if (hyphen && !NOT_A_GROUP.test(hyphen[1])) group = hyphen[1]

  const year = (spaced.match(/\b(19\d{2}|20\d{2})\b/) || [])[1] || null

  return {
    raw: rawName,
    sourceFamily: source ? source.family : null,
    sourceLabel: source ? source.label : null,
    resolution: resolution ? resolution.label : null,
    codec: codec ? codec.label : null,
    group,
    flags,
    year,
    // Short chips for the interface, in the order they read best.
    chips: [source && source.label, resolution && resolution.label, codec && codec.label, group && `-${group}`, ...flags].filter(Boolean),
  }
}

// How two source families relate. A disc rip and a streaming rip usually share a runtime; a
// broadcast rip or a camera recording usually does not.
const FAMILY_AFFINITY = {
  'BluRay|WEB': 'likely',
  'BluRay|HDRip': 'likely',
  'WEB|HDRip': 'likely',
  'BluRay|DVD': 'unlikely',
  'WEB|DVD': 'unlikely',
  'DVD|HDRip': 'unlikely',
  'BluRay|HDTV': 'unlikely',
  'WEB|HDTV': 'unlikely',
  'DVD|HDTV': 'unlikely',
  'HDRip|HDTV': 'unlikely',
}

const affinityFor = (a, b) => FAMILY_AFFINITY[[a, b].sort().join('|')] || null

/**
 * Compare a candidate release against the one already chosen in the other language.
 * Returns { level, label, reason } where level is one of:
 *   match     same group, or same source and resolution. Timing should agree.
 *   likely    same family, or two families that normally share a runtime.
 *   unsure    nothing useful in the name, so no opinion.
 *   unlikely  different kind of source. Expect the timing to be off.
 *   bad       a camera recording against a clean source. Timing will not agree.
 */
export function compareReleases(chosen, candidate) {
  if (!chosen || !candidate) return { level: 'unsure', label: '?', reason: 'Nothing selected in the other language yet' }
  const a = typeof chosen === 'string' ? parseRelease(chosen) : chosen
  const b = typeof candidate === 'string' ? parseRelease(candidate) : candidate

  // Labels say "cut" rather than "match" on purpose. This only compares which video release the
  // subtitles were timed against. It says nothing about whether the file is in the right
  // language, and a plain "Match" was read as exactly that: a file offered as Thai but actually
  // in Sinhala earned a Match here, because as a video cut it genuinely did match.
  const timing = 'Timing only, not language'

  if (a.group && b.group && a.group.toLowerCase() === b.group.toLowerCase()) {
    return { level: 'match', label: 'Same cut', reason: `Same release group (${b.group}). ${timing}.` }
  }

  const aFam = a.sourceFamily, bFam = b.sourceFamily
  if (!aFam || !bFam) {
    return { level: 'unsure', label: '?', reason: 'Release name does not say what it came from' }
  }

  if ((aFam === 'CAM') !== (bFam === 'CAM')) {
    return { level: 'bad', label: 'Avoid', reason: `A camera recording will not line up with a clean source. ${timing}.` }
  }

  if (aFam === bFam) {
    if (a.resolution && b.resolution && a.resolution === b.resolution) {
      return { level: 'match', label: 'Same cut', reason: `Both ${bFam} ${b.resolution}. ${timing}.` }
    }
    return { level: 'likely', label: 'Likely', reason: `Both ${bFam}, different resolution. ${timing}.` }
  }

  const affinity = affinityFor(aFam, bFam)
  if (affinity === 'likely') return { level: 'likely', label: 'Likely', reason: `${aFam} and ${bFam} usually share the same runtime. ${timing}.` }
  if (affinity === 'unlikely') return { level: 'unlikely', label: 'Differs', reason: `${bFam} is a different cut from ${aFam}. ${timing}.` }
  return { level: 'unsure', label: '?', reason: `${bFam} against ${aFam} is hard to predict` }
}

// Colours for the badge. Kept here so the interface and any future report agree.
export const MATCH_COLORS = {
  match: { fg: '#0a0a0f', bg: '#35f18a' },
  likely: { fg: '#0a0a0f', bg: '#c8f135' },
  unsure: { fg: '#9a9ab0', bg: 'rgba(255,255,255,0.08)' },
  unlikely: { fg: '#0a0a0f', bg: '#c8a135' },
  bad: { fg: '#fff', bg: '#f1354a' },
}
