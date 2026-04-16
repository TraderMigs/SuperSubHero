// Language code map: SubDL codes → OpenSubtitles language codes
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

async function fetchFromOpenSubtitles(params, OS_KEY) {
  const { imdb_id, tmdb_id, type, language, season, episode } = params

  const osLang = OS_LANG_MAP[language] || language.toLowerCase()
  const searchParams = new URLSearchParams({ languages: osLang })

  if (imdb_id) searchParams.append('imdb_id', imdb_id.replace('tt', ''))
  else if (tmdb_id) {
    searchParams.append('tmdb_id', tmdb_id)
    searchParams.append('type', type === 'tv' ? 'episode' : 'movie')
  }

  if (type === 'tv' && season) searchParams.append('season_number', season)
  if (type === 'tv' && episode) searchParams.append('episode_number', episode)

  const url = `https://api.opensubtitles.com/api/v1/subtitles?${searchParams}`
  const resp = await fetch(url, {
    headers: {
      'Api-Key': OS_KEY,
      'Content-Type': 'application/json',
      'User-Agent': 'SuperSubHero v2.0',
    }
  })

  if (!resp.ok) throw new Error(`OpenSubtitles error: ${resp.status}`)
  const data = await resp.json()
  if (!data.data?.length) return []

  const episodeNum = episode ? parseInt(episode) : null

  let subtitles = data.data.map(s => {
    const file = s.attributes?.files?.[0]
    return {
      id: `os_${s.id}`,
      name: s.attributes?.release || s.attributes?.filename || 'Unknown release',
      url: null,
      file_id: file?.file_id || null,
      source: 'opensubtitles',
      language: language,
      season: s.attributes?.feature_details?.season_number || null,
      episode: s.attributes?.feature_details?.episode_number || null,
      full_season: false,
    }
  }).filter(s => s.file_id)

  if (episodeNum) {
    subtitles = subtitles.sort((a, b) => {
      const aExact = a.episode === episodeNum
      const bExact = b.episode === episodeNum
      if (aExact && !bExact) return -1
      if (!aExact && bExact) return 1
      return 0
    })
  }

  return subtitles.slice(0, 20)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { sd_id, imdb_id, tmdb_id, type = 'movie', language, season, episode } = req.query
  if (!language) return res.status(400).json({ error: 'language required' })

  const SUBDL_KEY = process.env.SUBDL_API_KEY
  const OS_KEY = process.env.OPENSUBTITLES_API_KEY

  // ── SUBDL ─────────────────────────────────────────────────────────────────
  try {
    const params = new URLSearchParams({
      api_key: SUBDL_KEY,
      languages: language,
      type,
      releases: '1',
    })

    if (sd_id) params.append('sd_id', sd_id)
    else if (imdb_id) params.append('imdb_id', imdb_id)
    else if (tmdb_id) params.append('tmdb_id', tmdb_id)

    if (type === 'tv' && season) params.append('season_number', season)
    if (type === 'tv' && episode) params.append('episode_number', episode)

    const url = `https://api.subdl.com/api/v1/subtitles?${params}`
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } })
    const data = await resp.json()

    if (data.status && data.subtitles?.length) {
      const episodeNum = episode ? parseInt(episode) : null

      let subtitles = data.subtitles.map(s => ({
        id: s.sd_id || s.url,
        sd_id: s.sd_id || null,
        name: s.release_name || s.name || 'Unknown release',
        url: s.url,
        source: 'subdl',
        language: s.lang || language,
        author: s.author || null,
        season: s.season || null,
        episode: s.episode || null,
        full_season: s.full_season || false,
      }))

      if (episodeNum) {
        subtitles = subtitles.sort((a, b) => {
          const aExact = a.episode === episodeNum
          const bExact = b.episode === episodeNum
          const aFull = a.full_season || a.episode === 0
          const bFull = b.full_season || b.episode === 0
          if (aExact && !bExact) return -1
          if (!aExact && bExact) return 1
          if (aFull && !bFull) return 1
          if (!aFull && bFull) return -1
          return 0
        })
      }

      return res.status(200).json({ subtitles: subtitles.slice(0, 20), source: 'subdl' })
    }
  } catch (err) {
    console.error('SubDL error:', err.message)
  }

  // ── OPENSUBTITLES FALLBACK ────────────────────────────────────────────────
  if (!OS_KEY) {
    return res.status(200).json({ subtitles: [], source: 'none' })
  }

  try {
    const subtitles = await fetchFromOpenSubtitles(
      { imdb_id, tmdb_id, type, language, season, episode },
      OS_KEY
    )
    return res.status(200).json({ subtitles, source: 'opensubtitles' })
  } catch (err) {
    console.error('OpenSubtitles error:', err.message)
    return res.status(200).json({ subtitles: [], source: 'none' })
  }
}
