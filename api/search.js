import { requireAuth } from './_auth.js'

// Title search across every provider we have a key for.
//
// This used to be SubDL only, so a SubDL outage or a title SubDL does not carry meant no
// search at all, even though the subtitle listing already used three providers.
//
// The other win is ID merging: SubDL knows a title by its own sd_id, OpenSubtitles and
// SubSource know it by IMDb/TMDb. The same film found in two providers is merged into one
// result carrying every ID, and api/subtitles.js can then ask all three providers about it.
// Previously a SubDL-only result had just an sd_id, which is what starved OpenSubtitles.

const SUBSOURCE_TYPE = { movie: 'movie', tv: 'series' }

function normalizeTitle(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/[._]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const cleanImdb = v => (v ? String(v).replace(/^tt/, '').replace(/\D/g, '') : '')

async function searchSubDL({ query, type, year, season, episode }, key) {
  if (!key) return []
  const params = new URLSearchParams({ api_key: key, film_name: query, type })
  if (year) params.append('year', year)
  if (type === 'tv' && season) params.append('season_number', season)
  if (type === 'tv' && episode) params.append('episode_number', episode)

  const resp = await fetch(`https://api.subdl.com/api/v1/subtitles?${params}`, { headers: { Accept: 'application/json' } })
  if (!resp.ok) throw new Error(`SubDL error: ${resp.status}`)
  const data = await resp.json()
  if (!data.status) return []

  return (data.results || []).map(r => ({
    title: r.name,
    year: r.year || (r.first_air_date ? String(r.first_air_date).slice(0, 4) : null),
    type: r.type,
    imdb_id: r.imdb_id || null,
    tmdb_id: r.tmdb_id || null,
    sd_id: r.sd_id || null,
    provider: 'subdl',
  }))
}

// The /subtitles endpoint takes a free-text query and returns feature_details for each hit;
// collapsing those gives a title list without needing a second endpoint. For a series we
// want the show, which lives in the parent_* fields of an episode result.
async function searchOpenSubtitles({ query, type, year, season, episode }, key) {
  if (!key) return []
  const params = new URLSearchParams({ query, languages: 'en' })
  params.append('type', type === 'tv' ? 'episode' : 'movie')
  if (year) params.append('year', year)
  if (type === 'tv' && season) params.append('season_number', season)
  if (type === 'tv' && episode) params.append('episode_number', episode)

  const resp = await fetch(`https://api.opensubtitles.com/api/v1/subtitles?${params}`, {
    headers: { 'Api-Key': key, 'Content-Type': 'application/json', 'User-Agent': 'SuperSubHero v2.0' },
  })
  if (!resp.ok) throw new Error(`OpenSubtitles error: ${resp.status}`)
  const data = await resp.json()

  const out = []
  for (const item of data.data || []) {
    const fd = item.attributes?.feature_details
    if (!fd) continue
    const isEpisode = type === 'tv' && (fd.parent_title || fd.parent_imdb_id)
    out.push({
      title: (isEpisode ? fd.parent_title : fd.title || fd.movie_name) || fd.movie_name || fd.title,
      year: fd.year ? String(fd.year) : null,
      type: type === 'tv' ? 'tv' : 'movie',
      imdb_id: (isEpisode ? fd.parent_imdb_id : fd.imdb_id) || null,
      tmdb_id: (isEpisode ? fd.parent_tmdb_id : fd.tmdb_id) || null,
      sd_id: null,
      provider: 'opensubtitles',
    })
  }
  return out.filter(r => r.title)
}

async function searchSubSource({ query, type, year, season }, key) {
  if (!key) return []
  const params = new URLSearchParams({ searchType: 'text', q: query, type: SUBSOURCE_TYPE[type] || 'movie' })
  if (year) params.append('year', year)
  if (type === 'tv' && season) params.append('season', season)

  const resp = await fetch(`https://api.subsource.net/api/v1/movies/search?${params}`, {
    headers: { 'X-API-Key': key, Accept: 'application/json' },
  })
  if (!resp.ok) throw new Error(`SubSource error: ${resp.status}`)
  const data = await resp.json()

  return (Array.isArray(data?.data) ? data.data : [])
    .filter(m => m.title || m.movieId)
    .map(m => ({
      title: m.title || m.alternateTitle,
      year: m.releaseYear ? String(m.releaseYear) : null,
      type: m.type === 'series' || m.type === 'tv' ? 'tv' : 'movie',
      imdb_id: m.imdbId || null,
      tmdb_id: m.tmdbId || null,
      sd_id: null,
      provider: 'subsource',
    }))
}

// One result per title, carrying every ID any provider gave us for it.
function mergeTitles(groups, wantedQuery) {
  const byKey = new Map()

  const keysFor = r => {
    const keys = []
    const imdb = cleanImdb(r.imdb_id)
    if (imdb) keys.push(`imdb:${imdb}`)
    if (r.tmdb_id) keys.push(`tmdb:${r.tmdb_id}`)
    const t = normalizeTitle(r.title)
    if (t) keys.push(`title:${t}|${r.year || ''}`)
    return keys
  }

  for (const list of groups) {
    for (const r of list) {
      if (!r.title) continue
      const keys = keysFor(r)
      const existing = keys.map(k => byKey.get(k)).find(Boolean)
      if (existing) {
        // Fill in whatever this provider knows that we did not already have.
        existing.imdb_id = existing.imdb_id || r.imdb_id
        existing.tmdb_id = existing.tmdb_id || r.tmdb_id
        existing.sd_id = existing.sd_id || r.sd_id
        existing.year = existing.year || r.year
        if (!existing.providers.includes(r.provider)) existing.providers.push(r.provider)
        for (const k of keysFor(existing)) byKey.set(k, existing)
      } else {
        const entry = { ...r, providers: [r.provider] }
        delete entry.provider
        for (const k of keys) byKey.set(k, entry)
        byKey.set(`__self:${byKey.size}`, entry)
      }
    }
  }

  const unique = [...new Set(byKey.values())]
  const wanted = normalizeTitle(wantedQuery)

  const score = r => {
    let s = 0
    const t = normalizeTitle(r.title)
    if (t === wanted) s += 100
    else if (t.startsWith(wanted)) s += 60
    else if (t.includes(wanted)) s += 30
    // A title known to more providers, with more IDs, gives the listing step more to work with.
    s += r.providers.length * 8
    if (r.imdb_id) s += 6
    if (r.tmdb_id) s += 3
    if (r.sd_id) s += 3
    return s
  }

  return unique
    .sort((a, b) => score(b) - score(a))
    .slice(0, 10)
    .map((r, i) => ({
      id: r.imdb_id || r.tmdb_id || r.sd_id || `t${i}`,
      title: r.title,
      year: r.year,
      type: r.type,
      imdb_id: r.imdb_id,
      tmdb_id: r.tmdb_id,
      sd_id: r.sd_id,
      providers: r.providers,
    }))
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { query, type = 'movie', season, episode, year } = req.query
  if (!query) return res.status(400).json({ error: 'query required' })

  const args = { query: String(query).trim(), type, season, episode, year }
  const attempts = [
    ['subdl', searchSubDL, process.env.SUBDL_API_KEY],
    ['opensubtitles', searchOpenSubtitles, process.env.OPENSUBTITLES_API_KEY],
    ['subsource', searchSubSource, process.env.SUBSOURCE_API_KEY],
  ]

  const settled = await Promise.allSettled(attempts.map(([, fn, key]) => fn(args, key)))
  const found = {}
  const errors = {}
  const groups = []

  settled.forEach((result, i) => {
    const name = attempts[i][0]
    if (result.status === 'fulfilled') {
      found[name] = result.value.length
      groups.push(result.value)
    } else {
      found[name] = 0
      errors[name] = result.reason?.message || String(result.reason)
      console.error(`Title search failed for ${name}:`, errors[name])
    }
  })

  const results = mergeTitles(groups, args.query)
  console.log(`Title search "${args.query}" (${type}): subdl=${found.subdl} opensubtitles=${found.opensubtitles} subsource=${found.subsource} -> ${results.length} titles`)

  return res.status(200).json({
    results,
    source: results.length ? 'mixed' : 'none',
    providers: found,
    ...(Object.keys(errors).length ? { providerErrors: errors } : {}),
  })
}

export default requireAuth(handler)
