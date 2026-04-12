export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { sd_id, imdb_id, tmdb_id, type = 'movie', language, season, episode } = req.query
  if (!language) return res.status(400).json({ error: 'language required' })

  const SUBDL_KEY = process.env.SUBDL_API_KEY

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

    if (!data.status || !data.subtitles?.length) {
      return res.status(200).json({ subtitles: [], source: 'subdl' })
    }

    const episodeNum = episode ? parseInt(episode) : null

    let subtitles = data.subtitles.map(s => ({
      id: s.sd_id || s.url,
      name: s.release_name || s.name || 'Unknown release',
      url: s.url,
      download_link: s.url ? `https://dl.subdl.com${s.url}` : null,
      language: s.lang || language,
      author: s.author || null,
      season: s.season || null,
      episode: s.episode || null,
      full_season: s.full_season || false,
    }))

    // Sort: exact episode match first, full season packs last
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
  } catch (err) {
    console.error('Subtitles error:', err)
    return res.status(500).json({ error: err.message })
  }
}
