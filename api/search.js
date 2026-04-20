export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { query, type = 'movie', season, episode, year } = req.query
  if (!query) return res.status(400).json({ error: 'query required' })

  const SUBDL_KEY = process.env.SUBDL_API_KEY

  try {
    const params = new URLSearchParams({
      api_key: SUBDL_KEY,
      film_name: query,
      type,
    })
    if (year) params.append('year', year)
    if (type === 'tv' && season) params.append('season_number', season)
    if (type === 'tv' && episode) params.append('episode_number', episode)

    const url = `https://api.subdl.com/api/v1/subtitles?${params}`
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } })
    const data = await resp.json()

    if (!data.status) return res.status(200).json({ results: [], source: 'subdl' })

    const results = (data.results || []).slice(0, 8).map(r => ({
      id: r.sd_id || r.tmdb_id,
      title: r.name,
      year: r.year || (r.first_air_date ? r.first_air_date.slice(0, 4) : null),
      type: r.type,
      imdb_id: r.imdb_id,
      tmdb_id: r.tmdb_id,
      sd_id: r.sd_id,
    }))

    return res.status(200).json({ results, source: 'subdl' })
  } catch (err) {
    console.error('Search error:', err)
    return res.status(500).json({ error: err.message })
  }
}
