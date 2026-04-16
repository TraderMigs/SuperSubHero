const OS_LANG_MAP = {
  'EN': 'en', 'FR': 'fr', 'ES': 'es', 'DE': 'de', 'IT': 'it',
  'PT': 'pt', 'ZH': 'zh-CN', 'ZT': 'zh-TW', 'JA': 'ja', 'KO': 'ko',
  'AR': 'ar', 'HI': 'hi', 'RU': 'ru', 'TH': 'th', 'VI': 'vi',
  'ID': 'id', 'MS': 'ms', 'NL': 'nl', 'PL': 'pl', 'SV': 'sv',
  'TR': 'tr', 'UK': 'uk', 'CS': 'cs', 'RO': 'ro', 'HU': 'hu',
  'EL': 'el', 'HE': 'he', 'DA': 'da', 'FI': 'fi', 'NO': 'no',
  'TL': 'tl', 'FA': 'fa', 'BN': 'bn', 'HR': 'hr', 'SK': 'sk',
  'BG': 'bg', 'SR': 'sr',
}

function normalizeName(name = '') {
  return name
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sortCandidates(subtitles, episode) {
  const episodeNum = episode ? parseInt(episode, 10) : null

  return subtitles.sort((a, b) => {
    const aExact = episodeNum ? a.episode === episodeNum : false
    const bExact = episodeNum ? b.episode === episodeNum : false
    const aFull = !!(a.full_season || a.episode === 0)
    const bFull = !!(b.full_season || b.episode === 0)
    const aProvider = a.source === 'opensubtitles' ? 1 : 0
    const bProvider = b.source === 'opensubtitles' ? 1 : 0

    if (aExact && !bExact) return -1
    if (!aExact && bExact) return 1
    if (aFull && !bFull) return 1
    if (!aFull && bFull) return -1
    if (aProvider !== bProvider) return aProvider - bProvider
    return (a.name || '').localeCompare(b.name || '')
  })
}

async function fetchFromSubDL(params, SUBDL_KEY) {
  if (!SUBDL_KEY) return []

  const { sd_id, imdb_id, tmdb_id, type, language, season, episode } = params
  const query = new URLSearchParams({
    api_key: SUBDL_KEY,
    languages: language,
    type,
    releases: '1',
  })

  if (sd_id) query.append('sd_id', sd_id)
  else if (imdb_id) query.append('imdb_id', imdb_id)
  else if (tmdb_id) query.append('tmdb_id', tmdb_id)

  if (type === 'tv' && season) query.append('season_number', season)
  if (type === 'tv' && episode) query.append('episode_number', episode)

  const url = `https://api.subdl.com/api/v1/subtitles?${query}`
  const resp = await fetch(url, { headers: { Accept: 'application/json' } })

  if (!resp.ok) {
    throw new Error(`SubDL error: ${resp.status}`)
  }

  const data = await resp.json()
  if (!data.status || !data.subtitles?.length) return []

  return data.subtitles.map(s => ({
    id: `subdl_${s.sd_id || s.url}`,
    sd_id: s.sd_id || null,
    name: s.release_name || s.name || 'Unknown release',
    normalized_name: normalizeName(s.release_name || s.name || ''),
    url: s.url,
    file_id: null,
    source: 'subdl',
    language: s.lang || language,
    author: s.author || null,
    season: s.season || null,
    episode: s.episode || null,
    full_season: s.full_season || false,
  }))
}

async function fetchFromOpenSubtitles(params, OS_KEY) {
  if (!OS_KEY) return []

  const { imdb_id, tmdb_id, type, language, season, episode } = params
  const osLang = OS_LANG_MAP[language] || language.toLowerCase()
  const query = new URLSearchParams({ languages: osLang })

  if (imdb_id) query.append('imdb_id', imdb_id.replace('tt', ''))
  else if (tmdb_id) {
    query.append('tmdb_id', tmdb_id)
    query.append('type', type === 'tv' ? 'episode' : 'movie')
  }

  if (type === 'tv' && season) query.append('season_number', season)
  if (type === 'tv' && episode) query.append('episode_number', episode)

  const url = `https://api.opensubtitles.com/api/v1/subtitles?${query}`
  const resp = await fetch(url, {
    headers: {
      'Api-Key': OS_KEY,
      'Content-Type': 'application/json',
      'User-Agent': 'SuperSubHero v2.0',
    },
  })

  if (!resp.ok) {
    throw new Error(`OpenSubtitles error: ${resp.status}`)
  }

  const data = await resp.json()
  if (!data.data?.length) return []

  return data.data
    .map(s => {
      const file = s.attributes?.files?.[0]
      return {
        id: `os_${s.id}_${file?.file_id || 'nofile'}`,
        sd_id: null,
        name: s.attributes?.release || s.attributes?.filename || 'Unknown release',
        normalized_name: normalizeName(s.attributes?.release || s.attributes?.filename || ''),
        url: null,
        file_id: file?.file_id || null,
        source: 'opensubtitles',
        language,
        author: null,
        season: s.attributes?.feature_details?.season_number || null,
        episode: s.attributes?.feature_details?.episode_number || null,
        full_season: false,
      }
    })
    .filter(s => s.file_id)
}

function mergeResults(subdlSubs, openSubs, episode) {
  const combined = [...subdlSubs]
  const seen = new Set(subdlSubs.map(s => `${s.source}:${s.normalized_name}`))

  for (const sub of openSubs) {
    const exactKey = `${sub.source}:${sub.normalized_name}`
    const crossKey = `subdl:${sub.normalized_name}`
    if (seen.has(exactKey) || seen.has(crossKey)) continue
    seen.add(exactKey)
    combined.push(sub)
  }

  return sortCandidates(combined, episode)
    .map(({ normalized_name, ...rest }) => rest)
    .slice(0, 30)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { sd_id, imdb_id, tmdb_id, type = 'movie', language, season, episode } = req.query
  if (!language) {
    return res.status(400).json({ error: 'language required' })
  }

  const SUBDL_KEY = process.env.SUBDL_API_KEY
  const OS_KEY = process.env.OPENSUBTITLES_API_KEY
  const params = { sd_id, imdb_id, tmdb_id, type, language, season, episode }

  const [subdlResult, openResult] = await Promise.allSettled([
    fetchFromSubDL(params, SUBDL_KEY),
    fetchFromOpenSubtitles(params, OS_KEY),
  ])

  if (subdlResult.status === 'rejected') {
    console.error('SubDL list error:', subdlResult.reason?.message || subdlResult.reason)
  }
  if (openResult.status === 'rejected') {
    console.error('OpenSubtitles list error:', openResult.reason?.message || openResult.reason)
  }

  const subdlSubs = subdlResult.status === 'fulfilled' ? subdlResult.value : []
  const openSubs = openResult.status === 'fulfilled' ? openResult.value : []
  const subtitles = mergeResults(subdlSubs, openSubs, episode)

  return res.status(200).json({
    subtitles,
    source: subtitles.length ? 'mixed' : 'none',
    providers: {
      subdl: subdlSubs.length,
      opensubtitles: openSubs.length,
    },
  })
}
