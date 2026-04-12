import React, { useState, useCallback } from 'react'
import { LANGUAGES } from '../lib/languages.js'
import { parseSrt, buildSrt, mergeSrts, downloadFile } from '../lib/srt.js'

const PREVIEW_LINES = [
  { en: "I'll be back.", th: 'ฉันจะกลับมา' },
  { en: "May the Force be with you.", th: 'ขอให้พลังสถิตกับเจ้า' },
  { en: "Why so serious?", th: 'ทำไมต้องจริงจังนัก?' },
]

export default function Home() {
  const [query, setQuery] = useState('')
  const [contentType, setContentType] = useState('movie')
  const [season, setSeason] = useState('')
  const [episode, setEpisode] = useState('')

  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [selectedTitle, setSelectedTitle] = useState(null)

  const [lang1, setLang1] = useState('EN')
  const [lang2, setLang2] = useState('')

  const [fetchingL1, setFetchingL1] = useState(false)
  const [fetchingL2, setFetchingL2] = useState(false)
  const [subResultsL1, setSubResultsL1] = useState([])
  const [subResultsL2, setSubResultsL2] = useState([])
  const [selectedSubL1, setSelectedSubL1] = useState(null)
  const [selectedSubL2, setSelectedSubL2] = useState(null)

  const [loadingL1, setLoadingL1] = useState(false)
  const [loadingL2, setLoadingL2] = useState(false)
  const [blocksL1, setBlocksL1] = useState([])
  const [blocksL2, setBlocksL2] = useState([])
  const [errorL1, setErrorL1] = useState('')
  const [errorL2, setErrorL2] = useState('')

  const [translatingL1, setTranslatingL1] = useState(false)
  const [translatingL2, setTranslatingL2] = useState(false)

  const [previewStyle, setPreviewStyle] = useState('transparent')
  const previewLine = PREVIEW_LINES[1]

  const handleSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    setSearchResults([])
    setSelectedTitle(null)
    setBlocksL1([])
    setBlocksL2([])
    setSubResultsL1([])
    setSubResultsL2([])
    setSelectedSubL1(null)
    setSelectedSubL2(null)

    try {
      const params = new URLSearchParams({ query: query.trim(), type: contentType })
      if (contentType === 'tv' && season) params.append('season', season)
      if (contentType === 'tv' && episode) params.append('episode', episode)
      const resp = await fetch(`/api/search?${params}`)
      const data = await resp.json()
      setSearchResults(data.results || [])
    } catch (err) {
      console.error(err)
    } finally {
      setSearching(false)
    }
  }

  const handleSelectTitle = (title) => {
    setSelectedTitle(title)
    setSearchResults([])
    setBlocksL1([])
    setBlocksL2([])
    setSubResultsL1([])
    setSubResultsL2([])
    setSelectedSubL1(null)
    setSelectedSubL2(null)
    setErrorL1('')
    setErrorL2('')
  }

  const fetchSubtitleList = async (language, setResults, setFetching, setError) => {
    if (!selectedTitle) return
    setFetching(true)
    setError('')
    setResults([])
    try {
      const params = new URLSearchParams({ language, type: contentType })
      if (selectedTitle.sd_id) params.append('sd_id', selectedTitle.sd_id)
      else if (selectedTitle.imdb_id) params.append('imdb_id', selectedTitle.imdb_id)
      else if (selectedTitle.tmdb_id) params.append('tmdb_id', selectedTitle.tmdb_id)
      if (contentType === 'tv' && season) params.append('season', season)
      if (contentType === 'tv' && episode) params.append('episode', episode)
      const resp = await fetch(`/api/subtitles?${params}`)
      const data = await resp.json()
      if (data.error) {
        setError('not_found')
        return
      }
      if (!data.subtitles || data.subtitles.length === 0) {
        setError('not_found')
        return
      }
      setResults(data.subtitles)
    } catch (err) {
      setError('not_found')
    } finally {
      setFetching(false)
    }
  }

  const loadSubContent = async (sub, setLoading, setBlocks, setError) => {
    setLoading(true)
    setError('')
    setBlocks([])
    try {
      const resp = await fetch('/api/fetch-sub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sub.url }),
      })
      const data = await resp.json()
      if (data.error) throw new Error(data.error)
      const parsed = parseSrt(data.content)
      if (!parsed.length) throw new Error('Could not parse subtitle file')
      setBlocks(parsed)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Auto-translate fallback: get EN subs then translate to target language
  const translateFallback = async (targetLangCode, setBlocks, setError, setTranslating) => {
    setTranslating(true)
    setError('')
    setBlocks([])

    try {
      // Step 1: fetch English subtitles list
      const params = new URLSearchParams({ language: 'EN', type: contentType })
      if (selectedTitle.sd_id) params.append('sd_id', selectedTitle.sd_id)
      else if (selectedTitle.imdb_id) params.append('imdb_id', selectedTitle.imdb_id)
      else if (selectedTitle.tmdb_id) params.append('tmdb_id', selectedTitle.tmdb_id)
      if (contentType === 'tv' && season) params.append('season', season)
      if (contentType === 'tv' && episode) params.append('episode', episode)

      const listResp = await fetch(`/api/subtitles?${params}`)
      const listData = await listResp.json()

      if (!listData.subtitles?.length) throw new Error('No English subtitles found to translate from')

      // Step 2: download first English sub
      const fetchResp = await fetch('/api/fetch-sub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: listData.subtitles[0].url }),
      })
      const fetchData = await fetchResp.json()
      if (fetchData.error) throw new Error(fetchData.error)

      // Step 3: translate to target language
      const targetLang = LANGUAGES.find(l => l.code === targetLangCode)?.label || targetLangCode
      const translateResp = await fetch('/api/translate-srt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          srtContent: fetchData.content,
          targetLanguage: targetLang,
          targetLanguageCode: targetLangCode,
        }),
      })
      const translateData = await translateResp.json()
      if (translateData.error) throw new Error(translateData.error)

      const parsed = parseSrt(translateData.content)
      if (!parsed.length) throw new Error('Translation produced empty result')
      setBlocks(parsed)

    } catch (err) {
      setError(err.message)
    } finally {
      setTranslating(false)
    }
  }

  const updateBlock = (blocks, setBlocks, idx, newText) => {
    const updated = [...blocks]
    updated[idx] = { ...updated[idx], text: newText }
    setBlocks(updated)
  }

  const handleDownloadSingle = () => {
    if (!blocksL1.length) return
    const srt = buildSrt(blocksL1)
    const title = selectedTitle?.title?.replace(/[^a-z0-9]/gi, '_') || 'subtitles'
    downloadFile(srt, `${title}_${lang1}.srt`)
  }

  const handleDownloadMerged = () => {
    if (!blocksL1.length || !blocksL2.length) return
    const merged = mergeSrts(blocksL1, blocksL2)
    const srt = buildSrt(merged)
    const title = selectedTitle?.title?.replace(/[^a-z0-9]/gi, '_') || 'subtitles'
    downloadFile(srt, `${title}_${lang1}_${lang2}_merged.srt`)
  }

  const lang1Label = LANGUAGES.find(l => l.code === lang1)?.label || lang1
  const lang2Label = lang2 ? (LANGUAGES.find(l => l.code === lang2)?.label || lang2) : null
  const hasDual = lang2 && blocksL2.length > 0

  return (
    <div>
      {/* NAV */}
      <nav className="nav">
        <div>
          <div className="nav-logo">Super<span>Sub</span>Hero</div>
        </div>
        <div className="nav-sub">Subtitle Search Engine</div>
      </nav>

      {/* HERO */}
      <div className="hero">
        <h1>Find Subtitles for<br /><em>Any Movie or Series</em></h1>
        <p>Search by title. Pick your languages. Edit if needed. Download single or dual-language SRT.</p>
      </div>

      {/* SEARCH */}
      <div className="search-wrap">
        <div className="type-toggle" style={{ marginBottom: 10 }}>
          <button className={`type-btn ${contentType === 'movie' ? 'active' : ''}`} onClick={() => setContentType('movie')}>Movie</button>
          <button className={`type-btn ${contentType === 'tv' ? 'active' : ''}`} onClick={() => setContentType('tv')}>TV Series</button>
        </div>

        <div className="search-box">
          <input
            type="text"
            placeholder={contentType === 'tv' ? 'Search TV series, anime, etc...' : 'Search movies, films, anime...'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
          <button className="search-btn" onClick={handleSearch} disabled={searching || !query.trim()}>
            {searching ? 'Searching...' : 'Search'}
          </button>
        </div>

        {contentType === 'tv' && (
          <div className="season-ep-row" style={{ marginTop: 10 }}>
            <input type="number" min="1" placeholder="Season (e.g. 1)" value={season} onChange={e => setSeason(e.target.value)} />
            <input type="number" min="1" placeholder="Episode (e.g. 1)" value={episode} onChange={e => setEpisode(e.target.value)} />
          </div>
        )}
      </div>

      {/* SEARCH RESULTS */}
      {searchResults.length > 0 && (
        <div className="results-list">
          <div className="results-label">Select a title</div>
          {searchResults.map(r => (
            <div key={r.id} className={`result-item ${selectedTitle?.id === r.id ? 'selected' : ''}`} onClick={() => handleSelectTitle(r)}>
              <div className="result-poster-placeholder">🎬</div>
              <div className="result-info">
                <div className="result-title">{r.title}</div>
                <div className="result-meta">{r.year || '—'} · {r.type === 'tv' ? 'TV Series' : 'Movie'}</div>
              </div>
              <div className="result-badge">{r.imdb_id || r.tmdb_id || ''}</div>
            </div>
          ))}
        </div>
      )}

      {/* SELECTED TITLE BANNER */}
      {selectedTitle && (
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 48px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', background: 'rgba(200,241,53,0.06)', border: '1px solid rgba(200,241,53,0.2)', borderRadius: 10 }}>
            <span style={{ fontSize: 20 }}>🎬</span>
            <div>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 15 }}>{selectedTitle.title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{selectedTitle.year} · {selectedTitle.type === 'tv' ? 'TV Series' : 'Movie'}</div>
            </div>
            <button onClick={() => { setSelectedTitle(null); setBlocksL1([]); setBlocksL2([]) }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>×</button>
          </div>
        </div>
      )}

      {/* WORKSPACE */}
      {selectedTitle && (
        <div className="workspace">
          {/* LEFT PANEL - LANG 1 */}
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">Primary Language</div>
              {blocksL1.length > 0 && <div className="panel-lang">{lang1Label} · {blocksL1.length} lines</div>}
            </div>
            <div className="panel-body">
              {blocksL1.length === 0 && !loadingL1 && !translatingL1 && (
                <div className="panel-empty">
                  <div className="panel-empty-icon">📄</div>
                  <div>Subtitle text will appear here</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>Select a subtitle from the center panel</div>
                </div>
              )}
              {(loadingL1 || translatingL1) && (
                <div className="panel-empty">
                  <div className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
                  <div>{translatingL1 ? `Translating to ${lang1Label}...` : 'Loading subtitle...'}</div>
                  {translatingL1 && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>This takes ~30 seconds for a full movie</div>}
                </div>
              )}
              {errorL1 && errorL1 !== 'not_found' && blocksL1.length === 0 && <div className="status-bar error">{errorL1}</div>}
              {blocksL1.map((block, idx) => (
                <div key={idx} className="sub-line">
                  <div className="sub-time">{block.start?.slice(0, 8)}</div>
                  <textarea
                    className="sub-text"
                    value={block.text}
                    onChange={e => updateBlock(blocksL1, setBlocksL1, idx, e.target.value)}
                    rows={block.text.split('\n').length}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* CENTER CONTROLS */}
          <div className="controls">
            <div className="controls-title">Controls</div>

            {/* LANG 1 */}
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Primary Language</div>
            <select className="lang-select" value={lang1} onChange={e => { setLang1(e.target.value); setBlocksL1([]); setSubResultsL1([]); setSelectedSubL1(null); setErrorL1('') }}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
            <button className="fetch-btn" onClick={() => fetchSubtitleList(lang1, setSubResultsL1, setFetchingL1, setErrorL1)} disabled={fetchingL1 || !selectedTitle}>
              {fetchingL1 ? 'Searching...' : `Find ${lang1Label} Subtitles`}
            </button>

            {/* NOT FOUND — show translate fallback option */}
            {errorL1 === 'not_found' && !blocksL1.length && !translatingL1 && (
              <div style={{ background: 'rgba(123,94,167,0.1)', border: '1px solid rgba(123,94,167,0.3)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 12, color: '#c4a8f0', marginBottom: 8 }}>No {lang1Label} subtitles found in database.</div>
                <button
                  className="fetch-btn"
                  onClick={() => translateFallback(lang1, setBlocksL1, setErrorL1, setTranslatingL1)}
                  style={{ background: 'rgba(123,94,167,0.4)', fontSize: 12 }}
                >
                  ✨ AI Translate from English
                </button>
              </div>
            )}

            {errorL1 && errorL1 !== 'not_found' && !subResultsL1.length && <div className="status-bar error" style={{ fontSize: 11 }}>{errorL1}</div>}

            {subResultsL1.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Pick a release</div>
                {subResultsL1.slice(0, 8).map((s, i) => (
                  <div key={i} className={`sub-result-item ${selectedSubL1?.id === s.id ? 'selected' : ''}`} onClick={() => { setSelectedSubL1(s); loadSubContent(s, setLoadingL1, setBlocksL1, setErrorL1) }}>
                    <div className="sub-result-name">{s.name}</div>
                    {s.episode > 0 && <div className="sub-result-meta">E{s.episode}</div>}
                    {(s.full_season || s.episode === 0) && <div className="sub-result-meta" style={{color:'var(--muted)'}}>Full</div>}
                  </div>
                ))}
              </div>
            )}

            <div className="divider" />

            {/* LANG 2 */}
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Second Language (Optional)</div>
            <select className="lang-select" value={lang2} onChange={e => { setLang2(e.target.value); setBlocksL2([]); setSubResultsL2([]); setSelectedSubL2(null); setErrorL2('') }}>
              <option value="">— None (single language) —</option>
              {LANGUAGES.filter(l => l.code !== lang1).map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>

            {lang2 && (
              <>
                <button className="fetch-btn" onClick={() => fetchSubtitleList(lang2, setSubResultsL2, setFetchingL2, setErrorL2)} disabled={fetchingL2 || !selectedTitle}>
                  {fetchingL2 ? 'Searching...' : `Find ${lang2Label} Subtitles`}
                </button>

                {/* NOT FOUND — show translate fallback */}
                {errorL2 === 'not_found' && !blocksL2.length && !translatingL2 && (
                  <div style={{ background: 'rgba(123,94,167,0.1)', border: '1px solid rgba(123,94,167,0.3)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 12, color: '#c4a8f0', marginBottom: 8 }}>No {lang2Label} subtitles found in database.</div>
                    <button
                      className="fetch-btn"
                      onClick={() => translateFallback(lang2, setBlocksL2, setErrorL2, setTranslatingL2)}
                      style={{ background: 'rgba(123,94,167,0.4)', fontSize: 12 }}
                    >
                      ✨ AI Translate from English
                    </button>
                  </div>
                )}

                {(loadingL2 || translatingL2) && (
                  <div className="status-bar loading">
                    <div className="spinner" />
                    {translatingL2 ? `Translating to ${lang2Label}...` : 'Loading...'}
                  </div>
                )}

                {errorL2 && errorL2 !== 'not_found' && !subResultsL2.length && <div className="status-bar error" style={{ fontSize: 11 }}>{errorL2}</div>}

                {subResultsL2.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Pick a release</div>
                    {subResultsL2.slice(0, 8).map((s, i) => (
                      <div key={i} className={`sub-result-item ${selectedSubL2?.id === s.id ? 'selected' : ''}`} onClick={() => { setSelectedSubL2(s); loadSubContent(s, setLoadingL2, setBlocksL2, setErrorL2) }}>
                        <div className="sub-result-name">{s.name}</div>
                        {s.episode > 0 && <div className="sub-result-meta">E{s.episode}</div>}
                        {(s.full_season || s.episode === 0) && <div className="sub-result-meta" style={{color:'var(--muted)'}}>Full</div>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="divider" />

            {/* PREVIEW */}
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Preview</div>
            <div className={`preview-box ${previewStyle === 'black' ? 'bg-black' : 'bg-transparent'}`}>
              <div className="preview-line">{previewLine.en}</div>
              {lang2 && <div className="preview-line lang2">{previewLine.th}</div>}
            </div>


            <div className="divider" />

            {/* DOWNLOADS */}
            <button className="dl-btn" onClick={handleDownloadSingle} disabled={!blocksL1.length}>
              ↓ Download Single ({lang1Label})
            </button>
            <button className="dl-btn secondary" onClick={handleDownloadMerged} disabled={!hasDual}>
              ↓ Download Merged ({lang2 ? `${lang1} + ${lang2}` : 'select 2nd lang'})
            </button>

            <div className="fallback-link">
              Can't find it? Try <a href="https://www.subtitlecat.com" target="_blank" rel="noreferrer">SubtitleCat</a> or <a href="https://subdl.com" target="_blank" rel="noreferrer">SubDL</a> manually.
            </div>
          </div>

          {/* RIGHT PANEL - LANG 2 */}
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">Second Language</div>
              {blocksL2.length > 0 && <div className="panel-lang">{lang2Label} · {blocksL2.length} lines</div>}
            </div>
            <div className="panel-body">
              {!lang2 && (
                <div className="panel-empty">
                  <div className="panel-empty-icon">🌍</div>
                  <div>Select a second language</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>Optional — for dual-language merged SRT</div>
                </div>
              )}
              {lang2 && blocksL2.length === 0 && !loadingL2 && !translatingL2 && (
                <div className="panel-empty">
                  <div className="panel-empty-icon">📄</div>
                  <div>Second subtitle will appear here</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>Find and select a {lang2Label} release</div>
                </div>
              )}
              {(loadingL2 || translatingL2) && (
                <div className="panel-empty">
                  <div className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
                  <div>{translatingL2 ? `Translating to ${lang2Label}...` : 'Loading subtitle...'}</div>
                  {translatingL2 && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>~30 seconds for a full movie</div>}
                </div>
              )}
              {errorL2 && errorL2 !== 'not_found' && blocksL2.length === 0 && <div className="status-bar error">{errorL2}</div>}
              {blocksL2.map((block, idx) => (
                <div key={idx} className="sub-line">
                  <div className="sub-time">{block.start?.slice(0, 8)}</div>
                  <textarea
                    className="sub-text"
                    value={block.text}
                    onChange={e => updateBlock(blocksL2, setBlocksL2, idx, e.target.value)}
                    rows={block.text.split('\n').length}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
