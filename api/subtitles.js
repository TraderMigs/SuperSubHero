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

// SubSource uses full language names
const SS_LANG_MAP = {
  'EN': 'english', 'FR': 'french', 'ES': 'spanish', 'DE': 'german',
  'IT': 'italian', 'PT': 'portuguese', 'ZH': 'chinese', 'ZT': 'chinese',
  'JA': 'japanese', 'KO': 'korean', 'AR': 'arabic', 'HI': 'hindi',
  'RU': 'russian', 'TH': 'thai', 'VI': 'vietnamese', 'ID': 'indonesian',
  'MS': 'malay', 'NL': 'dutch', 'PL': 'polish', 'SV': 'swedish',
  'TR': 'turkish', 'UK': 'ukrainian', 'CS': 'czech', 'RO': 'romanian',
  'HU': 'hungarian', 'EL': 'greek', 'HE': 'hebrew', 'DA': 'danish',
  'FI': 'finnish', 'NO': 'norwegian', 'TL': 'tagalog', 'FA': 'farsi_persian',
  'BN': 'bengali', 'HR': 'croatian', 'SK': 'slovak', 'BG': 'bulgarian',
  'SR': 'serbian',
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
    // Priority: subdl=0, subsource=1, opensubtitles=2
    const providerRank = { subdl: 0, subsource: 1, opensubtitles: 2 }
    const aProvider = providerRank[a.source] ?? 1
    const bProvider = providerRank[b.source] ?? 1

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
    subs_per_page: '30',
  })

  if (sd_id) query.append('sd_id', sd_id)
  else if (imdb_id) query.append('imdb_id', imdb_id)
  else if (tmdb_id) query.append('tmdb_id', tmdb_id)

  if (type === 'tv' && season) query.append('season_number', season)
  if (type === 'tv' && episode) query.append('episode_number', episode)

  const url = `https://api.subdl.com/api/v1/subtitles?${query}`
  const resp = await fetch(url, { headers: { Accept: 'application/json' } })

  if (!resp.ok) throw new Error(`SubDL error: ${resp.status}`)

  const data = await resp.json()
  if (!data.status || !data.subtitles?.length) return []

  return data.subtitles.map(s => ({
    id: `subdl_${s.sd_id || s.url}`,
    sd_id: s.sd_id || null,
    name: s.release_name || s.name || 'Unknown release',
    normalized_name: normalizeName(s.release_name || s.name || ''),
    url: s.url,
    file_id: null,
    ss_id: null,
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

  if (!resp.ok) throw new Error(`OpenSubtitles error: ${resp.status}`)

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
        ss_id: null,
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

async function fetchFromSubSource(params, SS_KEY) {
  if (!SS_KEY) return []

  const { imdb_id, tmdb_id, title, type, language, season, episode } = params
  const ssLang = SS_LANG_MAP[language] || language.toLowerCase()

  if (!title && !imdb_id && !tmdb_id) return []

  // Step 1: Search by title text (official API only supports text search)
  // Use title if available, otherwise fall back to imdb_id as text query
  const searchQuery = title || imdb_id || tmdb_id
  let movieId = null
  let rawSearchData = null

  try {
    const searchResp = await fetch(
      `https://api.subsource.net/api/v1/movies/search?query=${encodeURIComponent(searchQuery)}`,
      { headers: { 'X-API-Key': SS_KEY, Accept: 'application/json' } }
    )

    if (!searchResp.ok) {
      console.error(`SubSource search HTTP error: ${searchResp.status}`)
      return []
    }

    rawSearchData = await searchResp.json()
    console.log('SubSource search raw response keys:', Object.keys(rawSearchData || {}))

    // Handle multiple possible response shapes
    const results = rawSearchData?.data || rawSearchData?.results || rawSearchData?.movies || (Array.isArray(rawSearchData) ? rawSearchData : null)

    if (!results || !results.length) {
      console.error('SubSource search returned no results for query:', searchQuery, 'raw:', JSON.stringify(rawSearchData).slice(0, 200))
      return []
    }

    console.log('SubSource search results count:', results.length, 'first result keys:', Object.keys(results[0] || {}))

    // Validate match by imdb_id or tmdb_id if available
    for (const r of results) {
      const rImdb = (r.imdbId || r.imdb_id || r.imdb || '').toString().replace('tt', '')
      const pImdb = (imdb_id || '').toString().replace('tt', '')
      const rTmdb = (r.tmdbId || r.tmdb_id || r.tmdb || '').toString()
      const pTmdb = (tmdb_id || '').toString()

      if ((pImdb && rImdb && rImdb === pImdb) || (pTmdb && rTmdb && rTmdb === pTmdb)) {
        movieId = r.id || r.movieId || r.movie_id
        console.log('SubSource matched by ID, movieId:', movieId)
        break
      }
    }

    // Fall back to first result if no ID match
    if (!movieId) {
      const first = results[0]
      movieId = first.id || first.movieId || first.movie_id
      console.log('SubSource using first result, movieId:', movieId, 'title:', first.title || first.name)
    }
  } catch (err) {
    console.error('SubSource search exception:', err.message)
    return []
  }

  if (!movieId) {
    console.error('SubSource: could not determine movieId')
    return []
  }

  // Step 2: Get subtitles for this movie/show
  const subQuery = new URLSearchParams({ language: ssLang })
  if (type === 'tv' && season) subQuery.append('season', season)
  if (type === 'tv' && episode) subQuery.append('episode', episode)

  try {
    const subResp = await fetch(
      `https://api.subsource.net/api/v1/subtitles?movieId=${movieId}&${subQuery}`,
      { headers: { 'X-API-Key': SS_KEY, Accept: 'application/json' } }
    )

    if (!subResp.ok) {
      console.error(`SubSource subtitles HTTP error: ${subResp.status}`)
      return []
    }

    const subData = await subResp.json()
    console.log('SubSource subtitles raw keys:', Object.keys(subData || {}), 'count:', (subData?.data || subData?.results || subData?.subtitles || []).length)

    // Handle multiple possible response shapes
    const subs = subData?.data || subData?.results || subData?.subtitles || (Array.isArray(subData) ? subData : [])

    if (!subs.length) {
      console.log('SubSource: no subtitles found for movieId:', movieId, 'lang:', ssLang)
      return []
    }

    return subs.map(s => ({
      id: `ss_${s.id || s.subId || s.subtitleId}`,
      sd_id: null,
      name: s.releaseName || s.release_name || s.name || s.title || 'Unknown release',
      normalized_name: normalizeName(s.releaseName || s.release_name || s.name || s.title || ''),
      url: null,
      file_id: null,
      ss_id: s.id || s.subId || s.subtitleId,
      source: 'subsource',
      language,
      author: s.uploadedBy || s.uploaded_by || s.uploader || null,
      season: s.season || null,
      episode: s.episode || null,
      full_season: s.fullSeason || s.full_season || false,
    })).filter(s => s.ss_id)
  } catch (err) {
    console.error('SubSource subtitles exception:', err.message)
    return []
  }
}

function mergeResults(subdlSubs, openSubs, ssSubs, episode) {
  const combined = [...subdlSubs]
  const seen = new Set(subdlSubs.map(s => `${s.source}:${s.normalized_name}`))

  for (const sub of [...openSubs, ...ssSubs]) {
    const exactKey = `${sub.source}:${sub.normalized_name}`
    const crossKeySubdl = `subdl:${sub.normalized_name}`
    const crossKeySS = `subsource:${sub.normalized_name}`
    if (seen.has(exactKey) || seen.has(crossKeySubdl) || seen.has(crossKeySS)) continue
    seen.add(exactKey)
    combined.push(sub)
  }

  return sortCandidates(combined, episode)
    .map(({ normalized_name, ...rest }) => rest)
    .slice(0, 40)
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
  const SS_KEY = process.env.SUBSOURCE_API_KEY
  const params = { sd_id, imdb_id, tmdb_id, type, language, season, episode }

  const [subdlResult, openResult, ssResult] = await Promise.allSettled([
    fetchFromSubDL(params, SUBDL_KEY),
    fetchFromOpenSubtitles(params, OS_KEY),
    fetchFromSubSource(params, SS_KEY),
  ])

  if (subdlResult.status === 'rejected') {
    console.error('SubDL list error:', subdlResult.reason?.message || subdlResult.reason)
  }
  if (openResult.status === 'rejected') {
    console.error('OpenSubtitles list error:', openResult.reason?.message || openResult.reason)
  }
  if (ssResult.status === 'rejected') {
    console.error('SubSource list error:', ssResult.reason?.message || ssResult.reason)
  }

  const subdlSubs = subdlResult.status === 'fulfilled' ? subdlResult.value : []
  const openSubs = openResult.status === 'fulfilled' ? openResult.value : []
  const ssSubs = ssResult.status === 'fulfilled' ? ssResult.value : []
  const subtitles = mergeResults(subdlSubs, openSubs, ssSubs, episode)

  return res.status(200).json({
    subtitles,
    source: subtitles.length ? 'mixed' : 'none',
    providers: {
      subdl: subdlSubs.length,
      opensubtitles: openSubs.length,
      subsource: ssSubs.length,
    },
  })
}
